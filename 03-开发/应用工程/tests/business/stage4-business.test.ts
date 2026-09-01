import { beforeEach, describe, expect, it } from "vitest";

import type { ConfirmationCommand, ConfirmationRequest } from "@/lib/contracts";
import { crmMockAdapter } from "@/lib/adapters/crm-mock-adapter";
import { omsMockAdapter } from "@/lib/adapters/oms-mock-adapter";
import type {
  OrderCancelDraft,
  OrderChangeDraft,
  OrderManagementAdapter,
  ReturnExchangeDraft,
  WorkflowContext,
} from "@/lib/domain/business";
import { isOrderOperationAllowed } from "@/lib/domain/business";
import { BusinessWorkflowService } from "@/lib/domain/business-workflow";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import { businessStore } from "@/lib/stores/business/business-store";
import { confirmationStore } from "@/lib/stores/business/confirmation-store";

const context: WorkflowContext = {
  sessionId: "stage4-business-session",
  traceId: "stage4-business-trace",
  identity: { customerId: DEMO_CUSTOMER_ID, verified: true },
};

const service = new BusinessWorkflowService();

function confirm<T extends Record<string, unknown>>(
  request: ConfirmationRequest<T>,
  finalSnapshot: T,
): ConfirmationCommand<T> {
  return {
    confirmationRequestId: request.confirmationRequestId,
    confirmationToken: request.confirmationToken,
    idempotencyKey: request.idempotencyKey,
    action: "confirm",
    finalSnapshot,
  };
}

const returnDraft: ReturnExchangeDraft = {
  orderId: "OD202608100119",
  serviceType: "exchange",
  product: "智控系列吸顶灯 ZC80",
  reason: "到货破损",
  itemCondition: "灯罩破裂，未通电",
  evidence: ["stage4-damage.jpg"],
  contactPhone: "138****8001",
  pickupAddress: "上海市演示地址",
};

async function createReturn(idempotencyKey = "stage4-return-query") {
  const created = await crmMockAdapter.createReturnExchange(
    returnDraft,
    context.sessionId,
    idempotencyKey,
  );
  expect(created.status).toBe("success");
  if (created.status !== "success") throw new Error("test setup failed");
  return created.data;
}

describe("stage 4 order operations and CRM return status", () => {
  beforeEach(() => businessStore.reset());

  it("provides the latest mutable demo order with complete OMS provenance", async () => {
    const result = await service.queryOrderOperationCandidate(context);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data).toMatchObject({ orderId: "OD202608050088", status: "paid" });
    expect(result.meta.requestId).toBeTruthy();
    expect(result.meta.sources[0]).toMatchObject({
      sourceSystem: "OMS",
      adapterType: "mock",
      requestId: result.meta.requestId,
      recordId: result.data.recordId,
      sourceUpdatedAt: result.data.updatedAt,
    });
  });

  it.each([
    ["empty", "EMPTY_RESULT", false],
    ["timeout", "TIMEOUT", true],
    ["business_error", "BUSINESS_REJECTED", false],
    ["system_error", "SYSTEM_FAILURE", true],
  ] as const)("injects OMS candidate %s without preparing or writing an application", async (outcome, code, retryable) => {
    const result = await service.queryOrderOperationCandidate(context, { outcome });
    expect(result).toMatchObject({ status: outcome, data: null, error: { code, retryable } });
    expect(result.meta.sources[0]).toMatchObject({
      sourceSystem: "OMS",
      adapterType: "mock",
      requestId: result.meta.requestId,
    });
    expect(confirmationStore.list()).toHaveLength(0);
    expect(businessStore.listOrderChanges()).toHaveLength(0);
    expect(businessStore.listOrderCancellations()).toHaveLength(0);
  });

  it("creates an address-change application only after stage-3 confirmation", async () => {
    const original = businessStore.getOrder("OD202608050088");
    const draft: OrderChangeDraft = {
      orderId: "OD202608050088",
      deliveryAddress: "上海市演示新区 66 号",
      contactPhone: "139****9002",
    };
    const prepared = await service.prepareOrderChange(context, draft);
    expect(prepared.status).toBe("success");
    expect(businessStore.listOrderChanges()).toHaveLength(0);
    if (prepared.status !== "success") return;
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("pending");

    const submitted = await service.resolveConfirmation(context, confirm(prepared.data, draft));
    expect(submitted.status).toBe("success");
    if (submitted.status !== "success" || submitted.data.action !== "confirm") return;
    expect(submitted.data.record).toMatchObject({
      sourceSystem: "OMS",
      orderId: draft.orderId,
      status: "submitted",
      deliveryAddress: draft.deliveryAddress,
    });
    expect(submitted.meta.sources[0]).toMatchObject({
      sourceSystem: "OMS",
      adapterType: "mock",
      recordId: submitted.data.record.recordId,
      sourceUpdatedAt: submitted.data.record.updatedAt,
      requestId: submitted.meta.requestId,
    });
    expect(businessStore.getOrder(draft.orderId)).toEqual(original);
    expect(businessStore.listOrderChanges()).toHaveLength(1);
  });

  it("creates a cancellation application only after stage-3 confirmation", async () => {
    const original = businessStore.getOrder("OD202608050088");
    const draft: OrderCancelDraft = { orderId: "OD202608050088", reason: "用户不再需要" };
    const prepared = await service.prepareOrderCancel(context, draft);
    expect(prepared.status).toBe("success");
    expect(businessStore.listOrderCancellations()).toHaveLength(0);
    if (prepared.status !== "success") return;

    const submitted = await service.resolveConfirmation(context, confirm(prepared.data, draft));
    expect(submitted.status).toBe("success");
    if (submitted.status !== "success" || submitted.data.action !== "confirm") return;
    expect(submitted.data.record).toMatchObject({
      sourceSystem: "OMS",
      orderId: draft.orderId,
      status: "submitted",
      reason: draft.reason,
    });
    expect(businessStore.getOrder(draft.orderId)).toEqual(original);
    expect(businessStore.listOrderCancellations()).toHaveLength(1);
  });

  it.each([
    ["OD202608180236", "shipped"],
    ["OD202608100119", "delivered"],
    ["OD202607280017", "cancelled"],
  ] as const)("rejects change and cancellation for %s in %s state", async (orderId, status) => {
    expect(isOrderOperationAllowed(status)).toBe(false);
    const change = await service.prepareOrderChange(context, { orderId, deliveryAddress: "无效变更地址" });
    const cancel = await service.prepareOrderCancel(context, { orderId, reason: "状态不允许" });
    expect(change).toMatchObject({
      status: "business_error",
      error: { code: "BUSINESS_REJECTED", retryable: false, details: { orderStatus: status } },
    });
    expect(cancel).toMatchObject({
      status: "business_error",
      error: { code: "BUSINESS_REJECTED", retryable: false, details: { orderStatus: status } },
    });
    expect(businessStore.listOrderChanges()).toHaveLength(0);
    expect(businessStore.listOrderCancellations()).toHaveLength(0);
    expect(confirmationStore.list()).toHaveLength(0);
  });

  it("rechecks current order state at submit time and leaves Store clean when it changed", async () => {
    let currentStatus: "paid" | "shipped" = "paid";
    const changingOms: OrderManagementAdapter = {
      getOrder: async (orderId, options) => {
        const result = await omsMockAdapter.getOrder(orderId, options);
        return result.status === "success"
          ? { ...result, data: { ...result.data, status: currentStatus } }
          : result;
      },
      getLatestOrder: omsMockAdapter.getLatestOrder.bind(omsMockAdapter),
      getLatestMutableOrder: omsMockAdapter.getLatestMutableOrder.bind(omsMockAdapter),
      createOrderChange: omsMockAdapter.createOrderChange.bind(omsMockAdapter),
      cancelOrder: omsMockAdapter.cancelOrder.bind(omsMockAdapter),
    };
    const localService = new BusinessWorkflowService(changingOms);
    const draft: OrderChangeDraft = { orderId: "OD202608050088", deliveryAddress: "签发后的地址" };
    const prepared = await localService.prepareOrderChange(context, draft);
    expect(prepared.status).toBe("success");
    if (prepared.status !== "success") return;
    currentStatus = "shipped";

    const result = await localService.resolveConfirmation(context, confirm(prepared.data, draft));
    expect(result).toMatchObject({
      status: "business_error",
      error: { code: "BUSINESS_REJECTED", details: { orderStatus: "shipped" } },
    });
    expect(businessStore.listOrderChanges()).toHaveLength(0);
    expect(confirmationStore.get(prepared.data.confirmationRequestId)?.status).toBe("pending");
  });

  it("requires verified demo identity before querying return progress", async () => {
    const result = await service.queryReturnExchangeStatus({
      ...context,
      identity: { ...context.identity, verified: false },
    });
    expect(result).toMatchObject({
      status: "business_error",
      data: null,
      error: { code: "UNAUTHORIZED", retryable: false },
    });
  });

  it("returns the exact CRM request and public event timeline with complete provenance", async () => {
    const created = await createReturn();
    const result = await service.queryReturnExchangeStatus(context, created.requestNo);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data).toMatchObject({
      recordId: created.recordId,
      requestNo: created.requestNo,
      orderId: created.orderId,
      status: "submitted",
      updatedAt: created.updatedAt,
      events: [{ status: "submitted", description: "退换申请已提交，等待 CRM 审核" }],
      source: {
        sourceSystem: "CRM",
        adapterType: "mock",
        requestId: result.meta.requestId,
        recordId: created.recordId,
        sourceUpdatedAt: created.updatedAt,
      },
    });
    expect(result.meta.sources[0]).toEqual(result.data.source);
  });

  it("returns the current identity's most recently updated request when requestNo is omitted", async () => {
    const first = await createReturn("stage4-return-first");
    const second = await createReturn("stage4-return-second");
    const result = await service.queryReturnExchangeStatus(context);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect([first.requestNo, second.requestNo]).toContain(result.data.requestNo);
    expect(result.data.requestNo).toBe(second.requestNo);
  });

  it("returns empty for an unknown or another identity's request without a similar fallback", async () => {
    const created = await createReturn();
    const unknown = await service.queryReturnExchangeStatus(context, "RE-NOT-FOUND");
    const otherIdentity = await service.queryReturnExchangeStatus({
      ...context,
      identity: { customerId: "another-demo-customer", verified: true },
    }, created.requestNo);
    for (const result of [unknown, otherIdentity]) {
      expect(result).toMatchObject({ status: "empty", data: null, error: { code: "EMPTY_RESULT" } });
      expect(result.meta.sources[0]).toMatchObject({
        sourceSystem: "CRM",
        adapterType: "mock",
        requestId: result.meta.requestId,
      });
    }
    expect(businessStore.listReturnExchanges()).toHaveLength(1);
  });

  it.each([
    ["timeout", "TIMEOUT", true],
    ["business_error", "BUSINESS_REJECTED", false],
    ["system_error", "SYSTEM_FAILURE", true],
  ] as const)("injects %s for return progress without mutating CRM Store", async (outcome, code, retryable) => {
    const created = await createReturn();
    const before = businessStore.listReturnExchanges();
    const result = await service.queryReturnExchangeStatus(context, created.requestNo, { outcome });
    expect(result).toMatchObject({
      status: outcome,
      data: null,
      error: { code, retryable },
    });
    expect(result.meta.sources[0]).toMatchObject({
      sourceSystem: "CRM",
      adapterType: "mock",
      requestId: result.meta.requestId,
    });
    expect(businessStore.listReturnExchanges()).toEqual(before);
  });

  it("uses success by default and reset removes runtime return requests and confirmations", async () => {
    const created = await createReturn();
    expect((await service.queryReturnExchangeStatus(context, created.requestNo)).status).toBe("success");
    const prepared = await service.prepareOrderCancel(context, {
      orderId: "OD202608050088",
      reason: "测试 reset",
    });
    expect(prepared.status).toBe("success");
    expect(confirmationStore.list()).toHaveLength(1);
    businessStore.reset();
    expect(businessStore.listReturnExchanges()).toHaveLength(0);
    expect(confirmationStore.list()).toHaveLength(0);
  });
});
