import { beforeEach, describe, expect, it } from "vitest";

import type { ConfirmationCommand, ConfirmationRequest } from "@/lib/contracts";
import type {
  ConfirmedWrite,
  LogisticsUrgeDraft,
  OrderCancelDraft,
  OrderChangeDraft,
  ReturnExchangeDraft,
  ServiceTicketDraft,
  WorkflowContext,
} from "@/lib/domain/business";
import { BusinessWorkflowService } from "@/lib/domain/business-workflow";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import { businessStore } from "@/lib/stores/business/business-store";
import { ConfirmationStore, confirmationStore } from "@/lib/stores/business/confirmation-store";

const context: WorkflowContext = {
  sessionId: "stage3-confirmation-session",
  traceId: "stage3-confirmation-trace",
  identity: { customerId: DEMO_CUSTOMER_ID, verified: true },
};

const orderChangeDraft: OrderChangeDraft = {
  orderId: "OD202608050088",
  deliveryAddress: "草稿演示地址",
};

const orderCancelDraft: OrderCancelDraft = {
  orderId: "OD202608050088",
  reason: "用户不再需要",
};

const logisticsDraft: LogisticsUrgeDraft = {
  orderId: "OD202608180236",
  shipmentId: "SHIP-SF14900000628",
  reason: "物流轨迹长时间未更新",
};

const returnDraft: ReturnExchangeDraft = {
  orderId: "OD202608100119",
  serviceType: "exchange",
  product: "智控系列吸顶灯 ZC80",
  reason: "收货破损",
  itemCondition: "灯罩可见破裂，未通电",
  evidence: ["damage-demo.jpg"],
  contactPhone: "138****8001",
  pickupAddress: "原演示地址",
};

const ticketDraft: ServiceTicketDraft = {
  serviceType: "repair",
  product: "悦享系列 LED 吸顶灯",
  purchaseChannel: "online",
  issueDescription: "重启后仍然闪烁",
  contactPhone: "138****8001",
  serviceAddress: "上海市演示地址",
  preferredContactTime: "工作日",
  riskLevel: "low",
};

function command<T extends Record<string, unknown>>(
  request: ConfirmationRequest<T>,
  action: "confirm" | "modify",
  finalSnapshot: T,
): ConfirmationCommand<T> {
  return {
    confirmationRequestId: request.confirmationRequestId,
    confirmationToken: request.confirmationToken,
    idempotencyKey: request.idempotencyKey,
    action,
    finalSnapshot,
  };
}

function cancelCommand(request: ConfirmationRequest): ConfirmationCommand {
  return {
    confirmationRequestId: request.confirmationRequestId,
    confirmationToken: request.confirmationToken,
    idempotencyKey: request.idempotencyKey,
    action: "cancel",
  };
}

describe("stage 3 unified business confirmation", () => {
  const service = new BusinessWorkflowService();

  beforeEach(() => businessStore.reset());

  it("stores complete pending requests for all five ordinary write operations", async () => {
    const prepared = await Promise.all([
      service.prepareOrderChange(context, orderChangeDraft),
      service.prepareOrderCancel(context, orderCancelDraft),
      service.prepareLogisticsUrge(context, logisticsDraft),
      service.prepareReturnExchange(context, returnDraft),
      service.prepareServiceTicket(context, ticketDraft),
    ]);
    expect(prepared.every((result) => result.status === "success")).toBe(true);
    const requests = prepared.flatMap((result) => result.status === "success" ? [result.data] : []);
    expect(requests.map((request) => request.operation)).toEqual([
      "order_change",
      "order_cancel",
      "logistics_urge",
      "return_exchange_create",
      "service_ticket_create",
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        sessionId: context.sessionId,
        traceId: context.traceId,
        confirmationRequestId: expect.any(String),
        confirmationToken: expect.any(String),
        idempotencyKey: expect.any(String),
        draftSnapshot: expect.any(Object),
        expiresAt: expect.any(String),
        target: { type: expect.any(String), id: expect.any(String) },
      });
      const stored = confirmationStore.get(request.confirmationRequestId);
      expect(stored?.status).toBe("pending");
      expect(stored?.tokenDigest).not.toBe(request.confirmationToken);
      expect(stored?.request).not.toHaveProperty("confirmationToken");
    }
  });

  it("rejects submit without a server-side pending request", async () => {
    const fakeRequest: ConfirmationRequest<ReturnExchangeDraft> = {
      confirmationRequestId: "confirmation-forged",
      confirmationToken: "forged-token",
      idempotencyKey: "forged-idempotency",
      sessionId: context.sessionId,
      traceId: context.traceId,
      operation: "return_exchange_create",
      target: { type: "return_request", id: returnDraft.orderId },
      draftSnapshot: returnDraft,
      riskLevel: "medium",
      risks: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const write: ConfirmedWrite<ReturnExchangeDraft> = {
      request: fakeRequest,
      confirmationToken: fakeRequest.confirmationToken,
      idempotencyKey: fakeRequest.idempotencyKey,
      finalSnapshot: returnDraft,
    };
    const result = await service.submitReturnExchange(context, write);
    expect(result).toMatchObject({ status: "business_error", data: null, error: { code: "NOT_FOUND" } });
    expect(businessStore.listReturnExchanges()).toHaveLength(0);
  });

  it("rejects a wrong session, forged token and wrong idempotency key without writing", async () => {
    const prepared = await service.prepareReturnExchange(context, returnDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const valid = command(prepared.data, "confirm", returnDraft);
    const wrongSession = await service.resolveConfirmation({ ...context, sessionId: "other-session" }, valid);
    const forgedToken = await service.resolveConfirmation(context, { ...valid, confirmationToken: "forged-token" });
    const wrongIdempotency = await service.resolveConfirmation(context, { ...valid, idempotencyKey: "forged-idempotency" });
    expect(wrongSession).toMatchObject({ status: "business_error", error: { code: "UNAUTHORIZED" } });
    expect(forgedToken).toMatchObject({ status: "business_error", error: { code: "UNAUTHORIZED" } });
    expect(wrongIdempotency).toMatchObject({ status: "business_error", error: { code: "CONFLICT" } });
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("pending");
    expect(businessStore.listReturnExchanges()).toHaveLength(0);
  });

  it("rejects incomplete snapshots and a mismatched legacy operation without writing", async () => {
    const prepared = await service.prepareReturnExchange(context, returnDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const incomplete = { ...returnDraft, pickupAddress: "" };
    const invalid = await service.resolveConfirmation(context, command(prepared.data, "confirm", incomplete));
    expect(invalid).toMatchObject({ status: "business_error", error: { code: "INVALID_INPUT" } });

    const mismatchedWrite = {
      request: prepared.data,
      confirmationToken: prepared.data.confirmationToken,
      idempotencyKey: prepared.data.idempotencyKey,
      finalSnapshot: ticketDraft,
    } as unknown as ConfirmedWrite<ServiceTicketDraft>;
    const mismatched = await service.submitServiceTicket(context, mismatchedWrite);
    expect(mismatched).toMatchObject({ status: "business_error", error: { code: "CONFLICT", message: "CONFIRMATION_OPERATION_MISMATCH" } });
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("pending");
    expect(businessStore.listReturnExchanges()).toHaveLength(0);
    expect(businessStore.listServiceTickets()).toHaveLength(1);
  });

  it("expires a pending request and rejects its token without writing", async () => {
    let now = new Date("2026-09-01T10:00:00.000Z");
    const localStore = new ConfirmationStore();
    const localService = new BusinessWorkflowService(undefined, undefined, undefined, undefined, localStore, () => now);
    const prepared = await localService.prepareOrderChange(context, orderChangeDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    now = new Date("2026-09-01T10:16:00.000Z");
    const result = await localService.resolveConfirmation(context, command(prepared.data, "confirm", orderChangeDraft));
    expect(result).toMatchObject({ status: "business_error", data: null, error: { code: "CONFLICT", message: "CONFIRMATION_EXPIRED" } });
    expect(localStore.get(prepared.data.confirmationRequestId)?.status).toBe("expired");
    expect(businessStore.listOrderChanges()).toHaveLength(0);
  });

  it("modify rotates all opaque identifiers and only the replacement can submit the edited snapshot", async () => {
    const prepared = await service.prepareReturnExchange(context, returnDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const edited = { ...returnDraft, pickupAddress: "用户修改后的演示地址" };
    const modified = await service.resolveConfirmation(context, command(prepared.data, "modify", edited));
    expect(modified.status).toBe("success");
    if (modified.status !== "success" || modified.data.action !== "modify") return;
    expect(businessStore.listReturnExchanges()).toHaveLength(0);
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("modified");
    expect(modified.data.replacement.confirmationRequestId).not.toBe(prepared.data.confirmationRequestId);
    expect(modified.data.replacement.confirmationToken).not.toBe(prepared.data.confirmationToken);
    expect(modified.data.replacement.idempotencyKey).not.toBe(prepared.data.idempotencyKey);
    expect(modified.data.replacement.draftSnapshot).toEqual(edited);

    const oldResult = await service.resolveConfirmation(context, command(prepared.data, "confirm", edited));
    expect(oldResult).toMatchObject({ status: "business_error", error: { code: "CONFLICT", message: "CONFIRMATION_REPLACED" } });
    const submitted = await service.resolveConfirmation(
      context,
      command(modified.data.replacement as ConfirmationRequest<ReturnExchangeDraft>, "confirm", edited),
    );
    expect(submitted.status).toBe("success");
    if (submitted.status === "success" && submitted.data.action === "confirm") {
      expect(submitted.data.record).toMatchObject({ pickupAddress: edited.pickupAddress });
    }
    expect(businessStore.listReturnExchanges()).toHaveLength(1);
  });

  it("cancel closes the request and a later confirm cannot write", async () => {
    const prepared = await service.prepareLogisticsUrge(context, logisticsDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const cancelled = await service.resolveConfirmation(context, cancelCommand(prepared.data));
    expect(cancelled).toMatchObject({ status: "success", data: { action: "cancel" } });
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("cancelled");
    const submitted = await service.resolveConfirmation(context, command(prepared.data, "confirm", logisticsDraft));
    expect(submitted).toMatchObject({ status: "business_error", error: { code: "CANCELLED", message: "CONFIRMATION_CANCELLED" } });
    expect(businessStore.listLogisticsUrges()).toHaveLength(0);
  });

  it("concurrent duplicate clicks share one execution and return the original record", async () => {
    const prepared = await service.prepareServiceTicket(context, ticketDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const confirm = command(prepared.data, "confirm", ticketDraft);
    const [first, second] = await Promise.all([
      service.resolveConfirmation(context, confirm, { adapter: { delayMs: 20 } }),
      service.resolveConfirmation(context, confirm, { adapter: { delayMs: 20 } }),
    ]);
    expect(first).toEqual(second);
    expect(first.status).toBe("success");
    expect(businessStore.listServiceTickets()).toHaveLength(2);
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("completed");
  });

  it("confirms order cancellation once and replays the original cancellation record", async () => {
    const prepared = await service.prepareOrderCancel(context, orderCancelDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const confirm = command(prepared.data, "confirm", orderCancelDraft);
    const first = await service.resolveConfirmation(context, confirm);
    const replay = await service.resolveConfirmation(context, confirm);
    expect(first).toEqual(replay);
    expect(first.status).toBe("success");
    if (first.status === "success" && first.data.action === "confirm") {
      expect(first.data.operation).toBe("order_cancel");
      expect(first.data.record).toMatchObject({ orderId: orderCancelDraft.orderId, reason: orderCancelDraft.reason });
    }
    expect(businessStore.listOrderCancellations()).toHaveLength(1);
  });

  it("timeout, business_error and system_error never return IDs or dirty-write", async () => {
    const returnPrepared = await service.prepareReturnExchange(context, returnDraft);
    const timeoutPrepared = await service.prepareServiceTicket(context, ticketDraft);
    const systemPrepared = await service.prepareServiceTicket({ ...context, sessionId: "system-error-session" }, ticketDraft);
    if (returnPrepared.status !== "success" || timeoutPrepared.status !== "success" || systemPrepared.status !== "success") return;

    const businessFailure = await service.resolveConfirmation(
      context,
      command(returnPrepared.data, "confirm", returnDraft),
      { adapter: { outcome: "business_error" } },
    );
    const timeoutFailure = await service.resolveConfirmation(
      context,
      command(timeoutPrepared.data, "confirm", ticketDraft),
      { adapter: { outcome: "timeout" } },
    );
    const systemContext = { ...context, sessionId: "system-error-session" };
    const systemFailure = await service.resolveConfirmation(
      systemContext,
      command(systemPrepared.data, "confirm", ticketDraft),
      { adapter: { outcome: "system_error" } },
    );
    expect(businessFailure).toMatchObject({ status: "business_error", data: null, error: { retryable: false } });
    expect(timeoutFailure).toMatchObject({ status: "timeout", data: null, error: { retryable: true } });
    expect(systemFailure).toMatchObject({ status: "system_error", data: null, error: { retryable: true } });
    expect(businessStore.listReturnExchanges()).toHaveLength(0);
    expect(businessStore.listServiceTickets()).toHaveLength(1);
  });

  it("an aborted confirm fails before the tool and leaves Store clean", async () => {
    const prepared = await service.prepareOrderCancel(context, orderCancelDraft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const controller = new AbortController();
    controller.abort();
    const result = await service.resolveConfirmation(
      context,
      command(prepared.data, "confirm", orderCancelDraft),
      { signal: controller.signal },
    );
    expect(result).toMatchObject({ status: "business_error", data: null, error: { code: "CANCELLED" } });
    expect(businessStore.listOrderCancellations()).toHaveLength(0);
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("failed");
  });

  it("safety escalation bypasses ordinary confirmation without being blocked", async () => {
    expect(confirmationStore.list()).toHaveLength(0);
    const handoff = await service.escalateToHuman(context, {
      reason: "safety",
      riskLevel: "high",
      summary: "用户报告冒烟和烧焦味，已提示断电。",
      completedActions: ["安全提示"],
      pendingQuestions: [],
      relatedRecordIds: [],
    });
    expect(handoff.status).toBe("success");
    expect(businessStore.listHumanHandoffs()).toHaveLength(1);
    expect(confirmationStore.list()).toHaveLength(0);
  });
});
