export type Intent =
  | "logistics_query"
  | "return_exchange"
  | "troubleshooting"
  | "service_ticket_create"
  | "service_ticket_query"
  | "knowledge_query"
  | "human_escalation"
  | "smalltalk"
  | "clarification"
  | "other";

export type RiskLevel = "low" | "medium" | "high";
export type ServiceModule = "logistics" | "return" | "repair";
export type RouteModule = ServiceModule | "knowledge" | "conversation" | "handoff";

/**
 * Cross-module contracts are frozen under this version. Changes require an
 * approved request in `03-开发/并行开发/变更申请/` and a version bump.
 */
export const PUBLIC_CONTRACT_VERSION = "1.1.0" as const;

export type KnowledgeTopic =
  | "product"
  | "return"
  | "safety"
  | "troubleshooting"
  | "smart_setup"
  | "warranty"
  | "installation"
  | "consumer_business";

export type KnowledgeStatus = "draft" | "published" | "inactive";

export interface KnowledgeArticleFields {
  title: string;
  question: string;
  answer: string;
  answerItems: string[];
  topic: KnowledgeTopic;
  productScope: string;
  channelScope: string;
  regionScope: string;
  source: string;
  maintainer: string;
  tags: string[];
}

export interface KnowledgeArticle extends KnowledgeArticleFields {
  id: string;
  status: KnowledgeStatus;
  version: string;
  updatedAt: string;
  publishedAt?: string;
  hasUnpublishedChanges: boolean;
}

export interface KnowledgePreviewResult {
  articleId: string;
  title: string;
  topic: KnowledgeTopic;
  status: KnowledgeStatus;
  version: string;
  score: number;
  excerpt: string;
  selectedDraft: boolean;
}

export interface RouteDecision {
  module: RouteModule;
  intent: Intent;
  topic: string;
  action: string;
  confidence: number;
  needsClarification: boolean;
  requiresConfirmation: boolean;
  requiresHuman: boolean;
  remainingIntents: string[];
  entities: Record<string, string | null>;
  observations: string[];
}

export interface AttachmentMeta {
  name: string;
  type: string;
  size: number;
  /** Request-only image payload. Never include this field in consumer responses or Trace output. */
  dataUrl?: string;
}

export interface ReturnFormData {
  serviceType: "换货" | "退货";
  product: string;
  issueDescription: string;
  contactPhone: string;
  pickupAddress: string;
}

export interface ServiceTicketFormData {
  serviceType: "维修服务" | "安装服务";
  product: string;
  purchaseChannel: "线上商城" | "线下门店";
  faultDescription: string;
  contactPhone: string;
  serviceAddress: string;
  preferredContactTime: string;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  module?: ServiceModule;
  action?:
    | "confirm_identity"
    | "submit_return"
    | "prepare_logistics_urge"
    | "submit_logistics_urge"
    | "prepare_service_ticket"
    | "submit_service_ticket"
    | "confirm_service_identity"
    | "prepare_order_change"
    | "prepare_order_cancel"
    | "confirm_return_identity"
    | "select_repair";
  attachment?: AttachmentMeta;
  formData?: ReturnFormData;
  serviceFormData?: ServiceTicketFormData;
  /**
   * Stage-3 confirmation command. `operation` is intentionally absent: the
   * server resolves it from its ConfirmationRequest store by request ID.
   */
  confirmation?: ConfirmationCommand;
}

export interface ProductView {
  name: string;
  model: string;
  image: string;
  specs: string[];
}

export interface LogisticsEvent {
  time: string;
  text: string;
  active?: boolean;
}

export interface OrderView {
  id: string;
  product: string;
  status: string;
  eta: string;
  carrier: string;
  trackingNo: string;
  hotline: string;
  events: LogisticsEvent[];
}

export interface ServiceTicketView {
  id: string;
  product: string;
  issue: string;
  status: string;
  updatedAt: string;
  events: LogisticsEvent[];
}

export interface OrderOperationResultView {
  operation: "order_change" | "order_cancel";
  orderId: string;
  requestNo: string;
  status: string;
}

export interface ReturnExchangeStatusView {
  requestNo: string;
  orderId: string;
  serviceType: ReturnFormData["serviceType"];
  product: string;
  status: string;
  updatedAt: string;
  events: LogisticsEvent[];
}

export type ChatUi =
  | { kind: "product"; product: ProductView }
  | {
      kind: "identity_confirm";
      maskedPhone: string;
      purpose: "order" | "service" | "order_change" | "order_cancel" | "return";
    }
  | { kind: "order"; order: OrderView }
  | { kind: "order_operation_success"; result: OrderOperationResultView }
  | { kind: "safety"; priority: "urgent" }
  | { kind: "upload_prompt" }
  | { kind: "return_confirm"; form: ReturnFormData }
  | { kind: "return_success"; requestNo: string }
  | { kind: "return_status"; request: ReturnExchangeStatusView }
  | { kind: "troubleshooting"; title: string; steps: string[]; note: string; reportedIssue: string }
  | { kind: "service_ticket_form"; form: ServiceTicketFormData }
  | { kind: "service_ticket_success"; ticketNo: string; serviceType: ServiceTicketFormData["serviceType"] }
  | { kind: "service_ticket"; ticket: ServiceTicketView }
  | { kind: "repair_intake"; examples: string[] }
  | { kind: "knowledge_answer"; title: string; items: string[]; footer: string }
  | { kind: "human_handoff"; title: string; queue: string; reason: string }
  | { kind: "service_menu" }
  | { kind: "confirmation"; request: ConfirmationRequest }
  | {
      kind: "logistics_urge_confirm";
      orderId: string;
      carrier: string;
      trackingNo: string;
      latestStatus: string;
    }
  | {
      kind: "logistics_urge_success";
      requestNo: string;
      carrier: string;
      handoff: string;
    }
  | { kind: "clarification" };

export interface ChatResponse {
  message: string;
  intent: Intent;
  riskLevel: RiskLevel;
  traceId: string;
  route?: RouteDecision;
  ui?: ChatUi;
}

export const AGENT_EVENT_TYPES = ["progress", "token", "ui", "final", "error"] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface AgentEventBase {
  contractVersion: typeof PUBLIC_CONTRACT_VERSION;
  eventId: string;
  sessionId: string;
  sequence: number;
  createdAt: string;
  traceId?: string;
}

export type AgentEvent =
  | (AgentEventBase & {
      type: "progress";
      progress: {
        stage: string;
        label: string;
        status: "started" | "completed" | "failed";
        durationMs?: number;
      };
    })
  | (AgentEventBase & {
      type: "token";
      messageId: string;
      delta: string;
    })
  | (AgentEventBase & {
      type: "ui";
      ui: ChatUi;
    })
  | (AgentEventBase & {
      type: "final";
      response: ChatResponse;
    })
  | (AgentEventBase & {
      type: "error";
      error: AgentPublicError;
    });

export interface AgentPublicError {
  code: string;
  message: string;
  retryable: boolean;
}

export const TOOL_RESULT_STATUSES = [
  "success",
  "empty",
  "timeout",
  "business_error",
  "system_error",
] as const;
export type ToolResultStatus = (typeof TOOL_RESULT_STATUSES)[number];

export type ToolErrorCode =
  | "EMPTY_RESULT"
  | "TIMEOUT"
  | "BUSINESS_REJECTED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "SYSTEM_FAILURE"
  | "CANCELLED";

export interface DataSourceMetadata {
  sourceSystem: "PCMP" | "OMS" | "WMS" | "TMS" | "CRM" | "CustomerKnowledgeBase" | string;
  adapterType: "mock" | "live";
  requestId: string;
  recordId?: string;
  sourceUpdatedAt?: string;
}

export interface ToolResultMetadata {
  requestId: string;
  sources: DataSourceMetadata[];
  durationMs: number;
  attempts: number;
}

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type ToolResult<T> =
  | {
      status: "success";
      data: T;
      error?: never;
      meta: ToolResultMetadata;
    }
  | {
      status: Exclude<ToolResultStatus, "success">;
      data: null;
      error: ToolError;
      meta: ToolResultMetadata;
    };

export type ConfirmationOperation =
  | "order_change"
  | "order_cancel"
  | "logistics_urge"
  | "return_exchange_create"
  | "service_ticket_create";

export const CONFIRMATION_DECISION_ACTIONS = ["confirm", "modify", "cancel"] as const;
export type ConfirmationDecisionAction = (typeof CONFIRMATION_DECISION_ACTIONS)[number];

export interface ConfirmationRequest<TDraft extends Record<string, unknown> = Record<string, unknown>> {
  confirmationRequestId: string;
  sessionId: string;
  traceId: string;
  operation: ConfirmationOperation;
  target: {
    type: "order" | "shipment" | "return_request" | "service_ticket";
    id: string;
    label?: string;
  };
  draftSnapshot: Readonly<TDraft>;
  riskLevel: RiskLevel;
  risks: string[];
  confirmationToken: string;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
}

export interface ConfirmationDecision<TSnapshot extends Record<string, unknown> = Record<string, unknown>> {
  confirmationRequestId: string;
  action: ConfirmationDecisionAction;
  finalSnapshot?: Readonly<TSnapshot>;
  decidedAt: string;
}

interface ConfirmationCommandBase {
  confirmationRequestId: string;
  confirmationToken: string;
  idempotencyKey: string;
}

/** Consumer-to-server wire command. Never accepts a client-provided operation. */
export type ConfirmationCommand<TSnapshot extends Record<string, unknown> = Record<string, unknown>> =
  | (ConfirmationCommandBase & {
      action: "confirm" | "modify";
      finalSnapshot: Readonly<TSnapshot>;
    })
  | (ConfirmationCommandBase & {
      action: "cancel";
      finalSnapshot?: never;
    });

export const KNOWLEDGE_RETRIEVAL_STATUSES = ["hit", "no_hit", "conflict", "expired"] as const;
export type KnowledgeRetrievalStatus = (typeof KNOWLEDGE_RETRIEVAL_STATUSES)[number];

export interface KnowledgeRetrievalFilter {
  status: "published";
  productId?: string;
  productCategory?: string;
  channel?: string;
  region?: string;
  effectiveAt: string;
}

export interface KnowledgeCitation {
  articleId: string;
  version: string;
  excerpt: string;
}

export interface KnowledgeRetrievalCandidate {
  articleId: string;
  version: string;
  title: string;
  score: number;
  excerpt: string;
  adopted: boolean;
  adoptionReason?: string;
  filterReasons: string[];
  citation?: KnowledgeCitation;
}

export interface KnowledgeConflict {
  articleIds: string[];
  reason: string;
}

export interface KnowledgeRetrievalResult {
  status: KnowledgeRetrievalStatus;
  query: string;
  filters: KnowledgeRetrievalFilter;
  candidates: KnowledgeRetrievalCandidate[];
  selectedArticleIds: string[];
  conflicts: KnowledgeConflict[];
  citations: KnowledgeCitation[];
  requestId: string;
  durationMs: number;
}

export const TRACE_EVENT_TYPES = [
  "model",
  "route",
  "rag",
  "tool",
  "rule",
  "confirmation",
  "output",
  "error",
] as const;
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

interface TraceEventBase<TType extends TraceEventType, TPayload> {
  contractVersion: typeof PUBLIC_CONTRACT_VERSION;
  eventId: string;
  traceId: string;
  sessionId: string;
  sequence: number;
  createdAt: string;
  type: TType;
  status: "started" | "completed" | "failed" | "skipped";
  durationMs?: number;
  payload: TPayload;
}

export type TraceEvent =
  | TraceEventBase<"model", {
      provider: string;
      model: string;
      mode: "mock" | "live";
      inputSummary?: string;
      outputSummary?: string;
    }>
  | TraceEventBase<"route", {
      selected?: RouteDecision;
      candidates: Array<{ intent: Intent; topic: string; score: number }>;
    }>
  | TraceEventBase<"rag", KnowledgeRetrievalResult>
  | TraceEventBase<"tool", {
      toolName: string;
      operation: string;
      result: ToolResult<unknown>;
    }>
  | TraceEventBase<"rule", {
      ruleId: string;
      matched: boolean;
      evidence: string[];
      effect: string;
    }>
  | TraceEventBase<"confirmation", {
      request: ConfirmationRequest;
      decision?: ConfirmationDecision;
    }>
  | TraceEventBase<"output", {
      audience: "consumer" | "operations" | "internal";
      summary: string;
    }>
  | TraceEventBase<"error", AgentPublicError & { internalCode?: string }>;

export interface TraceSource {
  type: "business" | "knowledge" | "rule";
  sourceSystem: string;
  recordId: string;
  version?: string;
  updatedAt?: string;
  excerpt?: string;
}

export type TraceStageKind = "decision" | "guardrail" | "knowledge" | "tool" | "output";
export type TraceStageStatus = "completed" | "failed";

export interface TraceToolCall {
  system: string;
  toolName: string;
  operation: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  endpoint: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  statusCode: number;
}

export interface TraceStage {
  id: string;
  title: string;
  kind: TraceStageKind;
  status: TraceStageStatus;
  durationMs: number;
  summary: string;
  toolCall?: TraceToolCall;
}

export interface TracePromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TraceRouteCandidate {
  intent: Intent;
  topic: string;
  score: number;
  matchedSignals: string[];
}

export interface TraceRuleEvaluation {
  ruleId: string;
  name: string;
  matched: boolean;
  evidence: string[];
  effect: string;
}

export interface TraceDebugContext {
  environment: "mock";
  recordLevel: "application_full";
  model: {
    provider: string;
    model: string;
    mode: "mock";
    temperature: number;
    responseFormat: "json_schema";
  };
  prompt: {
    templateId: string;
    version: string;
    applicationSystemPrompt: string;
    messages: TracePromptMessage[];
    responseSchema: Record<string, unknown>;
    fewShotExampleIds: string[];
  };
  classification: {
    candidates: TraceRouteCandidate[];
    selected: RouteDecision;
    rules: TraceRuleEvaluation[];
  };
  extraction: {
    entities: RouteDecision["entities"];
    observations: string[];
    missingFields: string[];
  };
  modelOutput: {
    raw: string;
    parsed: RouteDecision;
  };
  finalDecisionSummary: string;
  boundaryNote: string;
}

export interface TraceRecord {
  traceId: string;
  sessionId: string;
  createdAt: string;
  intent: Intent;
  route: RouteDecision;
  riskLevel: RiskLevel;
  inputSummary: string;
  outputSummary: string;
  steps: string[];
  totalDurationMs: number;
  stages: TraceStage[];
  sources: TraceSource[];
  debug: TraceDebugContext;
}
