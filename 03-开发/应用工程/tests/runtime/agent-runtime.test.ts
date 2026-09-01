import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "@/lib/agent-runtime/agent-runtime";
import { createConfiguredAgentRuntime } from "@/lib/agent-runtime/configured-runtime";
import { InMemoryRuntimeTraceStore } from "@/lib/agent-runtime/runtime-trace-store";
import type {
  RuntimeRunOptions,
  RuntimeWorkflowContext,
  RuntimeWorkflowExecutor,
} from "@/lib/agent-runtime/types";
import type { AgentEvent, ChatRequest, ChatResponse } from "@/lib/contracts";
import {
  MockMultimodalModelAdapter,
  MockTextModelAdapter,
  createDefaultModelAdapters,
} from "@/lib/models";
import type { TextModelAdapter } from "@/lib/models";
import { InMemorySessionStore } from "@/lib/sessions";

async function collect(runtime: AgentRuntime, request: ChatRequest, options: RuntimeRunOptions = {}) {
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(request, options)) events.push(event);
  return events;
}

function response(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    message: "已完成查询。",
    intent: "logistics_query",
    riskLevel: "low",
    traceId: "legacy-trace",
    ...overrides,
  };
}

function workflow(run: RuntimeWorkflowExecutor["execute"] = vi.fn(async () => response())): RuntimeWorkflowExecutor {
  return { execute: run };
}

function liveTextModel(answer: TextModelAdapter["answer"] = vi.fn(async () => ({
  text: "这是模型整理后的低风险回复。",
  provider: "test-provider",
  model: "test-live-model",
  mode: "live" as const,
}))): TextModelAdapter {
  return {
    provider: "test-provider",
    model: "test-live-model",
    mode: "live",
    route: vi.fn(async () => ({
      raw: JSON.stringify({
        module: "logistics",
        intent: "logistics_query",
        topic: "logistics.status",
        action: "confirm_identity_then_query",
        confidence: 0.96,
        needsClarification: false,
        requiresConfirmation: false,
        requiresHuman: false,
        remainingIntents: [],
        entities: { orderId: null, productId: null, serviceType: null },
        observations: [],
      }),
      provider: "test-provider",
      model: "test-live-model",
      mode: "live" as const,
    })),
    answer,
  };
}

describe("AgentRuntime model routing", () => {
  it("routes pure text through the text adapter only", async () => {
    const text = new MockTextModelAdapter();
    const vision = new MockMultimodalModelAdapter();
    const execute = vi.fn(async () => response());
    const runtime = new AgentRuntime({ textModel: text, multimodalModel: vision, workflow: workflow(execute) });

    const events = await collect(runtime, { sessionId: "S-text", message: "我的订单到哪了" });

    expect(text.callCount).toBe(1);
    expect(vision.callCount).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toContain("token");
    expect(events.at(-1)?.type).toBe("final");
  });

  it("answers a clear nameplate with the multimodal adapter only", async () => {
    const text = new MockTextModelAdapter();
    const vision = new MockMultimodalModelAdapter();
    const execute = vi.fn(async () => response());
    const runtime = new AgentRuntime({ textModel: text, multimodalModel: vision, workflow: workflow(execute) });

    const events = await collect(runtime, {
      sessionId: "S-image-observe",
      message: "帮我看看铭牌上是什么型号",
      attachment: { name: "virtual-nameplate.jpg", type: "image/jpeg", size: 42_000 },
    });

    expect(vision.callCount).toBe(1);
    expect(text.callCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    const final = events.find((event) => event.type === "final");
    expect(final?.type === "final" && final.response).toMatchObject({ intent: "knowledge_query", riskLevel: "low" });
    expect(final?.type === "final" && final.response.message).toContain("LUM-36W");
  });

  it("asks for a clearer nameplate photo without entering return workflow", async () => {
    const text = new MockTextModelAdapter();
    const vision = new MockMultimodalModelAdapter();
    const execute = vi.fn(async () => response({ intent: "return_exchange" }));
    const runtime = new AgentRuntime({ textModel: text, multimodalModel: vision, workflow: workflow(execute) });

    const events = await collect(runtime, {
      sessionId: "S-image-blurry",
      message: "这张铭牌很模糊，能看清吗",
      module: "return",
      attachment: { name: "virtual-blurry.jpg", type: "image/jpeg", size: 700 },
    });

    expect(vision.callCount).toBe(1);
    expect(text.callCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    const final = events.find((event) => event.type === "final");
    expect(final?.type === "final" && final.response).toMatchObject({ intent: "clarification", riskLevel: "low" });
    expect(final?.type === "final" && final.response.message).toContain("无法确认");
    expect(final?.type === "final" && final.response.message).toContain("补拍");
  });

  it("protects arrival damage flow through observation, text routing and return draft workflow", async () => {
    const text = new MockTextModelAdapter();
    const vision = new MockMultimodalModelAdapter();
    const execute = vi.fn(async (_request: ChatRequest, context: RuntimeWorkflowContext) => response({
      intent: context.route.intent,
      riskLevel: "medium",
      ui: {
        kind: "return_confirm",
        form: {
          serviceType: "换货",
          product: "悦享吸顶灯",
          issueDescription: "到货破损（待人工复核）",
          contactPhone: "138****6821",
          pickupAddress: "演示地址",
        },
      },
    }));
    const runtime = new AgentRuntime({ textModel: text, multimodalModel: vision, workflow: workflow(execute) });

    await collect(runtime, {
      sessionId: "S-image-return",
      message: "请根据图片帮我处理",
      attachment: { name: "virtual-damage.jpg", type: "image/jpeg", size: 42_000 },
    });

    expect(vision.callCount).toBe(1);
    expect(text.callCount).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(text.lastInput?.observations[0]).toContain("可见");
    const firstCall = execute.mock.calls[0] as unknown as [ChatRequest, RuntimeWorkflowContext];
    expect(firstCall[1].route).toMatchObject({ intent: "return_exchange", module: "return", topic: "return.arrival_damage" });
  });

  it("uses mock adapters when no model keys are configured", () => {
    const adapters = createDefaultModelAdapters({ mode: "mock" });
    expect(adapters.textModel).toBeInstanceOf(MockTextModelAdapter);
    expect(adapters.multimodalModel).toBeInstanceOf(MockMultimodalModelAdapter);
  });
});

describe("AgentRuntime safety and failures", () => {
  it("uses one caller trace ID across runtime events, workflow context and final response", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const execute = vi.fn(async (_request: ChatRequest, context: RuntimeWorkflowContext) => response({
      traceId: context.traceId,
    }));
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter(),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
      traceSink: traces,
    });

    const events = await collect(
      runtime,
      { sessionId: "S-fixed-trace", message: "订单到哪了" },
      { traceId: "TR-STAGE2-FIXED" },
    );

    const firstCall = execute.mock.calls[0] as unknown as [ChatRequest, RuntimeWorkflowContext];
    expect(firstCall[1].traceId).toBe("TR-STAGE2-FIXED");
    expect(events.every((event) => event.traceId === "TR-STAGE2-FIXED")).toBe(true);
    expect(traces.list().every((event) => event.traceId === "TR-STAGE2-FIXED")).toBe(true);
    const final = events.at(-1);
    expect(final?.type === "final" && final.response.traceId).toBe("TR-STAGE2-FIXED");
  });

  it("does not execute a write workflow after the caller aborts", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const execute = vi.fn(async () => response({ intent: "return_exchange" }));
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter(),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
      traceSink: traces,
    });
    const controller = new AbortController();
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({
      sessionId: "S-abort",
      message: "确认提交换货申请",
      action: "submit_return",
      formData: {
        serviceType: "换货",
        product: "客厅吸顶灯",
        issueDescription: "到货破损",
        contactPhone: "13800000000",
        pickupAddress: "演示地址",
      },
    }, { signal: controller.signal })) {
      events.push(event);
      if (event.type === "progress" && event.progress.stage === "workflow") controller.abort();
    }

    expect(execute).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "token")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "GENERATION_STOPPED" } });
    expect(traces.list().some((event) => event.type === "error" && event.payload.internalCode === "ABORT_BEFORE_WORKFLOW")).toBe(true);
    expect(traces.list().some((event) => event.type === "rule" && event.payload.ruleId === "RULE-DETERMINISTIC-GUARD-001")).toBe(true);
  });

  it("falls back to deterministic rules for invalid model JSON and records the failure", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const execute = vi.fn(async () => response());
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter({ behavior: "invalid_json" }),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
      traceSink: traces,
    });

    const events = await collect(runtime, { sessionId: "S-fallback", message: "物流到哪了" });

    const firstCall = execute.mock.calls[0] as unknown as [ChatRequest, RuntimeWorkflowContext];
    expect(firstCall[1].route.intent).toBe("logistics_query");
    expect(events.at(-1)?.type).toBe("final");
    expect(traces.list().some((event) => event.type === "error" && event.payload.internalCode === "MODEL_OUTPUT_INVALID")).toBe(true);
    const parseTrace = traces.list().find((event) => event.type === "rule" && event.payload.ruleId === "RULE-STRUCTURED-OUTPUT-PARSE-001");
    expect(parseTrace?.type === "rule" && parseTrace.payload).toMatchObject({ matched: false, effect: "fallback_to_deterministic_route:invalid_json" });
    const modelTrace = traces.list().find((event) => event.type === "model" && event.status === "completed");
    expect(modelTrace?.type === "model" && modelTrace.payload.inputSummary).toContain("intent-router-system");
    expect(modelTrace?.type === "model" && modelTrace.payload.inputSummary).toContain("schemaVersion");
    expect(modelTrace?.type === "model" && modelTrace.payload.outputSummary).toContain("invalid_json");
  });

  it("omits data URLs and Base64 payloads from runtime trace and consumer events", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter(),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(),
      traceSink: traces,
    });

    const events = await collect(runtime, {
      sessionId: "S-trace-image-redaction",
      message: "帮我看看铭牌型号",
      attachment: {
        name: "virtual-nameplate.jpg",
        type: "image/jpeg",
        size: 1,
        dataUrl: "data:image/jpeg;base64,AA==",
      },
    });
    const traceJson = JSON.stringify(traces.list());
    const consumerJson = JSON.stringify(events);

    expect(traceJson).not.toMatch(/dataUrl|base64|AA==/i);
    expect(consumerJson).not.toMatch(/dataUrl|base64|AA==/i);
    const final = events.at(-1);
    expect(final?.type === "final" && final.response).not.toHaveProperty("debug");
    expect(final?.type === "final" && final.response).not.toHaveProperty("route");
    const imageTraces = traces.list().filter((event) => event.type === "model");
    expect(imageTraces.map((event) => event.status)).toEqual(["started", "completed"]);
    expect(imageTraces.every((event) => event.type === "model" && event.payload.inputSummary?.includes("image-observation-system"))).toBe(true);
  });

  it("records traceable route and low-risk answer model events", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const runtime = new AgentRuntime({
      textModel: liveTextModel(),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(),
      traceSink: traces,
    });

    const events = await collect(runtime, { sessionId: "S-live-answer", message: "订单到哪了" });
    const modelEvents = traces.list().filter((event) => event.type === "model");
    const operations = modelEvents.map((event) => event.type === "model" ? JSON.parse(event.payload.inputSummary ?? "{}")?.operation : undefined);

    expect(modelEvents.map((event) => event.status)).toEqual(["started", "completed", "started", "completed"]);
    expect(operations).toEqual(["text_route", "text_route", "low_risk_answer", "low_risk_answer"]);
    expect(modelEvents.every((event) => event.type === "model" && event.payload.provider === "test-provider" && event.payload.model === "test-live-model" && event.payload.mode === "live")).toBe(true);
    expect(modelEvents.every((event) => event.type === "model" && event.payload.inputSummary?.includes("templateVersion") && event.payload.inputSummary.includes("schemaVersion"))).toBe(true);
    const final = events.at(-1);
    expect(final?.type === "final" && final.response.message).toBe("这是模型整理后的低风险回复。");
  });

  it("records answer fallback metadata and returns the workflow safe response", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const answer = vi.fn<TextModelAdapter["answer"]>(async () => {
      throw new Error("answer failed");
    });
    const runtime = new AgentRuntime({
      textModel: liveTextModel(answer),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(),
      traceSink: traces,
    });

    const events = await collect(runtime, { sessionId: "S-answer-fallback", message: "订单到哪了" });
    const fallbackTrace = traces.list().find((event) => event.type === "model" && event.status === "failed");
    expect(fallbackTrace?.type === "model" && fallbackTrace.payload.outputSummary).toContain("answer_generation_failed");
    expect(traces.list().some((event) => event.type === "error" && event.payload.internalCode === "MODEL_ANSWER_FALLBACK")).toBe(true);
    const final = events.at(-1);
    expect(final?.type === "final" && final.response.message).toBe("已完成查询。");
  });

  it("does not start answer generation or emit tokens after abort", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const answer = vi.fn<TextModelAdapter["answer"]>(async () => ({
      text: "不应生成",
      provider: "test-provider",
      model: "test-live-model",
      mode: "live",
    }));
    const runtime = new AgentRuntime({
      textModel: liveTextModel(answer),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(),
      traceSink: traces,
    });
    const controller = new AbortController();
    const events: AgentEvent[] = [];

    for await (const event of runtime.run(
      { sessionId: "S-abort-answer", message: "订单到哪了" },
      { signal: controller.signal },
    )) {
      events.push(event);
      if (event.type === "progress" && event.progress.stage === "answer_generation") controller.abort();
    }

    expect(answer).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "token")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "GENERATION_STOPPED" } });
    expect(traces.list().some((event) => event.type === "error" && event.payload.internalCode === "ABORT_BEFORE_ANSWER_GENERATION")).toBe(true);
  });

  it("records an aborted model call as a failed model event", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const controller = new AbortController();
    const text: TextModelAdapter = {
      ...liveTextModel(),
      mode: "mock",
      route: vi.fn(() => {
        controller.abort();
        return new Promise<never>(() => undefined);
      }),
    };
    const runtime = new AgentRuntime({
      textModel: text,
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(),
      traceSink: traces,
    });

    const events = await collect(
      runtime,
      { sessionId: "S-abort-model", message: "订单到哪了" },
      { signal: controller.signal },
    );

    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "GENERATION_STOPPED" } });
    const modelEvents = traces.list().filter((event) => event.type === "model");
    expect(modelEvents.map((event) => event.status)).toEqual(["started", "failed"]);
    expect(modelEvents.at(-1)?.type === "model" && modelEvents.at(-1)?.payload.outputSummary).toContain("abort");
  });

  it("times out a hanging live-compatible call with a retryable model error", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const execute = vi.fn(async () => response());
    const hangingText: TextModelAdapter = {
      ...liveTextModel(),
      route: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const runtime = new AgentRuntime({
      textModel: hangingText,
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
      traceSink: traces,
      modelTimeoutMs: 5,
    });

    const events = await collect(runtime, { sessionId: "S-live-timeout", message: "订单到哪了" });

    expect(execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "MODEL_TIMEOUT", retryable: true } });
    const failureTrace = traces.list().find((event) => event.type === "model" && event.status === "failed");
    expect(failureTrace?.type === "model" && failureTrace.payload.outputSummary).toContain("timeout");
  });

  it.each([
    ["timeout", "MODEL_TIMEOUT", true],
    ["refusal", "MODEL_REFUSED", false],
    ["unavailable", "MODEL_UNAVAILABLE", true],
  ] as const)("maps %s failures to a public error event", async (behavior, code, retryable) => {
    const traces = new InMemoryRuntimeTraceStore();
    const execute = vi.fn(async () => response());
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter({ behavior }),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
      traceSink: traces,
    });

    const events = await collect(runtime, { sessionId: `S-${behavior}`, message: "订单到哪了" });

    expect(execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code, retryable } });
    const failureTrace = traces.list().find((event) => event.type === "model" && event.status === "failed");
    expect(failureTrace?.type === "model" && failureTrace.payload.outputSummary).toContain(behavior);
  });

  it("records failed image observation without leaking image bytes", async () => {
    const traces = new InMemoryRuntimeTraceStore();
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter(),
      multimodalModel: new MockMultimodalModelAdapter({ behavior: "unavailable" }),
      workflow: workflow(),
      traceSink: traces,
    });

    await collect(runtime, {
      sessionId: "S-image-failure",
      message: "看看这张图",
      attachment: { name: "failure.jpg", type: "image/jpeg", size: 2, dataUrl: "data:image/jpeg;base64,AA==" },
    });

    const imageTraces = traces.list().filter((event) => event.type === "model");
    expect(imageTraces.map((event) => event.status)).toEqual(["started", "failed"]);
    expect(JSON.stringify(imageTraces)).not.toMatch(/dataUrl|base64|AA==/i);
    expect(imageTraces.at(-1)?.type === "model" && imageTraces.at(-1)?.payload.outputSummary).toContain("unavailable");
  });

  it("explicitly rebuilds the consumer final response without workflow debug fields", async () => {
    const execute = vi.fn(async () => ({
      ...response(),
      debug: { private: true },
      route: { internal: true },
      toolCalls: ["write-order"],
    } as unknown as ChatResponse));
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter(),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
    });

    const final = (await collect(runtime, { sessionId: "S-final-isolation", message: "订单到哪了" })).at(-1);

    expect(final?.type === "final" && Object.keys(final.response).sort()).toEqual(["intent", "message", "riskLevel", "traceId"]);
  });
});

describe("configured AgentRuntime", () => {
  it("accepts the unified Trace Sink and session store as explicit injections", async () => {
    vi.stubEnv("MODEL_MODE", "mock");
    vi.stubEnv("TEXT_MODEL_MODE", "mock");
    vi.stubEnv("MULTIMODAL_MODEL_MODE", "mock");
    const traces = new InMemoryRuntimeTraceStore();
    const sessions = new InMemorySessionStore();
    try {
      const runtime = createConfiguredAgentRuntime({ traceSink: traces, sessions });
      await collect(
        runtime,
        { sessionId: "S-configured-injection", message: "订单到哪了" },
        { traceId: "TR-CONFIGURED-INJECTION" },
      );

      expect(traces.list("TR-CONFIGURED-INJECTION").length).toBeGreaterThan(0);
      expect(sessions.get("S-configured-injection")?.messages.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("AgentRuntime session context", () => {
  it("passes history, image observations and remaining intents into the next route call", async () => {
    const sessions = new InMemorySessionStore();
    const text = new MockTextModelAdapter();
    const vision = new MockMultimodalModelAdapter({ requiresBusinessRouting: true });
    const runtime = new AgentRuntime({ textModel: text, multimodalModel: vision, workflow: workflow(), sessions });

    await collect(runtime, {
      sessionId: "S-context",
      message: "灯罩碎了，另外物流也很慢",
      module: "return",
      attachment: { name: "damage.png", type: "image/png", size: 20_000 },
    });
    await collect(runtime, { sessionId: "S-context", message: "先处理物流" });

    expect(text.lastInput?.history.some((message) => message.content.includes("灯罩碎了"))).toBe(true);
    expect(text.lastInput?.observations.length).toBeGreaterThan(0);
    expect(sessions.get("S-context")?.messages.at(-1)?.role).toBe("assistant");
  });
});
