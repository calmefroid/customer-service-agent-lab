import type { ConfirmationOperation, ConfirmationRequest, ToolResult, ToolResultMetadata } from "@/lib/contracts";
import { businessError, executeMock } from "@/lib/adapters/mock-adapter-utils";
import { crmMockAdapter } from "@/lib/adapters/crm-mock-adapter";
import { omsMockAdapter } from "@/lib/adapters/oms-mock-adapter";
import { tmsMockAdapter } from "@/lib/adapters/tms-mock-adapter";
import { wmsMockAdapter } from "@/lib/adapters/wms-mock-adapter";
import type {
  AdapterCallOptions,
  ConfirmedWrite,
  CustomerRelationshipAdapter,
  HumanHandoffDraft,
  HumanHandoffRecord,
  LogisticsUrgeDraft,
  LogisticsUrgeRecord,
  OrderChangeDraft,
  OrderChangeRecord,
  OrderLogisticsView,
  OrderManagementAdapter,
  ReturnExchangeDraft,
  ReturnExchangeRecord,
  ServiceTicketDraft,
  ServiceTicketRecord,
  TransportManagementAdapter,
  WarehouseManagementAdapter,
  WorkflowContext,
} from "@/lib/domain/business";

export interface LogisticsQueryOptions {
  oms?: AdapterCallOptions;
  wms?: AdapterCallOptions;
  tms?: AdapterCallOptions;
}

function mergeMeta(results: ToolResult<unknown>[]): ToolResultMetadata {
  return {
    requestId: `workflow-${crypto.randomUUID()}`,
    sources: results.flatMap((result) => result.meta.sources),
    durationMs: results.reduce((sum, result) => sum + result.meta.durationMs, 0),
    attempts: Math.max(...results.map((result) => result.meta.attempts)),
  };
}

function firstFailure<T>(results: ToolResult<unknown>[]): ToolResult<T> | null {
  for (const result of results) {
    if (result.status === "timeout" || result.status === "business_error" || result.status === "system_error") {
      return { status: result.status, data: null, error: result.error, meta: mergeMeta(results) };
    }
  }
  return null;
}

function requireIdentity<T>(context: WorkflowContext, system: "OMS" | "CRM" | "TMS" = "CRM"): ToolResult<T> | null {
  if (context.identity.verified) return null;
  return businessError<T>(system, "UNAUTHORIZED", "请先确认当前演示身份");
}

function createConfirmation<TDraft extends Record<string, unknown>>(
  context: WorkflowContext,
  operation: ConfirmationOperation,
  target: ConfirmationRequest["target"],
  draft: TDraft,
  risks: string[],
): ConfirmationRequest<TDraft> {
  const createdAt = new Date();
  return {
    confirmationRequestId: `confirmation-${crypto.randomUUID()}`,
    sessionId: context.sessionId,
    traceId: context.traceId,
    operation,
    target,
    draftSnapshot: structuredClone(draft),
    riskLevel: risks.length > 0 ? "medium" : "low",
    risks,
    confirmationToken: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
  };
}

function validateWrite<TDraft extends Record<string, unknown>>(
  context: WorkflowContext,
  write: ConfirmedWrite<TDraft>,
  expectedOperation: ConfirmationOperation,
): string | null {
  if (!context.identity.verified) return "请先确认当前演示身份";
  if (write.request.sessionId !== context.sessionId) return "确认请求不属于当前会话";
  if (write.request.operation !== expectedOperation) return "确认请求的操作类型不匹配";
  if (write.confirmationToken !== write.request.confirmationToken) return "确认令牌无效";
  if (write.idempotencyKey !== write.request.idempotencyKey) return "幂等键与确认请求不匹配";
  if (Date.parse(write.request.expiresAt) <= Date.now()) return "确认请求已过期";
  return null;
}

export class BusinessWorkflowService {
  constructor(
    private readonly oms: OrderManagementAdapter = omsMockAdapter,
    private readonly wms: WarehouseManagementAdapter = wmsMockAdapter,
    private readonly tms: TransportManagementAdapter = tmsMockAdapter,
    private readonly crm: CustomerRelationshipAdapter = crmMockAdapter,
  ) {}

  async queryOrderLogistics(
    context: WorkflowContext,
    orderId: string,
    options: LogisticsQueryOptions = {},
  ): Promise<ToolResult<OrderLogisticsView>> {
    const unauthorized = requireIdentity<OrderLogisticsView>(context, "OMS");
    if (unauthorized) return unauthorized;

    const orderResult = await this.oms.getOrder(orderId, options.oms);
    if (orderResult.status !== "success") return orderResult;
    if (orderResult.data.customerId !== context.identity.customerId) {
      return businessError("OMS", "UNAUTHORIZED", "当前演示身份无权访问该订单");
    }

    const [fulfillmentResult, shipmentResult] = await Promise.all([
      this.wms.getFulfillment(orderId, options.wms),
      this.tms.getShipment(orderId, options.tms),
    ]);
    const results: ToolResult<unknown>[] = [orderResult, fulfillmentResult, shipmentResult];
    const operationalFailure = firstFailure<OrderLogisticsView>(results);
    if (operationalFailure) return operationalFailure;

    return {
      status: "success",
      data: {
        order: orderResult.data,
        fulfillment: fulfillmentResult.status === "success" ? fulfillmentResult.data : null,
        shipment: shipmentResult.status === "success" ? shipmentResult.data : null,
      },
      meta: mergeMeta(results),
    };
  }

  async prepareOrderChange(
    context: WorkflowContext,
    draft: OrderChangeDraft,
  ): Promise<ToolResult<ConfirmationRequest<OrderChangeDraft>>> {
    const unauthorized = requireIdentity<ConfirmationRequest<OrderChangeDraft>>(context, "OMS");
    if (unauthorized) return unauthorized;
    const order = await this.oms.getOrder(draft.orderId);
    if (order.status !== "success") return order;
    if (order.data.customerId !== context.identity.customerId) {
      return businessError<ConfirmationRequest<OrderChangeDraft>>("OMS", "UNAUTHORIZED", "当前演示身份无权变更该订单");
    }
    if (!["paid", "allocated"].includes(order.data.status)) {
      return businessError<ConfirmationRequest<OrderChangeDraft>>("OMS", "BUSINESS_REJECTED", "订单当前状态不可变更", {
        orderStatus: order.data.status,
      });
    }
    return executeMock("OMS", undefined, () => ({
      data: createConfirmation(context, "order_change", { type: "order", id: draft.orderId }, draft, ["提交后将由 OMS 处理订单变更申请"]),
      records: [order.data],
    }));
  }

  async submitOrderChange(
    context: WorkflowContext,
    write: ConfirmedWrite<OrderChangeDraft>,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<OrderChangeRecord>> {
    const invalid = validateWrite(context, write, "order_change");
    if (invalid) return businessError<OrderChangeRecord>("OMS", "UNAUTHORIZED", invalid);
    return this.oms.createOrderChange(structuredClone(write.finalSnapshot), context.sessionId, write.idempotencyKey, options);
  }

  async prepareLogisticsUrge(
    context: WorkflowContext,
    draft: LogisticsUrgeDraft,
  ): Promise<ToolResult<ConfirmationRequest<LogisticsUrgeDraft>>> {
    const unauthorized = requireIdentity<ConfirmationRequest<LogisticsUrgeDraft>>(context, "TMS");
    if (unauthorized) return unauthorized;
    const order = await this.oms.getOrder(draft.orderId);
    if (order.status !== "success") return order;
    if (order.data.customerId !== context.identity.customerId) {
      return businessError<ConfirmationRequest<LogisticsUrgeDraft>>("TMS", "UNAUTHORIZED", "当前演示身份无权催办该订单");
    }
    return executeMock("TMS", undefined, () => ({
      data: createConfirmation(context, "logistics_urge", { type: "shipment", id: draft.shipmentId }, draft, ["催办将同步留痕至 TMS 和 CRM"]),
    }));
  }

  async submitLogisticsUrge(
    context: WorkflowContext,
    write: ConfirmedWrite<LogisticsUrgeDraft>,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<LogisticsUrgeRecord>> {
    const invalid = validateWrite(context, write, "logistics_urge");
    if (invalid) return businessError<LogisticsUrgeRecord>("TMS", "UNAUTHORIZED", invalid);
    return this.tms.createUrge(structuredClone(write.finalSnapshot), context.sessionId, write.idempotencyKey, options);
  }

  async prepareReturnExchange(
    context: WorkflowContext,
    draft: ReturnExchangeDraft,
  ): Promise<ToolResult<ConfirmationRequest<ReturnExchangeDraft>>> {
    const unauthorized = requireIdentity<ConfirmationRequest<ReturnExchangeDraft>>(context);
    if (unauthorized) return unauthorized;
    const order = await this.oms.getOrder(draft.orderId);
    if (order.status !== "success") return order;
    if (order.data.customerId !== context.identity.customerId) {
      return businessError<ConfirmationRequest<ReturnExchangeDraft>>("CRM", "UNAUTHORIZED", "当前演示身份无权为该订单申请退换");
    }
    return executeMock("CRM", undefined, () => ({
      data: createConfirmation(context, "return_exchange_create", { type: "return_request", id: draft.orderId }, draft, ["图片仅作为可见现象记录，不自动判定责任或资格"]),
      records: [order.data],
    }));
  }

  async submitReturnExchange(
    context: WorkflowContext,
    write: ConfirmedWrite<ReturnExchangeDraft>,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ReturnExchangeRecord>> {
    const invalid = validateWrite(context, write, "return_exchange_create");
    if (invalid) return businessError<ReturnExchangeRecord>("CRM", "UNAUTHORIZED", invalid);
    return this.crm.createReturnExchange(structuredClone(write.finalSnapshot), context.sessionId, write.idempotencyKey, options);
  }

  async prepareServiceTicket(
    context: WorkflowContext,
    draft: ServiceTicketDraft,
  ): Promise<ToolResult<ConfirmationRequest<ServiceTicketDraft>>> {
    const unauthorized = requireIdentity<ConfirmationRequest<ServiceTicketDraft>>(context);
    if (unauthorized) return unauthorized;
    if (draft.riskLevel === "high") {
      return businessError<ConfirmationRequest<ServiceTicketDraft>>(
        "CRM",
        "BUSINESS_REJECTED",
        "高风险安全问题必须先进入人工接管，不生成普通工单确认",
      );
    }
    return executeMock("CRM", undefined, () => ({
      data: createConfirmation(context, "service_ticket_create", { type: "service_ticket", id: draft.product }, draft, []),
    }));
  }

  async submitServiceTicket(
    context: WorkflowContext,
    write: ConfirmedWrite<ServiceTicketDraft>,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ServiceTicketRecord>> {
    const invalid = validateWrite(context, write, "service_ticket_create");
    if (invalid) return businessError<ServiceTicketRecord>("CRM", "UNAUTHORIZED", invalid);
    if (write.finalSnapshot.riskLevel === "high") {
      return businessError<ServiceTicketRecord>("CRM", "BUSINESS_REJECTED", "高风险安全问题必须转人工处理");
    }
    return this.crm.createServiceTicket(
      context.identity.customerId,
      structuredClone(write.finalSnapshot),
      context.sessionId,
      write.idempotencyKey,
      options,
    );
  }

  async queryServiceTickets(
    context: WorkflowContext,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ServiceTicketRecord[]>> {
    const unauthorized = requireIdentity<ServiceTicketRecord[]>(context);
    if (unauthorized) return unauthorized;
    return this.crm.listServiceTickets(context.identity.customerId, options);
  }

  async escalateToHuman(
    context: WorkflowContext,
    draft: Pick<
      HumanHandoffDraft,
      "reason" | "riskLevel" | "summary" | "completedActions" | "pendingQuestions" | "relatedRecordIds"
    >,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<HumanHandoffRecord>> {
    return this.crm.createHumanHandoff(
      { ...draft, sessionId: context.sessionId, customerId: context.identity.customerId },
      options,
    );
  }
}

export const businessWorkflowService = new BusinessWorkflowService();
