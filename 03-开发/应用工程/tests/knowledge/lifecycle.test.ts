import { beforeEach, describe, expect, it } from "vitest";

import { findKnowledge } from "@/lib/adapters/knowledge-mock-adapter";
import {
  createKnowledgeArticle,
  deactivateKnowledgeArticle,
  getPublishedKnowledgeByTopic,
  previewKnowledge,
  publishKnowledgeArticle,
  resetKnowledgeStore,
  retrievePublishedKnowledge,
  updateKnowledgeArticle,
} from "@/lib/knowledge-store";

describe("knowledge lifecycle", () => {
  beforeEach(() => resetKnowledgeStore());

  it("编辑已发布知识不会立刻影响线上检索，发布后才切换版本", () => {
    const id = "KB-AFTERSALE-WARRANTY-003";
    const before = retrievePublishedKnowledge("产品质保多久维修收费吗", { effectiveAt: "2026-08-24T10:00:00+08:00" });
    expect(before.retrieval.status).toBe("hit");
    expect(before.candidates.find((candidate) => candidate.adopted)?.excerpt).toContain("质保期限");

    const edited = updateKnowledgeArticle(id, { answer: "这是待发布的新质保回答。" });
    expect(edited?.hasUnpublishedChanges).toBe(true);
    expect(retrievePublishedKnowledge("产品质保多久维修收费吗", { effectiveAt: "2026-08-24T10:00:00+08:00" }).candidates.find((candidate) => candidate.adopted)?.excerpt)
      .toContain("质保期限");

    const published = publishKnowledgeArticle(id);
    expect(published?.version).toBe("V3.1");
    expect(published?.hasUnpublishedChanges).toBe(false);
    expect(retrievePublishedKnowledge("产品质保多久维修收费吗", { effectiveAt: "2026-08-24T10:00:00+08:00" }).candidates.find((candidate) => candidate.adopted)?.excerpt)
      .toBe("这是待发布的新质保回答。");
  });

  it("停用知识后返回 no_hit 且兼容查询不再读取它", async () => {
    deactivateKnowledgeArticle("KB-INSTALL-GUIDE-007");
    const result = retrievePublishedKnowledge("灯具安装视频和接线方法", { effectiveAt: "2026-08-24T10:00:00+08:00" });
    expect(result.retrieval.status).toBe("no_hit");
    expect(result.retrieval.selectedArticleIds).toEqual([]);
    expect(result.candidates.find((candidate) => candidate.articleId === "KB-INSTALL-GUIDE-007")?.filterReasons[0]).toContain("inactive");
    expect(getPublishedKnowledgeByTopic("installation", "2026-08-24T10:00:00+08:00")).toBeUndefined();
    expect(await findKnowledge("installation")).toBeUndefined();
  });

  it("草稿只参与当前后台预览，reset 后恢复确定性初始状态", () => {
    const draft = createKnowledgeArticle({
      title: "遥控器配对失败知识",
      question: "遥控器配对失败怎么办",
      answer: "这是后台召回预览内容。",
      answerItems: ["重新配对"],
      topic: "troubleshooting",
      tags: ["遥控器", "配对"],
      effectiveFrom: "2026-08-01T00:00:00+08:00",
    });
    const preview = previewKnowledge("遥控器配对失败", draft.id, { effectiveAt: "2026-08-24T10:00:00+08:00" });
    expect(preview.candidates[0].articleId).toBe(draft.id);
    expect(preview.candidates[0].selectedDraft).toBe(true);
    expect(retrievePublishedKnowledge("遥控器配对失败", { effectiveAt: "2026-08-24T10:00:00+08:00" }).retrieval.selectedArticleIds)
      .not.toContain(draft.id);

    resetKnowledgeStore();
    expect(createKnowledgeArticle().id).toBe("KB-DRAFT-001");
  });
});
