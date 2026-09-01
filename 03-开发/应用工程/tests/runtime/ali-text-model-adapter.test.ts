import { describe, expect, it, vi } from "vitest";

import { AliTextModelAdapter, createDefaultModelAdapters } from "@/lib/models";
import { MockMultimodalModelAdapter } from "@/lib/models/mock-multimodal-model-adapter";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function adapterWith(fetcher: typeof fetch) {
  return new AliTextModelAdapter({
    baseUrl: "https://model.example.test/v1/chat/completions",
    apiKey: "test-key",
    model: "Qwen3.6-27B",
    fetcher,
  });
}

describe("AliTextModelAdapter", () => {
  it("calls the documented chat completions endpoint and strips a JSON fence", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: "<think>internal reasoning</think>\n```json\n{\"module\":\"conversation\"}\n```" } }],
    }));
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    const output = await adapter.route({
      message: "你好",
      history: [{ role: "user", content: "你好", createdAt: "2026-08-27T00:00:00.000Z" }],
      observations: [],
      remainingIntents: [],
      applicationSystemPrompt: "route",
      responseSchema: { type: "object" },
    });

    expect(output.raw).toBe('{"module":"conversation"}');
    expect(output.mode).toBe("live");
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    const requestBody = JSON.parse(String(init.body)) as { model: string; stream: boolean; max_tokens: number; enable_thinking: boolean; messages: unknown[] };
    expect(requestBody).toMatchObject({ model: "Qwen3.6-27B", stream: false, max_tokens: 1000, enable_thinking: false });
    expect(requestBody.messages).toHaveLength(2);
  });

  it("generates a consumer answer from the executed workflow result", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: "已查到物流，预计明天送达。" } }],
    }));
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    const output = await adapter.answer({
      message: "物流到哪了",
      route: {
        module: "logistics",
        intent: "logistics_query",
        topic: "logistics.status",
        action: "query",
        confidence: 0.9,
        needsClarification: false,
        requiresConfirmation: false,
        requiresHuman: false,
        remainingIntents: [],
        entities: {},
        observations: [],
      },
      history: [],
      observations: [],
      workflowResult: {
        message: "预计明天送达",
        intent: "logistics_query",
        riskLevel: "low",
        uiKind: "order",
      },
    });

    expect(output.text).toContain("明天送达");
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("executedWorkflowResult");
  });

  it("maps gateway errors without exposing the authorization value", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ message: "unauthorized" }, 401));
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    await expect(adapter.route({
      message: "你好",
      history: [],
      observations: [],
      remainingIntents: [],
      applicationSystemPrompt: "route",
      responseSchema: { type: "object" },
    })).rejects.toMatchObject({ code: "unavailable", retryable: false });
  });

  it.each([429, 500])("maps HTTP %s to an explicit retryable error", async (status) => {
    const fetcher = vi.fn(async () => jsonResponse({ message: "temporary gateway failure" }, status));
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    await expect(adapter.route({
      message: "订单到哪了",
      history: [],
      observations: [],
      remainingIntents: [],
      applicationSystemPrompt: "route",
      responseSchema: { type: "object" },
    })).rejects.toMatchObject({ code: "unavailable", retryable: true });
  });

  it("drops typed reasoning content and keeps only the final text part", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: [
        { type: "reasoning", text: "private chain of thought" },
        { type: "text", text: "{\"module\":\"conversation\"}" },
      ] } }],
    }));
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    const output = await adapter.route({
      message: "你好",
      history: [],
      observations: [],
      remainingIntents: [],
      applicationSystemPrompt: "route",
      responseSchema: { type: "object" },
    });

    expect(output.raw).toBe('{"module":"conversation"}');
    expect(output.raw).not.toContain("private chain of thought");
  });

  it("rejects an unclosed think block instead of exposing it", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: "<think>private unfinished reasoning" } }],
    }));
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    await expect(adapter.answer({
      message: "你好",
      route: {
        module: "conversation",
        intent: "smalltalk",
        topic: "conversation.greeting",
        action: "respond",
        confidence: 0.9,
        needsClarification: false,
        requiresConfirmation: false,
        requiresHuman: false,
        remainingIntents: [],
        entities: {},
        observations: [],
      },
      history: [],
      observations: [],
      workflowResult: { message: "你好", intent: "smalltalk", riskLevel: "low" },
    })).rejects.toMatchObject({ code: "unavailable", retryable: true });
  });

  it("supports live text with mock multimodal as independent modes", () => {
    const adapters = createDefaultModelAdapters({
      mode: "mock",
      textMode: "live",
      multimodalMode: "mock",
      textBaseUrl: "https://model.example.test/v1/chat/completions",
      textApiKey: "test-key",
    });

    expect(adapters.textModel).toBeInstanceOf(AliTextModelAdapter);
    expect(adapters.multimodalModel).toBeInstanceOf(MockMultimodalModelAdapter);
  });
});
