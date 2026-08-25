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
    listLogisticsUrges: () => [{ ...base, recordId: "URGE-1", sourceSystem: "TMS", urgeRequestNo: "URGE-1", orderId: "OD-1", shipmentId: "SHIP-1", reason: "物流停滞", status: "submitted", sessionId: "session-urge" }],
    listReturnExchanges: () => [],
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
    const detail = getOperationDetail(createStore(), "logistics-urge:URGE-1");
    expect(detail.item?.traceHref).toBe("/trace?sessionId=session-urge");
  });

  it("不返回未脱敏手机号和详细地址", () => {
    const serialized = JSON.stringify(queryOperations(createStore()));
    expect(serialized).not.toContain("13812348001");
    expect(serialized).not.toContain("演示路 18 号");
    expect(serialized).toContain("138****8001");
    expect(serialized).toContain("运营台不展示完整地址");
  });

  it("Store 空时返回明确空集合", () => {
    const emptyStore = createStore({
      listOrders: () => [],
      listLogisticsUrges: () => [],
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
