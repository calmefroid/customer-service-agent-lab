import { beforeEach, describe, expect, it } from "vitest";

import { POST as jsonChat } from "@/app/api/chat/route";
import { POST as streamChat } from "@/app/api/chat/stream/route";
import type { AgentEvent, ChatRequest, ConfirmationRequest } from "@/lib/contracts";
import { queryOperations } from "@/lib/operations";
import { businessStore } from "@/lib/stores/business/business-store";
import { clearTraces, listTraceEvents } from "@/lib/trace-store";

function parseEvents(value: string): AgentEvent[] {
  return value
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as AgentEvent);
}

async function send(request: ChatRequest): Promise<Extract<AgentEvent, { type: "final" }>> {
  const response = await streamChat(new Request("http://localhost/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }));
  expect(response.status).toBe(200);
  const events = parseEvents(await response.text());
  const error = events.find((event) => event.type === "error");
  expect(error).toBeUndefined();
  const final = events.find((event): event is Extract<AgentEvent, { type: "final" }> => event.type === "final");
  if (!final) throw new Error("FINAL_EVENT_MISSING");
  expect(final.response).not.toHaveProperty("debug");
  expect(final.response).not.toHaveProperty("route");
  return final;
}

function confirmation(final: Extract<AgentEvent, { type: "final" }>): ConfirmationRequest {
  if (final.response.ui?.kind !== "confirmation") throw new Error("CONFIRMATION_UI_MISSING");
  return final.response.ui.request;
}

async function confirm(request: ConfirmationRequest) {
  return send({
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
}

describe("stage 4 six core consumer-to-business chains", () => {
  beforeEach(() => {
    businessStore.reset();
    clearTraces();
  });

  it("runs order change, cancellation, return status, logistics urge, damage return and repair", async () => {
    const jsonResponse = await jsonChat(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "S-core-json", message: "请帮我申请取消订单" }),
    }));
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({
      intent: "logistics_query",
      ui: { kind: "identity_confirm", purpose: "order_cancel" },
    });

    const changeIdentity = await send({ sessionId: "S-core-change", message: "我想修改订单的收货地址" });
    expect(changeIdentity.response.ui).toMatchObject({ kind: "identity_confirm", purpose: "order_change" });
    const changeRequest = confirmation(await send({
      sessionId: "S-core-change",
      message: "已确认本人，请生成改址草稿",
      action: "prepare_order_change",
    }));
    expect(changeRequest.operation).toBe("order_change");
    const changed = await confirm(changeRequest);
    expect(changed.response.ui).toMatchObject({ kind: "order_operation_success", result: { operation: "order_change" } });

    const cancelIdentity = await send({ sessionId: "S-core-cancel", message: "请帮我申请取消订单" });
    expect(cancelIdentity.response.ui).toMatchObject({ kind: "identity_confirm", purpose: "order_cancel" });
    const cancelRequest = confirmation(await send({
      sessionId: "S-core-cancel",
      message: "已确认本人，请生成取消草稿",
      action: "prepare_order_cancel",
    }));
    expect(cancelRequest.operation).toBe("order_cancel");
    const cancelled = await confirm(cancelRequest);
    expect(cancelled.response.ui).toMatchObject({ kind: "order_operation_success", result: { operation: "order_cancel" } });

    const logisticsRequest = confirmation(await send({
      sessionId: "S-core-logistics",
      message: "准备物流催办",
      action: "prepare_logistics_urge",
    }));
    expect((await confirm(logisticsRequest)).response.ui?.kind).toBe("logistics_urge_success");

    const returnRequest = confirmation(await send({
      sessionId: "S-core-return",
      message: "灯罩收到时碎了，帮我处理",
      module: "return",
      attachment: { name: "virtual-damage.jpg", type: "image/jpeg", size: 900 },
    }));
    expect((await confirm(returnRequest)).response.ui?.kind).toBe("return_success");
    const returnIdentity = await send({ sessionId: "S-core-return", message: "我的换货申请处理到哪了" });
    expect(returnIdentity.response.ui).toMatchObject({ kind: "identity_confirm", purpose: "return" });
    const returnStatus = await send({
      sessionId: "S-core-return",
      message: "确认本人并查询退换进度",
      action: "confirm_return_identity",
    });
    expect(returnStatus.response.ui).toMatchObject({ kind: "return_status", request: { serviceType: "换货" } });

    const repairRequest = confirmation(await send({
      sessionId: "S-core-repair",
      message: "准备售后报修：灯具重启后仍然闪烁",
      action: "prepare_service_ticket",
    }));
    expect((await confirm(repairRequest)).response.ui?.kind).toBe("service_ticket_success");

    expect(businessStore.listOrderChanges()).toHaveLength(1);
    expect(businessStore.listOrderCancellations()).toHaveLength(1);
    expect(businessStore.listLogisticsUrges()).toHaveLength(1);
    expect(businessStore.listReturnExchanges()).toHaveLength(1);
    expect(businessStore.listServiceTickets()).toHaveLength(2);
    const operationTypes = new Set(queryOperations(businessStore).items.map((item) => item.type));
    for (const type of [
      "order_change",
      "order_cancel",
      "logistics_urge",
      "return_exchange",
      "service_ticket",
    ] as const) expect(operationTypes.has(type)).toBe(true);
    expect(listTraceEvents().length).toBeGreaterThan(0);
  });
});
