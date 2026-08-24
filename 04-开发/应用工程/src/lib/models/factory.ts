import { MockMultimodalModelAdapter } from "./mock-multimodal-model-adapter";
import { MockTextModelAdapter } from "./mock-text-model-adapter";
import type { ModelMode, MultimodalModelAdapter, TextModelAdapter } from "./types";
import { UnavailableMultimodalModelAdapter, UnavailableTextModelAdapter } from "./unavailable-model-adapters";

export interface ModelAdapterFactoryOptions {
  mode?: ModelMode;
  textApiKey?: string;
  multimodalApiKey?: string;
}

export interface ModelAdapters {
  textModel: TextModelAdapter;
  multimodalModel: MultimodalModelAdapter;
}

export function createDefaultModelAdapters(options: ModelAdapterFactoryOptions = {}): ModelAdapters {
  const mode = options.mode ?? "mock";
  if (mode === "mock") {
    return {
      textModel: new MockTextModelAdapter(),
      multimodalModel: new MockMultimodalModelAdapter(),
    };
  }

  // Live 接口字段尚未由用户提供。保留明确的 Adapter 边界，避免把 Key
  // 或供应商请求格式散落到 Runtime 与业务工作流中。
  return {
    textModel: new UnavailableTextModelAdapter(),
    multimodalModel: new UnavailableMultimodalModelAdapter(),
  };
}
