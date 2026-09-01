import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";
import { ConsumerRequestStateCard } from "@/components/chat/MessageItem";
import {
  getIdentityConfirmationConfig,
  IdentityConfirmationCard,
  OrderOperationSuccessCard,
  ReturnStatusCard,
} from "@/components/chat/OrderAndReturnCards";
import { getPublicConsumerError } from "@/components/chat/consumer-error";
import { createConfirmationCommand, getConfirmationPresentation } from "@/components/chat/confirmation-flow";
import { applyAgentEvent, createStreamState } from "@/components/chat/stream-state";
import { UiCard, type UiCardActions } from "@/components/chat/UiCard";
import type { AgentEvent, ConfirmationRequest, OrderView, ReturnExchangeStatusView } from "@/lib/contracts";

const complete = async () => ({ status: "completed" as const });
const noop = () => {};
const actions: UiCardActions = {
  onConfirmIdentity: noop,
  onRefresh: noop,
  onContact: noop,
  onPrepareOrderChange: noop,
  onPrepareOrderCancel: noop,
  onPrepareUrge: noop,
  onPrepareServiceTicket: noop,
  onTroubleshootingResolved: noop,
  onConfirmationDecision: complete,
  onRegenerateConfirmation: complete,
};

const order: OrderView = {
  id: "OD-DEMO-1",
  product: "吸顶灯",
  status: "待发货",
  eta: "预计明天发货",
  carrier: "演示物流",
  trackingNo: "SF-DEMO-1",
  hotline: "95338",
  events: [],
};

function orderConfirmation(operation: "order_change" | "order_cancel"): ConfirmationRequest {
  return {
    confirmationRequestId: `request-${operation}`,
    sessionId: "stage4-consumer",
    traceId: "trace-stage4-consumer",
    operation,
    target: { type: "order", id: "OD-DEMO-1" },
    draftSnapshot: operation === "order_change"
      ? { orderId: "OD-DEMO-1", deliveryAddress: "演示新地址", contactPhone: "138****6821" }
      : { orderId: "OD-DEMO-1", reason: "不再需要" },
    riskLevel: "medium",
    risks: ["确认后提交申请"],
    confirmationToken: `server-token-${operation}`,
    idempotencyKey: `server-key-${operation}`,
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2099-09-01T00:15:00.000Z",
  };
}

const returnStatus: ReturnExchangeStatusView = {
  requestNo: "RE-DEMO-1",
  orderId: "OD-DEMO-1",
  serviceType: "换货",
  product: "吸顶灯",
  status: "reviewing",
  updatedAt: "2026-09-01 13:20",
  events: [
    { time: "2026-09-01 13:20", text: "申请已进入审核", active: true },
    { time: "2026-09-01 12:30", text: "退换申请已提交" },
  ],
};

describe("stage 4 consumer order and return experience", () => {
  it("maps every demo identity purpose to the frozen deterministic action", () => {
    expect(Object.fromEntries((["order", "service", "order_change", "order_cancel", "return"] as const).map((purpose) => [
      purpose,
      getIdentityConfirmationConfig(purpose).action,
    ]))).toEqual({
      order: "confirm_identity",
      service: "confirm_service_identity",
      order_change: "prepare_order_change",
      order_cancel: "prepare_order_cancel",
      return: "confirm_return_identity",
    });
  });

  it("shows demo identity confirmation before preparing address changes or querying returns", () => {
    const change = renderToStaticMarkup(createElement(IdentityConfirmationCard, {
      maskedPhone: "****6821",
      purpose: "order_change",
      busy: false,
      onConfirm: noop,
    }));
    const status = renderToStaticMarkup(createElement(IdentityConfirmationCard, {
      maskedPhone: "****6821",
      purpose: "return",
      busy: false,
      onConfirm: noop,
    }));

    expect(change).toContain("只会生成修改地址草稿");
    expect(change).not.toContain("订单已修改");
    expect(status).toContain("仅展示当前演示身份下的退换申请");
    expect(status).toContain("确认演示身份");
  });

  it("keeps address and cancellation entry points inside the verified order card", () => {
    const html = renderToStaticMarkup(createElement(UiCard, { ui: { kind: "order", order }, busy: false, actions }));
    expect(html).toContain("申请修改地址");
    expect(html).toContain("申请取消订单");
    expect(html).toContain("订单申请入口");
  });

  it("uses the stage 3 confirmation command for both order writes", () => {
    for (const operation of ["order_change", "order_cancel"] as const) {
      const request = orderConfirmation(operation);
      const command = createConfirmationCommand(request, "confirm", request.draftSnapshot);
      expect(command).toEqual({
        confirmationRequestId: request.confirmationRequestId,
        confirmationToken: request.confirmationToken,
        idempotencyKey: request.idempotencyKey,
        action: "confirm",
        finalSnapshot: request.draftSnapshot,
      });
      expect(command).not.toHaveProperty("operation");
    }
    expect(getConfirmationPresentation(orderConfirmation("order_change")).title).toBe("确认修改订单地址申请");
    expect(getConfirmationPresentation(orderConfirmation("order_cancel")).title).toBe("确认取消订单申请");
  });

  it("does not expose any legacy direct-submit confirmation interaction", () => {
    const legacyCards = [
      { kind: "return_confirm", form: { prompt: "SECRET_PROMPT" } },
      { kind: "logistics_urge_confirm", orderId: "OD-DEMO-1", carrier: "演示物流", trackingNo: "SF-DEMO-1", latestStatus: "运输中" },
      { kind: "service_ticket_form", form: { toolParameters: "SECRET_TOOL_PARAMETERS" } },
    ] as const;
    for (const ui of legacyCards) {
      const html = renderToStaticMarkup(createElement(UiCard, { ui: ui as never, busy: false, actions }));
      expect(html).toContain("请重新生成统一确认草稿");
      expect(html).not.toContain("确认提交");
      expect(html).not.toContain("SECRET_PROMPT");
      expect(html).not.toContain("SECRET_TOOL_PARAMETERS");
    }
  });

  it("reports an address change only as a submitted application", () => {
    const html = renderToStaticMarkup(createElement(OrderOperationSuccessCard, {
      result: {
        operation: "order_change",
        orderId: "OD-DEMO-1",
        requestNo: "OC-DEMO-1",
        status: "ORDER_ALREADY_CHANGED",
        internalToolParameters: "SECRET_TOOL_PARAMETERS",
      } as never,
    }));
    expect(html).toContain("修改地址申请已提交");
    expect(html).toContain("OC-DEMO-1");
    expect(html).not.toContain("订单已修改完成");
    expect(html).not.toContain("ORDER_ALREADY_CHANGED");
    expect(html).not.toContain("SECRET_TOOL_PARAMETERS");
  });

  it("renders cancellation as an application rather than a direct order mutation", () => {
    const html = renderToStaticMarkup(createElement(OrderOperationSuccessCard, {
      result: { operation: "order_cancel", orderId: "OD-DEMO-1", requestNo: "CC-DEMO-1", status: "submitted" },
    }));
    expect(html).toContain("取消订单申请已提交");
    expect(html).not.toContain("订单已取消完成");
  });

  it("renders the public return timeline and ignores identity and debug extras", () => {
    const html = renderToStaticMarkup(createElement(ReturnStatusCard, {
      request: {
        ...returnStatus,
        customerId: "OTHER-CUSTOMER",
        prompt: "SECRET_PROMPT",
        toolParameters: "SECRET_TOOL_PARAMETERS",
        knowledgeId: "SECRET_KNOWLEDGE_ID",
      } as never,
    }));
    expect(html).toContain("RE-DEMO-1");
    expect(html).toContain("申请已进入审核");
    expect(html).toContain("仅展示当前演示身份下的申请数据");
    expect(html).not.toContain("OTHER-CUSTOMER");
    expect(html).not.toContain("SECRET_PROMPT");
    expect(html).not.toContain("SECRET_TOOL_PARAMETERS");
    expect(html).not.toContain("SECRET_KNOWLEDGE_ID");
  });

  it("shows an explicit empty timeline when the request has no status events", () => {
    const html = renderToStaticMarkup(createElement(ReturnStatusCard, { request: { ...returnStatus, events: [] } }));
    expect(html).toContain("暂无新的进度记录");
    expect(html).toContain("当前状态为“审核中”");
  });

  it("maps empty, rejected, timeout and system errors to safe consumer states", () => {
    expect(getPublicConsumerError("EMPTY_RESULT", false)).toMatchObject({ kind: "empty", retryable: false });
    expect(getPublicConsumerError("BUSINESS_REJECTED", false)).toMatchObject({ kind: "rejected", retryable: false });
    expect(getPublicConsumerError("TIMEOUT", true)).toMatchObject({ kind: "timeout", retryable: true });
    expect(getPublicConsumerError("SYSTEM_FAILURE", true)).toMatchObject({ kind: "failed", retryable: true });

    const unsafe = JSON.stringify({ prompt: "SECRET_PROMPT", toolParameters: { customerId: "OTHER" }, knowledgeId: "KB-1" });
    const state = getPublicConsumerError("SYSTEM_FAILURE", true, unsafe);
    const retryableHtml = renderToStaticMarkup(createElement(ConsumerRequestStateCard, { state, busy: false, canRetry: true, onRetry: noop }));
    const rejectedHtml = renderToStaticMarkup(createElement(ConsumerRequestStateCard, { state: getPublicConsumerError("BUSINESS_REJECTED", false), busy: false, canRetry: true, onRetry: noop }));
    expect(retryableHtml).toContain("安全重试");
    expect(retryableHtml).not.toContain("SECRET_PROMPT");
    expect(retryableHtml).not.toContain("customerId");
    expect(rejectedHtml).not.toContain("安全重试");
  });

  it("drops a stage 4 success card when the stream ends in failure", () => {
    const base = { contractVersion: "1.1.0", sessionId: "stage4-consumer", traceId: "trace-stage4", createdAt: "2026-09-01T00:00:00.000Z" } as const;
    let state = createStreamState("stage4-failure");
    state = applyAgentEvent(state, {
      ...base,
      type: "ui",
      eventId: "ui-success",
      sequence: 1,
      ui: { kind: "order_operation_success", result: { operation: "order_change", orderId: "OD-DEMO-1", requestNo: "MUST-NOT-RENDER", status: "submitted" } },
    } as AgentEvent);
    state = applyAgentEvent(state, {
      ...base,
      type: "error",
      eventId: "tool-failure",
      sequence: 2,
      error: { code: "SYSTEM_FAILURE", message: "internal object", retryable: true },
    } as AgentEvent);
    expect(state.pendingUi).toBeUndefined();
    expect(state.message).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("MUST-NOT-RENDER");
  });

  it("keeps exactly the three established consumer quick entries", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect((html.match(/class="quick-card"/g) ?? [])).toHaveLength(3);
    expect(html).toContain("查订单物流");
    expect(html).toContain("退换与破损");
    expect(html).toContain("故障报修");
    expect(html).not.toContain("class=\"quick-card\">申请修改地址");
  });
});
