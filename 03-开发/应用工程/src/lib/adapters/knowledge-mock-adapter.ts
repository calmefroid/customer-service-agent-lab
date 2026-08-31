import type {
  KnowledgeArticle,
  KnowledgeRetrievalResult,
  KnowledgeTopic,
  TraceSource,
} from "@/lib/contracts";
import {
  activateKnowledgeSandboxScenario,
  clearKnowledgeSandboxScenario,
  getActiveKnowledgeSandboxScenario,
  getPublishedKnowledgeByTopic,
  retrievePublishedKnowledge,
} from "@/lib/knowledge-store";
import type { KnowledgeSearchFilters } from "@/lib/rag/types";
export {
  KNOWLEDGE_SANDBOX_EFFECTIVE_AT,
  KNOWLEDGE_SANDBOX_SCENARIOS,
  retrieveKnowledgeSandboxScenario,
  type KnowledgeSandboxScenario,
} from "@/lib/rag/sandbox-scenarios";

export interface KnowledgeRetrieval {
  article: KnowledgeArticle;
  source: TraceSource;
}

export async function findKnowledge(topic: KnowledgeTopic): Promise<KnowledgeRetrieval | undefined> {
  const article = getPublishedKnowledgeByTopic(topic);
  if (!article) return undefined;
  return {
    article,
    source: {
      type: "knowledge",
      sourceSystem: "CustomerKnowledgeBase",
      recordId: article.id,
      version: article.version,
      updatedAt: article.publishedAt ?? article.updatedAt,
      excerpt: article.answer,
    },
  };
}

export async function retrieveKnowledge(topic: KnowledgeTopic): Promise<KnowledgeRetrieval> {
  const hit = await findKnowledge(topic);
  if (!hit) throw new Error(`NO_PUBLISHED_KNOWLEDGE:${topic}`);
  return hit;
}

/** Full query retrieval for runtime/Trace integration. Never returns a generated fallback. */
export async function retrieveKnowledgeByQuery(
  query: string,
  filters?: KnowledgeSearchFilters,
): Promise<KnowledgeRetrievalResult> {
  return retrievePublishedKnowledge(query, filters).retrieval;
}

/** Scenario control surface for the sequential fixed-Evals runner. */
export const knowledgeSandbox = {
  activate: activateKnowledgeSandboxScenario,
  clear: clearKnowledgeSandboxScenario,
  getActive: getActiveKnowledgeSandboxScenario,
} as const;

export async function searchKnowledge(topic: KnowledgeTopic): Promise<TraceSource> {
  return (await findKnowledge(topic))?.source ?? {
    type: "knowledge",
    sourceSystem: "CustomerKnowledgeBase",
    recordId: `NO_PUBLISHED_MATCH:${topic}`,
    version: "none",
    excerpt: "当前主题没有可用的已发布知识，未采用草稿或已停用内容。",
  };
}
