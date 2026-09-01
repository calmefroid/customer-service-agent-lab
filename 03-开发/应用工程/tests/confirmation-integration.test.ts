import { beforeEach, describe, expect, it } from "vitest";

import { POST as streamChat } from "@/app/api/chat/stream/route";
import type { AgentEvent, ChatRequest, ConfirmationRequest } from "@/lib/contracts";
import { businessStore } from "@/lib/stores/business/business-store";
import { confirmationStore } from "@/lib/stores/business/confirmation-store";
import { clearTraces } from "@/lib/trace-store";

function parseAgentEvents(value: string): AgentEvent[] {
  return value
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as AgentEvent);
}

async function send(request: ChatRequest): Promise<AgentEvent[]> {
  const response = await streamChat(new Request("http://localhost/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }));
  expect(response.status).toBe(200);
  return parseAgentEvents(await response.text());
}

function finalEvent(events: AgentEvent[]): Extract<AgentEvent, { type: "final" }> {
  const event = events.find((item): item is Extract<AgentEvent, { type: "final" }> => item.type === "final");
  if (!event) throw new Error("FINAL_EVENT_MISSING");
  return event;
}

function confirmationRequest(event: Extract<AgentEvent, { type: "final" }>): ConfirmationRequest {
  if (event.response.ui?.kind !== "confirmation") throw new Error("CONFIRMATION_UI_MISSING");
  return event.response.ui.request;
}

describe("stage-3 confirmation API integration", () => {
  beforeEach(() => {
    clearTraces();
    businessStore.reset();
  });

  it("modifies with rotated server credentials and confirms only the replacement", async () => {
    const prepared = confirmationRequest(finalEvent(await send({
      sessionId: "S-confirmation-modify",
      message: "准备物流催办",
      action: "prepare_logistics_urge",
    })));
    const editedSnapshot = { ...prepared.draftSnapshot, reason: "用户修改后的催办原因" };

    const modified = confirmationRequest(finalEvent(await send({
      sessionId: prepared.sessionId,
      message: "返回修改",
      confirmation: {
        confirmationRequestId: prepared.confirmationRequestId,
        confirmationToken: prepared.confirmationToken,
        idempotencyKey: prepared.idempotencyKey,
        action: "modify",
        finalSnapshot: editedSnapshot,
      },
    })));
    expect(modified.draftSnapshot).toEqual(editedSnapshot);
    expect(modified.confirmationRequestId).not.toBe(prepared.confirmationRequestId);
    expect(modified.confirmationToken).not.toBe(prepared.confirmationToken);
    expect(modified.idempotencyKey).not.toBe(prepared.idempotencyKey);
    expect(businessStore.listLogisticsUrges()).toHaveLength(0);

    const confirmed = finalEvent(await send({
      sessionId: modified.sessionId,
      message: "确认提交",
      confirmation: {
        confirmationRequestId: modified.confirmationRequestId,
        confirmationToken: modified.confirmationToken,
        idempotencyKey: modified.idempotencyKey,
        action: "confirm",
        finalSnapshot: modified.draftSnapshot,
      },
    }));
    expect(confirmed.response.ui?.kind).toBe("logistics_urge_success");
    expect(businessStore.listLogisticsUrges()).toHaveLength(1);
  });

  it("cancels without a snapshot and reaches an ordinary terminal response without writing", async () => {
    const initialTicketCount = businessStore.listServiceTickets().length;
    const prepared = confirmationRequest(finalEvent(await send({
      sessionId: "S-confirmation-cancel",
      message: "准备售后报修",
      action: "prepare_service_ticket",
    })));
    const cancelled = finalEvent(await send({
      sessionId: prepared.sessionId,
      message: "取消",
      confirmation: {
        confirmationRequestId: prepared.confirmationRequestId,
        confirmationToken: prepared.confirmationToken,
        idempotencyKey: prepared.idempotencyKey,
        action: "cancel",
      },
    }));
    expect(cancelled.response.message).toContain("没有写入");
    expect(cancelled.response.ui).toBeUndefined();
    expect(businessStore.listServiceTickets()).toHaveLength(initialTicketCount);
  });

  it("preserves confirmation business error codes on the consumer AgentEvent", async () => {
    const request: ConfirmationRequest = {
      confirmationRequestId: "confirmation-expired-api",
      sessionId: "S-confirmation-expired",
      traceId: "TR-confirmation-expired-prepare",
      operation: "logistics_urge",
      target: { type: "shipment", id: "SHIP-SF14900000628" },
      draftSnapshot: {
        orderId: "OD202608180236",
        shipmentId: "SHIP-SF14900000628",
        reason: "物流轨迹长时间未更新",
      },
      riskLevel: "medium",
      risks: [],
      confirmationToken: "expired-token",
      idempotencyKey: "expired-idempotency",
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:15:00.000Z",
    };
    confirmationStore.savePending(request);

    const events = await send({
      sessionId: request.sessionId,
      message: "确认提交",
      confirmation: {
        confirmationRequestId: request.confirmationRequestId,
        confirmationToken: request.confirmationToken,
        idempotencyKey: request.idempotencyKey,
        action: "confirm",
        finalSnapshot: request.draftSnapshot,
      },
    });
    const error = events.find((event): event is Extract<AgentEvent, { type: "error" }> => event.type === "error");
    expect(error?.error).toMatchObject({ code: "CONFIRMATION_EXPIRED", retryable: false });
    expect(events.some((event) => event.type === "final")).toBe(false);
    expect(businessStore.listLogisticsUrges()).toHaveLength(0);
  });
});
