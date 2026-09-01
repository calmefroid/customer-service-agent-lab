import { beforeEach, describe, expect, it } from "vitest";

import {
  knowledgeSandbox,
  retrieveKnowledgeByQuery,
} from "@/lib/adapters/knowledge-mock-adapter";
import {
  createKnowledgeArticle,
  deactivateKnowledgeArticle,
  getKnowledgeArticle,
  listKnowledgeArticles,
  publishKnowledgeArticle,
  resetKnowledgeStore,
  retrievePublishedKnowledge,
  updateKnowledgeArticle,
} from "@/lib/knowledge-store";

const EFFECTIVE_AT = "2026-08-24T10:00:00+08:00";
const WARRANTY_ID = "KB-AFTERSALE-WARRANTY-003";
const WARRANTY_QUERY = "产品质保多久维修收费吗";

function retrieveWarranty() {
  return retrievePublishedKnowledge(WARRANTY_QUERY, { effectiveAt: EFFECTIVE_AT });
}

describe("knowledge Sandbox reset", () => {
  beforeEach(() => resetKnowledgeStore());

  it("统一入口恢复工作副本、发布快照、版本、状态、草稿序号和消费者索引", () => {
    const initial = retrieveWarranty();
    const initialArticle = getKnowledgeArticle(WARRANTY_ID);
    expect(initial.retrieval.status).toBe("hit");
    expect(initial.retrieval.citations).toEqual([
      expect.objectContaining({ articleId: WARRANTY_ID, version: "V3.0" }),
    ]);

    updateKnowledgeArticle(WARRANTY_ID, { answer: "阶段 4 已发布的临时质保口径。" });
    expect(publishKnowledgeArticle(WARRANTY_ID)?.version).toBe("V3.1");
    updateKnowledgeArticle(WARRANTY_ID, { answer: "尚未发布的工作副本口径。" });
    expect(retrieveWarranty().candidates.find((candidate) => candidate.adopted)?.excerpt)
      .toBe("阶段 4 已发布的临时质保口径。");

    deactivateKnowledgeArticle(WARRANTY_ID);
    expect(retrieveWarranty().retrieval.status).toBe("no_hit");
    expect(retrieveWarranty().candidates.find((candidate) => candidate.articleId === WARRANTY_ID)?.filterReasons)
      .toContain("状态为inactive，仅 published 可用于线上检索");

    const draft = createKnowledgeArticle({
      title: "统一重置临时草稿",
      question: "统一重置后是否保留",
      answer: "不应保留",
      answerItems: ["不应保留"],
      topic: "warranty",
      effectiveFrom: "2026-08-01T00:00:00+08:00",
    });
    expect(draft.id).toBe("KB-DRAFT-001");
    expect(listKnowledgeArticles()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: WARRANTY_ID, status: "inactive", version: "V3.1", hasUnpublishedChanges: true }),
      expect.objectContaining({ id: draft.id, status: "draft", version: "V0.1" }),
    ]));

    resetKnowledgeStore();

    const restoredArticle = getKnowledgeArticle(WARRANTY_ID);
    expect(restoredArticle).toEqual(initialArticle);
    expect(listKnowledgeArticles()).toHaveLength(8);
    expect(listKnowledgeArticles().some((article) => article.id === draft.id)).toBe(false);

    const restored = retrieveWarranty();
    expect({ ...restored.retrieval, durationMs: 0 }).toEqual({ ...initial.retrieval, durationMs: 0 });
    expect(restored.candidates.find((candidate) => candidate.adopted)?.excerpt)
      .toContain("质保期限和服务范围需结合具体型号");
    expect(restored.retrieval.citations).toEqual([
      expect.objectContaining({ articleId: WARRANTY_ID, version: "V3.0" }),
    ]);
    expect(createKnowledgeArticle().id).toBe("KB-DRAFT-001");
  });

  it.each(["knowledge_conflict", "knowledge_expired"] as const)(
    "reset 清理 %s 夹具激活态并恢复默认消费者检索",
    async (scenario) => {
      const initial = retrieveWarranty().retrieval;
      knowledgeSandbox.activate(scenario);

      const fixtureResult = await retrieveKnowledgeByQuery(
        scenario === "knowledge_conflict"
          ? "两条质保规则冲突时按哪条？"
          : "请按已过期的换新政策处理",
      );
      expect(fixtureResult.status).toBe(scenario === "knowledge_conflict" ? "conflict" : "expired");
      expect(knowledgeSandbox.getActive()).toBe(scenario);

      resetKnowledgeStore();

      expect(knowledgeSandbox.getActive()).toBeUndefined();
      const restored = retrieveWarranty().retrieval;
      expect({ ...restored, durationMs: 0 }).toEqual({ ...initial, durationMs: 0 });
      expect(restored.status).toBe("hit");
      expect(restored.citations).toEqual([
        expect.objectContaining({ articleId: WARRANTY_ID, version: "V3.0" }),
      ]);
    },
  );
});
