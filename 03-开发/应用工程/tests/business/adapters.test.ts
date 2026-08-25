import { beforeEach, describe, expect, it } from "vitest";
import { crmMockAdapter } from "@/lib/adapters/crm-mock-adapter";
import { omsMockAdapter } from "@/lib/adapters/oms-mock-adapter";
import { pcmpMockAdapter } from "@/lib/adapters/pcmp-mock-adapter";
import { tmsMockAdapter } from "@/lib/adapters/tms-mock-adapter";
import { wmsMockAdapter } from "@/lib/adapters/wms-mock-adapter";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import { businessStore } from "@/lib/stores/business/business-store";

describe("business mock adapters", () => {
  beforeEach(() => businessStore.reset());

  it("PCMP 返回产品主数据和统一来源元数据", async () => {
    const result = await pcmpMockAdapter.getProduct("SKU-MX960-D05-80");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.model).toBe("MX960-D0.5×80");
    expect(result.meta.sources[0]).toMatchObject({ sourceSystem: "PCMP", adapterType: "mock" });
    expect(result.meta.sources[0].recordId).toBe(result.data.recordId);
  });

  it("PCMP 空结果不返回相似产品", async () => {
    const result = await pcmpMockAdapter.getProduct("UNKNOWN");
    expect(result.status).toBe("empty");
    if (result.status === "success") return;
    expect(result.error.code).toBe("EMPTY_RESULT");
  });

  it("OMS 支持成功查询并拒绝不可变更订单", async () => {
    const order = await omsMockAdapter.getLatestOrder(DEMO_CUSTOMER_ID);
    expect(order.status).toBe("success");

    const rejected = await omsMockAdapter.createOrderChange(
      { orderId: "OD202608180236", deliveryAddress: "演示新地址" },
      "session-1",
      "idem-order-rejected",
    );
    expect(rejected.status).toBe("business_error");
    if (rejected.status === "success") return;
    expect(rejected.error.code).toBe("BUSINESS_REJECTED");
  });

  it("WMS 支持成功与超时注入", async () => {
    expect((await wmsMockAdapter.getFulfillment("OD202608180236")).status).toBe("success");
    const timeout = await wmsMockAdapter.getFulfillment("OD202608180236", { outcome: "timeout" });
    expect(timeout.status).toBe("timeout");
    if (timeout.status === "success") return;
    expect(timeout.error.retryable).toBe(true);
  });

  it("TMS 催办同时返回 TMS 与 CRM 来源，系统失败不伪造编号", async () => {
    const draft = { orderId: "OD202608180236", shipmentId: "SHIP-SF14900000628", reason: "物流停滞" };
    const success = await tmsMockAdapter.createUrge(draft, "session-1", "idem-urge-1");
    expect(success.status).toBe("success");
    if (success.status === "success") {
      expect(success.meta.sources.map((source) => source.sourceSystem)).toEqual(["TMS", "CRM"]);
    }

    const failed = await tmsMockAdapter.createUrge(draft, "session-1", "idem-urge-2", { outcome: "system_error" });
    expect(failed.status).toBe("system_error");
    expect(businessStore.listLogisticsUrges()).toHaveLength(1);
  });

  it("CRM 工单查询支持成功与失败注入", async () => {
    const success = await crmMockAdapter.listServiceTickets(DEMO_CUSTOMER_ID);
    expect(success.status).toBe("success");
    const failed = await crmMockAdapter.listServiceTickets(DEMO_CUSTOMER_ID, { outcome: "system_error" });
    expect(failed.status).toBe("system_error");
  });
});
