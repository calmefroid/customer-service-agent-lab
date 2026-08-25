import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "@/lib/agent-runtime/agent-runtime";
import { InMemoryRuntimeTraceStore } from "@/lib/agent-runtime/runtime-trace-store";
import type { RuntimeWorkflowContext, RuntimeWorkflowExecutor } from "@/lib/agent-runtime/types";
import type { AgentEvent, ChatRequest, ChatResponse } from "@/lib/contracts";
import {
  MockMultimodalModelAdapter,
  MockTextModelAdapter,
  createDefaultModelAdapters,
} from "@/lib/models";
import { InMemorySessionStore } from "@/lib/sessions";

async function collect(runtime: AgentRuntime, request: ChatRequest, signal?: AbortSignal) {
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(request, { signal })) events.push(event);
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

function workflow(run = vi.fn(async () => response())): RuntimeWorkflowExecutor {
  return { execute: run };
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

  it("answers an observation-only image with the multimodal adapter", async () => {
    const text = new MockTextModelAdapter();
    const vision = new MockMultimodalModelAdapter({ requiresBusinessRouting: false });
    const execute = vi.fn(async () => response());
    const runtime = new AgentRuntime({ textModel: text, multimodalModel: vision, workflow: workflow(execute) });

    const events = await collect(runtime, {
      sessionId: "S-image-observe",
      message: "帮我看看铭牌上是什么型号",
      attachment: { name: "plate.jpg", type: "image/jpeg", size: 42_000 },
    });

    expect(vision.callCount).toBe(1);
    expect(text.callCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    const final = events.find((event) => event.type === "final");
    expect(final?.type === "final" && final.response.message).toContain("可见");
  });

  it("observes an image before using text routing for a business application", async () => {
    const text = new MockTextModelAdapter();
    const vision = new MockMultimodalModelAdapter({ requiresBusinessRouting: true });
    const execute = vi.fn(async () => response({ intent: "return_exchange" }));
    const runtime = new AgentRuntime({ textModel: text, multimodalModel: vision, workflow: workflow(execute) });

    await collect(runtime, {
      sessionId: "S-image-return",
      message: "灯罩收到时碎了，帮我申请换货",
      module: "return",
      attachment: { name: "damage.jpg", type: "image/jpeg", size: 42_000 },
    });

    expect(vision.callCount).toBe(1);
    expect(text.callCount).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(text.lastInput?.observations[0]).toContain("可见");
  });

  it("uses mock adapters when no model keys are configured", () => {
    const adapters = createDefaultModelAdapters({ mode: "mock" });
    expect(adapters.textModel).toBeInstanceOf(MockTextModelAdapter);
    expect(adapters.multimodalModel).toBeInstanceOf(MockMultimodalModelAdapter);
  });
});

describe("AgentRuntime safety and failures", () => {
  it("does not execute a write workflow after the caller aborts", async () => {
    const execute = vi.fn(async () => response({ intent: "return_exchange" }));
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter(),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
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
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "GENERATION_STOPPED" } });
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
    const modelTrace = traces.list().find((event) => event.type === "model");
    expect(modelTrace?.type === "model" && modelTrace.payload.inputSummary).toContain("applicationSystemPrompt");
  });

  it.each([
    ["timeout", "MODEL_TIMEOUT", true],
    ["refusal", "MODEL_REFUSED", false],
    ["unavailable", "MODEL_UNAVAILABLE", true],
  ] as const)("maps %s failures to a public error event", async (behavior, code, retryable) => {
    const execute = vi.fn(async () => response());
    const runtime = new AgentRuntime({
      textModel: new MockTextModelAdapter({ behavior }),
      multimodalModel: new MockMultimodalModelAdapter(),
      workflow: workflow(execute),
    });

    const events = await collect(runtime, { sessionId: `S-${behavior}`, message: "订单到哪了" });

    expect(execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code, retryable } });
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
