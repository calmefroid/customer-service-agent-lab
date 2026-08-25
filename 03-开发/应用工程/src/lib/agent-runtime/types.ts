import type { ChatRequest, ChatResponse, RouteDecision, TraceEvent } from "@/lib/contracts";
import type { MultimodalModelAdapter, TextModelAdapter } from "@/lib/models";
import type { AgentSession, ImageObservation, SessionStore } from "@/lib/sessions";

export interface RuntimeTraceSink {
  append(event: TraceEvent): void;
}

export interface RuntimeWorkflowContext {
  traceId: string;
  route: RouteDecision;
  observation?: ImageObservation;
  session: AgentSession;
  signal?: AbortSignal;
}

export interface RuntimeWorkflowExecutor {
  execute(request: ChatRequest, context: RuntimeWorkflowContext): Promise<ChatResponse>;
}

export interface AgentRuntimeDependencies {
  textModel: TextModelAdapter;
  multimodalModel: MultimodalModelAdapter;
  workflow: RuntimeWorkflowExecutor;
  sessions?: SessionStore;
  traceSink?: RuntimeTraceSink;
  modelTimeoutMs?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export interface RuntimeRunOptions {
  signal?: AbortSignal;
}
