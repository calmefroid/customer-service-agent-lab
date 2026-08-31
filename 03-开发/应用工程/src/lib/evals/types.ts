import type {
  ChatRequest,
  ChatResponse,
  Intent,
  RiskLevel,
  RouteDecision,
  RouteModule,
  TraceRecord,
} from "@/lib/contracts";

export const EVAL_CATEGORIES = [
  "normal_intent",
  "rag",
  "no_knowledge",
  "knowledge_conflict",
  "tool_success",
  "tool_failure",
  "authorization",
  "image",
  "safety",
  "injection",
  "smalltalk",
] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const EVAL_COVERAGE = [
  "core_after_sales",
  "hidden_knowledge_rag",
  "knowledge_gap",
  "tool_resilience",
  "safety_boundary",
  "image_multimodal",
  "security_boundary",
  "conversation_fallback",
] as const;
export type EvalCoverage = (typeof EVAL_COVERAGE)[number];

export const BAD_CASE_LABELS = ["intent", "fact", "rag", "tool", "rule", "image", "interaction"] as const;
export type BadCaseLabel = (typeof BAD_CASE_LABELS)[number];

export const GRADER_IDS = ["route", "risk", "tool", "confirmation", "source", "response_boundary"] as const;
export type GraderId = (typeof GRADER_IDS)[number];

export type EvalScenario =
  | "default"
  | "knowledge_no_hit_installation"
  | "knowledge_no_hit_warranty"
  | "knowledge_conflict"
  | "knowledge_expired"
  | "tool_empty"
  | "tool_timeout"
  | "tool_business_error"
  | "tool_system_error";

export interface EvalInput {
  request: ChatRequest;
  confirmed: boolean;
  scenario?: EvalScenario;
}

export interface EvalExpectation {
  route?: {
    intent: Intent;
    module?: RouteModule;
    topic?: string;
    action?: string;
  };
  risk?: {
    level?: RiskLevel;
    requiresHuman?: boolean;
  };
  tools?: {
    required?: string[];
    forbidden?: string[];
    expectedOutcome?: "success" | "empty" | "timeout" | "business_error" | "system_error";
  };
  confirmation?: {
    required: boolean;
    writeExecution: "forbidden" | "required" | "none";
  };
  sources?: {
    requiredSystems?: string[];
    forbiddenSystems?: string[];
    requiresKnowledgeCitation?: boolean;
  };
  responseBoundary?: {
    mustContain?: string[];
    mustNotContain?: string[];
    forbiddenKeys?: string[];
    allowedUiKinds?: string[];
  };
}

export interface EvalCase {
  id: string;
  title: string;
  description?: string;
  category: EvalCategory;
  coverage: EvalCoverage[];
  input: EvalInput;
  expected: EvalExpectation;
}

export interface EvalToolObservation {
  system: string;
  toolName: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  statusCode: number;
}

export interface EvalActual {
  response: ChatResponse | null;
  /** Internal evaluator observation; never included in the consumer response. */
  route?: RouteDecision;
  trace: TraceRecord | null;
  toolCalls: EvalToolObservation[];
  sourceSystems: string[];
  sourceRecordIds: string[];
  durationMs: number;
  error?: string;
  simulatedOutcome?: "success" | "empty" | "timeout" | "business_error" | "system_error";
}

export interface GraderResult {
  grader: GraderId;
  status: "pass" | "fail" | "not_applicable";
  code: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface EvalCaseResult {
  resultId: string;
  caseId: string;
  title: string;
  category: EvalCategory;
  coverage: EvalCoverage[];
  passed: boolean;
  traceId: string;
  durationMs: number;
  expected: EvalExpectation;
  actual: EvalActual;
  graders: GraderResult[];
  badCaseLabels: BadCaseLabel[];
  manualLabels: BadCaseLabel[];
}

export interface EvalCategorySummary {
  category: EvalCategory;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface EvalRun {
  runId: string;
  suiteVersion: string;
  mockVersion: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  stableFingerprint: string;
  categories: EvalCategorySummary[];
  results: EvalCaseResult[];
}

export type EvalExecutor = (evalCase: EvalCase, sessionId: string) => Promise<EvalActual>;

export interface RunEvalsOptions {
  cases?: EvalCase[];
  caseId?: string;
  executor?: EvalExecutor;
}
