import type {
  KnowledgeArticle,
  KnowledgeArticleFields,
  KnowledgePreviewResult,
  KnowledgeRetrievalFilter,
  KnowledgeRetrievalResult,
  KnowledgeStatus,
} from "@/lib/contracts";

/** Knowledge-only fields kept outside the frozen cross-module contract. */
export interface KnowledgeScheduleFields {
  effectiveFrom: string;
  effectiveTo?: string;
}

export type KnowledgeManagedFields = KnowledgeArticleFields & KnowledgeScheduleFields;

export type KnowledgeManagedArticle = KnowledgeArticle & KnowledgeScheduleFields;

export interface KnowledgeFieldScores {
  title: number;
  question: number;
  answer: number;
  tags: number;
  scope: number;
}

export interface KnowledgeIndexArticle extends KnowledgeManagedFields {
  id: string;
  version: string;
  status: KnowledgeStatus;
  updatedAt: string;
  publishedAt?: string;
}

export interface KnowledgeRankedCandidate extends KnowledgePreviewResult {
  fieldScores: KnowledgeFieldScores;
  filterReasons: string[];
  adoptionReason?: string;
  adopted: boolean;
}

export interface KnowledgePreviewResponse {
  retrieval: KnowledgeRetrievalResult;
  candidates: KnowledgeRankedCandidate[];
}

export interface KnowledgeSearchFilters extends Partial<Omit<KnowledgeRetrievalFilter, "status">> {
  effectiveAt?: string;
}

export type KnowledgeRetrievalMode = "published" | "preview";
