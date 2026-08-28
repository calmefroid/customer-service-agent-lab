import { describe, expect, it, vi } from "vitest";

import { OpenAICompatibleMultimodalModelAdapter, createDefaultModelAdapters } from "@/lib/models";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function adapterWith(fetcher: typeof fetch) {
  return new OpenAICompatibleMultimodalModelAdapter({
    baseUrl: "https://model.example.test/v1/chat/completions",
    apiKey: "test-key",
    model: "Qwen3.6-27B",
    provider: "OppleAliModelGateway",
    fetcher,
  });
}

describe("OpenAICompatibleMultimodalModelAdapter", () => {
  it("sends the image as a data URL and parses a structured observation", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      choices: [{
        message: {
          content: "```json\n{\"summary\":\"铭牌上可见型号 LUM-36W\",\"uncertainties\":\"无\",\"responseText\":\"可见型号为 LUM-36W。\",\"requiresBusinessRouting\":false}\n```",
        },
      }],
    }));
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    const output = await adapter.observe({
      message: "请读一下铭牌型号",
      attachment: {
        name: "plate.png",
        type: "image/png",
        size: 1,
        dataUrl: "data:image/png;base64,AA==",
      },
      history: [],
    });

    expect(output).toMatchObject({
      provider: "OppleAliModelGateway",
      model: "Qwen3.6-27B",
      summary: expect.stringContaining("LUM-36W"),
      requiresBusinessRouting: false,
    });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "Qwen3.6-27B",
      stream: false,
      enable_thinking: false,
    });
    expect(String(init.body)).toContain("data:image/png;base64,AA==");
    expect(String(init.body)).toContain('"detail":"high"');
  });

  it("rejects live observation when image content is missing", async () => {
    const fetcher = vi.fn();
    const adapter = adapterWith(fetcher as unknown as typeof fetch);

    await expect(adapter.observe({
      message: "看图",
      attachment: { name: "plate.png", type: "image/png", size: 1 },
      history: [],
    })).rejects.toMatchObject({ code: "unavailable", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates independent live text and multimodal adapters", () => {
    const adapters = createDefaultModelAdapters({
      textMode: "mock",
      multimodalMode: "live",
      multimodalBaseUrl: "https://model.example.test/v1/chat/completions",
      multimodalApiKey: "test-key",
      multimodalModel: "Qwen3.6-27B",
      multimodalProvider: "OppleAliModelGateway",
    });
    expect(adapters.multimodalModel).toBeInstanceOf(OpenAICompatibleMultimodalModelAdapter);
  });
});
