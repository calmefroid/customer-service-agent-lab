import type { OrderCancelRecord, OrderChangeRecord, OrderManagementAdapter } from "@/lib/domain/business";
import { businessError, executeMock } from "@/lib/adapters/mock-adapter-utils";
import { businessStore } from "@/lib/stores/business/business-store";

export class OmsMockAdapter implements OrderManagementAdapter {
  getOrder(orderId: string, options?: Parameters<OrderManagementAdapter["getOrder"]>[1]) {
    return executeMock("OMS", options, () => {
      const order = businessStore.getOrder(orderId);
      return order ? { data: order, records: [order] } : null;
    });
  }

  getLatestOrder(customerId: string, options?: Parameters<OrderManagementAdapter["getLatestOrder"]>[1]) {
    return executeMock("OMS", options, () => {
      const order = businessStore
        .listOrders(customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return order ? { data: order, records: [order] } : null;
    });
  }

  createOrderChange(
    draft: Parameters<OrderManagementAdapter["createOrderChange"]>[0],
    sessionId: string,
    idempotencyKey: string,
    options?: Parameters<OrderManagementAdapter["createOrderChange"]>[3],
  ) {
    const order = businessStore.getOrder(draft.orderId);
    if (!order) return Promise.resolve(businessError<OrderChangeRecord>("OMS", "NOT_FOUND", "订单不存在"));
    if (!draft.deliveryAddress && !draft.contactPhone) {
      return Promise.resolve(businessError<OrderChangeRecord>("OMS", "INVALID_INPUT", "至少需要修改地址或联系电话"));
    }
    if (!["paid", "allocated"].includes(order.status)) {
      return Promise.resolve(
        businessError<OrderChangeRecord>("OMS", "BUSINESS_REJECTED", "订单已进入履约或结束状态，不可变更", {
          orderStatus: order.status,
        }),
      );
    }

    return executeMock("OMS", options, () => {
      const now = new Date().toISOString();
      const requestNo = businessStore.nextId("OC20260824");
      const record: OrderChangeRecord = {
        ...draft,
        recordId: requestNo,
        changeRequestNo: requestNo,
        sourceSystem: "OMS",
        sessionId,
        idempotencyKey,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      };
      const saved = businessStore.addOrderChange(record);
      return { data: saved, records: [saved] };
    });
  }

  cancelOrder(
    draft: Parameters<OrderManagementAdapter["cancelOrder"]>[0],
    sessionId: string,
    idempotencyKey: string,
    options?: Parameters<OrderManagementAdapter["cancelOrder"]>[3],
  ) {
    const order = businessStore.getOrder(draft.orderId);
    if (!order) return Promise.resolve(businessError<OrderCancelRecord>("OMS", "NOT_FOUND", "订单不存在"));
    if (!draft.reason.trim()) {
      return Promise.resolve(businessError<OrderCancelRecord>("OMS", "INVALID_INPUT", "取消原因不能为空"));
    }
    if (!["paid", "allocated"].includes(order.status)) {
      return Promise.resolve(
        businessError<OrderCancelRecord>("OMS", "BUSINESS_REJECTED", "订单已进入履约或结束状态，不可取消", {
          orderStatus: order.status,
        }),
      );
    }

    return executeMock("OMS", options, () => {
      const now = new Date().toISOString();
      const requestNo = businessStore.nextId("CX20260901");
      const record: OrderCancelRecord = {
        ...draft,
        recordId: requestNo,
        cancelRequestNo: requestNo,
        sourceSystem: "OMS",
        sessionId,
        idempotencyKey,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      };
      const saved = businessStore.addOrderCancellation(record);
      return { data: saved, records: [saved] };
    });
  }
}

export const omsMockAdapter = new OmsMockAdapter();
