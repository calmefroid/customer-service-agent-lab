import { describe, expect, it } from "vitest";

import { getOperationDetail, queryOperations } from "../../src/lib/operations/query";
import type { BusinessStoreQuery } from "../../src/lib/operations/query";

const base = {
  createdAt: "2026-08-24T08:00:00+08:00",
  updatedAt: "2026-08-24T09:00:00+08:00",
};

function createStore(overrides: Partial<BusinessStoreQuery> = {}): BusinessStoreQuery {
  return {
    listOrders: () => [{ ...base, recordId: "OD-1", sourceSystem: "OMS", orderId: "OD-1", status: "paid", contactPhone: "13812348001", deliveryAddress: "上海市浦东新区演示路 18 号" }],
    listFulfillments: () => [],
    listShipments: () => [],
    listOrderChanges: () => [{ ...base, recordId: "CHANGE-1", sourceSystem: "OMS", changeRequestNo: "CHANGE-1", orderId: "OD-1", deliveryAddress: "上海市浦东新区新地址 88 号", contactPhone: "13912348002", status: "submitted", sessionId: "session-change" }],
    listOrderCancellations: () => [{ ...base, recordId: "CANCEL-1", sourceSystem: "OMS", cancelRequestNo: "CANCEL-1", orderId: "OD-2", reason: "不再需要", status: "submitted", sessionId: "session-cancel" }],
    listLogisticsUrges: () => [{ ...base, recordId: "URGE-1", sourceSystem: "TMS", urgeRequestNo: "URGE-1", orderId: "OD-1", shipmentId: "SHIP-1", reason: "物流停滞", status: "submitted", sessionId: "session-urge" }],
    listReturnExchanges: () => [{ ...base, recordId: "RETURN-1", sourceSystem: "CRM", requestNo: "RETURN-1", orderId: "OD-3", serviceType: "exchange", product: "智控吸顶灯", reason: "到货破损", status: "reviewing", sessionId: "session-return", events: [{ occurredAt: base.createdAt, status: "submitted", description: "退换申请已提交" }, { occurredAt: base.updatedAt, status: "reviewing", description: "CRM 正在审核" }] }],
    listServiceTickets: () => [{ ...base, recordId: "WO-1", sourceSystem: "CRM", ticketNo: "WO-1", serviceType: "repair", issueDescription: "闻到烧焦味", contactPhone: "13812348001", serviceAddress: "上海市浦东新区演示路 18 号", riskLevel: "high", purchaseChannel: "store", status: "reviewing", sessionId: "session-risk", events: [] }],
    listHumanHandoffs: () => [],
    ...overrides,
  };
}

describe("operations query", () => {
  it("能在只读查询中找到已写入的物流催办", () => {
    const result = queryOperations(createStore(), { type: "logistics_urge" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ sourceRecordId: "URGE-1", sessionId: "session-urge" });
  });

  it("支持按 high 风险与渠道筛选", () => {
    const result = queryOperations(createStore(), { risk: "high", channel: "store" });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.type)).toEqual(expect.arrayContaining(["service_ticket", "risk_session"]));
    expect(result.items.every((item) => item.riskLevel === "high" && item.channel === "store")).toBe(true);
  });

  it("详情返回关联会话的 Trace 定位链接", () => {
    const detail = getOperationDetail(createStore(), "logistics-urge:URGE-1", (sessionId) => `TR-${sessionId}`);
    expect(detail.item).toMatchObject({ traceId: "TR-session-urge", traceHref: "/trace?traceId=TR-session-urge" });
  });

  it("展示并可分别筛选订单变更与取消申请", () => {
    const changes = queryOperations(createStore(), { type: "order_change", status: "submitted" });
    const cancellations = queryOperations(createStore(), { type: "order_cancel" });
    expect(changes.items).toHaveLength(1);
    expect(changes.items[0]).toMatchObject({ sourceSystem: "OMS", sourceRecordId: "CHANGE-1", sessionId: "session-change" });
    expect(cancellations.items).toHaveLength(1);
    expect(cancellations.items[0]).toMatchObject({ sourceSystem: "OMS", sourceRecordId: "CANCEL-1", sessionId: "session-cancel" });
  });

  it("退换申请展示来源状态时间线", () => {
    const result = queryOperations(createStore(), { type: "return_exchange" });
    expect(result.items[0]).toMatchObject({ status: "reviewing" });
    expect(result.items[0].timeline).toEqual([
      { occurredAt: base.createdAt, description: "退换申请已提交" },
      { occurredAt: base.updatedAt, description: "CRM 正在审核" },
    ]);
  });

  it("不返回未脱敏手机号和详细地址", () => {
    const serialized = JSON.stringify(queryOperations(createStore()));
    expect(serialized).not.toContain("13812348001");
    expect(serialized).not.toContain("13912348002");
    expect(serialized).not.toContain("演示路 18 号");
    expect(serialized).not.toContain("新地址 88 号");
    expect(serialized).toContain("138****8001");
    expect(serialized).toContain("139****8002");
    expect(serialized).toContain("运营台不展示完整地址");
  });

  it("Store 空时返回明确空集合", () => {
    const emptyStore = createStore({
      listOrders: () => [],
      listOrderChanges: () => [],
      listOrderCancellations: () => [],
      listLogisticsUrges: () => [],
      listReturnExchanges: () => [],
      listServiceTickets: () => [],
    });
    const result = queryOperations(emptyStore);
    expect(result.items).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it("单个数据源异常时保留其他记录并标记 degraded", () => {
    const result = queryOperations(createStore({ listReturnExchanges: () => { throw new Error("CRM timeout"); } }));
    expect(result.sourceHealth).toBe("degraded");
    expect(result.items.some((item) => item.type === "logistics_urge")).toBe(true);
    expect(result.sources.find((source) => source.name === "CRM 退换")).toMatchObject({ health: "degraded" });
  });
});
