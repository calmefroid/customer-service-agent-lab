import { beforeEach, describe, expect, it } from "vitest";

import { retrieveKnowledgeByQuery } from "@/lib/adapters/knowledge-mock-adapter";
import {
  createKnowledgeArticle,
  publishKnowledgeArticle,
  resetKnowledgeStore,
  retrievePublishedKnowledge,
  updateKnowledgeArticle,
} from "@/lib/knowledge-store";

const EFFECTIVE_AT = "2026-08-24T10:00:00+08:00";

describe("deterministic knowledge retrieval", () => {
  beforeEach(() => resetKnowledgeStore());

  it("返回 hit、可解释字段分数、采用原因、ID、版本和引用", () => {
    const result = retrievePublishedKnowledge("智能灯具 WIFI 配网失败搜不到设备", {
      productCategory: "智能灯具",
      channel: "线上商城",
      region: "中国大陆",
      effectiveAt: EFFECTIVE_AT,
    });
    expect(result.retrieval.status).toBe("hit");
    expect(result.retrieval.selectedArticleIds).toEqual(["KB-SMART-SETUP-011"]);
    expect(result.retrieval.citations[0]).toMatchObject({ articleId: "KB-SMART-SETUP-011", version: "V1.8" });
    expect(result.candidates[0].fieldScores.question).toBeGreaterThan(0);
    expect(result.candidates[0].adoptionReason).toContain("综合分最高");
  });

  it("产品、渠道和地区不适用时返回 no_hit 并说明过滤原因", () => {
    const result = retrievePublishedKnowledge("智能灯具 WIFI 配网失败搜不到设备", {
      productCategory: "浴霸",
      channel: "供应商门户",
      region: "海外",
      effectiveAt: EFFECTIVE_AT,
    });
    expect(result.retrieval.status).toBe("no_hit");
    const candidate = result.candidates.find((item) => item.articleId === "KB-SMART-SETUP-011");
    expect(candidate?.filterReasons).toEqual(expect.arrayContaining([
      expect.stringContaining("产品范围不匹配"),
      expect.stringContaining("渠道范围不匹配"),
      expect.stringContaining("地区范围不匹配"),
    ]));
    expect(result.retrieval.citations).toEqual([]);
  });

  it("相关知识过期时返回 expired，不生成业务结论", () => {
    updateKnowledgeArticle("KB-AFTERSALE-WARRANTY-003", { effectiveTo: "2026-08-23T23:59:59+08:00" });
    publishKnowledgeArticle("KB-AFTERSALE-WARRANTY-003");
    const result = retrievePublishedKnowledge("产品质保多久维修收费吗", { effectiveAt: EFFECTIVE_AT });
    expect(result.retrieval.status).toBe("expired");
    expect(result.retrieval.selectedArticleIds).toEqual([]);
    expect(result.candidates.find((candidate) => candidate.articleId === "KB-AFTERSALE-WARRANTY-003")?.filterReasons[0]).toContain("已失效");
  });

  it("同主题高分知识给出矛盾事实时返回 conflict 且不自动选边", () => {
    const base = {
      title: "智能灯具质保期限",
      question: "智能灯具质保期限是几年",
      answerItems: ["以发布政策为准"],
      topic: "warranty" as const,
      productScope: "智能灯具",
      channelScope: "线上商城",
      regionScope: "中国大陆",
      effectiveFrom: "2026-08-01T00:00:00+08:00",
      source: "测试政策",
      maintainer: "测试运营",
      tags: ["智能灯具", "质保期限", "几年"],
    };
    const first = createKnowledgeArticle({ ...base, answer: "智能灯具质保期限为 1 年。" });
    const second = createKnowledgeArticle({ ...base, answer: "智能灯具质保期限为 3 年。" });
    publishKnowledgeArticle(first.id);
    publishKnowledgeArticle(second.id);

    const result = retrievePublishedKnowledge("智能灯具质保期限是几年", {
      productCategory: "智能灯具",
      channel: "线上商城",
      region: "中国大陆",
      effectiveAt: EFFECTIVE_AT,
    });
    expect(result.retrieval.status).toBe("conflict");
    expect(result.retrieval.selectedArticleIds).toEqual([]);
    expect(result.retrieval.citations).toEqual([]);
    expect(result.retrieval.conflicts[0].articleIds).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("结果可直接序列化为 TraceEvent 的 rag payload，重复检索分数稳定", async () => {
    const first = await retrieveKnowledgeByQuery("官方门店在哪里怎么验真", { effectiveAt: EFFECTIVE_AT });
    const second = await retrieveKnowledgeByQuery("官方门店在哪里怎么验真", { effectiveAt: EFFECTIVE_AT });
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(second.candidates.map((candidate) => candidate.score)).toEqual(first.candidates.map((candidate) => candidate.score));
    expect(second.requestId).toBe(first.requestId);
  });
});
