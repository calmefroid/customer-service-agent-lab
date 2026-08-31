import { beforeEach, describe, expect, it } from "vitest";

import { crmMockAdapter } from "@/lib/adapters/crm-mock-adapter";
import { omsMockAdapter } from "@/lib/adapters/oms-mock-adapter";
import { tmsMockAdapter } from "@/lib/adapters/tms-mock-adapter";
import type { ReturnExchangeDraft, ServiceTicketDraft } from "@/lib/domain/business";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import { businessStore } from "@/lib/stores/business/business-store";

const returnDraft: ReturnExchangeDraft = {
  orderId: "OD202608180236",
  serviceType: "exchange",
  product: "悦享系列 LED 吸顶灯",
  reason: "收货破损",
  itemCondition: "灯罩可见破裂，未通电",
  evidence: ["damage-demo.jpg"],
  contactPhone: "138****8001",
  pickupAddress: "上海市演示地址",
};

const ticketDraft: ServiceTicketDraft = {
  serviceType: "repair",
  product: "悦享系列 LED 吸顶灯",
  purchaseChannel: "online",
  issueDescription: "重启后仍然闪烁",
  contactPhone: "138****8001",
  serviceAddress: "上海市演示地址",
  preferredContactTime: "工作日",
  riskLevel: "low",
};

function storeSnapshot() {
  return {
    orders: businessStore.listOrders(),
    fulfillments: businessStore.listFulfillments(),
    shipments: businessStore.listShipments(),
    orderChanges: businessStore.listOrderChanges(),
    urges: businessStore.listLogisticsUrges(),
    returns: businessStore.listReturnExchanges(),
    tickets: businessStore.listServiceTickets(),
    handoffs: businessStore.listHumanHandoffs(),
  };
}

describe("fixed eval tool failure injection", () => {
  beforeEach(() => businessStore.reset());

  it("injects OMS empty without changing Store and keeps success as the default", async () => {
    const before = storeSnapshot();
    const failed = await omsMockAdapter.getLatestOrder(DEMO_CUSTOMER_ID, { outcome: "empty" });

    expect(failed).toMatchObject({
      status: "empty",
      data: null,
      error: { code: "EMPTY_RESULT", retryable: false },
    });
    expect(failed.meta.sources[0]).toMatchObject({ sourceSystem: "OMS", adapterType: "mock" });
    expect(storeSnapshot()).toEqual(before);
    expect((await omsMockAdapter.getLatestOrder(DEMO_CUSTOMER_ID)).status).toBe("success");
  });

  it("injects TMS timeout as retryable without changing Store and keeps success as the default", async () => {
    const before = storeSnapshot();
    const failed = await tmsMockAdapter.getShipment("OD202608180236", { outcome: "timeout" });

    expect(failed).toMatchObject({
      status: "timeout",
      data: null,
      error: { code: "TIMEOUT", retryable: true },
    });
    expect(failed.meta.sources[0]).toMatchObject({ sourceSystem: "TMS", adapterType: "mock" });
    expect(storeSnapshot()).toEqual(before);
    expect((await tmsMockAdapter.getShipment("OD202608180236")).status).toBe("success");
  });

  it("injects CRM return business_error without a request number or dirty write", async () => {
    const before = businessStore.listReturnExchanges();
    const failed = await crmMockAdapter.createReturnExchange(
      returnDraft,
      "badcase-return-session",
      "badcase-return-failure",
      { outcome: "business_error" },
    );

    expect(failed).toMatchObject({
      status: "business_error",
      data: null,
      error: { code: "BUSINESS_REJECTED", retryable: false },
    });
    expect(failed.meta.sources[0]).toMatchObject({ sourceSystem: "CRM", adapterType: "mock" });
    expect(businessStore.listReturnExchanges()).toEqual(before);

    const defaultResult = await crmMockAdapter.createReturnExchange(
      returnDraft,
      "default-return-session",
      "default-return-success",
    );
    expect(defaultResult.status).toBe("success");
    if (defaultResult.status === "success") expect(defaultResult.data.requestNo).toMatch(/0001$/);
  });

  it("injects CRM ticket system_error as retryable without a ticket number or dirty write", async () => {
    const before = businessStore.listServiceTickets();
    const failed = await crmMockAdapter.createServiceTicket(
      DEMO_CUSTOMER_ID,
      ticketDraft,
      "badcase-ticket-session",
      "badcase-ticket-failure",
      { outcome: "system_error" },
    );

    expect(failed).toMatchObject({
      status: "system_error",
      data: null,
      error: { code: "SYSTEM_FAILURE", retryable: true },
    });
    expect(failed.meta.sources[0]).toMatchObject({ sourceSystem: "CRM", adapterType: "mock" });
    expect(businessStore.listServiceTickets()).toEqual(before);

    const defaultResult = await crmMockAdapter.createServiceTicket(
      DEMO_CUSTOMER_ID,
      ticketDraft,
      "default-ticket-session",
      "default-ticket-success",
    );
    expect(defaultResult.status).toBe("success");
    if (defaultResult.status === "success") expect(defaultResult.data.ticketNo).toMatch(/0001$/);
  });

  it("explicit CRM failures take precedence over invalid drafts without entering Store", async () => {
    const invalidReturnDraft = { ...returnDraft, orderId: "UNKNOWN", reason: "" };
    const invalidTicketDraft = { ...ticketDraft, product: "", issueDescription: "" };

    const returnFailure = await crmMockAdapter.createReturnExchange(
      invalidReturnDraft,
      "precedence-session",
      "precedence-return",
      { outcome: "business_error" },
    );
    const ticketFailure = await crmMockAdapter.createServiceTicket(
      DEMO_CUSTOMER_ID,
      invalidTicketDraft,
      "precedence-session",
      "precedence-ticket",
      { outcome: "system_error" },
    );

    expect(returnFailure).toMatchObject({ status: "business_error", error: { code: "BUSINESS_REJECTED" } });
    expect(ticketFailure).toMatchObject({ status: "system_error", error: { code: "SYSTEM_FAILURE" } });
    expect(businessStore.listReturnExchanges()).toHaveLength(0);
    expect(businessStore.listServiceTickets()).toHaveLength(1);
  });
});
