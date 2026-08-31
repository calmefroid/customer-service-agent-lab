import type {
  CustomerRelationshipAdapter,
  HumanHandoffRecord,
  ReturnExchangeRecord,
  ServiceTicketRecord,
} from "@/lib/domain/business";
import { businessError, executeInjectedFailure, executeMock } from "@/lib/adapters/mock-adapter-utils";
import { businessStore } from "@/lib/stores/business/business-store";

export class CrmMockAdapter implements CustomerRelationshipAdapter {
  createReturnExchange(
    draft: Parameters<CustomerRelationshipAdapter["createReturnExchange"]>[0],
    sessionId: string,
    idempotencyKey: string,
    options?: Parameters<CustomerRelationshipAdapter["createReturnExchange"]>[3],
  ) {
    const injectedFailure = executeInjectedFailure<ReturnExchangeRecord>("CRM", options);
    if (injectedFailure) return injectedFailure;

    const order = businessStore.getOrder(draft.orderId);
    if (!order) return Promise.resolve(businessError<ReturnExchangeRecord>("CRM", "NOT_FOUND", "退换所属订单不存在"));
    if (!draft.reason || !draft.itemCondition || !draft.contactPhone || !draft.pickupAddress) {
      return Promise.resolve(businessError<ReturnExchangeRecord>("CRM", "INVALID_INPUT", "退换申请缺少必填字段"));
    }

    return executeMock("CRM", options, () => {
      const now = new Date().toISOString();
      const requestNo = businessStore.nextId("RE20260824");
      const record: ReturnExchangeRecord = {
        ...draft,
        recordId: requestNo,
        requestNo,
        sourceSystem: "CRM",
        sessionId,
        idempotencyKey,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      };
      const saved = businessStore.addReturnExchange(record);
      return { data: saved, records: [saved] };
    });
  }

  createServiceTicket(
    customerId: string,
    draft: Parameters<CustomerRelationshipAdapter["createServiceTicket"]>[1],
    sessionId: string,
    idempotencyKey: string,
    options?: Parameters<CustomerRelationshipAdapter["createServiceTicket"]>[4],
  ) {
    const injectedFailure = executeInjectedFailure<ServiceTicketRecord>("CRM", options);
    if (injectedFailure) return injectedFailure;

    if (!draft.product || !draft.issueDescription || !draft.contactPhone || !draft.serviceAddress) {
      return Promise.resolve(businessError<ServiceTicketRecord>("CRM", "INVALID_INPUT", "服务工单缺少必填字段"));
    }

    return executeMock("CRM", options, () => {
      const now = new Date().toISOString();
      const ticketNo = businessStore.nextId("WO20260824");
      const record: ServiceTicketRecord = {
        ...draft,
        recordId: ticketNo,
        ticketNo,
        sourceSystem: "CRM",
        customerId,
        sessionId,
        idempotencyKey,
        status: "submitted",
        events: [{ occurredAt: now, description: draft.serviceType === "repair" ? "售后报修已提交" : "安装服务申请已提交" }],
        createdAt: now,
        updatedAt: now,
      };
      const saved = businessStore.addServiceTicket(record);
      return { data: saved, records: [saved] };
    });
  }

  listServiceTickets(customerId: string, options?: Parameters<CustomerRelationshipAdapter["listServiceTickets"]>[1]) {
    return executeMock("CRM", options, () => {
      const tickets = businessStore.listServiceTickets(customerId);
      return tickets.length > 0 ? { data: tickets, records: tickets } : null;
    });
  }

  createHumanHandoff(
    draft: Parameters<CustomerRelationshipAdapter["createHumanHandoff"]>[0],
    options?: Parameters<CustomerRelationshipAdapter["createHumanHandoff"]>[1],
  ) {
    if (!draft.summary.trim()) {
      return Promise.resolve(businessError<HumanHandoffRecord>("CRM", "INVALID_INPUT", "人工接管摘要不能为空"));
    }
    return executeMock("CRM", options, () => {
      const now = new Date().toISOString();
      const handoffNo = businessStore.nextId("HO20260824");
      const record: HumanHandoffRecord = {
        ...draft,
        recordId: handoffNo,
        handoffNo,
        sourceSystem: "CRM",
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      const saved = businessStore.addHumanHandoff(record);
      return { data: saved, records: [saved] };
    });
  }
}

export const crmMockAdapter = new CrmMockAdapter();
