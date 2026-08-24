import { beforeEach, describe, expect, it } from "vitest";

import { findKnowledge } from "@/lib/adapters/knowledge-mock-adapter";
import {
  createKnowledgeArticle,
  deactivateKnowledgeArticle,
  getPublishedKnowledgeByTopic,
  previewKnowledge,
  publishKnowledgeArticle,
  resetKnowledgeStore,
  updateKnowledgeArticle,
} from "@/lib/knowledge-store";

describe("knowledge store", () => {
  beforeEach(() => resetKnowledgeStore());

  it("保存已发布知识的工作副本不会立刻影响 RAG，发布后才切换版本", () => {
    const id = "KB-AFTERSALE-WARRANTY-003";
    const before = getPublishedKnowledgeByTopic("warranty");
    expect(before?.answer).toContain("质保期限");

    const edited = updateKnowledgeArticle(id, { answer: "这是待发布的新质保回答。" });
    expect(edited?.hasUnpublishedChanges).toBe(true);
    expect(getPublishedKnowledgeByTopic("warranty")?.answer).toBe(before?.answer);

    const published = publishKnowledgeArticle(id);
    expect(published?.version).toBe("V3.1");
    expect(published?.hasUnpublishedChanges).toBe(false);
    expect(getPublishedKnowledgeByTopic("warranty")?.answer).toBe("这是待发布的新质保回答。");
  });

  it("停用知识后不再进入已发布检索", async () => {
    deactivateKnowledgeArticle("KB-INSTALL-GUIDE-007");
    expect(getPublishedKnowledgeByTopic("installation")).toBeUndefined();
    expect(await findKnowledge("installation")).toBeUndefined();
  });

  it("新建草稿可参与后台召回预览，但不会进入消费者检索", () => {
    const draft = createKnowledgeArticle({
      title: "测试遥控器知识",
      question: "遥控器配对失败怎么办",
      answer: "这是后台召回预览内容。",
      topic: "troubleshooting",
      tags: ["遥控器", "配对"],
    });
    const results = previewKnowledge("遥控器配对失败", draft.id);
    expect(results[0].articleId).toBe(draft.id);
    expect(results[0].selectedDraft).toBe(true);
    expect(getPublishedKnowledgeByTopic("troubleshooting")?.id).not.toBe(draft.id);
  });
});
