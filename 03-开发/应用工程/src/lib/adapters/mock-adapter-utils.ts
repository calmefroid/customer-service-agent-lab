import type { ToolError, ToolResult, ToolResultMetadata } from "@/lib/contracts";
import type { AdapterCallOptions, BusinessRecord, BusinessSourceSystem } from "@/lib/domain/business";
import { sourceMetadata } from "@/lib/domain/business";

const errorByOutcome = {
  empty: { code: "EMPTY_RESULT", message: "演示数据中未找到匹配记录", retryable: false },
  timeout: { code: "TIMEOUT", message: "Mock Adapter 请求超时", retryable: true },
  business_error: { code: "BUSINESS_REJECTED", message: "当前业务状态不允许该操作", retryable: false },
  system_error: { code: "SYSTEM_FAILURE", message: "Mock 来源系统暂时不可用", retryable: true },
} satisfies Record<Exclude<AdapterCallOptions["outcome"], "success" | undefined>, ToolError>;

function requestId(system: BusinessSourceSystem): string {
  return `mock-${system.toLowerCase()}-${crypto.randomUUID()}`;
}

async function wait(delayMs = 0): Promise<void> {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function executeMock<T>(
  sourceSystem: BusinessSourceSystem,
  options: AdapterCallOptions | undefined,
  operation: (requestId: string) => { data: T; records?: BusinessRecord[] } | null,
): Promise<ToolResult<T>> {
  const startedAt = performance.now();
  const id = requestId(sourceSystem);
  await wait(options?.delayMs);
  const outcome = options?.outcome ?? "success";
  const baseMeta = (records: BusinessRecord[] = []): ToolResultMetadata => ({
    requestId: id,
    sources: records.length > 0
      ? records.map((record) => sourceMetadata(record.sourceSystem, id, record))
      : [sourceMetadata(sourceSystem, id)],
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    attempts: 1,
  });

  if (outcome !== "success") {
    return { status: outcome, data: null, error: errorByOutcome[outcome], meta: baseMeta() };
  }

  const result = operation(id);
  if (!result) {
    return { status: "empty", data: null, error: errorByOutcome.empty, meta: baseMeta() };
  }

  return { status: "success", data: result.data, meta: baseMeta(result.records) };
}

/**
 * Short-circuits write adapters before validation or ID allocation when a
 * deterministic failure has been requested. Callers can then prove that an
 * injected failure never enters the Store mutation callback.
 */
export function executeInjectedFailure<T>(
  sourceSystem: BusinessSourceSystem,
  options: AdapterCallOptions | undefined,
): Promise<ToolResult<T>> | null {
  if (!options?.outcome || options.outcome === "success") return null;
  return executeMock<T>(sourceSystem, options, () => null);
}

export function businessError<T>(
  sourceSystem: BusinessSourceSystem,
  code: ToolError["code"],
  message: string,
  details?: Record<string, unknown>,
): ToolResult<T> {
  const id = requestId(sourceSystem);
  return {
    status: "business_error",
    data: null,
    error: { code, message, retryable: false, details },
    meta: { requestId: id, sources: [sourceMetadata(sourceSystem, id)], durationMs: 0, attempts: 1 },
  };
}
