import { retrieveFromKnowledgeIndex } from "@/lib/rag/deterministic-retriever";
import type {
  KnowledgeIndexArticle,
  KnowledgePreviewResponse,
  KnowledgeSearchFilters,
} from "@/lib/rag/types";

export const KNOWLEDGE_SANDBOX_SCENARIOS = ["knowledge_conflict", "knowledge_expired"] as const;
export type KnowledgeSandboxScenario = (typeof KNOWLEDGE_SANDBOX_SCENARIOS)[number];

/** Fixed clock used by the two Evals fixtures so results never depend on wall time. */
export const KNOWLEDGE_SANDBOX_EFFECTIVE_AT = "2026-08-24T10:00:00+08:00";

const COMMON_FIELDS = {
  status: "published" as const,
  topic: "warranty" as const,
  productScope: "全部灯具商品",
  channelScope: "全部消费者渠道",
  regionScope: "中国大陆",
  effectiveFrom: "2026-01-01T00:00:00+08:00",
  source: "Sandbox 固定评测夹具",
  maintainer: "Evals Sandbox",
};

const CONFLICT_FIXTURES: KnowledgeIndexArticle[] = [
  {
    ...COMMON_FIELDS,
    id: "KB-SANDBOX-CONFLICT-WARRANTY-01",
    version: "V1.0",
    updatedAt: "2026-08-20T10:00:00+08:00",
    publishedAt: "2026-08-20T10:00:00+08:00",
    title: "Sandbox 质保期限规则 A",
    question: "两条质保规则冲突时按哪条？",
    answer: "Sandbox 规则 A：灯具质保期限为 1 年。",
    answerItems: ["质保期限为 1 年", "冲突时不得自动采用"],
    tags: ["质保", "规则冲突", "期限", "按哪条"],
  },
  {
    ...COMMON_FIELDS,
    id: "KB-SANDBOX-CONFLICT-WARRANTY-02",
    version: "V1.0",
    updatedAt: "2026-08-20T10:00:00+08:00",
    publishedAt: "2026-08-20T10:00:00+08:00",
    title: "Sandbox 质保期限规则 B",
    question: "两条质保规则冲突时按哪条？",
    answer: "Sandbox 规则 B：灯具质保期限为 3 年。",
    answerItems: ["质保期限为 3 年", "冲突时不得自动采用"],
    tags: ["质保", "规则冲突", "期限", "按哪条"],
  },
];

const EXPIRED_FIXTURES: KnowledgeIndexArticle[] = [
  {
    ...COMMON_FIELDS,
    id: "KB-SANDBOX-EXPIRED-REPLACEMENT-01",
    version: "V1.0",
    updatedAt: "2026-07-01T10:00:00+08:00",
    publishedAt: "2026-07-01T10:00:00+08:00",
    effectiveTo: "2026-07-31T23:59:59+08:00",
    title: "Sandbox 已过期换新政策",
    question: "请按已过期的换新政策处理",
    answer: "此换新政策仅用于验证过期知识过滤，不得作为业务结论。",
    answerItems: ["政策已过期", "不得引用", "需要人工确认当前政策"],
    tags: ["过期", "换新政策", "人工"],
  },
];

function fixturesFor(scenario: KnowledgeSandboxScenario): KnowledgeIndexArticle[] {
  return scenario === "knowledge_conflict" ? CONFLICT_FIXTURES : EXPIRED_FIXTURES;
}

/**
 * Runs an isolated, deterministic knowledge bad case. Normal store articles are
 * intentionally excluded and the effective clock is fixed for reproducibility.
 */
export function retrieveKnowledgeSandboxScenario(
  scenario: KnowledgeSandboxScenario,
  query: string,
  filters: KnowledgeSearchFilters = {},
): KnowledgePreviewResponse {
  const response = retrieveFromKnowledgeIndex({
    articles: fixturesFor(scenario),
    query,
    filters: { ...filters, effectiveAt: KNOWLEDGE_SANDBOX_EFFECTIVE_AT },
    mode: "published",
  });
  return {
    ...response,
    retrieval: { ...response.retrieval, durationMs: 0 },
  };
}
