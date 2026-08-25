import { ModelAdapterError, throwIfModelAborted } from "./model-error";
import type {
  ModelCallOptions,
  MultimodalInput,
  MultimodalModelAdapter,
  TextModelAdapter,
  TextRouteInput,
} from "./types";

export class UnavailableTextModelAdapter implements TextModelAdapter {
  readonly provider = "UnconfiguredLiveAdapter";
  readonly model = "text-model-unconfigured";
  readonly mode = "live" as const;

  async route(_input: TextRouteInput, options: ModelCallOptions = {}): Promise<never> {
    throwIfModelAborted(options.signal);
    throw new ModelAdapterError("unavailable", "文字模型 Adapter 尚未配置", true);
  }
}

export class UnavailableMultimodalModelAdapter implements MultimodalModelAdapter {
  readonly provider = "UnconfiguredLiveAdapter";
  readonly model = "multimodal-model-unconfigured";
  readonly mode = "live" as const;

  async observe(_input: MultimodalInput, options: ModelCallOptions = {}): Promise<never> {
    throwIfModelAborted(options.signal);
    throw new ModelAdapterError("unavailable", "多模态模型 Adapter 尚未配置", true);
  }
}
