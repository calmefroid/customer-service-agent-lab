import type { LogisticsUrgeRecord, TransportManagementAdapter } from "@/lib/domain/business";
import { sourceMetadata } from "@/lib/domain/business";
import { businessError, executeMock } from "@/lib/adapters/mock-adapter-utils";
import { businessStore } from "@/lib/stores/business/business-store";

export class TmsMockAdapter implements TransportManagementAdapter {
  getShipment(orderId: string, options?: Parameters<TransportManagementAdapter["getShipment"]>[1]) {
    return executeMock("TMS", options, () => {
      const shipment = businessStore.getShipment(orderId);
      return shipment ? { data: shipment, records: [shipment] } : null;
    });
  }

  async createUrge(
    draft: Parameters<TransportManagementAdapter["createUrge"]>[0],
    sessionId: string,
    idempotencyKey: string,
    options?: Parameters<TransportManagementAdapter["createUrge"]>[3],
  ) {
    const shipment = businessStore.getShipment(draft.orderId);
    if (!shipment || shipment.shipmentId !== draft.shipmentId) {
      return businessError<LogisticsUrgeRecord>("TMS", "NOT_FOUND", "未找到匹配的物流记录");
    }
    if (!draft.reason.trim()) {
      return businessError<LogisticsUrgeRecord>("TMS", "INVALID_INPUT", "催办原因不能为空");
    }

    const result = await executeMock("TMS", options, () => {
      const now = new Date().toISOString();
      const urgeRequestNo = businessStore.nextId("URGE20260824");
      const record: LogisticsUrgeRecord = {
        ...draft,
        recordId: urgeRequestNo,
        urgeRequestNo,
        crmRecordId: businessStore.nextId("CS20260824"),
        sourceSystem: "TMS",
        sessionId,
        idempotencyKey,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      };
      const saved = businessStore.addLogisticsUrge(record);
      return { data: saved, records: [saved] };
    });
    if (result.status === "success") {
      result.meta.sources.push({
        ...sourceMetadata("CRM", result.meta.requestId),
        recordId: result.data.crmRecordId,
        sourceUpdatedAt: result.data.updatedAt,
      });
    }
    return result;
  }
}

export const tmsMockAdapter = new TmsMockAdapter();
