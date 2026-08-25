import type { WarehouseManagementAdapter } from "@/lib/domain/business";
import { executeMock } from "@/lib/adapters/mock-adapter-utils";
import { businessStore } from "@/lib/stores/business/business-store";

export class WmsMockAdapter implements WarehouseManagementAdapter {
  getFulfillment(orderId: string, options?: Parameters<WarehouseManagementAdapter["getFulfillment"]>[1]) {
    return executeMock("WMS", options, () => {
      const fulfillment = businessStore.getFulfillment(orderId);
      return fulfillment ? { data: fulfillment, records: [fulfillment] } : null;
    });
  }
}

export const wmsMockAdapter = new WmsMockAdapter();
