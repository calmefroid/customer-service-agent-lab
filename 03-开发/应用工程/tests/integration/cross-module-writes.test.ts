import { beforeEach, describe, expect, it } from "vitest";

import { resetKnowledgeStore } from "@/lib/knowledge-store";
import { orchestrateMock } from "@/lib/mock-orchestrator";
import { queryOperations } from "@/lib/operations";
import { businessStore } from "@/lib/stores/business/business-store";
import { clearTraces } from "@/lib/trace-store";

describe("consumer writes feed the operations console", () => {
  beforeEach(() => {
    businessStore.reset();
    clearTraces();
    resetKnowledgeStore();
  });

  it("persists writes with the originating session and keeps retries idempotent", async () => {
    const sessionId = "integration-session";

    await orchestrateMock({
      sessionId,
      message: "提交物流催办",
      action: "submit_logistics_urge",
    });
    await orchestrateMock({
      sessionId,
      message: "提交物流催办",
      action: "submit_logistics_urge",
    });
    await orchestrateMock({
      sessionId,
      message: "提交退换货申请",
      action: "submit_return",
      formData: {
        serviceType: "换货",
        product: "悦享系列 LED 吸顶灯",
        issueDescription: "灯罩边缘破裂",
        contactPhone: "13800006821",
        pickupAddress: "上海市测试区虚拟路 18 号",
      },
    });
    await orchestrateMock({
      sessionId,
      message: "提交维修服务",
      action: "submit_service_ticket",
      serviceFormData: {
        serviceType: "维修服务",
        product: "悦享系列 LED 吸顶灯",
        purchaseChannel: "线上商城",
        faultDescription: "重启后仍然闪烁",
        contactPhone: "13800006821",
        serviceAddress: "上海市测试区虚拟路 18 号",
        preferredContactTime: "周六上午",
      },
    });
    await orchestrateMock({
      sessionId,
      message: "灯有烧焦味，还在冒烟",
      module: "repair",
    });

    expect(businessStore.listLogisticsUrges()).toHaveLength(1);

    const records = queryOperations(businessStore).items.filter((item) => item.sessionId === sessionId);
    expect(new Set(records.map((item) => item.type))).toEqual(new Set([
      "logistics_urge",
      "return_exchange",
      "service_ticket",
      "human_handoff",
      "risk_session",
    ]));
    expect(records.every((item) => item.traceHref === "/trace?sessionId=integration-session")).toBe(true);
  });
});
