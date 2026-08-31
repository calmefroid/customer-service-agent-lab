import { randomUUID } from "node:crypto";

import { defaultRuntimeTraceStore } from "@/lib/agent-runtime/runtime-singletons";
import {
  PUBLIC_CONTRACT_VERSION,
  type KnowledgeRetrievalResult,
  type RiskLevel,
  type RouteDecision,
  type ToolResult,
  type ToolResultStatus,
  type TraceDebugContext,
  type TraceEvent,
  type TraceEventType,
  type TraceRecord,
  type TraceSource,
  type TraceStage,
} from "@/lib/contracts";

const TRACE_STATUSES = ["started", "completed", "failed", "skipped"] as const;
export type TraceEventStatus = (typeof TRACE_STATUSES)[number];

type TraceEventBaseKeys = "contractVersion" | "eventId" | "traceId" | "sessionId" | "sequence" | "createdAt";
export type TraceEventDraft = TraceEvent extends infer TEvent
  ? TEvent extends TraceEvent
    ? Omit<TEvent, TraceEventBaseKeys>
    : never
  : never;

export interface TraceEventQuery {
  traceId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  type?: TraceEventType;
  status?: TraceEventStatus;
}

export type TraceView = Omit<TraceRecord, "debug"> & {
  debug?: TraceDebugContext;
  events: TraceEvent[];
};

export interface TraceWriter {
  traceId: string;
  sessionId: string;
  append(event: TraceEventDraft): TraceEvent;
}

declare global {
  // eslint-disable-next-line no-var
  var customerServiceTraceEventStore: TraceEvent[] | undefined;
  // eslint-disable-next-line no-var
  var customerServiceTraceProjectionSeeds: Map<string, TraceRecord> | undefined;
}

function eventStore(): TraceEvent[] {
  if (!globalThis.customerServiceTraceEventStore) globalThis.customerServiceTraceEventStore = [];
  return globalThis.customerServiceTraceEventStore;
}

function projectionSeeds(): Map<string, TraceRecord> {
  if (!globalThis.customerServiceTraceProjectionSeeds) {
    globalThis.customerServiceTraceProjectionSeeds = new Map<string, TraceRecord>();
  }
  return globalThis.customerServiceTraceProjectionSeeds;
}

function redactString(value: string, key: string): string {
  const redacted = value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[REDACTED_IMAGE_PAYLOAD]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "sk-***")
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|secret)\s*[=:]\s*)[^\s,;"'}]+/gi, "$1***")
    .replace(/<think>[\s\S]*?<\/think>/gi, "[PRIVATE_REASONING_OMITTED]")
    .replace(/(?:chain[ _-]?of[ _-]?thought|private[ _-]?reasoning)\s*[=:]\s*[^\n]+/gi, "private_reasoning=OMITTED")
    .replace(/(?:北京市|上海市|天津市|重庆市|[\p{Script=Han}]{2,8}(?:省|自治区))[\p{Script=Han}A-Za-z0-9* -]{2,50}(?:路|街|道|巷)[\p{Script=Han}A-Za-z0-9* -]{0,20}(?:号|室)/gu, "[REDACTED_ADDRESS]");
  if (/^(?:sessionId|traceId|eventId|requestId|recordId|createdAt|updatedAt|publishedAt|expiresAt)$/i.test(key)) return redacted;
  return redacted.replace(/1\d{2}[ -]?\d{4}[ -]?(\d{4})/g, "1********$1");
}

function sanitizeUnknown(value: unknown, key = ""): unknown {
  if (/data.?url|base64|image.?data/i.test(key)) return undefined;
  if (/api.?key|authorization|secret|access.?token|refresh.?token|confirmation.?token|idempotency.?key/i.test(key)) return "***";
  if (/chain.?of.?thought|private.?reasoning|hidden.?reasoning|thinking/i.test(key)) return "[OMITTED]";
  if (/(?:phone|mobile)$/i.test(key)) {
    return typeof value === "string" && value.includes("*") ? value : "[REDACTED_PHONE]";
  }
  if (/address$/i.test(key)) {
    return typeof value === "string" && /\*|XX|演示|虚拟/.test(value) ? value : "[REDACTED_ADDRESS]";
  }
  if (typeof value === "string") return redactString(value, key);
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([childKey]) => !/data.?url|base64|image.?data/i.test(childKey))
        .map(([childKey, childValue]) => [childKey, sanitizeUnknown(childValue, childKey)]),
    );
  }
  return value;
}

function sanitizeEvent(event: TraceEvent): TraceEvent {
  return sanitizeUnknown(event) as TraceEvent;
}

function sanitizeRecord(record: TraceRecord): TraceRecord {
  return sanitizeUnknown(record) as TraceRecord;
}

function sharedEventsFor(traceId: string): TraceEvent[] {
  return eventStore().filter((event) => event.traceId === traceId);
}

function runtimeEventsFor(traceId: string): TraceEvent[] {
  return defaultRuntimeTraceStore.list(traceId);
}

function hasEvent(traceId: string, type: TraceEventType): boolean {
  return [...runtimeEventsFor(traceId), ...sharedEventsFor(traceId)].some((event) => event.type === type);
}

export function appendTraceEvent(event: TraceEvent): TraceEvent {
  const sanitized = sanitizeEvent(event);
  const events = eventStore();
  const existing = events.find((candidate) => candidate.eventId === sanitized.eventId);
  if (existing) return existing;
  const sequence = events
    .filter((candidate) => candidate.traceId === sanitized.traceId)
    .reduce((highest, candidate) => Math.max(highest, candidate.sequence), 0) + 1;
  const normalized = { ...sanitized, sequence } as TraceEvent;
  events.push(normalized);
  if (events.length > 5_000) events.splice(0, events.length - 5_000);
  return normalized;
}

/** Structural RuntimeTraceSink used by the 00 Chat API assembly after 01 exposes injection. */
export const unifiedTraceSink = { append: appendTraceEvent } as const;

export function createTraceWriter(traceId: string, sessionId: string): TraceWriter {
  let localSequence = [...runtimeEventsFor(traceId), ...sharedEventsFor(traceId)]
    .reduce((highest, event) => Math.max(highest, event.sequence), 0);
  return {
    traceId,
    sessionId,
    append(event) {
      return appendTraceEvent({
        contractVersion: PUBLIC_CONTRACT_VERSION,
        eventId: `TE-ORCH-${randomUUID()}`,
        traceId,
        sessionId,
        sequence: ++localSequence,
        createdAt: new Date().toISOString(),
        ...event,
      } as TraceEvent);
    },
  };
}

function toolStatus(stage: TraceStage): ToolResultStatus {
  const outcome = stage.toolCall?.output.outcome;
  if (outcome === "success" || outcome === "empty" || outcome === "timeout" || outcome === "business_error" || outcome === "system_error") {
    return outcome;
  }
  const statusCode = stage.toolCall?.statusCode ?? 200;
  if (statusCode < 400) return "success";
  if (statusCode === 404) return "empty";
  if (statusCode === 408 || statusCode === 504) return "timeout";
  if (statusCode < 500) return "business_error";
  return "system_error";
}

function toolResult(record: TraceRecord, stage: TraceStage): ToolResult<unknown> {
  const call = stage.toolCall!;
  const status = toolStatus(stage);
  const sources = record.sources
    .filter((source) => call.system.includes(source.sourceSystem) || source.sourceSystem === call.system)
    .map((source) => ({
      sourceSystem: source.sourceSystem,
      adapterType: "mock" as const,
      requestId: `${record.traceId}:${stage.id}`,
      recordId: source.recordId,
      sourceUpdatedAt: source.updatedAt,
    }));
  const meta = {
    requestId: `${record.traceId}:${stage.id}`,
    sources,
    durationMs: stage.durationMs,
    attempts: 1,
  };
  if (status === "success") return { status, data: call.output, meta };
  const code = status === "empty" ? "EMPTY_RESULT" as const
    : status === "timeout" ? "TIMEOUT" as const
      : status === "business_error" ? "BUSINESS_REJECTED" as const
        : "SYSTEM_FAILURE" as const;
  return {
    status,
    data: null,
    error: { code, message: stage.summary, retryable: status === "timeout" || status === "system_error" },
    meta,
  };
}

function ragResult(record: TraceRecord, stage: TraceStage): KnowledgeRetrievalResult {
  const call = stage.toolCall!;
  const statusValue = call.output.retrieval_status;
  const status = statusValue === "hit" || statusValue === "no_hit" || statusValue === "conflict" || statusValue === "expired"
    ? statusValue
    : call.output.hit_count === 0 ? "no_hit" : "hit";
  const citations = record.sources
    .filter((source) => source.type === "knowledge" && source.version)
    .map((source) => ({ articleId: source.recordId, version: source.version!, excerpt: source.excerpt ?? "" }));
  return {
    status,
    query: typeof call.input.query === "string" ? call.input.query : record.inputSummary,
    filters: { status: "published", effectiveAt: record.createdAt },
    candidates: citations.map((citation) => ({
      articleId: citation.articleId,
      version: citation.version,
      title: citation.articleId,
      score: 1,
      excerpt: citation.excerpt,
      adopted: status === "hit",
      filterReasons: [],
      ...(status === "hit" ? { citation } : {}),
    })),
    selectedArticleIds: status === "hit" ? citations.map((citation) => citation.articleId) : [],
    conflicts: status === "conflict" ? [{
      articleIds: Array.isArray(call.output.selected_article_ids)
        ? call.output.selected_article_ids.filter((id): id is string => typeof id === "string")
        : [],
      reason: stage.summary,
    }] : [],
    citations: status === "hit" ? citations : [],
    requestId: `${record.traceId}:${stage.id}`,
    durationMs: stage.durationMs,
  };
}

function appendCompatibilityEvents(record: TraceRecord): void {
  const writer = createTraceWriter(record.traceId, record.sessionId);
  if (!hasEvent(record.traceId, "model")) {
    writer.append({
      type: "model",
      status: "completed",
      payload: {
        provider: record.debug.model.provider,
        model: record.debug.model.model,
        mode: record.debug.model.mode,
        inputSummary: JSON.stringify(record.debug.prompt.messages),
        outputSummary: record.debug.modelOutput.raw,
      },
    });
  }
  if (!hasEvent(record.traceId, "route")) {
    writer.append({
      type: "route",
      status: "completed",
      payload: {
        selected: record.route,
        candidates: record.debug.classification.candidates.map(({ intent, topic, score }) => ({ intent, topic, score })),
      },
    });
  }
  record.debug.classification.rules.forEach((rule) => writer.append({
    type: "rule",
    status: "completed",
    payload: { ruleId: rule.ruleId, matched: rule.matched, evidence: rule.evidence, effect: rule.effect },
  }));
  record.stages.forEach((stage) => {
    if (stage.toolCall && stage.kind === "knowledge") {
      writer.append({ type: "rag", status: stage.status, durationMs: stage.durationMs, payload: ragResult(record, stage) });
      return;
    }
    if (stage.toolCall) {
      writer.append({
        type: "tool",
        status: stage.status,
        durationMs: stage.durationMs,
        payload: { toolName: stage.toolCall.toolName, operation: stage.toolCall.operation, result: toolResult(record, stage) },
      });
      return;
    }
    if (stage.kind === "guardrail") {
      writer.append({
        type: "rule",
        status: stage.status,
        durationMs: stage.durationMs,
        payload: { ruleId: `LEGACY-STAGE-${stage.id}`, matched: true, evidence: [stage.summary], effect: stage.title },
      });
      return;
    }
    writer.append({
      type: "output",
      status: stage.status,
      durationMs: stage.durationMs,
      payload: { audience: stage.kind === "output" ? "consumer" : "internal", summary: stage.summary },
    });
  });
}

/**
 * Compatibility ingress for the stage-1 orchestrator. The record is retained only
 * as a projection seed; canonical query and filtering operate on TraceEvent.
 */
export function appendTrace(record: TraceRecord): TraceRecord {
  const sanitized = sanitizeRecord(record);
  projectionSeeds().set(sanitized.traceId, sanitized);
  appendCompatibilityEvents(sanitized);
  return sanitized;
}

function eventTime(event: TraceEvent): number {
  const value = Date.parse(event.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function queryMatches(event: TraceEvent, query: TraceEventQuery): boolean {
  if (query.traceId && event.traceId !== query.traceId) return false;
  if (query.sessionId && event.sessionId !== query.sessionId) return false;
  if (query.type && event.type !== query.type) return false;
  if (query.status && event.status !== query.status) return false;
  if (query.from && eventTime(event) < Date.parse(query.from)) return false;
  if (query.to && eventTime(event) > Date.parse(query.to)) return false;
  return true;
}

export function listTraceEvents(query: TraceEventQuery = {}): TraceEvent[] {
  const unique = new Map<string, TraceEvent>();
  [...defaultRuntimeTraceStore.list(), ...eventStore()].forEach((event) => {
    const sanitized = sanitizeEvent(event);
    if (queryMatches(sanitized, query)) unique.set(sanitized.eventId, sanitized);
  });
  const sorted = [...unique.values()].sort((left, right) =>
    eventTime(left) - eventTime(right) || left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
  const sequences = new Map<string, number>();
  return sorted.map((event) => {
    const sequence = (sequences.get(event.traceId) ?? 0) + 1;
    sequences.set(event.traceId, sequence);
    return { ...event, sequence };
  });
}

function riskForRoute(route: RouteDecision | undefined): RiskLevel {
  if (!route) return "low";
  if (route.topic.startsWith("safety.")) return "high";
  if (route.requiresHuman || route.requiresConfirmation) return "medium";
  return "low";
}

function eventTitle(event: TraceEvent): string {
  if (event.type === "model") return `模型调用 · ${event.payload.model}`;
  if (event.type === "route") return `路由 · ${event.payload.selected?.topic ?? "未选择"}`;
  if (event.type === "rag") return `RAG · ${event.payload.status}`;
  if (event.type === "tool") return `工具 · ${event.payload.toolName}`;
  if (event.type === "rule") return `规则 · ${event.payload.ruleId}`;
  if (event.type === "confirmation") return `确认 · ${event.payload.request.operation}`;
  if (event.type === "output") return `输出 · ${event.payload.audience}`;
  return `错误 · ${event.payload.code}`;
}

function eventSummary(event: TraceEvent): string {
  if (event.type === "model") return event.payload.outputSummary ?? `${event.payload.provider} / ${event.payload.model}`;
  if (event.type === "route") return event.payload.selected ? `${event.payload.selected.intent} / ${event.payload.selected.topic}` : "没有选中路由";
  if (event.type === "rag") return `${event.payload.status}；候选 ${event.payload.candidates.length} 条`;
  if (event.type === "tool") return `${event.payload.operation}：${event.payload.result.status}`;
  if (event.type === "rule") return `${event.payload.matched ? "命中" : "未命中"}；${event.payload.effect}`;
  if (event.type === "confirmation") return event.payload.decision?.action ?? "等待用户确认";
  if (event.type === "output") return event.payload.summary;
  return event.payload.message;
}

function eventStage(event: TraceEvent): TraceStage {
  const kind = event.type === "rule" || event.type === "confirmation" ? "guardrail"
    : event.type === "rag" ? "knowledge"
      : event.type === "tool" ? "tool"
        : event.type === "output" ? "output"
          : "decision";
  return {
    id: event.eventId,
    title: eventTitle(event),
    kind,
    status: event.status === "failed" ? "failed" : "completed",
    durationMs: event.durationMs ?? 0,
    summary: eventSummary(event),
  };
}

function eventSources(events: TraceEvent[]): TraceSource[] {
  const sources: TraceSource[] = [];
  events.forEach((event) => {
    if (event.type === "tool") {
      event.payload.result.meta.sources.forEach((source) => sources.push({
        type: source.sourceSystem === "CustomerKnowledgeBase" ? "knowledge" : "business",
        sourceSystem: source.sourceSystem,
        recordId: source.recordId ?? source.requestId,
        updatedAt: source.sourceUpdatedAt,
      }));
    }
    if (event.type === "rag") {
      event.payload.citations.forEach((citation) => sources.push({
        type: "knowledge",
        sourceSystem: "CustomerKnowledgeBase",
        recordId: citation.articleId,
        version: citation.version,
        excerpt: citation.excerpt,
      }));
    }
  });
  return [...new Map(sources.map((source) => [`${source.type}:${source.sourceSystem}:${source.recordId}:${source.version ?? ""}`, source])).values()];
}

function runtimeOnlyView(events: TraceEvent[]): TraceView {
  const first = events[0];
  const route = events.filter((event) => event.type === "route" && event.payload.selected).at(-1);
  const selectedRoute = route?.type === "route" ? route.payload.selected : undefined;
  const output = events.filter((event) => event.type === "output").at(-1);
  const stages = events.map(eventStage);
  const sources = eventSources(events);
  return {
    traceId: first.traceId,
    sessionId: first.sessionId,
    createdAt: first.createdAt,
    intent: selectedRoute?.intent ?? "other",
    route: selectedRoute ?? {
      module: "conversation",
      intent: "other",
      topic: "conversation.unclassified",
      action: "respond",
      confidence: 0,
      needsClarification: false,
      requiresConfirmation: false,
      requiresHuman: false,
      remainingIntents: [],
      entities: { orderId: null, productId: null, serviceType: null },
      observations: [],
    },
    riskLevel: riskForRoute(selectedRoute),
    inputSummary: `Runtime 请求 · ${first.sessionId}`,
    outputSummary: output?.type === "output" ? output.payload.summary : "Runtime 尚未产生消费者输出",
    steps: stages.map((stage) => stage.title),
    totalDurationMs: stages.reduce((sum, stage) => sum + stage.durationMs, 0),
    stages,
    sources,
    events,
  };
}

export function listTraceViews(query: TraceEventQuery = {}): TraceView[] {
  const events = listTraceEvents(query);
  const grouped = new Map<string, TraceEvent[]>();
  events.forEach((event) => grouped.set(event.traceId, [...(grouped.get(event.traceId) ?? []), event]));
  return [...grouped.values()].map((traceEvents) => {
    const seed = projectionSeeds().get(traceEvents[0].traceId);
    return seed ? { ...seed, events: traceEvents } : runtimeOnlyView(traceEvents);
  }).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

/** Legacy compatibility query used by stage-1 Evals and tests. */
export function listTraces(sessionId?: string): TraceRecord[] {
  return [...projectionSeeds().values()].filter((record) => !sessionId || record.sessionId === sessionId);
}

export function clearTraces(): void {
  globalThis.customerServiceTraceEventStore = [];
  globalThis.customerServiceTraceProjectionSeeds = new Map<string, TraceRecord>();
  defaultRuntimeTraceStore.reset();
}

export function isTraceEventType(value: string | null): value is TraceEventType {
  return Boolean(value && ["model", "route", "rag", "tool", "rule", "confirmation", "output", "error"].includes(value));
}

export function isTraceEventStatus(value: string | null): value is TraceEventStatus {
  return Boolean(value && TRACE_STATUSES.includes(value as TraceEventStatus));
}
