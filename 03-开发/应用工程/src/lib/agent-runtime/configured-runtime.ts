import { runRegisteredAgent } from "@/lib/orchestration/mock-compatibility";
import { createDefaultModelAdapters, type ModelMode } from "@/lib/models";
import type { SessionStore } from "@/lib/sessions";

import { AgentRuntime } from "./agent-runtime";
import { defaultRuntimeSessions, defaultRuntimeTraceStore } from "./runtime-singletons";
import type { RuntimeTraceSink, RuntimeWorkflowExecutor } from "./types";

export interface ConfiguredAgentRuntimeOptions {
  sessions?: SessionStore;
  traceSink?: RuntimeTraceSink;
}

function modelMode(value: string | undefined, fallback: ModelMode): ModelMode {
  return value === "live" ? "live" : value === "mock" ? "mock" : fallback;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function imageDetail(value: string | undefined): "low" | "high" | "auto" | undefined {
  return value === "low" || value === "high" || value === "auto" ? value : undefined;
}

export function createConfiguredAgentRuntime(options: ConfiguredAgentRuntimeOptions = {}): AgentRuntime {
  const defaultMode = modelMode(process.env.MODEL_MODE, "mock");
  const textMode = modelMode(process.env.TEXT_MODEL_MODE, defaultMode);
  const multimodalMode = modelMode(process.env.MULTIMODAL_MODEL_MODE, defaultMode);
  const configuredTimeoutMs = positiveInteger(process.env.MODEL_TIMEOUT_MS);
  const modelTimeoutMs = textMode === "live" || multimodalMode === "live"
    ? Math.max(configuredTimeoutMs ?? 60_000, 60_000)
    : configuredTimeoutMs;
  const unifiedModel = process.env.UNIFIED_MODEL_MODE === "true";
  const textBaseUrl = process.env.TEXT_MODEL_BASE_URL;
  const textApiKey = process.env.TEXT_MODEL_API_KEY;
  const textModel = process.env.TEXT_MODEL_NAME;
  const adapters = createDefaultModelAdapters({
    mode: defaultMode,
    textMode,
    multimodalMode,
    textBaseUrl,
    textApiKey,
    textModel,
    textMaxTokens: positiveInteger(process.env.TEXT_MODEL_MAX_TOKENS),
    multimodalBaseUrl: unifiedModel ? textBaseUrl : process.env.MULTIMODAL_MODEL_BASE_URL,
    multimodalApiKey: unifiedModel ? textApiKey : process.env.MULTIMODAL_MODEL_API_KEY,
    multimodalModel: unifiedModel ? textModel : process.env.MULTIMODAL_MODEL_NAME,
    multimodalProvider: unifiedModel ? "OppleAliModelGateway" : process.env.MULTIMODAL_MODEL_PROVIDER,
    multimodalMaxTokens: positiveInteger(process.env.MULTIMODAL_MODEL_MAX_TOKENS),
    multimodalImageDetail: imageDetail(process.env.MULTIMODAL_IMAGE_DETAIL),
  });
  const workflow: RuntimeWorkflowExecutor = {
    execute: (chatRequest, context) => runRegisteredAgent(chatRequest, context),
  };
  return new AgentRuntime({
    ...adapters,
    workflow,
    sessions: options.sessions ?? defaultRuntimeSessions,
    traceSink: options.traceSink ?? defaultRuntimeTraceStore,
    modelTimeoutMs,
  });
}
