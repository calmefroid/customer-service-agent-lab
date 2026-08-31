import { beforeEach, describe, expect, it } from "vitest";

import {
  findKnowledge,
  knowledgeSandbox,
  retrieveKnowledgeByQuery,
  retrieveKnowledgeSandboxScenario,
} from "@/lib/adapters/knowledge-mock-adapter";
import {
  resetKnowledgeStore,
  retrievePublishedKnowledge,
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

  it("显式 expired Sandbox 场景保留候选与时间过滤原因且不生成引用", async () => {
    knowledgeSandbox.activate("knowledge_expired");
    const result = await retrieveKnowledgeByQuery("请按已过期的换新政策处理");
    expect(result.status).toBe("expired");
    expect(result.selectedArticleIds).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      articleId: "KB-SANDBOX-EXPIRED-REPLACEMENT-01",
      adopted: false,
      filterReasons: [expect.stringContaining("已失效")],
    });
    expect(await findKnowledge("warranty")).toBeUndefined();
  });

  it("显式 conflict Sandbox 场景返回冲突条目与原因且不自动选边", async () => {
    knowledgeSandbox.activate("knowledge_conflict");
    const result = await retrieveKnowledgeByQuery("两条质保规则冲突时按哪条？");
    expect(result.status).toBe("conflict");
    expect(result.selectedArticleIds).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.candidates.every((candidate) => candidate.adopted === false)).toBe(true);
    expect(result.conflicts).toEqual([{
      articleIds: ["KB-SANDBOX-CONFLICT-WARRANTY-01", "KB-SANDBOX-CONFLICT-WARRANTY-02"],
      reason: expect.stringContaining("不一致事实"),
    }]);
    expect(await findKnowledge("warranty")).toBeUndefined();
  });

  it("Sandbox 场景结果可重复，且清理后恢复完全相同的默认检索", () => {
    const query = "两条质保规则冲突时按哪条？";
    const defaultBefore = retrievePublishedKnowledge(query, { effectiveAt: EFFECTIVE_AT }).retrieval;
    expect(defaultBefore.status).not.toBe("conflict");

    const first = retrieveKnowledgeSandboxScenario("knowledge_conflict", query).retrieval;
    const second = retrieveKnowledgeSandboxScenario("knowledge_conflict", query).retrieval;
    expect(second).toEqual(first);

    knowledgeSandbox.activate("knowledge_conflict");
    expect(retrievePublishedKnowledge(query).retrieval.status).toBe("conflict");
    expect(knowledgeSandbox.getActive()).toBe("knowledge_conflict");
    resetKnowledgeStore();
    expect(knowledgeSandbox.getActive()).toBeUndefined();
    const defaultAfter = retrievePublishedKnowledge(query, { effectiveAt: EFFECTIVE_AT }).retrieval;
    expect({ ...defaultAfter, durationMs: 0 }).toEqual({ ...defaultBefore, durationMs: 0 });
  });

  it("结果可直接序列化为 TraceEvent 的 rag payload，重复检索分数稳定", async () => {
    const first = await retrieveKnowledgeByQuery("官方门店在哪里怎么验真", { effectiveAt: EFFECTIVE_AT });
    const second = await retrieveKnowledgeByQuery("官方门店在哪里怎么验真", { effectiveAt: EFFECTIVE_AT });
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(second.candidates.map((candidate) => candidate.score)).toEqual(first.candidates.map((candidate) => candidate.score));
    expect(second.requestId).toBe(first.requestId);
  });
});
