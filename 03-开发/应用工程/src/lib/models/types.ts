import type { AttachmentMeta, Intent, RiskLevel, RouteDecision } from "@/lib/contracts";
import type { SessionMessage } from "@/lib/sessions";

export type ModelMode = "mock" | "live";
export type MockModelBehavior = "success" | "invalid_json" | "timeout" | "refusal" | "unavailable";

export interface ModelCallOptions {
  signal?: AbortSignal;
}

export interface TextRouteInput {
  message: string;
  module?: "logistics" | "return" | "repair";
  action?: string;
  attachment?: AttachmentMeta;
  history: SessionMessage[];
  observations: string[];
  remainingIntents: string[];
  applicationSystemPrompt: string;
  responseSchema: Record<string, unknown>;
}

export interface TextRouteOutput {
  raw: string;
  provider: string;
  model: string;
  mode: ModelMode;
}

export interface TextAnswerInput {
  message: string;
  route: RouteDecision;
  history: SessionMessage[];
  observations: string[];
  workflowResult: {
    message: string;
    intent: Intent;
    riskLevel: RiskLevel;
    uiKind?: string;
  };
}

export interface TextAnswerOutput {
  text: string;
  provider: string;
  model: string;
  mode: ModelMode;
}

export interface MultimodalInput {
  message: string;
  module?: "logistics" | "return" | "repair";
  attachment: AttachmentMeta;
  history: SessionMessage[];
}

export interface MultimodalObservationOutput {
  summary: string;
  uncertainties: string[];
  responseText: string;
  requiresBusinessRouting: boolean;
  provider: string;
  model: string;
  mode: ModelMode;
}

export interface TextModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly mode: ModelMode;
  route(input: TextRouteInput, options?: ModelCallOptions): Promise<TextRouteOutput>;
  answer(input: TextAnswerInput, options?: ModelCallOptions): Promise<TextAnswerOutput>;
}

export interface MultimodalModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly mode: ModelMode;
  observe(input: MultimodalInput, options?: ModelCallOptions): Promise<MultimodalObservationOutput>;
}
