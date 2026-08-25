import type {
  KnowledgeCitation,
  KnowledgeConflict,
  KnowledgeRetrievalCandidate,
  KnowledgeRetrievalFilter,
  KnowledgeRetrievalResult,
} from "@/lib/contracts";

import type {
  KnowledgeFieldScores,
  KnowledgeIndexArticle,
  KnowledgePreviewResponse,
  KnowledgeRankedCandidate,
  KnowledgeRetrievalMode,
  KnowledgeSearchFilters,
} from "./types";

const MIN_SCORE = 0.22;
const CONFLICT_SCORE = 0.46;
const CONFLICT_GAP = 0.08;

const FIELD_WEIGHTS: Record<keyof KnowledgeFieldScores, number> = {
  title: 0.28,
  question: 0.3,
  answer: 0.14,
  tags: 0.2,
  scope: 0.08,
};

const contradictionPairs = [
  ["可以", "不可以"],
  ["支持", "不支持"],
  ["允许", "禁止"],
  ["免费", "收费"],
  ["需要", "无需"],
  ["能退", "不能退"],
] as const;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/wi[\s-]?fi/g, "wifi")
    .replace(/[^\p{Script=Han}a-z0-9.]+/gu, " ")
    .trim();
}

function tokensOf(value: string): string[] {
  const normalized = normalize(value);
  if (!normalized) return [];
  const tokens = new Set<string>();
  for (const part of normalized.split(/\s+/)) {
    if (!part) continue;
    tokens.add(part);
    if (/^[a-z0-9.]+$/.test(part)) continue;
    for (let index = 0; index < part.length - 1; index += 1) {
      tokens.add(part.slice(index, index + 2));
    }
  }
  return [...tokens];
}

function overlapScore(queryTokens: string[], query: string, value: string): number {
  if (!queryTokens.length || !value.trim()) return 0;
  const normalizedValue = normalize(value);
  const matched = queryTokens.filter((token) => normalizedValue.includes(token));
  const coverage = matched.length / queryTokens.length;
  const exactBonus = normalizedValue.includes(normalize(query)) ? 0.18 : 0;
  return Math.min(1, coverage + exactBonus);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function scoreKnowledgeArticle(query: string, article: KnowledgeIndexArticle): {
  score: number;
  fieldScores: KnowledgeFieldScores;
} {
  const queryTokens = tokensOf(query);
  const fieldScores: KnowledgeFieldScores = {
    title: round(overlapScore(queryTokens, query, article.title)),
    question: round(overlapScore(queryTokens, query, article.question)),
    answer: round(overlapScore(queryTokens, query, [article.answer, ...article.answerItems].join(" "))),
    tags: round(overlapScore(queryTokens, query, article.tags.join(" "))),
    scope: round(overlapScore(queryTokens, query, [article.productScope, article.channelScope, article.regionScope].join(" "))),
  };
  const score = (Object.keys(FIELD_WEIGHTS) as Array<keyof KnowledgeFieldScores>)
    .reduce((total, field) => total + fieldScores[field] * FIELD_WEIGHTS[field], 0);
  return { score: round(score), fieldScores };
}

function scopeMatches(scope: string, requested?: string): boolean {
  if (!requested?.trim()) return true;
  if (/^全部消费者渠道/.test(scope.trim())) return !/(供应商|加盟|市场合作|企业采购)/.test(requested);
  if (/^(全部|所有|通用|不限)/.test(scope.trim())) return true;
  const normalizedScope = normalize(scope);
  const normalizedRequested = normalize(requested);
  return normalizedScope.includes(normalizedRequested) || normalizedRequested.includes(normalizedScope);
}

function temporalReasons(article: KnowledgeIndexArticle, effectiveAt: string): string[] {
  const at = new Date(effectiveAt).getTime();
  const from = new Date(article.effectiveFrom).getTime();
  const to = article.effectiveTo ? new Date(article.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isFinite(from) && at < from) return [`尚未生效（${article.effectiveFrom}）`];
  if (Number.isFinite(to) && at > to) return [`已失效（${article.effectiveTo}）`];
  return [];
}

function filterReasons(
  article: KnowledgeIndexArticle,
  filters: KnowledgeRetrievalFilter,
  mode: KnowledgeRetrievalMode,
  selectedArticleId?: string,
): string[] {
  const reasons: string[] = [];
  const selectedPreview = mode === "preview" && article.id === selectedArticleId;
  if (mode === "published" && article.status !== "published") reasons.push(`状态为${article.status}，仅 published 可用于线上检索`);
  if (mode === "preview" && article.status !== "published" && !selectedPreview) reasons.push(`状态为${article.status}，仅当前选中工作副本可参与预览`);
  if (!scopeMatches(article.productScope, filters.productCategory ?? filters.productId)) reasons.push(`产品范围不匹配：${article.productScope}`);
  if (!scopeMatches(article.channelScope, filters.channel)) reasons.push(`渠道范围不匹配：${article.channelScope}`);
  if (!scopeMatches(article.regionScope, filters.region)) reasons.push(`地区范围不匹配：${article.regionScope}`);
  reasons.push(...temporalReasons(article, filters.effectiveAt));
  return reasons;
}

function excerptOf(article: KnowledgeIndexArticle): string {
  return article.answer.slice(0, 120);
}

function hasContradictoryFacts(left: KnowledgeIndexArticle, right: KnowledgeIndexArticle): boolean {
  const leftAnswer = normalize(`${left.answer} ${left.answerItems.join(" ")}`);
  const rightAnswer = normalize(`${right.answer} ${right.answerItems.join(" ")}`);
  if (leftAnswer === rightAnswer) return false;
  const leftNumbers = new Set(leftAnswer.match(/\d+(?:\.\d+)?/g) ?? []);
  const rightNumbers = new Set(rightAnswer.match(/\d+(?:\.\d+)?/g) ?? []);
  if (leftNumbers.size && rightNumbers.size && ![...leftNumbers].some((value) => rightNumbers.has(value))) return true;
  return contradictionPairs.some(([positive, negative]) =>
    (leftAnswer.includes(positive) && rightAnswer.includes(negative))
      || (leftAnswer.includes(negative) && rightAnswer.includes(positive)));
}

function findConflicts(
  ranked: Array<{ article: KnowledgeIndexArticle; score: number; reasons: string[] }>,
): KnowledgeConflict[] {
  const eligible = ranked.filter(({ score, reasons }) => score >= CONFLICT_SCORE && reasons.length === 0);
  const conflicts: KnowledgeConflict[] = [];
  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      const left = eligible[leftIndex];
      const right = eligible[rightIndex];
      if (left.article.topic !== right.article.topic || Math.abs(left.score - right.score) > CONFLICT_GAP) continue;
      if (!hasContradictoryFacts(left.article, right.article)) continue;
      conflicts.push({
        articleIds: [left.article.id, right.article.id],
        reason: `同主题高分知识给出不一致事实（分数 ${left.score.toFixed(2)} / ${right.score.toFixed(2)}），需人工确认`,
      });
    }
  }
  return conflicts;
}

function requestIdFor(query: string, filters: KnowledgeRetrievalFilter): string {
  const value = `${query}|${JSON.stringify(filters)}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `rag_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function retrieveFromKnowledgeIndex(options: {
  articles: KnowledgeIndexArticle[];
  query: string;
  filters?: KnowledgeSearchFilters;
  mode?: KnowledgeRetrievalMode;
  selectedArticleId?: string;
}): KnowledgePreviewResponse {
  const startedAt = Date.now();
  const mode = options.mode ?? "published";
  const effectiveAt = options.filters?.effectiveAt ?? new Date().toISOString();
  const filters: KnowledgeRetrievalFilter = {
    status: "published",
    ...(options.filters?.productId ? { productId: options.filters.productId } : {}),
    ...(options.filters?.productCategory ? { productCategory: options.filters.productCategory } : {}),
    ...(options.filters?.channel ? { channel: options.filters.channel } : {}),
    ...(options.filters?.region ? { region: options.filters.region } : {}),
    effectiveAt,
  };

  const ranked = options.articles
    .map((article) => {
      const scoring = scoreKnowledgeArticle(options.query, article);
      return {
        article,
        ...scoring,
        reasons: filterReasons(article, filters, mode, options.selectedArticleId),
      };
    })
    .filter(({ score, article }) => score >= MIN_SCORE || article.id === options.selectedArticleId)
    .sort((left, right) => right.score - left.score
      || new Date(right.article.publishedAt ?? right.article.updatedAt).getTime() - new Date(left.article.publishedAt ?? left.article.updatedAt).getTime()
      || left.article.id.localeCompare(right.article.id));

  const conflicts = findConflicts(ranked);
  const eligible = ranked.filter(({ score, reasons }) => score >= MIN_SCORE && reasons.length === 0);
  const temporalOnly = ranked.length > 0 && eligible.length === 0 && ranked.some(({ reasons }) =>
    reasons.length > 0 && reasons.every((reason) => reason.startsWith("尚未生效") || reason.startsWith("已失效")));
  const status = conflicts.length > 0 ? "conflict" : eligible.length > 0 ? "hit" : temporalOnly ? "expired" : "no_hit";
  const selected = status === "hit" ? eligible[0] : undefined;
  const citation: KnowledgeCitation | undefined = selected ? {
    articleId: selected.article.id,
    version: selected.article.version,
    excerpt: excerptOf(selected.article),
  } : undefined;

  const candidates: KnowledgeRankedCandidate[] = ranked.slice(0, 8).map(({ article, score, fieldScores, reasons }) => {
    const adopted = selected?.article.id === article.id;
    return {
      articleId: article.id,
      title: article.title,
      topic: article.topic,
      status: article.status,
      version: article.version,
      score,
      excerpt: excerptOf(article),
      selectedDraft: mode === "preview" && article.id === options.selectedArticleId,
      fieldScores,
      filterReasons: reasons,
      adopted,
      ...(adopted ? { adoptionReason: "通过发布状态、适用范围与有效期过滤，且确定性综合分最高" } : {}),
    };
  });

  const contractCandidates: KnowledgeRetrievalCandidate[] = candidates.map((candidate) => ({
    articleId: candidate.articleId,
    version: candidate.version,
    title: candidate.title,
    score: candidate.score,
    excerpt: candidate.excerpt,
    adopted: candidate.adopted,
    ...(candidate.adoptionReason ? { adoptionReason: candidate.adoptionReason } : {}),
    filterReasons: candidate.filterReasons,
    ...(candidate.adopted && citation ? { citation } : {}),
  }));

  const retrieval: KnowledgeRetrievalResult = {
    status,
    query: options.query,
    filters,
    candidates: contractCandidates,
    selectedArticleIds: selected ? [selected.article.id] : [],
    conflicts,
    citations: citation ? [citation] : [],
    requestId: requestIdFor(options.query, filters),
    durationMs: Date.now() - startedAt,
  };
  return { retrieval, candidates };
}
