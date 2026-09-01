import type {
  ConfirmationCommand,
  ConfirmationOperation,
  ConfirmationRequest,
  ToolErrorCode,
  ToolResult,
  ToolResultMetadata,
} from "@/lib/contracts";
import { businessError, executeMock } from "@/lib/adapters/mock-adapter-utils";
import { crmMockAdapter } from "@/lib/adapters/crm-mock-adapter";
import { omsMockAdapter } from "@/lib/adapters/oms-mock-adapter";
import { tmsMockAdapter } from "@/lib/adapters/tms-mock-adapter";
import { wmsMockAdapter } from "@/lib/adapters/wms-mock-adapter";
import type {
  AdapterCallOptions,
  AnyConfirmationCommand,
  BusinessWriteRecord,
  ConfirmationResolution,
  ConfirmedWrite,
  CustomerRelationshipAdapter,
  HumanHandoffDraft,
  HumanHandoffRecord,
  LogisticsUrgeDraft,
  LogisticsUrgeRecord,
  OrderCancelDraft,
  OrderCancelRecord,
  OrderChangeDraft,
  OrderChangeRecord,
  OrderLogisticsView,
  OrderManagementAdapter,
  OrderRecord,
  ResolveConfirmationOptions,
  ReturnExchangeDraft,
  ReturnExchangeRecord,
  ReturnExchangeStatusView,
  ServiceTicketDraft,
  ServiceTicketRecord,
  StoredConfirmation,
  TransportManagementAdapter,
  WarehouseManagementAdapter,
  WorkflowContext,
} from "@/lib/domain/business";
import { isOrderOperationAllowed, sourceMetadata } from "@/lib/domain/business";
import { ConfirmationStore, confirmationStore } from "@/lib/stores/business/confirmation-store";

export interface LogisticsQueryOptions {
  oms?: AdapterCallOptions;
  wms?: AdapterCallOptions;
  tms?: AdapterCallOptions;
}

type Clock = () => Date;

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

function operationSystem(operation: ConfirmationOperation): "OMS" | "TMS" | "CRM" {
  if (operation === "order_change" || operation === "order_cancel") return "OMS";
  if (operation === "logistics_urge") return "TMS";
  return "CRM";
}

function confirmationError<T>(
  system: "OMS" | "TMS" | "CRM",
  code: ToolErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolResult<T> {
  return businessError<T>(system, code, message, details);
}

function confirmationSuccess<T>(system: "OMS" | "TMS" | "CRM", data: T): ToolResult<T> {
  const requestId = `confirmation-${crypto.randomUUID()}`;
  return {
    status: "success",
    data,
    meta: {
      requestId,
      sources: [sourceMetadata(system, requestId)],
      durationMs: 0,
      attempts: 1,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(snapshot: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(snapshot).every((key) => allowed.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSnapshot(
  operation: ConfirmationOperation,
  target: ConfirmationRequest["target"],
  snapshot: unknown,
): string | null {
  if (!isObject(snapshot)) return "finalSnapshot 必须是对象";

  if (operation === "order_change") {
    if (!hasExactKeys(snapshot, ["orderId", "deliveryAddress", "contactPhone"])) return "订单变更包含未允许字段";
    if (snapshot.orderId !== target.id) return "订单变更的目标订单不可修改";
    if (!nonEmptyString(snapshot.deliveryAddress) && !nonEmptyString(snapshot.contactPhone)) return "至少需要有效地址或联系电话";
    return null;
  }

  if (operation === "order_cancel") {
    if (!hasExactKeys(snapshot, ["orderId", "reason"])) return "订单取消包含未允许字段";
    if (snapshot.orderId !== target.id) return "订单取消的目标订单不可修改";
    if (!nonEmptyString(snapshot.reason)) return "取消原因不能为空";
    return null;
  }

  if (operation === "logistics_urge") {
    if (!hasExactKeys(snapshot, ["orderId", "shipmentId", "reason"])) return "物流催办包含未允许字段";
    if (snapshot.shipmentId !== target.id) return "物流催办的目标运单不可修改";
    if (!nonEmptyString(snapshot.orderId) || !nonEmptyString(snapshot.reason)) return "物流催办缺少必填字段";
    return null;
  }

  if (operation === "return_exchange_create") {
    const fields = ["orderId", "serviceType", "product", "reason", "itemCondition", "evidence", "contactPhone", "pickupAddress"];
    if (!hasExactKeys(snapshot, fields)) return "退换申请包含未允许字段";
    if (snapshot.orderId !== target.id) return "退换申请的目标订单不可修改";
    if (snapshot.serviceType !== "return" && snapshot.serviceType !== "exchange") return "退换服务类型无效";
    if (![snapshot.product, snapshot.reason, snapshot.itemCondition, snapshot.contactPhone, snapshot.pickupAddress].every(nonEmptyString)) {
      return "退换申请缺少必填字段";
    }
    if (!Array.isArray(snapshot.evidence) || !snapshot.evidence.every(nonEmptyString)) return "退换凭证格式无效";
    return null;
  }

  const fields = ["serviceType", "product", "purchaseChannel", "issueDescription", "contactPhone", "serviceAddress", "preferredContactTime", "riskLevel"];
  if (!hasExactKeys(snapshot, fields)) return "服务工单包含未允许字段";
  if (snapshot.serviceType !== "repair" && snapshot.serviceType !== "installation") return "工单服务类型无效";
  if (snapshot.purchaseChannel !== "online" && snapshot.purchaseChannel !== "store") return "购买渠道无效";
  if (![snapshot.product, snapshot.issueDescription, snapshot.contactPhone, snapshot.serviceAddress, snapshot.preferredContactTime].every(nonEmptyString)) {
    return "服务工单缺少必填字段";
  }
  if (!(["low", "medium"] as unknown[]).includes(snapshot.riskLevel)) return "高风险问题必须转人工";
  return null;
}

export class BusinessWorkflowService {
  private readonly executions = new Map<string, Promise<ToolResult<ConfirmationResolution>>>();

  constructor(
    private readonly oms: OrderManagementAdapter = omsMockAdapter,
    private readonly wms: WarehouseManagementAdapter = wmsMockAdapter,
    private readonly tms: TransportManagementAdapter = tmsMockAdapter,
    private readonly crm: CustomerRelationshipAdapter = crmMockAdapter,
    private readonly confirmations: ConfirmationStore = confirmationStore,
    private readonly clock: Clock = () => new Date(),
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
    if (orderResult.data.customerId !== context.identity.customerId) return businessError("OMS", "UNAUTHORIZED", "当前演示身份无权访问该订单");
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

  async queryOrderOperationCandidate(
    context: WorkflowContext,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<OrderRecord>> {
    const unauthorized = requireIdentity<OrderRecord>(context, "OMS");
    if (unauthorized) return unauthorized;
    return this.oms.getLatestMutableOrder(context.identity.customerId, options);
  }

  async prepareOrderChange(context: WorkflowContext, draft: OrderChangeDraft) {
    const checked = await this.validateOrderWrite(context, draft.orderId, "change");
    if (checked) return checked as ToolResult<ConfirmationRequest<OrderChangeDraft>>;
    return this.prepare(context, "order_change", { type: "order", id: draft.orderId }, draft, ["提交后将由 OMS 处理订单变更申请"], "OMS");
  }

  async prepareOrderCancel(context: WorkflowContext, draft: OrderCancelDraft) {
    const checked = await this.validateOrderWrite(context, draft.orderId, "cancel");
    if (checked) return checked as ToolResult<ConfirmationRequest<OrderCancelDraft>>;
    return this.prepare(context, "order_cancel", { type: "order", id: draft.orderId }, draft, ["取消申请提交后将由 OMS 处理"], "OMS");
  }

  async prepareLogisticsUrge(context: WorkflowContext, draft: LogisticsUrgeDraft) {
    const unauthorized = requireIdentity<ConfirmationRequest<LogisticsUrgeDraft>>(context, "TMS");
    if (unauthorized) return unauthorized;
    const order = await this.oms.getOrder(draft.orderId);
    if (order.status !== "success") return order;
    if (order.data.customerId !== context.identity.customerId) return confirmationError<ConfirmationRequest<LogisticsUrgeDraft>>("TMS", "UNAUTHORIZED", "当前演示身份无权催办该订单");
    const shipment = await this.tms.getShipment(draft.orderId);
    if (shipment.status !== "success") return shipment;
    if (shipment.data.shipmentId !== draft.shipmentId) return confirmationError<ConfirmationRequest<LogisticsUrgeDraft>>("TMS", "NOT_FOUND", "未找到目标运单");
    return this.prepare(context, "logistics_urge", { type: "shipment", id: draft.shipmentId }, draft, ["催办将同步留痕至 TMS 和 CRM"], "TMS");
  }

  async prepareReturnExchange(context: WorkflowContext, draft: ReturnExchangeDraft) {
    const unauthorized = requireIdentity<ConfirmationRequest<ReturnExchangeDraft>>(context);
    if (unauthorized) return unauthorized;
    const order = await this.oms.getOrder(draft.orderId);
    if (order.status !== "success") return order;
    if (order.data.customerId !== context.identity.customerId) return confirmationError<ConfirmationRequest<ReturnExchangeDraft>>("CRM", "UNAUTHORIZED", "当前演示身份无权为该订单申请退换");
    return this.prepare(context, "return_exchange_create", { type: "return_request", id: draft.orderId }, draft, ["图片仅作为可见现象记录，不自动判定责任或资格"], "CRM");
  }

  async prepareServiceTicket(context: WorkflowContext, draft: ServiceTicketDraft) {
    const unauthorized = requireIdentity<ConfirmationRequest<ServiceTicketDraft>>(context);
    if (unauthorized) return unauthorized;
    if (draft.riskLevel === "high") return confirmationError<ConfirmationRequest<ServiceTicketDraft>>("CRM", "BUSINESS_REJECTED", "高风险安全问题必须先进入人工接管，不生成普通工单确认");
    return this.prepare(context, "service_ticket_create", { type: "service_ticket", id: `draft:${context.sessionId}` }, draft, [], "CRM");
  }

  async resolveConfirmation(
    context: WorkflowContext,
    command: AnyConfirmationCommand,
    options: ResolveConfirmationOptions = {},
  ): Promise<ToolResult<ConfirmationResolution>> {
    const stored = this.confirmations.get(command.confirmationRequestId);
    if (!stored) return confirmationError("CRM", "NOT_FOUND", "CONFIRMATION_NOT_FOUND");
    const system = operationSystem(stored.request.operation);
    if (stored.request.sessionId !== context.sessionId) return confirmationError(system, "UNAUTHORIZED", "CONFIRMATION_SESSION_MISMATCH");
    if (!this.confirmations.matchesToken(stored, command.confirmationToken)) return confirmationError(system, "UNAUTHORIZED", "CONFIRMATION_TOKEN_INVALID");
    if (stored.request.idempotencyKey !== command.idempotencyKey) return confirmationError(system, "CONFLICT", "CONFIRMATION_IDEMPOTENCY_MISMATCH");

    if ((stored.status === "completed" || stored.status === "failed") && stored.result) return stored.result;
    if (stored.status === "executing") {
      const executing = this.executions.get(command.confirmationRequestId);
      return executing ? executing : confirmationError(system, "CONFLICT", "CONFIRMATION_EXECUTING");
    }
    if (stored.status === "cancelled") return confirmationError(system, "CANCELLED", "CONFIRMATION_CANCELLED");
    if (stored.status === "modified") return confirmationError(system, "CONFLICT", "CONFIRMATION_REPLACED");
    if (stored.status === "expired") return confirmationError(system, "CONFLICT", "CONFIRMATION_EXPIRED");

    const now = this.clock();
    if (Date.parse(stored.request.expiresAt) <= now.getTime()) {
      this.confirmations.transition(stored.request.confirmationRequestId, "pending", "expired", {}, now.toISOString());
      return confirmationError(system, "CONFLICT", "CONFIRMATION_EXPIRED");
    }

    if (command.action === "cancel") {
      if (!this.confirmations.transition(stored.request.confirmationRequestId, "pending", "cancelled", {}, now.toISOString())) return confirmationError(system, "CONFLICT", "CONFIRMATION_STATE_CONFLICT");
      return confirmationSuccess(system, { action: "cancel", confirmationRequestId: stored.request.confirmationRequestId });
    }

    const validation = validateSnapshot(stored.request.operation, stored.request.target, command.finalSnapshot);
    if (validation) return confirmationError(system, "INVALID_INPUT", validation);
    const businessValidation = await this.recheckBusinessState(context, stored, command.finalSnapshot);
    if (businessValidation) return businessValidation;

    if (command.action === "modify") {
      const replacement = this.buildConfirmation(context, stored.request.operation, stored.request.target, command.finalSnapshot, stored.request.risks, stored.request.riskLevel);
      if (!this.confirmations.transition(
        stored.request.confirmationRequestId,
        "pending",
        "modified",
        { finalSnapshot: command.finalSnapshot, replacementRequestId: replacement.confirmationRequestId },
        now.toISOString(),
      )) return confirmationError(system, "CONFLICT", "CONFIRMATION_STATE_CONFLICT");
      this.confirmations.savePending(replacement);
      return confirmationSuccess(system, { action: "modify", confirmationRequestId: stored.request.confirmationRequestId, replacement });
    }

    if (options.signal?.aborted) {
      const aborted = confirmationError<ConfirmationResolution>(system, "CANCELLED", "CONFIRMATION_ABORTED_BEFORE_TOOL");
      this.confirmations.failBeforeExecution(stored.request.confirmationRequestId, aborted, now.toISOString());
      return aborted;
    }

    if (!this.confirmations.transition(stored.request.confirmationRequestId, "pending", "executing", { finalSnapshot: command.finalSnapshot }, now.toISOString())) {
      const concurrent = this.executions.get(stored.request.confirmationRequestId);
      return concurrent ? concurrent : confirmationError(system, "CONFLICT", "CONFIRMATION_STATE_CONFLICT");
    }
    const execution = this.executeConfirmed(stored, command.finalSnapshot, context, options.adapter);
    this.executions.set(stored.request.confirmationRequestId, execution);
    try {
      return await execution;
    } finally {
      this.executions.delete(stored.request.confirmationRequestId);
    }
  }

  async submitOrderChange(context: WorkflowContext, write: ConfirmedWrite<OrderChangeDraft>, options?: AdapterCallOptions) {
    return this.resolveLegacy<OrderChangeRecord, OrderChangeDraft>(context, write, "order_change", options);
  }

  async submitOrderCancel(context: WorkflowContext, write: ConfirmedWrite<OrderCancelDraft>, options?: AdapterCallOptions) {
    return this.resolveLegacy<OrderCancelRecord, OrderCancelDraft>(context, write, "order_cancel", options);
  }

  async submitLogisticsUrge(context: WorkflowContext, write: ConfirmedWrite<LogisticsUrgeDraft>, options?: AdapterCallOptions) {
    return this.resolveLegacy<LogisticsUrgeRecord, LogisticsUrgeDraft>(context, write, "logistics_urge", options);
  }

  async submitReturnExchange(context: WorkflowContext, write: ConfirmedWrite<ReturnExchangeDraft>, options?: AdapterCallOptions) {
    return this.resolveLegacy<ReturnExchangeRecord, ReturnExchangeDraft>(context, write, "return_exchange_create", options);
  }

  async submitServiceTicket(context: WorkflowContext, write: ConfirmedWrite<ServiceTicketDraft>, options?: AdapterCallOptions) {
    return this.resolveLegacy<ServiceTicketRecord, ServiceTicketDraft>(context, write, "service_ticket_create", options);
  }

  async queryServiceTickets(context: WorkflowContext, options?: AdapterCallOptions): Promise<ToolResult<ServiceTicketRecord[]>> {
    const unauthorized = requireIdentity<ServiceTicketRecord[]>(context);
    if (unauthorized) return unauthorized;
    return this.crm.listServiceTickets(context.identity.customerId, options);
  }

  async queryReturnExchangeStatus(
    context: WorkflowContext,
    requestNo?: string,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ReturnExchangeStatusView>> {
    const unauthorized = requireIdentity<ReturnExchangeStatusView>(context);
    if (unauthorized) return unauthorized;
    if (requestNo !== undefined && !requestNo.trim()) {
      return businessError("CRM", "INVALID_INPUT", "退换申请编号不能为空");
    }
    return this.crm.getReturnExchangeStatus(context.identity.customerId, requestNo, options);
  }

  async escalateToHuman(
    context: WorkflowContext,
    draft: Pick<HumanHandoffDraft, "reason" | "riskLevel" | "summary" | "completedActions" | "pendingQuestions" | "relatedRecordIds">,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<HumanHandoffRecord>> {
    return this.crm.createHumanHandoff({ ...draft, sessionId: context.sessionId, customerId: context.identity.customerId }, options);
  }

  private async prepare<TDraft extends Record<string, unknown>>(
    context: WorkflowContext,
    operation: ConfirmationOperation,
    target: ConfirmationRequest["target"],
    draft: TDraft,
    risks: string[],
    system: "OMS" | "TMS" | "CRM",
  ): Promise<ToolResult<ConfirmationRequest<TDraft>>> {
    const validation = validateSnapshot(operation, target, draft);
    if (validation) return confirmationError(system, "INVALID_INPUT", validation);
    return executeMock(system, undefined, () => {
      const request = this.buildConfirmation(context, operation, target, draft, risks);
      this.confirmations.savePending(request);
      return { data: request };
    });
  }

  private buildConfirmation<TDraft extends Record<string, unknown>>(
    context: WorkflowContext,
    operation: ConfirmationOperation,
    target: ConfirmationRequest["target"],
    draft: TDraft,
    risks: string[],
    riskLevel: ConfirmationRequest["riskLevel"] = risks.length > 0 ? "medium" : "low",
  ): ConfirmationRequest<TDraft> {
    const createdAt = this.clock();
    return {
      confirmationRequestId: `confirmation-${crypto.randomUUID()}`,
      sessionId: context.sessionId,
      traceId: context.traceId,
      operation,
      target: structuredClone(target),
      draftSnapshot: structuredClone(draft),
      riskLevel,
      risks: [...risks],
      confirmationToken: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
    };
  }

  private async validateOrderWrite(context: WorkflowContext, orderId: string, action: "change" | "cancel") {
    const unauthorized = requireIdentity<ConfirmationRequest>(context, "OMS");
    if (unauthorized) return unauthorized;
    const order = await this.oms.getOrder(orderId);
    if (order.status !== "success") return order;
    if (order.data.customerId !== context.identity.customerId) return confirmationError("OMS", "UNAUTHORIZED", `当前演示身份无权${action === "change" ? "变更" : "取消"}该订单`);
    if (!isOrderOperationAllowed(order.data.status)) return confirmationError("OMS", "BUSINESS_REJECTED", `订单当前状态不可${action === "change" ? "变更" : "取消"}`, { orderStatus: order.data.status });
    return null;
  }

  private async recheckBusinessState(
    context: WorkflowContext,
    stored: StoredConfirmation,
    snapshot: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult<ConfirmationResolution> | null> {
    const operation = stored.request.operation;
    const system = operationSystem(operation);
    const unauthorized = requireIdentity<ConfirmationResolution>(context, system);
    if (unauthorized) return unauthorized;
    if (operation === "service_ticket_create") return null;
    const orderId = String(snapshot.orderId);
    const order = await this.oms.getOrder(orderId);
    if (order.status !== "success") return order;
    if (order.data.customerId !== context.identity.customerId) return confirmationError(system, "UNAUTHORIZED", "当前演示身份无权执行该操作");
    if ((operation === "order_change" || operation === "order_cancel") && !isOrderOperationAllowed(order.data.status)) {
      return confirmationError(system, "BUSINESS_REJECTED", "订单状态已变化，请重新准备确认", { orderStatus: order.data.status });
    }
    if (operation === "logistics_urge") {
      const shipment = await this.tms.getShipment(orderId);
      if (shipment.status !== "success") return shipment;
      if (shipment.data.shipmentId !== snapshot.shipmentId) return confirmationError(system, "NOT_FOUND", "目标运单不存在");
    }
    return null;
  }

  private async executeConfirmed(
    stored: StoredConfirmation,
    snapshot: Readonly<Record<string, unknown>>,
    context: WorkflowContext,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ConfirmationResolution>> {
    const { operation, confirmationRequestId, idempotencyKey } = stored.request;
    let result: ToolResult<BusinessWriteRecord>;
    try {
      if (operation === "order_change") {
        result = await this.oms.createOrderChange(structuredClone(snapshot) as OrderChangeDraft, context.sessionId, idempotencyKey, options);
      } else if (operation === "order_cancel") {
        result = await this.oms.cancelOrder(structuredClone(snapshot) as OrderCancelDraft, context.sessionId, idempotencyKey, options);
      } else if (operation === "logistics_urge") {
        result = await this.tms.createUrge(structuredClone(snapshot) as LogisticsUrgeDraft, context.sessionId, idempotencyKey, options);
      } else if (operation === "return_exchange_create") {
        result = await this.crm.createReturnExchange(structuredClone(snapshot) as ReturnExchangeDraft, context.sessionId, idempotencyKey, options);
      } else {
        result = await this.crm.createServiceTicket(context.identity.customerId, structuredClone(snapshot) as ServiceTicketDraft, context.sessionId, idempotencyKey, options);
      }
    } catch {
      result = await executeMock<BusinessWriteRecord>(operationSystem(operation), { outcome: "system_error" }, () => null);
    }
    const resolution: ToolResult<ConfirmationResolution> = result.status === "success"
      ? { status: "success", data: { action: "confirm", confirmationRequestId, operation, record: result.data }, meta: result.meta }
      : result;
    this.confirmations.finish(confirmationRequestId, resolution, this.clock().toISOString());
    return resolution;
  }

  private async resolveLegacy<TRecord extends BusinessWriteRecord, TDraft extends Record<string, unknown>>(
    context: WorkflowContext,
    write: ConfirmedWrite<TDraft>,
    expectedOperation: ConfirmationOperation,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<TRecord>> {
    const stored = this.confirmations.get(write.request.confirmationRequestId);
    const system = stored ? operationSystem(stored.request.operation) : operationSystem(expectedOperation);
    if (!stored) return confirmationError(system, "NOT_FOUND", "CONFIRMATION_NOT_FOUND");
    if (stored.request.operation !== expectedOperation) return confirmationError(system, "CONFLICT", "CONFIRMATION_OPERATION_MISMATCH");
    if (write.request.idempotencyKey !== write.idempotencyKey) return confirmationError(system, "CONFLICT", "CONFIRMATION_IDEMPOTENCY_MISMATCH");
    if (stored.request.idempotencyKey !== write.idempotencyKey && !this.confirmations.adoptLegacyIdempotencyKey(
      stored.request.confirmationRequestId,
      stored.request.idempotencyKey,
      write.idempotencyKey,
      this.clock().toISOString(),
    )) return confirmationError(system, "CONFLICT", "CONFIRMATION_IDEMPOTENCY_MISMATCH");
    const command: ConfirmationCommand<Record<string, unknown>> = {
      confirmationRequestId: write.request.confirmationRequestId,
      confirmationToken: write.confirmationToken,
      idempotencyKey: write.idempotencyKey,
      action: "confirm",
      finalSnapshot: write.finalSnapshot,
    };
    const result = await this.resolveConfirmation(context, command, { adapter: options });
    if (result.status !== "success") return result;
    if (result.data.action !== "confirm") return confirmationError(system, "CONFLICT", "CONFIRMATION_NOT_CONFIRMED");
    return { status: "success", data: result.data.record as TRecord, meta: result.meta };
  }
}

export const businessWorkflowService = new BusinessWorkflowService();
