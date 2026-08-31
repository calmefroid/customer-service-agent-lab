import { AgentRuntime } from "@/lib/agent-runtime/agent-runtime";
import { InMemoryRuntimeTraceStore } from "@/lib/agent-runtime/runtime-trace-store";
import { knowledgeSandbox } from "@/lib/adapters/knowledge-mock-adapter";
import { deactivateKnowledgeArticle, resetKnowledgeStore } from "@/lib/knowledge-store";
import { MockMultimodalModelAdapter, MockTextModelAdapter } from "@/lib/models";
import { orchestrateMock, type MockOrchestrationOptions } from "@/lib/mock-orchestrator";
import { runRegisteredAgent } from "@/lib/orchestration/mock-compatibility";
import { InMemorySessionStore } from "@/lib/sessions";
import { listTraces } from "@/lib/trace-store";
import { EVAL_CASES, EVAL_MOCK_VERSION, EVAL_SUITE_VERSION, getEvalCase } from "@/lib/evals/dataset";
import { gradeEvalCase } from "@/lib/evals/graders";
import type {
  BadCaseLabel,
  EvalActual,
  EvalCase,
  EvalCaseResult,
  EvalCategory,
  EvalCategorySummary,
  EvalExecutor,
  EvalRun,
  GraderId,
  RunEvalsOptions,
} from "@/lib/evals/types";

declare global {
  // eslint-disable-next-line no-var
  var customerServiceEvalRunStore: EvalRun[] | undefined;
}

function store(): EvalRun[] {
  if (!globalThis.customerServiceEvalRunStore) globalThis.customerServiceEvalRunStore = [];
  return globalThis.customerServiceEvalRunStore;
}

function setupScenario(evalCase: EvalCase): void {
  resetKnowledgeStore();
  knowledgeSandbox.clear();
  if (evalCase.input.scenario === "knowledge_no_hit_installation") {
    deactivateKnowledgeArticle("KB-INSTALL-GUIDE-007");
  }
  if (evalCase.input.scenario === "knowledge_no_hit_warranty") {
    deactivateKnowledgeArticle("KB-AFTERSALE-WARRANTY-003");
  }
  if (evalCase.input.scenario === "knowledge_conflict" || evalCase.input.scenario === "knowledge_expired") {
    knowledgeSandbox.activate(evalCase.input.scenario);
  }
}

function inferSemanticOutcome(trace: EvalActual["trace"]): EvalActual["simulatedOutcome"] {
  const outputs = trace?.stages.flatMap((stage) => stage.toolCall ? [stage.toolCall.output] : []) ?? [];
  if (outputs.some((output) => output.retrieval_status === "conflict" || output.outcome === "business_error")) return "business_error";
  if (outputs.some((output) => output.retrieval_status === "expired" || output.outcome === "empty")) return "empty";
  if (outputs.some((output) => output.outcome === "timeout")) return "timeout";
  if (outputs.some((output) => output.outcome === "system_error")) return "system_error";
  if (outputs.some((output) => output.hit_count === 0)) return "empty";
  return undefined;
}

function orchestrationOptions(evalCase: EvalCase): MockOrchestrationOptions {
  switch (evalCase.input.scenario) {
    case "tool_empty":
      return { toolOutcomes: { latestOrder: "empty" } };
    case "tool_timeout":
      return { toolOutcomes: { shipment: "timeout" } };
    case "tool_business_error":
      return { toolOutcomes: { returnExchange: "business_error" } };
    case "tool_system_error":
      return { toolOutcomes: { serviceTicket: "system_error" } };
    default:
      return {};
  }
}

async function executeImageEval(evalCase: EvalCase, sessionId: string) {
  const runtimeTraces = new InMemoryRuntimeTraceStore();
  const runtime = new AgentRuntime({
    textModel: new MockTextModelAdapter(),
    multimodalModel: new MockMultimodalModelAdapter(),
    workflow: {
      execute: (request, context) => runRegisteredAgent(request, context),
    },
    sessions: new InMemorySessionStore(),
    traceSink: runtimeTraces,
  });
  let response: EvalActual["response"] = null;
  let publicError: string | undefined;
  for await (const event of runtime.run({ ...evalCase.input.request, sessionId })) {
    if (event.type === "final") response = event.response;
    if (event.type === "error") publicError = `${event.error.code}: ${event.error.message}`;
  }
  if (!response) throw new Error(publicError ?? "RUNTIME_FINAL_RESPONSE_MISSING");
  const route = runtimeTraces
    .list(response.traceId)
    .filter((event) => event.type === "route" && event.payload.selected)
    .at(-1);
  return {
    response,
    route: route?.type === "route" ? route.payload.selected : undefined,
  };
}

export const executeMockEval: EvalExecutor = async (evalCase, sessionId) => {
  setupScenario(evalCase);
  const startedAt = Date.now();
  try {
    const runtimeResult = evalCase.category === "image"
      ? await executeImageEval(evalCase, sessionId)
      : undefined;
    const response = runtimeResult?.response
      ?? await orchestrateMock({ ...evalCase.input.request, sessionId }, orchestrationOptions(evalCase));
    const trace = listTraces(sessionId).at(-1) ?? null;
    const toolCalls = trace?.stages.flatMap((stage) => stage.toolCall ? [{
      system: stage.toolCall.system,
      toolName: stage.toolCall.toolName,
      method: stage.toolCall.method,
      statusCode: stage.toolCall.statusCode,
    }] : []) ?? [];
    return {
      response,
      route: runtimeResult?.route,
      trace,
      toolCalls,
      sourceSystems: [...new Set(trace?.sources.map((source) => source.sourceSystem) ?? [])],
      sourceRecordIds: [...new Set(trace?.sources.map((source) => source.recordId) ?? [])],
      durationMs: Date.now() - startedAt,
      simulatedOutcome: inferSemanticOutcome(trace),
    };
  } finally {
    knowledgeSandbox.clear();
    resetKnowledgeStore();
  }
};

const GRADER_LABELS: Record<GraderId, BadCaseLabel[]> = {
  route: ["intent"],
  risk: ["rule"],
  tool: ["tool"],
  confirmation: ["interaction", "rule"],
  source: ["rag", "fact"],
  response_boundary: ["rule", "interaction"],
};

function classifyBadCase(evalCase: EvalCase, graders: EvalCaseResult["graders"]): BadCaseLabel[] {
  const labels = graders
    .filter((grader) => grader.status === "fail")
    .flatMap((grader) => GRADER_LABELS[grader.grader]);
  if (evalCase.category === "image" && graders.some((grader) => grader.status === "fail")) labels.push("image");
  if (["rag", "no_knowledge", "knowledge_conflict"].includes(evalCase.category) && graders.some((grader) => grader.status === "fail")) labels.push("rag");
  return [...new Set(labels)];
}

function hashStable(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function summarizeCategories(results: EvalCaseResult[]): EvalCategorySummary[] {
  const categories = [...new Set(results.map((item) => item.category))];
  return categories.map((category) => {
    const matching = results.filter((item) => item.category === category);
    const passed = matching.filter((item) => item.passed).length;
    return {
      category,
      total: matching.length,
      passed,
      failed: matching.length - passed,
      passRate: matching.length ? Number(((passed / matching.length) * 100).toFixed(1)) : 0,
    };
  });
}

function makeRunId(): string {
  return `EV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function runEvals(options: RunEvalsOptions = {}): Promise<EvalRun> {
  const selectedCases = options.caseId
    ? [getEvalCase(options.caseId)].filter((item): item is EvalCase => Boolean(item))
    : options.cases ?? EVAL_CASES;
  if (!selectedCases.length) throw new Error(options.caseId ? `EVAL_CASE_NOT_FOUND:${options.caseId}` : "EVAL_CASES_EMPTY");

  const runId = makeRunId();
  const startedAt = new Date();
  const executor = options.executor ?? executeMockEval;
  const results: EvalCaseResult[] = [];

  for (const [index, evalCase] of selectedCases.entries()) {
    const sessionId = `eval-${runId}-${evalCase.id}`;
    let actual: EvalActual;
    try {
      actual = await executor(evalCase, sessionId);
    } catch (error) {
      actual = {
        response: null,
        trace: null,
        toolCalls: [],
        sourceSystems: [],
        sourceRecordIds: [],
        durationMs: 0,
        error: error instanceof Error ? error.message : "UNKNOWN_EVAL_EXECUTOR_ERROR",
        simulatedOutcome: "system_error",
      };
    }
    const graders = gradeEvalCase(evalCase, actual);
    const passed = graders.every((grader) => grader.status !== "fail");
    const traceId = actual.response?.traceId ?? actual.trace?.traceId ?? `EVAL-ERROR-${runId}-${index + 1}`;
    results.push({
      resultId: `${runId}:${evalCase.id}`,
      caseId: evalCase.id,
      title: evalCase.title,
      category: evalCase.category,
      coverage: evalCase.coverage,
      passed,
      traceId,
      durationMs: actual.durationMs,
      expected: evalCase.expected,
      actual,
      graders,
      badCaseLabels: passed ? [] : classifyBadCase(evalCase, graders),
      manualLabels: [],
    });
  }

  const completedAt = new Date();
  const passed = results.filter((item) => item.passed).length;
  const fingerprintSource = results.map((item) => ({
    caseId: item.caseId,
    passed: item.passed,
    failures: item.graders.filter((grader) => grader.status === "fail").map((grader) => grader.code).sort(),
    labels: item.badCaseLabels,
  }));
  const run: EvalRun = {
    runId,
    suiteVersion: EVAL_SUITE_VERSION,
    mockVersion: EVAL_MOCK_VERSION,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: Number(((passed / results.length) * 100).toFixed(1)),
    stableFingerprint: hashStable(JSON.stringify(fingerprintSource)),
    categories: summarizeCategories(results),
    results,
  };
  const runs = store();
  runs.unshift(run);
  if (runs.length > 20) runs.splice(20);
  return run;
}

export function listEvalRuns(): EvalRun[] {
  return store();
}

export function getEvalRun(runId: string): EvalRun | undefined {
  return store().find((run) => run.runId === runId);
}

export function clearEvalRuns(): void {
  globalThis.customerServiceEvalRunStore = [];
}

export function updateEvalResultLabels(runId: string, resultId: string, labels: BadCaseLabel[]): EvalCaseResult | undefined {
  const result = getEvalRun(runId)?.results.find((item) => item.resultId === resultId);
  if (!result) return undefined;
  result.manualLabels = [...new Set(labels)];
  return result;
}

export function getEvalDatasetSummary(): { total: number; categories: Record<EvalCategory, number> } {
  const categories = Object.fromEntries(
    [...new Set(EVAL_CASES.map((item) => item.category))].map((category) => [category, EVAL_CASES.filter((item) => item.category === category).length]),
  ) as Record<EvalCategory, number>;
  return { total: EVAL_CASES.length, categories };
}
