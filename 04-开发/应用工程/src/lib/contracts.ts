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
    | "select_repair";
  attachment?: AttachmentMeta;
  formData?: ReturnFormData;
  serviceFormData?: ServiceTicketFormData;
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

export type ChatUi =
  | { kind: "product"; product: ProductView }
  | { kind: "identity_confirm"; maskedPhone: string; purpose: "order" | "service" }
  | { kind: "order"; order: OrderView }
  | { kind: "safety"; priority: "urgent" }
  | { kind: "upload_prompt" }
  | { kind: "return_confirm"; form: ReturnFormData }
  | { kind: "return_success"; requestNo: string }
  | { kind: "troubleshooting"; title: string; steps: string[]; note: string; reportedIssue: string }
  | { kind: "service_ticket_form"; form: ServiceTicketFormData }
  | { kind: "service_ticket_success"; ticketNo: string; serviceType: ServiceTicketFormData["serviceType"] }
  | { kind: "service_ticket"; ticket: ServiceTicketView }
  | { kind: "repair_intake"; examples: string[] }
  | { kind: "knowledge_answer"; title: string; items: string[]; footer: string }
  | { kind: "human_handoff"; title: string; queue: string; reason: string }
  | { kind: "service_menu" }
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
