import { AliTextModelAdapter } from "./ali-text-model-adapter";
import { MockMultimodalModelAdapter } from "./mock-multimodal-model-adapter";
import { MockTextModelAdapter } from "./mock-text-model-adapter";
import { OpenAICompatibleMultimodalModelAdapter } from "./siliconflow-multimodal-model-adapter";
import type { ModelMode, MultimodalModelAdapter, TextModelAdapter } from "./types";
import { UnavailableMultimodalModelAdapter, UnavailableTextModelAdapter } from "./unavailable-model-adapters";

export interface ModelAdapterFactoryOptions {
  mode?: ModelMode;
  textMode?: ModelMode;
  multimodalMode?: ModelMode;
  textBaseUrl?: string;
  textApiKey?: string;
  textModel?: string;
  textMaxTokens?: number;
  multimodalBaseUrl?: string;
  multimodalApiKey?: string;
  multimodalModel?: string;
  multimodalProvider?: string;
  multimodalMaxTokens?: number;
  multimodalImageDetail?: "low" | "high" | "auto";
}

export interface ModelAdapters {
  textModel: TextModelAdapter;
  multimodalModel: MultimodalModelAdapter;
}

export function createDefaultModelAdapters(options: ModelAdapterFactoryOptions = {}): ModelAdapters {
  const defaultMode = options.mode ?? "mock";
  const textMode = options.textMode ?? defaultMode;
  const multimodalMode = options.multimodalMode ?? defaultMode;

  const textModel = textMode === "mock"
    ? new MockTextModelAdapter()
    : options.textBaseUrl && options.textApiKey
      ? new AliTextModelAdapter({
          baseUrl: options.textBaseUrl,
          apiKey: options.textApiKey,
          model: options.textModel,
          maxTokens: options.textMaxTokens,
        })
      : new UnavailableTextModelAdapter();

  const multimodalModel = multimodalMode === "mock"
    ? new MockMultimodalModelAdapter()
    : options.multimodalBaseUrl && options.multimodalApiKey && options.multimodalModel
      ? new OpenAICompatibleMultimodalModelAdapter({
          baseUrl: options.multimodalBaseUrl,
          apiKey: options.multimodalApiKey,
          model: options.multimodalModel,
          provider: options.multimodalProvider,
          maxTokens: options.multimodalMaxTokens,
          imageDetail: options.multimodalImageDetail,
        })
      : new UnavailableMultimodalModelAdapter();

  return {
    textModel,
    multimodalModel,
  };
}
