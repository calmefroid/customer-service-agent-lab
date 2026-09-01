import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "@/lib/agent-runtime/agent-runtime";
import { InMemoryRuntimeTraceStore } from "@/lib/agent-runtime/runtime-trace-store";
import {
  ROUTE_RESPONSE_SCHEMA,
  fallbackRoute,
  parseStructuredRoute,
} from "@/lib/agent-runtime/route-schema";
import type { RuntimeWorkflowContext } from "@/lib/agent-runtime/types";
import type { ChatRequest, ChatResponse, RouteDecision } from "@/lib/contracts";
import { MockMultimodalModelAdapter, MockTextModelAdapter } from "@/lib/models";
import type { TextModelAdapter } from "@/lib/models";

const requiredRouteFields = [
  "module",
  "intent",
  "topic",
  "action",
  "confidence",
  "needsClarification",
  "requiresConfirmation",
  "requiresHuman",
  "remainingIntents",
  "entities",
  "observations",
] as const;

function expectCompleteRoute(route: RouteDecision): void {
  expect(Object.keys(route)).toEqual(expect.arrayContaining([...requiredRouteFields]));
  expect(route.confidence).toBeGreaterThanOrEqual(0);
  expect(route.confidence).toBeLessThanOrEqual(1);
  expect(Array.isArray(route.remainingIntents)).toBe(true);
  expect(Array.isArray(route.observations)).toBe(true);
}

function structuredRoute(overrides: Partial<RouteDecision> = {}): RouteDecision {
  return {
    module: "conversation",
    intent: "other",
    topic: "conversation.unclassified",
    action: "respond_with_boundary",
    confidence: 0.7,
    needsClarification: false,
    requiresConfirmation: false,
    requiresHuman: false,
    remainingIntents: [],
    entities: { orderId: null, productId: null, serviceType: null },
    observations: [],
    ...overrides,
  };
}

describe("stage 4 four-dimensional fallback routes", () => {
  it.each([
    [
      "修改订单地址",
      { message: "我想修改订单的收货地址" },
      {
        module: "logistics",
        intent: "logistics_query",
        topic: "order.change",
        action: "confirm_identity_then_prepare_order_change",
        needsClarification: false,
        requiresConfirmation: true,
        requiresHuman: false,
      },
    ],
    [
      "取消订单申请",
      { message: "这个订单不想要了，帮我申请取消" },
      {
        module: "logistics",
        intent: "logistics_query",
        topic: "order.cancel",
        action: "confirm_identity_then_prepare_order_cancel",
        needsClarification: false,
        requiresConfirmation: true,
        requiresHuman: false,
      },
    ],
    [
      "查询退换申请进度",
      { message: "我的换货申请到哪一步了" },
      {
        module: "return",
        intent: "return_exchange",
        topic: "return.status",
        action: "confirm_identity_then_query_return",
        needsClarification: false,
        requiresConfirmation: false,
        requiresHuman: false,
      },
    ],
    [
      "订单变更信息不足",
      { message: "我想修改一下订单" },
      {
        module: "logistics",
        intent: "clarification",
        topic: "order.change",
        action: "ask_order_change_target",
        needsClarification: true,
        requiresConfirmation: false,
        requiresHuman: false,
      },
    ],
    [
      "退换进度信息不足",
      { message: "帮我查一下申请进度" },
      {
        module: "conversation",
        intent: "clarification",
        topic: "conversation.application_status",
        action: "ask_application_type",
        needsClarification: true,
        requiresConfirmation: false,
        requiresHuman: false,
      },
    ],
  ] as const)("routes %s with all required fields", (_name, request, expected) => {
    const route = fallbackRoute(request);

    expect(route).toMatchObject(expected);
    expectCompleteRoute(route);
  });

  it("uses return module context to resolve an otherwise generic application-progress request", () => {
    expect(fallbackRoute({ message: "进度怎么样", module: "return" })).toMatchObject({
      module: "return",
      intent: "return_exchange",
      topic: "return.status",
      action: "confirm_identity_then_query_return",
      needsClarification: false,
    });
  });

  it.each([
    ["收货地址填错了", "order.change"],
    ["我不想要这个订单了", "order.cancel"],
    ["帮我查一下换货的审核状态", "return.status"],
    ["报修申请进度怎么样", "after_sales.ticket_status"],
  ] as const)("keeps common phrasing stable for %s", (message, topic) => {
    expect(fallbackRoute({ message }).topic).toBe(topic);
  });

  it.each([
    ["prepare_order_change", "order.change", true],
    ["prepare_order_cancel", "order.cancel", true],
    ["confirm_return_identity", "return.status", false],
  ] as const)("prioritizes deterministic action %s", (action, topic, requiresConfirmation) => {
    const route = fallbackRoute({
      message: "这段文字故意误导成冒烟退货和转人工",
      action,
    });

    expect(route).toMatchObject({
      topic,
      action,
      requiresConfirmation,
      requiresHuman: false,
    });
    expectCompleteRoute(route);
  });

  it("keeps safety first for natural language and preserves the pending order operation", () => {
    const route = fallbackRoute({ message: "灯在冒烟，另外请取消订单" });

    expect(route).toMatchObject({ intent: "human_escalation", topic: "safety.electrical" });
    expect(route.remainingIntents).toContain("logistics_query");
  });

  it("keeps a pending service-ticket query behind a safety escalation", () => {
    const route = fallbackRoute({ message: "灯在冒烟，另外查一下报修进度" });

    expect(route).toMatchObject({ intent: "human_escalation", topic: "safety.electrical" });
    expect(route.remainingIntents).toContain("service_ticket_query");
    expect(route.remainingIntents).not.toContain("service_ticket_create");
  });

  it("preserves a pending return-status intent behind an order cancellation", () => {
    const route = fallbackRoute({ message: "先取消订单，另外查一下换货申请进度" });

    expect(route).toMatchObject({ topic: "order.cancel" });
    expect(route.remainingIntents).toContain("return_exchange");
  });
});

describe("stage 4 structured schema compatibility", () => {
  it("publishes every required structured route field", () => {
    expect(ROUTE_RESPONSE_SCHEMA).toMatchObject({ type: "object", additionalProperties: false });
    expect(ROUTE_RESPONSE_SCHEMA.required).toEqual(requiredRouteFields);
  });

  it.each([
    ["troubleshoot", "troubleshooting", {}],
    ["create_return", "return_exchange", {}],
    ["create_service_ticket", "service_ticket_create", {}],
    ["query_service_ticket", "service_ticket_query", {}],
    ["order_query", "logistics_query", {}],
    ["service_ticket", "service_ticket_create", { topic: "after_sales.repair_process", action: "prepare_service_ticket" }],
    ["service_ticket", "service_ticket_query", { topic: "after_sales.ticket_status", action: "confirm_identity_then_query_ticket" }],
    ["repair_support", "troubleshooting", { topic: "fault.not_lit", action: "safety_check_then_troubleshoot" }],
    ["repair_support", "knowledge_query", { topic: "after_sales.warranty", action: "retrieve_published_knowledge" }],
  ] as const)("normalizes historical intent %s to %s", (historical, canonical, routeOverrides) => {
    const parsed = parseStructuredRoute(JSON.stringify(structuredRoute({
      ...routeOverrides,
      intent: historical as RouteDecision["intent"],
    })));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.intent).toBe(canonical);
  });

  it.each(["service_ticket", "repair_support", "invented_intent"])("rejects ambiguous or unknown intent %s", (intent) => {
    const parsed = parseStructuredRoute(JSON.stringify({
      ...structuredRoute(),
      intent,
      topic: "conversation.unclassified",
      action: "respond_with_boundary",
    }));

    expect(parsed).toMatchObject({ ok: false, reason: "schema_invalid" });
  });

  it("rejects incomplete output rather than silently inventing required fields", () => {
    const parsed = parseStructuredRoute(JSON.stringify({
      module: "logistics",
      intent: "logistics_query",
      topic: "order.cancel",
      action: "confirm_identity_then_prepare_order_cancel",
    }));

    expect(parsed).toMatchObject({ ok: false, reason: "schema_invalid" });
  });
});

describe("stage 4 Mock and Runtime compatibility", () => {
  it.each([
    ["我想修改订单的收货地址", "order.change", "confirm_identity_then_prepare_order_change"],
    ["请帮我申请取消订单", "order.cancel", "confirm_identity_then_prepare_order_cancel"],
    ["我的退货申请处理到哪了", "return.status", "confirm_identity_then_query_return"],
    ["我想修改一下订单", "order.change", "ask_order_change_target"],
    ["帮我查一下申请进度", "conversation.application_status", "ask_application_type"],
  ] as const)("Mock emits a complete route for %s", async (message, topic, action) => {
    const model = new MockTextModelAdapter();
    const output = await model.route({
      message,
      history: [],
      observations: [],
      remainingIntents: [],
      applicationSystemPrompt: "test",
      responseSchema: ROUTE_RESPONSE_SCHEMA,
    });
    const parsed = parseStructuredRoute(output.raw);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({ topic, action });
      expectCompleteRoute(parsed.value);
    }
  });

  it("overrides a model guess with the deterministic order-cancel action", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const wrongModel: TextModelAdapter = {
      provider: "test",
      model: "wrong-route",
      mode: "mock",
      route: vi.fn(async () => ({
        raw: JSON.stringify(structuredRoute({ intent: "smalltalk", topic: "conversation.greeting", action: "respond" })),
        provider: "test",
        model: "wrong-route",
        mode: "mock" as const,
      })),
      answer: vi.fn(async () => ({ text: "", provider: "test", model: "wrong-route", mode: "mock" as const })),
    };
    const execute = vi.fn(async (_request: ChatRequest, context: RuntimeWorkflowContext): Promise<ChatResponse> => ({
      message: "已准备取消订单申请。",
      intent: context.route.intent,
      riskLevel: "medium",
      traceId: context.traceId,
    }));
    const runtime = new AgentRuntime({
      textModel: wrongModel,
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: { execute },
      traceSink: traces,
    });

    for await (const _event of runtime.run({
      sessionId: "S-stage4-deterministic",
      message: "你好",
      action: "prepare_order_cancel",
    })) {
      // Drain the stream so the workflow receives the final route.
    }

    const call = execute.mock.calls[0] as unknown as [ChatRequest, RuntimeWorkflowContext];
    expect(call[1].route).toMatchObject({
      module: "logistics",
      intent: "logistics_query",
      topic: "order.cancel",
      action: "prepare_order_cancel",
      requiresConfirmation: true,
    });
    expect(wrongModel.route).not.toHaveBeenCalled();
    expect(traces.list().find((event) => event.type === "model")).toMatchObject({
      type: "model",
      status: "skipped",
    });
  });

  it("keeps a recognized natural-language P0 route stable when the live model guesses another valid route", async () => {
    const wrongModel: TextModelAdapter = {
      provider: "test",
      model: "wrong-live-route",
      mode: "live",
      route: vi.fn(async () => ({
        raw: JSON.stringify(structuredRoute({ intent: "smalltalk", topic: "conversation.greeting", action: "respond" })),
        provider: "test",
        model: "wrong-live-route",
        mode: "live" as const,
      })),
      answer: vi.fn(async () => ({ text: "", provider: "test", model: "wrong-live-route", mode: "live" as const })),
    };
    const execute = vi.fn(async (_request: ChatRequest, context: RuntimeWorkflowContext): Promise<ChatResponse> => ({
      message: "请先确认身份。",
      intent: context.route.intent,
      riskLevel: "medium",
      traceId: context.traceId,
    }));
    const runtime = new AgentRuntime({
      textModel: wrongModel,
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: { execute },
    });

    for await (const _event of runtime.run({ sessionId: "S-stage5-p0-guard", message: "我的换货申请处理到哪了" })) {
      // Drain the stream so the workflow receives the guarded route.
    }

    const call = execute.mock.calls[0] as unknown as [ChatRequest, RuntimeWorkflowContext];
    expect(call[1].route).toMatchObject({
      module: "return",
      intent: "return_exchange",
      topic: "return.status",
      action: "confirm_identity_then_query_return",
    });
  });

  it("uses the new deterministic fallback when model JSON is invalid", async () => {
    const execute = vi.fn(async (_request: ChatRequest, context: RuntimeWorkflowContext): Promise<ChatResponse> => ({
      message: "已进入订单取消流程。",
      intent: context.route.intent,
      riskLevel: "medium",
      traceId: context.traceId,
    }));
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter({ behavior: "invalid_json" }),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: { execute },
    });

    for await (const _event of runtime.run({ sessionId: "S-stage4-fallback", message: "请帮我取消订单" })) {
      // Drain the stream so the workflow receives the fallback route.
    }

    const call = execute.mock.calls[0] as unknown as [ChatRequest, RuntimeWorkflowContext];
    expect(call[1].route).toMatchObject({
      intent: "logistics_query",
      topic: "order.cancel",
      action: "confirm_identity_then_prepare_order_cancel",
    });
  });

  it("keeps the raw historical intent in model Trace while workflows receive canonical intent", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const aliasModel: TextModelAdapter = {
      provider: "legacy-provider",
      model: "legacy-router",
      mode: "mock",
      route: vi.fn(async () => ({
        raw: JSON.stringify({
          ...structuredRoute({
            module: "logistics",
            topic: "order.cancel",
            action: "confirm_identity_then_prepare_order_cancel",
            requiresConfirmation: true,
          }),
          intent: "order_query",
        }),
        provider: "legacy-provider",
        model: "legacy-router",
        mode: "mock" as const,
      })),
      answer: vi.fn(async () => ({ text: "", provider: "legacy-provider", model: "legacy-router", mode: "mock" as const })),
    };
    const execute = vi.fn(async (_request: ChatRequest, context: RuntimeWorkflowContext): Promise<ChatResponse> => ({
      message: "已进入订单取消流程。",
      intent: context.route.intent,
      riskLevel: "medium",
      traceId: context.traceId,
    }));
    const runtime = new AgentRuntime({
      textModel: aliasModel,
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: { execute },
      traceSink: traces,
    });

    for await (const _event of runtime.run({ sessionId: "S-stage4-alias-trace", message: "请帮我取消订单" })) {
      // Drain the stream so Runtime records the full trace.
    }

    const call = execute.mock.calls[0] as unknown as [ChatRequest, RuntimeWorkflowContext];
    expect(call[1].route.intent).toBe("logistics_query");
    const modelTrace = traces.list().find((event) => event.type === "model" && event.status === "completed");
    expect(modelTrace?.type === "model" && modelTrace.payload.outputSummary).toContain("order_query");
    const routeTrace = traces.list().find((event) => event.type === "route");
    expect(routeTrace?.type === "route" ? routeTrace.payload.selected?.intent : undefined).toBe("logistics_query");
  });
});
