export type ModelAdapterErrorCode = "timeout" | "refusal" | "unavailable" | "cancelled";

export class ModelAdapterError extends Error {
  constructor(
    readonly code: ModelAdapterErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ModelAdapterError";
  }
}

export function throwIfModelAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ModelAdapterError("cancelled", "生成已停止", false);
}

export function throwForMockBehavior(behavior: Exclude<import("./types").MockModelBehavior, "success" | "invalid_json">): never {
  if (behavior === "timeout") throw new ModelAdapterError("timeout", "模型响应超时", true);
  if (behavior === "refusal") throw new ModelAdapterError("refusal", "模型拒绝处理该请求", false);
  throw new ModelAdapterError("unavailable", "模型 Adapter 当前不可用", true);
}
