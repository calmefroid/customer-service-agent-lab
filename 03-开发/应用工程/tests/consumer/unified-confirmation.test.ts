import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { UnifiedConfirmationCard } from "@/components/chat/ConfirmationCards";
import {
  ConfirmationSubmissionGate,
  createConfirmationCommand,
  getConfirmationPresentation,
  isConfirmationExpired,
  isConfirmationExpiryError,
  isWriteConfirmationAction,
  updateConfirmationSnapshot,
} from "@/components/chat/confirmation-flow";
import { applyAgentEvent, createStreamState, finishStream } from "@/components/chat/stream-state";
import type { AgentEvent, ConfirmationOperation, ConfirmationRequest } from "@/lib/contracts";

function confirmation(
  operation: ConfirmationOperation,
  draftSnapshot: Record<string, unknown>,
  overrides: Partial<ConfirmationRequest> = {},
): ConfirmationRequest {
  return {
    confirmationRequestId: `confirmation-${operation}`,
    sessionId: "consumer-stage3",
    traceId: "trace-consumer-stage3",
    operation,
    target: { type: operation === "logistics_urge" ? "shipment" : operation === "service_ticket_create" ? "service_ticket" : operation === "return_exchange_create" ? "return_request" : "order", id: "target-1" },
    draftSnapshot,
    riskLevel: "medium",
    risks: ["确认后才会执行本次操作"],
    confirmationToken: `server-token-${operation}`,
    idempotencyKey: `server-idempotency-${operation}`,
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2099-09-01T00:15:00.000Z",
    ...overrides,
  };
}

const eventBase = {
  contractVersion: "1.1.0",
  sessionId: "consumer-stage3",
  traceId: "trace-consumer-stage3",
  createdAt: "2026-09-01T00:00:00.000Z",
} as const;

describe("stage 3 consumer unified confirmation", () => {
  it("submits the edited final snapshot with server-issued opaque fields", () => {
    const request = confirmation("return_exchange_create", {
      orderId: "OD-1",
      serviceType: "exchange",
      product: "吸顶灯",
      reason: "到货破损",
      itemCondition: "未通电",
      contactPhone: "138****6821",
      pickupAddress: "原地址",
    });
    const edited = updateConfirmationSnapshot(request.draftSnapshot, "pickupAddress", "编辑后的最终地址");
    const command = createConfirmationCommand(request, "confirm", edited);

    expect(command).toEqual({
      confirmationRequestId: request.confirmationRequestId,
      confirmationToken: request.confirmationToken,
      idempotencyKey: request.idempotencyKey,
      action: "confirm",
      finalSnapshot: { ...request.draftSnapshot, pickupAddress: "编辑后的最终地址" },
    });
    expect(command).not.toHaveProperty("operation");
    expect(request.draftSnapshot.pickupAddress).toBe("原地址");
  });

  it("sends edits as modify and only confirms a server-issued replacement draft", () => {
    const original = confirmation("service_ticket_create", {
      serviceType: "repair",
      product: "吸顶灯",
      purchaseChannel: "online",
      issueDescription: "不亮",
      contactPhone: "138****6821",
      serviceAddress: "原地址",
      preferredContactTime: "工作日",
    });
    const edited = updateConfirmationSnapshot(original.draftSnapshot, "serviceAddress", "编辑后的地址");
    const modify = createConfirmationCommand(original, "modify", edited);
    const replacement = confirmation("service_ticket_create", edited, {
      confirmationRequestId: "replacement-confirmation",
      confirmationToken: "replacement-token",
      idempotencyKey: "replacement-idempotency",
    });
    const confirmReplacement = createConfirmationCommand(replacement, "confirm", replacement.draftSnapshot);

    expect(modify.action).toBe("modify");
    expect(modify.finalSnapshot).toEqual(edited);
    expect(confirmReplacement.confirmationRequestId).toBe("replacement-confirmation");
    expect(confirmReplacement.confirmationToken).toBe("replacement-token");
    expect(confirmReplacement.idempotencyKey).toBe("replacement-idempotency");
    expect(confirmReplacement).not.toEqual(expect.objectContaining({ confirmationToken: original.confirmationToken }));
  });

  it("maps cancel to a non-write command without a final snapshot", () => {
    const request = confirmation("logistics_urge", { orderId: "OD-1", shipmentId: "SHIP-1", reason: "轨迹未更新" });
    const command = createConfirmationCommand(request, "cancel");

    expect(isWriteConfirmationAction("cancel")).toBe(false);
    expect(command).toEqual({
      confirmationRequestId: request.confirmationRequestId,
      confirmationToken: request.confirmationToken,
      idempotencyKey: request.idempotencyKey,
      action: "cancel",
    });
    expect(command).not.toHaveProperty("finalSnapshot");
  });

  it("locks synchronously so repeated clicks send only once", async () => {
    const gate = new ConfirmationSubmissionGate();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => pending);

    const first = gate.run(send);
    const duplicate = await gate.run(send);

    expect(gate.locked).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(duplicate).toEqual({ accepted: false, reason: "duplicate" });
    release();
    await first;
    expect(gate.locked).toBe(false);
  });

  it("preserves the edited snapshot and server-issued retry key after a retryable failure", async () => {
    const request = confirmation("order_change", { orderId: "OD-1", deliveryAddress: "原地址", contactPhone: "138****6821" });
    const edited = updateConfirmationSnapshot(request.draftSnapshot, "deliveryAddress", "失败后仍保留的新地址");
    const gate = new ConfirmationSubmissionGate();
    const send = vi.fn(async (_command: ReturnType<typeof createConfirmationCommand>) => ({ status: "error" as const, message: "网络失败", retryable: true }));

    const result = await gate.run(() => send(createConfirmationCommand(request, "confirm", edited)));
    const safeRetry = createConfirmationCommand(request, "confirm", edited);

    expect(result.accepted).toBe(true);
    expect(gate.locked).toBe(false);
    expect(send).toHaveBeenCalledWith(safeRetry);
    expect(safeRetry.finalSnapshot).toEqual({ ...request.draftSnapshot, deliveryAddress: "失败后仍保留的新地址" });
    expect(safeRetry.idempotencyKey).toBe(request.idempotencyKey);
  });

  it("never commits a buffered success card when the tool stream fails", () => {
    let state = createStreamState("request-failure");
    state = applyAgentEvent(state, {
      ...eventBase,
      type: "ui",
      eventId: "event-ui",
      sequence: 1,
      ui: { kind: "service_ticket_success", ticketNo: "SHOULD-NOT-RENDER", serviceType: "维修服务" },
    } as AgentEvent);
    state = applyAgentEvent(state, {
      ...eventBase,
      type: "error",
      eventId: "event-error",
      sequence: 2,
      error: { code: "TOOL_TIMEOUT", message: "提交超时", retryable: true },
    } as AgentEvent);

    expect(state.message).toBeUndefined();
    expect(state.pendingUi).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("SHOULD-NOT-RENDER");
  });

  it("recognizes expired confirmations and guides regeneration", () => {
    const expired = confirmation("order_change", { orderId: "OD-1", deliveryAddress: "新地址" }, { expiresAt: "2026-08-31T23:59:59.000Z" });
    expect(isConfirmationExpired(expired, Date.parse("2026-09-01T00:00:00.000Z"))).toBe(true);
    expect(isConfirmationExpiryError("CONFIRMATION_EXPIRED")).toBe(true);
    expect(isConfirmationExpiryError(undefined, "业务拒绝：CONFIRMATION_EXPIRED")).toBe(true);
  });

  it("does not dispatch after stop and keeps the stream free of success UI", async () => {
    const gate = new ConfirmationSubmissionGate();
    const controller = new AbortController();
    const write = vi.fn(async () => ({ status: "completed" as const }));
    controller.abort();

    const result = await gate.run(write, controller.signal);
    const stopped = finishStream(createStreamState("request-stopped"), { kind: "stopped" });

    expect(result).toEqual({ accepted: false, reason: "stopped" });
    expect(write).not.toHaveBeenCalled();
    expect(stopped.message).toBeUndefined();
    expect(stopped.pendingUi).toBeUndefined();
  });

  it("registers public draft fields for logistics, order change, return, repair and installation", () => {
    const requests = [
      confirmation("logistics_urge", { orderId: "OD-1", shipmentId: "SHIP-1", reason: "轨迹未更新" }),
      confirmation("order_change", { orderId: "OD-1", deliveryAddress: "新地址", contactPhone: "138****6821" }),
      confirmation("return_exchange_create", { orderId: "OD-1", serviceType: "exchange", product: "吸顶灯", reason: "破损", itemCondition: "未通电", contactPhone: "138****6821", pickupAddress: "地址" }),
      confirmation("service_ticket_create", { serviceType: "repair", product: "吸顶灯", purchaseChannel: "online", issueDescription: "不亮", contactPhone: "138****6821", serviceAddress: "地址", preferredContactTime: "工作日", riskLevel: "low" }),
      confirmation("service_ticket_create", { serviceType: "installation", product: "吸顶灯", purchaseChannel: "store", issueDescription: "上门安装", contactPhone: "138****6821", serviceAddress: "地址", preferredContactTime: "周末", riskLevel: "low" }),
    ];

    expect(requests.map((request) => getConfirmationPresentation(request).title)).toEqual([
      "确认物流催办",
      "确认订单变更",
      "确认退换申请",
      "确认维修工单",
      "确认安装工单",
    ]);
    expect(requests.every((request) => getConfirmationPresentation(request).fields.some((field) => field.editable))).toBe(true);
  });

  it("keeps opaque credentials and unregistered internal data out of consumer DOM", () => {
    const request = confirmation("return_exchange_create", {
      orderId: "OD-1",
      serviceType: "exchange",
      product: "吸顶灯",
      reason: "破损",
      itemCondition: "未通电",
      contactPhone: "138****6821",
      pickupAddress: "地址",
      internalToolParameters: "SECRET_TOOL_PARAMETERS",
      prompt: "SECRET_PROMPT",
      knowledgeId: "SECRET_KNOWLEDGE_ID",
    });
    const html = renderToStaticMarkup(createElement(UnifiedConfirmationCard, {
      request,
      busy: false,
      onDecision: async () => ({ status: "completed" as const }),
      onRegenerate: async () => ({ status: "completed" as const }),
    }));

    expect(html).not.toContain(request.confirmationRequestId);
    expect(html).not.toContain(request.confirmationToken);
    expect(html).not.toContain(request.idempotencyKey);
    expect(html).not.toContain(request.operation);
    expect(html).not.toContain("SECRET_TOOL_PARAMETERS");
    expect(html).not.toContain("SECRET_PROMPT");
    expect(html).not.toContain("SECRET_KNOWLEDGE_ID");
    expect(html).toContain("确认退换申请");
  });
});
