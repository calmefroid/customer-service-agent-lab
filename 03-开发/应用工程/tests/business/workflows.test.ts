import { beforeEach, describe, expect, it } from "vitest";
import type {
  ConfirmedWrite,
  ReturnExchangeDraft,
  ServiceTicketDraft,
  WorkflowContext,
} from "@/lib/domain/business";
import { BusinessWorkflowService } from "@/lib/domain/business-workflow";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import { businessStore } from "@/lib/stores/business/business-store";

const verifiedContext: WorkflowContext = {
  sessionId: "business-test-session",
  traceId: "business-test-trace",
  identity: { customerId: DEMO_CUSTOMER_ID, verified: true },
};

const service = new BusinessWorkflowService();

function confirmed<T extends Record<string, unknown>>(
  request: ConfirmedWrite<T>["request"],
  finalSnapshot: T,
): ConfirmedWrite<T> {
  return {
    request,
    confirmationToken: request.confirmationToken,
    idempotencyKey: request.idempotencyKey,
    finalSnapshot,
  };
}

describe("business after-sales workflows", () => {
  beforeEach(() => businessStore.reset());

  it("订单物流查询前必须确认演示身份", async () => {
    const result = await service.queryOrderLogistics(
      { ...verifiedContext, identity: { ...verifiedContext.identity, verified: false } },
      "OD202608180236",
    );
    expect(result.status).toBe("business_error");
    if (result.status === "success") return;
    expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("订单物流聚合 OMS、WMS 和 TMS 来源", async () => {
    const result = await service.queryOrderLogistics(verifiedContext, "OD202608180236");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.shipment?.hotline).toBe("95338");
    expect(result.meta.sources.map((source) => source.sourceSystem)).toEqual(["OMS", "WMS", "TMS"]);
  });

  it("可变更订单经确认后保存最终地址", async () => {
    const draft = { orderId: "OD202608050088", deliveryAddress: "草稿演示地址" };
    const prepared = await service.prepareOrderChange(verifiedContext, draft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const submitted = await service.submitOrderChange(
      verifiedContext,
      confirmed(prepared.data, { ...draft, deliveryAddress: "用户确认的演示地址" }),
    );
    expect(submitted.status).toBe("success");
    if (submitted.status === "success") {
      expect(submitted.data.deliveryAddress).toBe("用户确认的演示地址");
    }
  });

  it("相同幂等键重复确认只创建一条退换申请，并保存最终编辑内容", async () => {
    const draft: ReturnExchangeDraft = {
      orderId: "OD202608100119",
      serviceType: "exchange",
      product: "智控系列吸顶灯 ZC80",
      reason: "收货破损",
      itemCondition: "灯罩可见破裂，未通电",
      evidence: ["damage-demo.jpg"],
      contactPhone: "138****8001",
      pickupAddress: "原演示地址",
    };
    const prepared = await service.prepareReturnExchange(verifiedContext, draft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;

    const finalSnapshot = { ...draft, pickupAddress: "用户最终修改的演示地址" };
    const write = confirmed(prepared.data, finalSnapshot);
    const first = await service.submitReturnExchange(verifiedContext, write);
    const second = await service.submitReturnExchange(verifiedContext, write);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    if (first.status === "success" && second.status === "success") {
      expect(second.data.requestNo).toBe(first.data.requestNo);
      expect(first.data.pickupAddress).toBe("用户最终修改的演示地址");
    }
    expect(businessStore.listReturnExchanges()).toHaveLength(1);
  });

  it("工单写入失败不返回伪造工单号，重放返回原失败结果", async () => {
    const draft: ServiceTicketDraft = {
      serviceType: "repair",
      product: "悦享系列 LED 吸顶灯",
      purchaseChannel: "online",
      issueDescription: "重启后仍然闪烁",
      contactPhone: "138****8001",
      serviceAddress: "上海市演示地址",
      preferredContactTime: "周六上午",
      riskLevel: "low",
    };
    const prepared = await service.prepareServiceTicket(verifiedContext, draft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    const write = confirmed(prepared.data, { ...draft, issueDescription: "用户最终确认：重启后仍然闪烁" });
    const failed = await service.submitServiceTicket(verifiedContext, write, { outcome: "timeout" });
    expect(failed.status).toBe("timeout");
    if (failed.status !== "success") expect(failed.data).toBeNull();
    expect(businessStore.listServiceTickets()).toHaveLength(1);

    const replayed = await service.submitServiceTicket(verifiedContext, write);
    expect(replayed).toEqual(failed);
    expect(businessStore.listServiceTickets()).toHaveLength(1);
  });

  it("高风险普通工单被拒绝，人工接管保留摘要对象", async () => {
    const draft: ServiceTicketDraft = {
      serviceType: "repair",
      product: "悦享系列 LED 吸顶灯",
      purchaseChannel: "store",
      issueDescription: "有烧焦味并冒烟",
      contactPhone: "138****8001",
      serviceAddress: "上海市演示地址",
      preferredContactTime: "立即",
      riskLevel: "high",
    };
    const rejected = await service.prepareServiceTicket(verifiedContext, draft);
    expect(rejected.status).toBe("business_error");

    const handoff = await service.escalateToHuman(verifiedContext, {
      reason: "safety",
      riskLevel: "high",
      summary: "用户报告灯具有烧焦味并冒烟，已提示断电和停止使用。",
      completedActions: ["安全提示"],
      pendingQuestions: ["确认现场是否已安全"],
      relatedRecordIds: [],
    });
    expect(handoff.status).toBe("success");
    if (handoff.status === "success") expect(handoff.data.reason).toBe("safety");
  });

  it("Store reset 恢复初始数据并清空运行时写记录", async () => {
    await service.escalateToHuman(verifiedContext, {
      reason: "requested",
      riskLevel: "low",
      summary: "用户明确要求人工",
      completedActions: [],
      pendingQuestions: [],
      relatedRecordIds: [],
    });
    expect(businessStore.listHumanHandoffs()).toHaveLength(1);
    businessStore.reset();
    expect(businessStore.listHumanHandoffs()).toHaveLength(0);
    expect(businessStore.listOrders()).toHaveLength(3);
    expect(businessStore.listServiceTickets()).toHaveLength(1);
  });
});
