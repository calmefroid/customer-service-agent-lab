import { getLatestOrder } from "@/lib/adapters/order-mock-adapter";
import {
  findKnowledge,
  knowledgeSandbox,
  retrieveKnowledgeByQuery,
  searchKnowledge,
} from "@/lib/adapters/knowledge-mock-adapter";
import { omsMockAdapter } from "@/lib/adapters/oms-mock-adapter";
import { queryProductKnowledge } from "@/lib/adapters/product-mock-adapter";
import { getLatestServiceTicket } from "@/lib/adapters/service-mock-adapter";
import { tmsMockAdapter } from "@/lib/adapters/tms-mock-adapter";
import type {
  ChatRequest,
  ChatResponse,
  ConfirmationDecision,
  ConfirmationOperation,
  ConfirmationRequest,
  DataSourceMetadata,
  Intent,
  RiskLevel,
  RouteDecision,
  ToolResult,
  TraceDebugContext,
  TraceStage,
  TraceSource,
} from "@/lib/contracts";
import type {
  BusinessWriteRecord,
  ConfirmationResolution,
  ConfirmedWrite,
  LogisticsUrgeDraft,
  OrderCancelDraft,
  OrderChangeDraft,
  ReturnExchangeDraft,
  ServiceTicketDraft,
  WorkflowContext,
} from "@/lib/domain/business";
import type { AdapterCallOptions } from "@/lib/domain/business";
import { businessWorkflowService } from "@/lib/domain/business-workflow";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import { AgentWorkflowError } from "@/lib/orchestration/workflow-error";
import { confirmationStore } from "@/lib/stores/business/confirmation-store";
import { appendTrace, createTraceWriter } from "@/lib/trace-store";

const safetyPattern = /冒烟|烧焦|触电|火花|异常发热|明显过热|漏电|起火/;
const requestedHumanPattern = /转人工|人工客服|找客服|真人客服|人工处理/;
const disputePattern = /赔偿|判责|谁的责任|投诉|消协|必须赔|资格争议|拒绝处理/;

type InjectedToolOutcome = Exclude<AdapterCallOptions["outcome"], undefined>;

export interface MockOrchestrationOptions {
  traceId?: string;
  route?: RouteDecision;
  signal?: AbortSignal;
  toolOutcomes?: {
    latestOrder?: InjectedToolOutcome;
    shipment?: InjectedToolOutcome;
    returnExchange?: InjectedToolOutcome;
    serviceTicket?: InjectedToolOutcome;
  };
}

const routeOverrides = new WeakMap<ChatRequest, RouteDecision>();
const traceIdOverrides = new WeakMap<ChatRequest, string>();

function requiredTraceId(request: ChatRequest): string {
  const traceId = traceIdOverrides.get(request);
  if (!traceId) throw new Error("TRACE_ID_NOT_INITIALIZED");
  return traceId;
}

function workflowContext(request: ChatRequest): WorkflowContext {
  return {
    sessionId: request.sessionId,
    traceId: requiredTraceId(request),
    identity: { customerId: DEMO_CUSTOMER_ID, verified: true },
  };
}

function appendConfirmationTrace<TDraft extends Record<string, unknown>>(
  request: ChatRequest,
  confirmation: ConfirmationRequest<TDraft>,
  status: "started" | "completed" | "failed",
  decision?: ConfirmationDecision<TDraft>,
): void {
  createTraceWriter(requiredTraceId(request), request.sessionId).append({
    type: "confirmation",
    status,
    payload: { request: confirmation, ...(decision ? { decision } : {}) },
  });
}

function confirmedWrite<TDraft extends Record<string, unknown>>(
  request: ChatRequest,
  confirmation: ConfirmationRequest<TDraft>,
  finalSnapshot: TDraft,
): ConfirmedWrite<TDraft> {
  const idempotencyKey = `compat:${request.sessionId}:${confirmation.operation}`;
  const normalizedConfirmation = { ...confirmation, idempotencyKey };
  return {
    request: normalizedConfirmation,
    confirmationToken: normalizedConfirmation.confirmationToken,
    idempotencyKey,
    finalSnapshot,
  };
}

function traceSources(sources: DataSourceMetadata[]): TraceSource[] {
  return sources.map((source) => ({
    type: "business",
    sourceSystem: source.sourceSystem,
    recordId: source.recordId ?? source.requestId,
    updatedAt: source.sourceUpdatedAt,
  }));
}

function toolFailure(result: { error: { code: string; message: string } }): never {
  throw new Error(`${result.error.code}: ${result.error.message}`);
}

function confirmationIntent(operation: ConfirmationOperation): Intent {
  if (operation === "logistics_urge" || operation === "order_change" || operation === "order_cancel") return "logistics_query";
  if (operation === "return_exchange_create") return "return_exchange";
  if (operation === "service_ticket_create") return "service_ticket_create";
  return "other";
}

function confirmationRoute(operation: ConfirmationOperation, action: "confirm" | "modify" | "cancel"): RouteDecision {
  const intent = confirmationIntent(operation);
  const module: RouteDecision["module"] = operation === "logistics_urge"
    ? "logistics"
    : operation === "order_change" || operation === "order_cancel"
      ? "logistics"
    : operation === "return_exchange_create"
      ? "return"
      : operation === "service_ticket_create" ? "repair" : "conversation";
  return {
    module,
    intent,
    topic: operation === "logistics_urge"
      ? "logistics.urge"
      : operation === "return_exchange_create"
        ? "return.request"
        : operation === "service_ticket_create"
          ? "after_sales.repair_process"
          : operation === "order_cancel" ? "order.cancel" : "order.change",
    action: `resolve_confirmation:${action}`,
    confidence: 1,
    needsClarification: false,
    requiresConfirmation: action === "modify",
    requiresHuman: false,
    remainingIntents: [],
    entities: { orderId: null, productId: null, serviceType: null },
    observations: [],
  };
}

function publicConfirmationError(
  result: Exclude<ToolResult<ConfirmationResolution>, { status: "success" }>,
  signal?: AbortSignal,
): AgentWorkflowError {
  if (signal?.aborted || result.error.code === "CANCELLED" && result.error.message === "CONFIRMATION_ABORTED_BEFORE_TOOL") {
    return new AgentWorkflowError({ code: "GENERATION_STOPPED", message: "已停止生成", retryable: false }, result.error.message);
  }
  const internalCode = /^CONFIRMATION_[A-Z_]+$/.test(result.error.message)
    ? result.error.message
    : result.error.code;
  const messages: Record<string, string> = {
    CONFIRMATION_EXPIRED: "确认草稿已过期，请重新生成后再提交",
    CONFIRMATION_NOT_FOUND: "确认草稿不存在或已清理，请重新生成",
    CONFIRMATION_REPLACED: "该确认草稿已被修改，请使用最新草稿",
    CONFIRMATION_CANCELLED: "该确认草稿已经取消",
    CONFIRMATION_TOKEN_INVALID: "确认凭证无效，请重新生成确认草稿",
    CONFIRMATION_SESSION_MISMATCH: "确认草稿不属于当前会话",
    CONFIRMATION_IDEMPOTENCY_MISMATCH: "确认请求校验失败，请使用原确认卡重试",
  };
  return new AgentWorkflowError({
    code: internalCode,
    message: messages[internalCode] ?? result.error.message,
    retryable: result.error.retryable,
  }, internalCode);
}

function publicToolError(
  result: { error: { code: string; message: string; retryable: boolean } },
  fallbackMessage: string,
): AgentWorkflowError {
  const messages: Record<string, string> = {
    EMPTY_RESULT: fallbackMessage,
    TIMEOUT: "业务系统暂时没有响应，请稍后重试。",
    BUSINESS_REJECTED: result.error.message,
    INVALID_INPUT: result.error.message,
    NOT_FOUND: fallbackMessage,
    UNAUTHORIZED: "当前账号无权查看或操作这条记录。",
    SYSTEM_FAILURE: "业务系统暂时不可用，请稍后重试。",
    CANCELLED: "已停止生成。",
  };
  return new AgentWorkflowError({
    code: result.error.code,
    message: messages[result.error.code] ?? fallbackMessage,
    retryable: result.error.retryable,
  }, result.error.code);
}

function traceableStoredRequest(confirmationRequestId: string): ConfirmationRequest | undefined {
  const stored = confirmationStore.get(confirmationRequestId);
  return stored ? { ...stored.request, confirmationToken: "***" } : undefined;
}

async function submitIntegratedLogisticsUrge(request: ChatRequest) {
  const context = workflowContext(request);
  const draft: LogisticsUrgeDraft = {
    orderId: "OD202608180236",
    shipmentId: "SHIP-SF14900000628",
    reason: "用户确认一键催办",
  };
  const prepared = await businessWorkflowService.prepareLogisticsUrge(context, draft);
  if (prepared.status !== "success") return toolFailure(prepared);
  const write = confirmedWrite(request, prepared.data, draft);
  appendConfirmationTrace(request, write.request, "started");
  const result = await businessWorkflowService.submitLogisticsUrge(
    context,
    write,
  );
  if (result.status !== "success") {
    appendConfirmationTrace(request, write.request, "failed");
    return toolFailure(result);
  }
  appendConfirmationTrace(request, write.request, "completed", {
    confirmationRequestId: write.request.confirmationRequestId,
    action: "confirm",
    finalSnapshot: draft,
    decidedAt: new Date().toISOString(),
  });
  return { requestNo: result.data.urgeRequestNo, sources: traceSources(result.meta.sources) };
}

async function submitIntegratedReturn(request: ChatRequest, outcome?: InjectedToolOutcome) {
  const form = request.formData;
  if (!form) throw new Error("INVALID_INPUT: 缺少退换申请字段");
  const context = workflowContext(request);
  const draft: ReturnExchangeDraft = {
    orderId: "OD202608180236",
    serviceType: form.serviceType === "退货" ? "return" : "exchange",
    product: form.product,
    reason: form.issueDescription,
    itemCondition: "消费者描述到货破损，待人工审核",
    evidence: ["消费者已提供图片或文字说明"],
    contactPhone: form.contactPhone,
    pickupAddress: form.pickupAddress,
  };
  const prepared = await businessWorkflowService.prepareReturnExchange(context, draft);
  if (prepared.status !== "success") return toolFailure(prepared);
  const write = confirmedWrite(request, prepared.data, draft);
  appendConfirmationTrace(request, write.request, "started");
  const result = await businessWorkflowService.submitReturnExchange(
    context,
    write,
    outcome ? { outcome } : undefined,
  );
  if (result.status !== "success") {
    appendConfirmationTrace(request, write.request, "failed");
    return toolFailure(result);
  }
  appendConfirmationTrace(request, write.request, "completed", {
    confirmationRequestId: write.request.confirmationRequestId,
    action: "confirm",
    finalSnapshot: draft,
    decidedAt: new Date().toISOString(),
  });
  return { requestNo: result.data.requestNo, sources: traceSources(result.meta.sources) };
}

async function submitIntegratedServiceTicket(request: ChatRequest, outcome?: InjectedToolOutcome) {
  const form = request.serviceFormData;
  if (!form) throw new Error("INVALID_INPUT: 缺少售后工单字段");
  const context = workflowContext(request);
  const draft: ServiceTicketDraft = {
    serviceType: form.serviceType === "安装服务" ? "installation" : "repair",
    product: form.product,
    purchaseChannel: form.purchaseChannel === "线上商城" ? "online" : "store",
    issueDescription: form.faultDescription,
    contactPhone: form.contactPhone,
    serviceAddress: form.serviceAddress,
    preferredContactTime: form.preferredContactTime,
    riskLevel: "low",
  };
  const prepared = await businessWorkflowService.prepareServiceTicket(context, draft);
  if (prepared.status !== "success") return toolFailure(prepared);
  const write = confirmedWrite(request, prepared.data, draft);
  appendConfirmationTrace(request, write.request, "started");
  const result = await businessWorkflowService.submitServiceTicket(
    context,
    write,
    outcome ? { outcome } : undefined,
  );
  if (result.status !== "success") {
    appendConfirmationTrace(request, write.request, "failed");
    return toolFailure(result);
  }
  appendConfirmationTrace(request, write.request, "completed", {
    confirmationRequestId: write.request.confirmationRequestId,
    action: "confirm",
    finalSnapshot: draft,
    decidedAt: new Date().toISOString(),
  });
  return { ticketNo: result.data.ticketNo, sources: traceSources(result.meta.sources) };
}

async function prepareIntegratedLogisticsUrge(request: ChatRequest) {
  const draft: LogisticsUrgeDraft = {
    orderId: "OD202608180236",
    shipmentId: "SHIP-SF14900000628",
    reason: "物流轨迹长时间未更新",
  };
  const result = await businessWorkflowService.prepareLogisticsUrge(workflowContext(request), draft);
  if (result.status !== "success") throw publicConfirmationError(result);
  appendConfirmationTrace(request, result.data, "started");
  return result;
}

async function prepareIntegratedReturn(request: ChatRequest) {
  const draft: ReturnExchangeDraft = {
    orderId: "OD202608100119",
    serviceType: "exchange",
    product: "智控系列吸顶灯 ZC80",
    reason: "灯罩边缘破裂（待人工复核）",
    itemCondition: "可见裂纹，未通电，责任与资格待人工审核",
    evidence: [request.attachment?.name ?? "消费者文字说明"],
    contactPhone: "138****8001",
    pickupAddress: "上海市浦东新区 XX 路 XX 号",
  };
  const result = await businessWorkflowService.prepareReturnExchange(workflowContext(request), draft);
  if (result.status !== "success") throw publicConfirmationError(result);
  appendConfirmationTrace(request, result.data, "started");
  return result;
}

async function prepareIntegratedServiceTicket(
  request: ChatRequest,
  serviceType: "repair" | "installation",
  issueDescription: string,
) {
  const draft: ServiceTicketDraft = {
    serviceType,
    product: "悦享系列 LED 吸顶灯",
    purchaseChannel: "online",
    issueDescription,
    contactPhone: "138****8001",
    serviceAddress: "上海市浦东新区 XX 路 XX 号",
    preferredContactTime: "工作日 09:00–18:00",
    riskLevel: "low",
  };
  const result = await businessWorkflowService.prepareServiceTicket(workflowContext(request), draft);
  if (result.status !== "success") throw publicConfirmationError(result);
  appendConfirmationTrace(request, result.data, "started");
  return result;
}

async function prepareIntegratedOrderOperation(
  request: ChatRequest,
  operation: "order_change" | "order_cancel",
) {
  const context = workflowContext(request);
  const candidate = await businessWorkflowService.queryOrderOperationCandidate(context);
  if (candidate.status !== "success") {
    throw publicToolError(candidate, "当前账号下没有可变更或取消的订单。请检查订单状态后再试。");
  }
  const draft: OrderChangeDraft | OrderCancelDraft = operation === "order_change"
    ? {
        orderId: candidate.data.orderId,
        deliveryAddress: candidate.data.deliveryAddress,
        contactPhone: candidate.data.contactPhone,
      }
    : {
        orderId: candidate.data.orderId,
        reason: "用户申请取消订单",
      };
  const prepared = operation === "order_change"
    ? await businessWorkflowService.prepareOrderChange(context, draft as OrderChangeDraft)
    : await businessWorkflowService.prepareOrderCancel(context, draft as OrderCancelDraft);
  if (prepared.status !== "success") {
    throw publicToolError(prepared, "当前订单状态不支持这项操作。请刷新订单后再试。");
  }
  appendConfirmationTrace(request, prepared.data as ConfirmationRequest, "started");
  return {
    confirmation: prepared.data,
    order: candidate.data,
    sources: traceSources(candidate.meta.sources),
  };
}

async function queryIntegratedReturnStatus(request: ChatRequest) {
  const result = await businessWorkflowService.queryReturnExchangeStatus(workflowContext(request));
  if (result.status !== "success") {
    throw publicToolError(result, "当前账号下还没有可查询的退换申请。完成申请后可在这里查看进度。");
  }
  return {
    request: {
      requestNo: result.data.requestNo,
      orderId: result.data.orderId,
      serviceType: result.data.serviceType === "return" ? "退货" as const : "换货" as const,
      product: result.data.product,
      status: result.data.status,
      updatedAt: result.data.updatedAt,
      events: result.data.events.map((event, index, events) => ({
        time: event.occurredAt,
        text: event.description,
        ...(index === events.length - 1 ? { active: true } : {}),
      })),
    },
    sources: traceSources(result.meta.sources),
  };
}

function confirmationRecordUi(operation: ConfirmationOperation, record: BusinessWriteRecord): ChatResponse["ui"] {
  if (operation === "logistics_urge" && typeof record.urgeRequestNo === "string") {
    return {
      kind: "logistics_urge_success",
      requestNo: record.urgeRequestNo,
      carrier: "顺丰速运",
      handoff: "物流平台 + 人工客服",
    };
  }
  if (operation === "return_exchange_create" && typeof record.requestNo === "string") {
    return { kind: "return_success", requestNo: record.requestNo };
  }
  if (operation === "service_ticket_create" && typeof record.ticketNo === "string") {
    return {
      kind: "service_ticket_success",
      ticketNo: record.ticketNo,
      serviceType: record.serviceType === "installation" ? "安装服务" : "维修服务",
    };
  }
  if (
    operation === "order_change"
    && typeof record.changeRequestNo === "string"
    && typeof record.orderId === "string"
    && typeof record.status === "string"
  ) {
    return {
      kind: "order_operation_success",
      result: {
        operation,
        orderId: record.orderId,
        requestNo: record.changeRequestNo,
        status: record.status,
      },
    };
  }
  if (
    operation === "order_cancel"
    && typeof record.cancelRequestNo === "string"
    && typeof record.orderId === "string"
    && typeof record.status === "string"
  ) {
    return {
      kind: "order_operation_success",
      result: {
        operation,
        orderId: record.orderId,
        requestNo: record.cancelRequestNo,
        status: record.status,
      },
    };
  }
  return undefined;
}

function confirmationSuccessMessage(operation: ConfirmationOperation, record: BusinessWriteRecord): string {
  if (operation === "logistics_urge" && "urgeRequestNo" in record) return `物流催办已提交，催办编号 ${record.urgeRequestNo}。`;
  if (operation === "return_exchange_create" && "requestNo" in record) return `退换申请已提交，申请编号 ${record.requestNo}。`;
  if (operation === "service_ticket_create" && "ticketNo" in record) return `${record.serviceType === "installation" ? "安装" : "维修"}工单已提交，工单编号 ${record.ticketNo}。`;
  if (operation === "order_change" && "changeRequestNo" in record) return `订单变更申请已提交，申请编号 ${record.changeRequestNo}。`;
  if (operation === "order_cancel" && "cancelRequestNo" in record) return `订单取消申请已提交，申请编号 ${record.cancelRequestNo}。`;
  return "写操作已确认并提交。";
}

async function resolveIntegratedConfirmation(
  request: ChatRequest & { confirmation: NonNullable<ChatRequest["confirmation"]> },
  options: MockOrchestrationOptions,
): Promise<ChatResponse> {
  const storedBefore = confirmationStore.get(request.confirmation.confirmationRequestId);
  const operation = storedBefore?.request.operation;
  const traceRequest = traceableStoredRequest(request.confirmation.confirmationRequestId);
  if (traceRequest) appendConfirmationTrace(request, traceRequest, "started");

  const result = await businessWorkflowService.resolveConfirmation(
    workflowContext(request),
    request.confirmation,
    { signal: options.signal },
  );
  if (result.status !== "success") {
    if (traceRequest) {
      appendConfirmationTrace(request, traceRequest, "failed", {
        confirmationRequestId: request.confirmation.confirmationRequestId,
        action: request.confirmation.action,
        ...(request.confirmation.action === "cancel" ? {} : { finalSnapshot: request.confirmation.finalSnapshot }),
        decidedAt: new Date().toISOString(),
      });
    }
    throw publicConfirmationError(result, options.signal);
  }

  const resolvedOperation = result.data.action === "confirm" ? result.data.operation : operation;
  if (!resolvedOperation) {
    throw new AgentWorkflowError({ code: "CONFIRMATION_NOT_FOUND", message: "确认草稿不存在或已清理，请重新生成", retryable: false });
  }
  routeOverrides.set(request, confirmationRoute(resolvedOperation, result.data.action));
  if (traceRequest) {
    appendConfirmationTrace(request, traceRequest, "completed", {
      confirmationRequestId: request.confirmation.confirmationRequestId,
      action: request.confirmation.action,
      ...(request.confirmation.action === "cancel" ? {} : { finalSnapshot: request.confirmation.finalSnapshot }),
      decidedAt: new Date().toISOString(),
    });
  }

  if (result.data.action === "modify") {
    appendConfirmationTrace(request, result.data.replacement, "started");
    const message = "修改已保存，请确认最新草稿后再提交。";
    return {
      message,
      intent: confirmationIntent(resolvedOperation),
      riskLevel: "medium",
      traceId: createTrace(request, confirmationIntent(resolvedOperation), "medium", message, ["校验原确认请求", "保存最终修改", "签发新确认请求"], traceSources(result.meta.sources)),
      ui: { kind: "confirmation", request: result.data.replacement },
    };
  }

  if (result.data.action === "cancel") {
    const message = "已取消本次操作，没有写入任何业务记录。";
    return {
      message,
      intent: confirmationIntent(resolvedOperation),
      riskLevel: "medium",
      traceId: createTrace(request, confirmationIntent(resolvedOperation), "medium", message, ["校验确认请求", "取消待确认操作", "保持业务数据不变"], []),
    };
  }

  const message = confirmationSuccessMessage(result.data.operation, result.data.record);
  const recordId = result.data.record.recordId;
  return {
    message,
    intent: confirmationIntent(result.data.operation),
    riskLevel: "medium",
    traceId: createTrace(
      request,
      confirmationIntent(result.data.operation),
      "medium",
      message,
      ["校验服务端确认请求", "执行一次写工具", "返回业务编号"],
      traceSources(result.meta.sources),
      [
        decisionStage("confirmation", "校验正式确认协议", `服务端按 ${request.confirmation.confirmationRequestId} 解析 operation 并完成令牌、幂等与快照校验。`, 12, "guardrail"),
        toolStage("write", "执行确认后的业务写入", `写工具成功返回业务记录 ${recordId}。`, result.meta.durationMs, {
          system: result.data.record.sourceSystem,
          toolName: `resolve_${result.data.operation}`,
          operation: result.data.operation,
          method: "POST",
          endpoint: "/internal/confirmation/resolve",
          input: { confirmation_request_id: request.confirmation.confirmationRequestId, operation_source: "server_store" },
          output: { outcome: "success", record_id: recordId },
          statusCode: 201,
        }),
        decisionStage("output", "返回确认结果", message, 8, "output"),
      ],
    ),
    ...(confirmationRecordUi(result.data.operation, result.data.record)
      ? { ui: confirmationRecordUi(result.data.operation, result.data.record) }
      : {}),
  };
}

async function submitIntegratedHandoff(
  request: ChatRequest,
  reason: "safety" | "requested" | "dispute",
  riskLevel: RiskLevel,
  summary: string,
) {
  const result = await businessWorkflowService.escalateToHuman(workflowContext(request), {
    reason,
    riskLevel,
    summary,
    completedActions: reason === "safety" ? ["已发送断电与停止使用提示"] : ["已生成脱敏会话摘要"],
    pendingQuestions: [],
    relatedRecordIds: [],
  });
  if (result.status !== "success") return toolFailure(result);
  return { handoffNo: result.data.handoffNo, sources: traceSources(result.meta.sources) };
}

const MOCK_ROUTER_SYSTEM_PROMPT = `你是灯具品牌售后客服 Agent 的意图路由器。
你必须输出符合 JSON Schema 的结构化结果，不直接执行工具。
优先级：确定性动作 > 用电安全 > 主动转人工或争议 > 写操作 > 查询与知识咨询 > 闲聊 > 澄清 > 兜底。
消费者首页只有订单物流、退换与破损、故障报修三个入口；产品知识、售后政策、配网、安装指导和消费者渠道问题可进入后台隐藏知识路由。
图片只作为观察输入，不自动判责、认定退换资格或决定赔偿。
当关键信息不足时只提出一个澄清问题。`;

function detectIntent(message: string, request: ChatRequest): Intent {
  if (request.action === "submit_return") return "return_exchange";
  if (request.action === "select_repair") return "troubleshooting";
  if (
    request.action === "prepare_service_ticket" ||
    request.action === "submit_service_ticket"
  ) return "service_ticket_create";
  if (request.action === "confirm_service_identity") return "service_ticket_query";
  if (
    request.action === "confirm_identity" ||
    request.action === "prepare_logistics_urge" ||
    request.action === "submit_logistics_urge" ||
    request.action === "prepare_order_change" ||
    request.action === "prepare_order_cancel"
  ) return "logistics_query";
  if (request.action === "confirm_return_identity") return "return_exchange";
  if (safetyPattern.test(message) || requestedHumanPattern.test(message) || disputePattern.test(message)) return "human_escalation";
  if (/^(你好|您好|在吗|谢谢|感谢|辛苦了|再见)[！!。,.， ]*$/.test(message.trim())) return "smalltalk";
  if (request.attachment && request.module !== "repair") return "return_exchange";
  if (/报修进度|服务进度|工单进度|报修到哪|维修到哪|安装预约到哪/.test(message)) return "service_ticket_query";
  if (/预约.*安装|上门安装|安装师傅/.test(message)) return "service_ticket_create";
  if (/退货申请|换货申请|退换申请/.test(message) && /进度|状态|到哪|处理/.test(message)) return "return_exchange";
  if (/取消.*订单|订单.*取消|订单.*地址|收货地址/.test(message)) return "logistics_query";
  if (/物流|到哪|发货|快递|订单/.test(message)) return "logistics_query";
  if (/破|碎|退货|换货|少件|错发/.test(message)) return "return_exchange";
  if (/配网|连不上|搜不到设备|绑定不了|语音控制|小爱|小度|天猫精灵/.test(message)) return "troubleshooting";
  if (/闪烁|一直闪|不亮|遥控|故障|报修|异响|嗡嗡/.test(message)) return "troubleshooting";
  if (/质保|保修|收费|过保|换新政策|配件购买|售后流程|怎么售后/.test(message)) return "knowledge_query";
  if (/安装视频|安装方法|怎么安装|拆卸|怎么拆|接线/.test(message)) return "knowledge_query";
  if (/型号|参数|单电机|双电机|WIFI|WiFi|wifi|功能|认证|许可证|适合多大|多少平米|怎么选灯/.test(message)) return "knowledge_query";
  if (/门店|购买渠道|哪里买|验真|真伪|客服电话|企业资质|公司介绍/.test(message)) return "knowledge_query";
  if (/这个怎么处理|帮我弄一下|还是不行|怎么办[？?]?$/.test(message.trim())) return "clarification";
  if (request.module === "logistics") return "logistics_query";
  if (request.module === "return") return "return_exchange";
  if (request.module === "repair") return "troubleshooting";
  return "other";
}

function buildRouteDecision(request: ChatRequest, intent: Intent): RouteDecision {
  const message = request.message;
  const isSafety = safetyPattern.test(message);
  const isInstallation = /安装/.test(message) || request.serviceFormData?.serviceType === "安装服务";
  const isSmartSetup = /配网|连不上|搜不到设备|绑定不了|语音控制|小爱|小度|天猫精灵/.test(message);
  const isWarranty = /质保|保修|收费|过保|换新政策|配件购买|售后流程|怎么售后/.test(message);
  const isInstallationGuide = /安装视频|安装方法|怎么安装|拆卸|怎么拆|接线/.test(message);
  const isConsumerBusiness = /门店|购买渠道|哪里买|验真|真伪|客服电话|企业资质|公司介绍/.test(message);
  const isNonConsumerBusiness = /加盟|代理|供应商|市场活动|促销活动/.test(message);

  let module: RouteDecision["module"] = request.module ?? "conversation";
  let topic = "conversation.unclassified";
  let action = "respond";
  let needsClarification = intent === "clarification";
  let requiresConfirmation = false;
  let requiresHuman = intent === "human_escalation";
  const observations = request.attachment ? [`image:${request.attachment.type}`, "visible_issue_pending_or_extracted"] : [];

  if (intent === "logistics_query") {
    module = "logistics";
    const orderCancel = request.action === "prepare_order_cancel" || /取消.*订单|订单.*取消/.test(message);
    const orderChange = request.action === "prepare_order_change" || /订单.*地址|收货地址/.test(message);
    topic = orderCancel
      ? "order.cancel"
      : orderChange
        ? "order.change"
        : request.action?.includes("urge") || /催/.test(message) ? "logistics.urge" : /电话|联系/.test(message) ? "logistics.contact" : "logistics.status";
    action = request.action
      ?? (orderCancel
        ? "confirm_identity_then_prepare_order_cancel"
        : orderChange ? "confirm_identity_then_prepare_order_change" : "confirm_identity_then_query");
    requiresConfirmation = request.action === "submit_logistics_urge"
      || request.action === "prepare_logistics_urge"
      || orderCancel
      || orderChange;
  } else if (intent === "return_exchange") {
    module = "return";
    const returnStatus = request.action === "confirm_return_identity"
      || /退货申请|换货申请|退换申请/.test(message) && /进度|状态|到哪|处理/.test(message);
    topic = returnStatus ? "return.status" : request.attachment ? "return.arrival_damage" : /少件/.test(message) ? "return.missing_item" : /错发/.test(message) ? "return.wrong_item" : "return.request";
    action = request.action ?? (returnStatus ? "confirm_identity_then_query_return" : request.attachment ? "analyze_image_then_prepare_return" : "collect_return_information");
    requiresConfirmation = request.action === "submit_return";
  } else if (intent === "troubleshooting") {
    module = "repair";
    topic = isSmartSetup ? "smart_setup.setup_failure" : /不亮/.test(message) ? "fault.not_lit" : /遥控/.test(message) ? "fault.remote_switch" : /异响|嗡嗡/.test(message) ? "fault.noise_odor" : "fault.flicker_color_change";
    action = request.action ?? (isSmartSetup ? "retrieve_kb_then_diagnose" : "safety_check_then_troubleshoot");
  } else if (intent === "service_ticket_create") {
    module = "repair";
    topic = isInstallation ? "installation.appointment" : "after_sales.repair_process";
    action = request.action ?? "prepare_service_ticket";
    requiresConfirmation = true;
  } else if (intent === "service_ticket_query") {
    module = "repair";
    topic = isInstallation ? "installation.appointment" : "after_sales.ticket_status";
    action = request.action ?? "confirm_identity_then_query_ticket";
  } else if (intent === "knowledge_query") {
    module = "knowledge";
    topic = isWarranty ? "after_sales.warranty" : isInstallationGuide ? "installation.guide" : isConsumerBusiness ? "business.consumer_channel" : /参数|单电机|双电机/.test(message) ? "product.specification" : /WIFI|WiFi|wifi|功能/.test(message) ? "product.function_usage" : "product.model_overview";
    action = topic.startsWith("product") ? "query_pcmp_then_rag" : "retrieve_published_knowledge";
  } else if (intent === "human_escalation") {
    module = "handoff";
    topic = isSafety ? "safety.electrical" : disputePattern.test(message) ? "handoff.dispute" : "handoff.requested";
    action = isSafety ? "safety_instruction_then_escalate" : "summarize_then_escalate";
  } else if (intent === "smalltalk") {
    module = "conversation";
    topic = "conversation.greeting";
  } else if (intent === "clarification") {
    module = request.module ?? "conversation";
    topic = "conversation.missing_context";
    action = "ask_one_clarifying_question";
  } else if (isNonConsumerBusiness) {
    module = "conversation";
    topic = /供应商/.test(message) ? "business.supplier" : "business.franchise_marketing";
    action = "provide_official_channel_guidance";
  }

  return {
    module,
    intent,
    topic,
    action,
    confidence: needsClarification ? 0.54 : intent === "other" ? 0.62 : 0.94,
    needsClarification,
    requiresConfirmation,
    requiresHuman,
    remainingIntents: [],
    entities: {
      orderId: null,
      productId: null,
      serviceType: isInstallation ? "installation" : intent === "service_ticket_create" ? "repair" : null,
    },
    observations,
  };
}

function sanitizeDebugText(value: string): string {
  return value
    .replace(/1\d{2}\d{4}(\d{4})/g, "1********$1")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "***@***")
    .replace(/(sk-|api[_-]?key[=: ]+)[A-Za-z0-9_-]+/gi, "$1***");
}

function buildDebugContext(
  request: ChatRequest,
  route: RouteDecision,
  stages: TraceStage[],
): TraceDebugContext {
  const message = sanitizeDebugText(request.message);
  const matchedSignals = [
    safetyPattern.test(message) ? "safety_keyword" : "",
    requestedHumanPattern.test(message) ? "human_request" : "",
    disputePattern.test(message) ? "dispute_keyword" : "",
    /物流|快递|订单|发货/.test(message) ? "logistics_keyword" : "",
    /退货|换货|破|碎|少件|错发/.test(message) ? "return_keyword" : "",
    /配网|搜不到设备|绑定不了/.test(message) ? "smart_setup_keyword" : "",
    /闪|不亮|遥控|故障|异响/.test(message) ? "fault_keyword" : "",
    /型号|参数|WIFI|质保|保修|安装视频|门店|验真/.test(message) ? "knowledge_keyword" : "",
    request.action ? `deterministic_action:${request.action}` : "",
    request.module ? `context_module:${request.module}` : "",
    request.attachment ? "image_attachment" : "",
  ].filter(Boolean);

  const alternativeIntents: Intent[] = route.intent === "knowledge_query"
    ? ["troubleshooting", "other"]
    : route.intent === "troubleshooting"
      ? ["knowledge_query", "service_ticket_create"]
      : route.intent === "human_escalation"
        ? ["troubleshooting", "other"]
        : route.intent === "return_exchange"
          ? ["troubleshooting", "clarification"]
          : ["other", "clarification"];
  const candidates = [
    { intent: route.intent, topic: route.topic, score: route.confidence, matchedSignals },
    ...alternativeIntents.map((intent, index) => ({
      intent,
      topic: intent === "other" ? "conversation.unclassified" : intent === "clarification" ? "conversation.missing_context" : `candidate.${intent}`,
      score: Math.max(0.03, Number((route.confidence - 0.57 - index * 0.13).toFixed(2))),
      matchedSignals: [`alternative_rank_${index + 2}`],
    })),
  ];

  const rules = [
    { ruleId: "RULE-ACTION-001", name: "确定性动作优先", matched: Boolean(request.action), evidence: request.action ? [request.action] : [], effect: request.action ? "bypass_intent_guessing" : "continue_classification" },
    { ruleId: "RULE-SAFETY-001", name: "用电安全优先", matched: safetyPattern.test(message), evidence: message.match(safetyPattern) ?? [], effect: safetyPattern.test(message) ? "force_safety_handoff" : "allow_normal_route" },
    { ruleId: "RULE-HANDOFF-001", name: "主动转人工与争议", matched: requestedHumanPattern.test(message) || disputePattern.test(message), evidence: [message.match(requestedHumanPattern)?.[0], message.match(disputePattern)?.[0]].filter((value): value is string => Boolean(value)), effect: route.requiresHuman ? "create_handoff" : "continue" },
    { ruleId: "RULE-KB-HIDDEN-001", name: "隐藏知识问答", matched: route.intent === "knowledge_query", evidence: route.intent === "knowledge_query" ? [route.topic] : [], effect: route.intent === "knowledge_query" ? "retrieve_without_fourth_entry" : "not_applicable" },
    { ruleId: "RULE-CONFIRM-001", name: "写操作确认", matched: route.requiresConfirmation, evidence: route.requiresConfirmation ? [route.action] : [], effect: route.requiresConfirmation ? "prepare_draft_and_wait" : "no_confirmation_required" },
    { ruleId: "RULE-CLARIFY-001", name: "信息不足澄清", matched: route.needsClarification, evidence: route.needsClarification ? ["low_context"] : [], effect: route.needsClarification ? "ask_one_question_no_tool" : "continue" },
    { ruleId: "RULE-CONSUMER-TRACE-001", name: "消费者与后台隔离", matched: true, evidence: ["debug_context_backend_only"], effect: "exclude_debug_from_chat_response" },
  ];

  const promptInput = {
    message,
    module: request.module ?? null,
    action: request.action ?? null,
    attachment: request.attachment ?? null,
    formData: request.formData ? { ...request.formData, contactPhone: "***", pickupAddress: "***" } : null,
    serviceFormData: request.serviceFormData ? { ...request.serviceFormData, contactPhone: "***", serviceAddress: "***" } : null,
  };
  const finalDecisionSummary = `选择 ${route.intent} / ${route.topic}，执行 ${route.action}；命中信号：${matchedSignals.join("、") || "仅上下文与兜底规则"}；共生成 ${stages.length} 个可审计执行阶段。`;
  const parsedOutput = { ...route };

  return {
    environment: "mock",
    recordLevel: "application_full",
    model: {
      provider: "LocalMockModelAdapter",
      model: "mock-text-router-v1",
      mode: "mock",
      temperature: 0,
      responseFormat: "json_schema",
    },
    prompt: {
      templateId: "intent-router-system",
      version: "V1.4",
      applicationSystemPrompt: MOCK_ROUTER_SYSTEM_PROMPT,
      messages: [
        { role: "system", content: MOCK_ROUTER_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(promptInput, null, 2) },
      ],
      responseSchema: {
        type: "object",
        required: ["module", "intent", "topic", "action", "riskLevel", "confidence"],
        properties: {
          module: { type: "string" },
          intent: { type: "string" },
          topic: { type: "string" },
          action: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needsClarification: { type: "boolean" },
          requiresConfirmation: { type: "boolean" },
          requiresHuman: { type: "boolean" },
          entities: { type: "object" },
          observations: { type: "array" },
        },
      },
      fewShotExampleIds: ["FS-SAFETY-001", "FS-RETURN-VS-FAULT-002", "FS-KNOWLEDGE-HIDDEN-003", "FS-INSTALL-APPOINTMENT-004"],
    },
    classification: { candidates, selected: route, rules },
    extraction: {
      entities: route.entities,
      observations: route.observations,
      missingFields: route.needsClarification ? ["userGoal"] : [],
    },
    modelOutput: {
      raw: JSON.stringify({ ...parsedOutput, decisionSummary: finalDecisionSummary }, null, 2),
      parsed: parsedOutput,
    },
    finalDecisionSummary,
    boundaryNote: "Mock 调试全量记录应用可观测输入、Prompt、输出、候选、规则和工具参数；平台级隐藏指令与模型私有思维链不属于应用可观测数据。密钥和可能的个人信息始终脱敏。",
  };
}

function createTrace(
  request: ChatRequest,
  intent: Intent,
  riskLevel: RiskLevel,
  outputSummary: string,
  steps: string[],
  sources: TraceSource[],
  stages?: TraceStage[],
): string {
  const traceId = requiredTraceId(request);
  const detailedStages = stages ?? steps.map((step, index) => ({
    id: `step-${index + 1}`,
    title: step,
    kind: index === steps.length - 1 ? "output" as const : "decision" as const,
    status: "completed" as const,
    durationMs: 18 + index * 7,
    summary: step,
  }));
  appendTrace({
    traceId,
    sessionId: request.sessionId,
    createdAt: new Date().toISOString(),
    intent,
    route: routeOverrides.get(request) ?? buildRouteDecision(request, intent),
    riskLevel,
    inputSummary: request.attachment
      ? `${request.message || "图片消息"}；附件=${request.attachment.name}`
      : request.message,
    outputSummary,
    steps,
    totalDurationMs: detailedStages.reduce((total, stage) => total + stage.durationMs, 0),
    stages: detailedStages,
    sources,
    debug: buildDebugContext(request, routeOverrides.get(request) ?? buildRouteDecision(request, intent), detailedStages),
  });
  return traceId;
}

function decisionStage(
  id: string,
  title: string,
  summary: string,
  durationMs = 32,
  kind: TraceStage["kind"] = "decision",
): TraceStage {
  return { id, title, kind, status: "completed", durationMs, summary };
}

function toolStage(
  id: string,
  title: string,
  summary: string,
  durationMs: number,
  call: NonNullable<TraceStage["toolCall"]>,
  kind: TraceStage["kind"] = "tool",
): TraceStage {
  return { id, title, kind, status: "completed", durationMs, summary, toolCall: call };
}

export async function orchestrateMock(
  request: ChatRequest,
  options: MockOrchestrationOptions = {},
): Promise<ChatResponse> {
  traceIdOverrides.set(request, options.traceId ?? `TR-ORCH-${crypto.randomUUID()}`);
  if (options.route) routeOverrides.set(request, options.route);
  if (request.confirmation) {
    return resolveIntegratedConfirmation(
      request as ChatRequest & { confirmation: NonNullable<ChatRequest["confirmation"]> },
      options,
    );
  }
  const intent = options.route?.intent ?? detectIntent(request.message, request);
  const selectedRoute = options.route ?? buildRouteDecision(request, intent);
  routeOverrides.set(request, selectedRoute);

  if (
    selectedRoute.action === "confirm_identity_then_prepare_order_change"
    || selectedRoute.action === "confirm_identity_then_prepare_order_cancel"
  ) {
    const operation = selectedRoute.action.endsWith("order_change") ? "order_change" : "order_cancel";
    const message = operation === "order_change"
      ? "修改收货地址需要先确认当前账号身份。确认后我会读取可变更订单，并生成一份可编辑草稿。"
      : "取消订单需要先确认当前账号身份。确认后我会读取可取消订单，并生成一份待确认申请。";
    return {
      message,
      intent: "logistics_query",
      riskLevel: "medium",
      traceId: createTrace(
        request,
        "logistics_query",
        "medium",
        message,
        ["识别订单写操作", "执行隐私校验", "等待身份确认"],
        [],
      ),
      ui: {
        kind: "identity_confirm",
        maskedPhone: "尾号 6821",
        purpose: operation,
      },
    };
  }

  if (selectedRoute.action === "confirm_identity_then_query_return") {
    const message = "退换申请进度仅对本人开放，请先确认使用当前账号查询。";
    return {
      message,
      intent: "return_exchange",
      riskLevel: "medium",
      traceId: createTrace(
        request,
        "return_exchange",
        "medium",
        message,
        ["识别退换进度查询", "执行隐私校验", "等待身份确认"],
        [],
      ),
      ui: { kind: "identity_confirm", maskedPhone: "尾号 6821", purpose: "return" },
    };
  }

  if (request.action === "prepare_order_change" || request.action === "prepare_order_cancel") {
    const operation = request.action === "prepare_order_change" ? "order_change" : "order_cancel";
    const prepared = await prepareIntegratedOrderOperation(request, operation);
    const message = operation === "order_change"
      ? "已找到当前可变更订单。请核对并编辑收货地址或联系电话，确认后提交变更申请。"
      : "已找到当前可取消订单。请核对订单和取消原因，确认后提交取消申请。";
    return {
      message,
      intent: "logistics_query",
      riskLevel: "medium",
      traceId: createTrace(
        request,
        "logistics_query",
        "medium",
        message,
        ["确认演示身份", "查询 OMS 可操作订单", "生成正式确认草稿", "等待用户确认"],
        prepared.sources,
        [
          decisionStage("identity", "确认订单操作权限", "用户已确认当前演示账号，允许查询本人可操作订单。", 12, "guardrail"),
          toolStage("oms", "查询 OMS 可操作订单", "只返回当前账号最近一笔仍允许变更或取消的订单。", 36, {
            system: "OMS",
            toolName: "get_latest_mutable_order",
            operation: operation === "order_change" ? "查询可变更订单" : "查询可取消订单",
            method: "GET",
            endpoint: "/mock/oms/orders/latest-mutable",
            input: { customer_scope: "current_user", allowed_statuses: ["created", "paid", "allocated"] },
            output: { order_id: prepared.order.orderId, order_status: prepared.order.status },
            statusCode: 200,
          }),
          decisionStage("confirm", "签发正式确认草稿", "operation、令牌与幂等键均由服务端 Confirmation Store 签发；此时尚未执行写工具。", 15, "output"),
        ],
      ),
      ui: { kind: "confirmation", request: prepared.confirmation },
    };
  }

  if (request.action === "confirm_return_identity") {
    const result = await queryIntegratedReturnStatus(request);
    const message = `已找到退换申请 ${result.request.requestNo}，当前状态为${result.request.status}。`;
    return {
      message,
      intent: "return_exchange",
      riskLevel: "low",
      traceId: createTrace(
        request,
        "return_exchange",
        "low",
        message,
        ["确认演示身份", "查询 CRM 退换申请", "返回申请进度"],
        result.sources,
        [
          decisionStage("identity", "确认退换查询权限", "用户已确认当前演示账号，只查询该账号的退换申请。", 12, "guardrail"),
          toolStage("crm", "查询 CRM 退换申请进度", "返回当前账号最近更新的退换申请与公开状态时间线。", 34, {
            system: "CRM",
            toolName: "get_return_exchange_status",
            operation: "查询退换申请进度",
            method: "GET",
            endpoint: "/mock/crm/return-requests/latest",
            input: { customer_scope: "current_user" },
            output: { request_no: result.request.requestNo, status: result.request.status },
            statusCode: 200,
          }),
          decisionStage("output", "返回退换进度", "仅展示当前账号申请的公开字段和状态时间线。", 9, "output"),
        ],
      ),
      ui: { kind: "return_status", request: result.request },
    };
  }

  if (intent === "logistics_query" && request.action !== "confirm_identity") {
    if (request.action === "prepare_logistics_urge") {
      const order = await getLatestOrder();
      const prepared = await prepareIntegratedLogisticsUrge(request);
      const message = "可以为你发起物流催办。请确认下面的订单与最新物流状态，确认后将同步物流平台和人工客服。";
      return {
        message,
        intent,
        riskLevel: "medium",
        traceId: createTrace(
          request,
          intent,
          "medium",
          message,
          ["读取当前物流状态", "生成催办确认摘要", "等待用户确认"],
          order.sources,
          [
            decisionStage("route", "识别物流催办意图", "用户明确反馈物流较慢，路由到 logistics_query / prepare_logistics_urge；该操作需要二次确认。", 24),
            toolStage("order", "读取订单与最新物流", "从 OMS 获取最近订单，并用运单号查询 TMS 最新节点。", 96, {
              system: "OMS + TMS",
              toolName: "get_latest_order_and_shipment",
              operation: "查询最近订单物流",
              method: "GET",
              endpoint: "/mock/oms/orders/latest?include=shipment",
              input: { account_id: "acct_demo_6821", scope: "current_user", include: ["order", "shipment_latest_event"] },
              output: { order_id: order.data.id, carrier: order.data.carrier, tracking_no: order.data.trackingNo, latest_status: order.data.events[0]?.text },
              statusCode: 200,
            }),
            decisionStage("confirm", "生成催办确认摘要", "已取得当前状态，但尚未执行写操作；向用户展示订单、运单和最新节点并等待确认。", 29, "output"),
          ],
        ),
        ui: { kind: "confirmation", request: prepared.data },
      };
    }

    if (request.action === "submit_logistics_urge") {
      const urge = await submitIntegratedLogisticsUrge(request);
      const message = "物流催办已提交，并已同步人工客服跟进。物流平台的后续反馈会通过当前账号消息通知你。";
      return {
        message,
        intent,
        riskLevel: "medium",
        traceId: createTrace(
          request,
          intent,
          "medium",
          message,
          ["校验用户催办确认", "提交 TMS 催办", "同步 CRM 人工客服", "返回催办编号"],
          urge.sources,
          [
            decisionStage("confirm", "校验用户确认", "检测到明确的“确认催物流”操作，允许执行写入；未包含赔付、改址等越权动作。", 21, "guardrail"),
            toolStage("tms", "提交物流平台催办", "向 TMS 创建一次物流催办请求。", 118, {
              system: "TMS",
              toolName: "create_logistics_urge",
              operation: "创建催办",
              method: "POST",
              endpoint: "/mock/tms/urge-requests",
              input: { tracking_no: "SF14900000628", reason_code: "DELIVERY_DELAY", requester: "current_user", notify_channel: "account_message" },
              output: { success: true, request_no: urge.requestNo, status: "accepted" },
              statusCode: 201,
            }),
            toolStage("crm", "同步人工客服跟进", "将催办编号与物流状态同步到 CRM 客服队列。", 82, {
              system: "CRM",
              toolName: "create_followup_task",
              operation: "创建客服跟进任务",
              method: "POST",
              endpoint: "/mock/crm/follow-up-tasks",
              input: { related_request_no: urge.requestNo, queue: "LOGISTICS_AFTERSALE", priority: "normal" },
              output: { success: true, task_id: "CS20260820017", assignee: "物流售后队列" },
              statusCode: 201,
            }),
            decisionStage("output", "生成用户结果", `催办 ${urge.requestNo} 已提交，并说明后续通知方式。`, 17, "output"),
          ],
        ),
        ui: {
          kind: "logistics_urge_success",
          requestNo: urge.requestNo,
          carrier: "顺丰速运",
          handoff: "物流平台 + 人工客服",
        },
      };
    }

    const message = "订单信息仅对本人开放，请先确认使用当前账号查询。";
    return {
      message,
      intent,
      riskLevel: "medium",
      traceId: createTrace(
        request,
        intent,
        "medium",
        message,
        ["识别物流查询意图", "命中订单隐私规则", "等待演示身份确认"],
        [],
        [
          decisionStage("route", "识别订单物流意图", "命中“订单 / 到哪里”等信号，路由到 logistics_query。", 18),
          decisionStage("privacy", "执行订单隐私校验", "订单与物流属于账号隐私数据；当前请求尚未确认本人，因此禁止调用 OMS / TMS。", 12, "guardrail"),
          decisionStage("output", "请求身份确认", "返回脱敏手机号尾号，仅等待用户确认，不读取业务数据。", 9, "output"),
        ],
      ),
      ui: { kind: "identity_confirm", maskedPhone: "尾号 6821", purpose: "order" },
    };
  }

  if (intent === "logistics_query") {
    if (options.toolOutcomes?.latestOrder && options.toolOutcomes.latestOrder !== "success") {
      const result = await omsMockAdapter.getLatestOrder(DEMO_CUSTOMER_ID, {
        outcome: options.toolOutcomes.latestOrder,
      });
      const message = "当前账号下未找到可查询的订单，我不会返回其他账号或相似订单。";
      return {
        message,
        intent,
        riskLevel: "low",
        traceId: createTrace(
          request,
          intent,
          "low",
          message,
          ["确认演示身份", "查询 OMS 最近订单", "安全处理空结果"],
          [],
          [
            decisionStage("identity", "确认查询权限", "用户已确认使用当前账号查询。", 12, "guardrail"),
            toolStage("oms", "查询 OMS 最近订单", "OMS 返回确定性的空结果；未尝试匹配其他账号订单。", 20, {
              system: "OMS",
              toolName: "get_latest_order",
              operation: "查询最近订单",
              method: "GET",
              endpoint: "/mock/oms/orders/latest",
              input: { account_id: "current_user", limit: 1 },
              output: { outcome: result.status, hit_count: 0 },
              statusCode: 200,
            }),
            decisionStage("output", "返回空结果", "明确告知未找到，不猜测或泄露其他订单。", 8, "output"),
          ],
        ),
      };
    }

    if (options.toolOutcomes?.shipment && options.toolOutcomes.shipment !== "success") {
      const orderResult = await omsMockAdapter.getLatestOrder(DEMO_CUSTOMER_ID);
      if (orderResult.status !== "success") return toolFailure(orderResult);
      const shipmentResult = await tmsMockAdapter.getShipment(orderResult.data.orderId, {
        outcome: options.toolOutcomes.shipment,
      });
      const message = "订单已找到，但物流接口暂时无法获取最新状态。请稍后重试，我不会猜测配送进度。";
      return {
        message,
        intent,
        riskLevel: "low",
        traceId: createTrace(
          request,
          intent,
          "low",
          message,
          ["确认演示身份", "查询 OMS 最近订单", "查询 TMS 物流超时", "返回安全重试提示"],
          [],
          [
            decisionStage("identity", "确认查询权限", "用户已确认使用当前账号查询。", 12, "guardrail"),
            toolStage("oms", "查询 OMS 最近订单", "OMS 返回当前账号最近订单。", 20, {
              system: "OMS",
              toolName: "get_latest_order",
              operation: "查询最近订单",
              method: "GET",
              endpoint: "/mock/oms/orders/latest",
              input: { account_id: "current_user", limit: 1 },
              output: { outcome: orderResult.status, order_id: orderResult.data.orderId },
              statusCode: 200,
            }),
            toolStage("tms", "查询 TMS 物流轨迹", "TMS 返回确定性的超时结果；未生成虚构物流状态。", 20, {
              system: "TMS",
              toolName: "get_shipment_timeline",
              operation: "查询物流轨迹",
              method: "GET",
              endpoint: "/mock/tms/shipments/{order_id}",
              input: { order_id: orderResult.data.orderId },
              output: { outcome: shipmentResult.status, retryable: shipmentResult.status !== "success" && shipmentResult.error.retryable },
              statusCode: 504,
            }),
            decisionStage("output", "返回安全重试提示", "说明暂时无法获取，不猜测物流状态。", 8, "output"),
          ],
        ),
      };
    }

    const order = await getLatestOrder();
    const message = "已找到最近一笔灯具订单，目前正在运输中。";
    return {
      message,
      intent,
      riskLevel: "low",
      traceId: createTrace(
        request,
        intent,
        "low",
        message,
        ["确认演示身份", "查询 OMS 订单", "查询 TMS 物流轨迹", "合并订单与物流结果"],
        order.sources,
        [
          decisionStage("identity", "确认查询权限", "用户已确认使用当前账号查询，允许读取该账号最近订单。", 72, "guardrail"),
          toolStage("oms", "查询 OMS 最近订单", "读取当前账号最近一笔可查询订单。", 420, {
            system: "OMS",
            toolName: "get_latest_order",
            operation: "查询最近订单",
            method: "GET",
            endpoint: "/mock/oms/orders/latest",
            input: { account_id: "acct_demo_6821", channel: "online", limit: 1 },
            output: { order_id: order.data.id, product: order.data.product, order_status: order.data.status, tracking_no: order.data.trackingNo },
            statusCode: 200,
          }),
          toolStage("tms", "查询 TMS 物流轨迹", "使用 OMS 返回的运单号读取承运商、预计送达和最新轨迹。", 610, {
            system: "TMS",
            toolName: "get_shipment_timeline",
            operation: "查询物流轨迹",
            method: "GET",
            endpoint: "/mock/tms/shipments/{tracking_no}",
            input: { tracking_no: order.data.trackingNo, include: ["latest_event", "timeline", "eta", "hotline"] },
            output: { carrier: order.data.carrier, status: order.data.status, eta: order.data.eta, latest_event: order.data.events[0]?.text, event_count: order.data.events.length },
            statusCode: 200,
          }),
          decisionStage("merge", "合并订单与物流结果", "订单状态与物流轨迹一致，生成可核验的物流卡片，并保留承运商电话和催办入口。", 105, "output"),
        ],
      ),
      ui: { kind: "order", order: order.data },
    };
  }

  if (intent === "human_escalation" && !safetyPattern.test(request.message)) {
    const isDispute = disputePattern.test(request.message);
    const handoff = await submitIntegratedHandoff(
      request,
      isDispute ? "dispute" : "requested",
      isDispute ? "medium" : "low",
      isDispute ? "用户提出赔偿、责任或投诉诉求，需人工确认" : "用户明确要求转接人工客服",
    );
    const message = isDispute
      ? "这类赔偿、责任或投诉问题需要由人工客服确认。我已整理当前问题并转交专席，不会由机器人直接做结论。"
      : "好的，我已整理当前会话信息并转接人工客服，你不需要重新描述已经提供的内容。";
    return {
      message,
      intent,
      riskLevel: isDispute ? "medium" : "low",
      traceId: createTrace(
        request,
        intent,
        isDispute ? "medium" : "low",
        message,
        [isDispute ? "识别争议或投诉" : "识别主动转人工", "生成会话摘要", "转入人工客服队列"],
        [
          { type: "rule", sourceSystem: "Guardrail", recordId: isDispute ? "RULE-DISPUTE-002" : "RULE-HANDOFF-001", version: "V1.0" },
          ...handoff.sources,
        ],
        [
          decisionStage("route", isDispute ? "识别争议升级意图" : "识别主动转人工意图", isDispute ? "用户表达赔偿、责任或投诉诉求，机器人不得做最终决定。" : "用户明确要求人工，停止继续自动业务引导。", 16),
          decisionStage("guardrail", "核对人工接管规则", "仅传递脱敏会话摘要、当前模块与已完成步骤，不包含模型私有思维链。", 9, "guardrail"),
          toolStage("handoff", "创建人工接管事件", "将会话摘要写入 CRM 客服队列。", 64, {
            system: "CRM",
            toolName: "create_handoff",
            operation: "转人工客服",
            method: "POST",
            endpoint: "/mock/crm/handoffs",
            input: { session_id: request.sessionId, queue: isDispute ? "DISPUTE_PRIORITY" : "GENERAL_AFTERSALE", reason_code: isDispute ? "DISPUTE" : "USER_REQUESTED", summary: "已脱敏的当前会话摘要" },
            output: { success: true, handoff_no: handoff.handoffNo, status: "queued", queue: isDispute ? "售后争议专席" : "售后人工客服" },
            statusCode: 201,
          }),
          decisionStage("output", "告知转接结果", "向用户说明已同步上下文，无需重复描述。", 8, "output"),
        ],
      ),
      ui: {
        kind: "human_handoff",
        title: isDispute ? "已转售后争议专席" : "已转人工客服",
        queue: isDispute ? "售后争议专席" : "售后人工客服",
        reason: isDispute ? "赔偿、责任认定或投诉需由人工确认" : "用户主动要求人工处理",
      },
    };
  }

  if (intent === "human_escalation") {
    const safetyKnowledge = await searchKnowledge("safety");
    const handoff = await submitIntegratedHandoff(
      request,
      "safety",
      "high",
      "灯具疑似冒烟或烧焦异味，已提示立即断电并停止使用",
    );
    const message =
      "请立即断开对应电源并停止使用，不要触碰或自行拆解灯具。我正在为你优先转接安全专席。";
    return {
      message,
      intent,
      riskLevel: "high",
      traceId: createTrace(
        request,
        intent,
        "high",
        message,
        ["进入故障报修模块", "识别用电安全风险", "命中高风险规则", "读取已发布安全知识", "自动升级人工"],
        [
          safetyKnowledge,
          { type: "rule", sourceSystem: "Guardrail", recordId: "RULE-SAFETY-001", version: "V1.0" },
          ...handoff.sources,
        ],
        [
          decisionStage("route", "识别故障与安全信号", "在故障报修语境中检测到“冒烟 / 烧焦味 / 火花 / 触电 / 异常发热”等高风险信号，优先级覆盖普通排障。", 19),
          decisionStage("guardrail", "命中高风险安全规则", "RULE-SAFETY-001 要求立即断电、停止使用、禁止拆机，并跳过自助排障。", 8, "guardrail"),
          toolStage("knowledge", "读取已发布安全知识", "检索适用于灯具电气安全的已发布知识条目。", 43, {
            system: "CustomerKnowledgeBase",
            toolName: "search_published_knowledge",
            operation: "检索安全知识",
            method: "POST",
            endpoint: "/mock/knowledge/search",
            input: { query: "灯具 冒烟 烧焦味 安全处理", filters: { status: "published", scope: "electrical_safety" }, top_k: 3 },
            output: { hit_count: 1, record_id: safetyKnowledge.recordId, version: safetyKnowledge.version, excerpt: safetyKnowledge.excerpt },
            statusCode: 200,
          }, "knowledge"),
          toolStage("escalate", "升级安全专席", "创建高优先级人工接管事件；只传递会话摘要和风险标签。", 67, {
            system: "CRM",
            toolName: "escalate_to_safety_queue",
            operation: "创建安全升级事件",
            method: "POST",
            endpoint: "/mock/crm/escalations",
            input: { session_id: request.sessionId, risk_level: "high", reason_code: "ELECTRICAL_SAFETY", summary: "灯具疑似冒烟或烧焦异味" },
            output: { success: true, handoff_no: handoff.handoffNo, queue: "SAFETY_PRIORITY", priority: "urgent" },
            statusCode: 201,
          }),
          decisionStage("output", "生成安全回复", "先给出断电与禁止触碰指引，再告知已转安全专席。", 11, "output"),
        ],
      ),
      ui: { kind: "safety", priority: "urgent" },
    };
  }

  if (intent === "return_exchange" && request.action === "submit_return") {
    const serviceType = request.formData?.serviceType ?? "退换货";
    let returnRequest: Awaited<ReturnType<typeof submitIntegratedReturn>>;
    try {
      returnRequest = await submitIntegratedReturn(request, options.toolOutcomes?.returnExchange);
    } catch (error) {
      if (!options.toolOutcomes?.returnExchange || options.toolOutcomes.returnExchange === "success") throw error;
      const message = `${serviceType}申请提交失败：当前业务状态不允许该操作。申请未创建，如需继续处理请联系人工客服。`;
      return {
        message,
        intent,
        riskLevel: "medium",
        traceId: createTrace(
          request,
          intent,
          "medium",
          message,
          ["校验用户确认", `提交${serviceType}申请`, "返回明确失败"],
          [],
          [
            decisionStage("confirm", "校验用户确认与必填项", `用户已确认提交${serviceType}，允许执行一次写工具。`, 18, "guardrail"),
            toolStage("crm", `创建${serviceType}申请单`, "CRM 按注入场景返回业务拒绝，写入未发生。", 20, {
              system: "CRM",
              toolName: "create_return_request",
              operation: `创建${serviceType}申请`,
              method: "POST",
              endpoint: "/mock/crm/return-requests",
              input: { user_confirmed: true },
              output: { outcome: options.toolOutcomes.returnExchange, created: false },
              statusCode: 409,
            }),
            decisionStage("output", "返回失败结果", "明确说明未创建申请，不伪造申请编号。", 8, "output"),
          ],
        ),
      };
    }
    const message = `${serviceType}申请已提交，后续进展会通过当前账号消息通知你。`;
    return {
      message,
      intent,
      riskLevel: "medium",
      traceId: createTrace(
        request,
        intent,
        "medium",
        message,
        ["校验用户确认", `读取用户最终编辑的${serviceType}申请`, "调用售后申请 Adapter", "返回申请编号"],
        returnRequest.sources,
        [
          decisionStage("confirm", "校验用户确认与必填项", `用户已确认提交${serviceType}；商品、问题描述、联系电话和取件地址均已填写。`, 25, "guardrail"),
          decisionStage("policy", "核对可执行边界", "仅创建待审核申请，不自动判责、不承诺赔偿，也不直接生成退款。", 13, "guardrail"),
          toolStage("crm", `创建${serviceType}申请单`, "将用户最终编辑后的字段写入 CRM Sandbox。联系电话与地址在 Trace 中已脱敏。", 146, {
            system: "CRM",
            toolName: "create_return_request",
            operation: `创建${serviceType}申请`,
            method: "POST",
            endpoint: "/mock/crm/return-requests",
            input: {
              service_type: serviceType,
              product: request.formData?.product,
              issue_description: request.formData?.issueDescription,
              contact_phone: "138****6821",
              pickup_address: "上海市浦东新区 ***",
              evidence_count: 1,
              user_confirmed: true,
            },
            output: { success: true, request_no: returnRequest.requestNo, status: "pending_review", next_step: "人工审核" },
            statusCode: 201,
          }),
          decisionStage("output", "返回申请结果", `向用户返回申请编号 ${returnRequest.requestNo}，并说明后续由售后人员审核。`, 16, "output"),
        ],
      ),
      ui: { kind: "return_success", requestNo: returnRequest.requestNo },
    };
  }

  if (intent === "return_exchange" && request.attachment) {
    const returnKnowledge = await searchKnowledge("return");
    const prepared = await prepareIntegratedReturn(request);
    const message =
      "从照片中看到灯罩边缘有一处明显裂纹。破损原因和责任无法仅凭照片确认，我已整理一份换货申请草稿。";
    return {
      message,
      intent,
      riskLevel: "medium",
      traceId: createTrace(
        request,
        intent,
        "medium",
        message,
        ["接收图片元数据", "使用 Mock 多模态观察", "检索破损售后知识", "生成待确认申请"],
        [returnKnowledge],
        [
          decisionStage("route", "识别图片售后场景", "收到商品图片且当前处于退换模块，路由到破损识别；只判断可见现象，不判断责任。", 22),
          toolStage("vision", "识别图片中的可见问题", "多模态模型观察到灯罩边缘裂纹；置信度仅用于生成申请草稿。", 382, {
            system: "MultimodalModel",
            toolName: "analyze_damage_image",
            operation: "商品破损识别",
            method: "POST",
            endpoint: "/mock/model/vision/analyze",
            input: { file_name: request.attachment.name, mime_type: request.attachment.type, size_bytes: request.attachment.size, task: "visible_damage_observation" },
            output: { visible_issue: "灯罩边缘明显裂纹", confidence: 0.91, responsibility_judgement: "not_allowed", need_human_review: true },
            statusCode: 200,
          }),
          toolStage("knowledge", "检索破损退换规则", "只检索已发布且适用于收货破损的知识。", 58, {
            system: "CustomerKnowledgeBase",
            toolName: "search_published_knowledge",
            operation: "检索退换规则",
            method: "POST",
            endpoint: "/mock/knowledge/search",
            input: { query: "灯罩边缘破裂 收货后 换货", filters: { status: "published", category: "return_damage" }, top_k: 3 },
            output: { hit_count: 1, record_id: returnKnowledge.recordId, version: returnKnowledge.version, excerpt: returnKnowledge.excerpt },
            statusCode: 200,
          }, "knowledge"),
          decisionStage("draft", "生成可编辑申请草稿", "根据可见问题与规则生成换货草稿；联系方式和取件地址使用账号中的脱敏 Mock 数据，提交前必须由用户确认。", 41, "output"),
        ],
      ),
      ui: { kind: "confirmation", request: prepared.data },
    };
  }

  if (intent === "return_exchange") {
    const message =
      "请上传一张灯罩破损处和外包装的清晰照片，我会先识别可见情况，再帮你整理换货申请。";
    return {
      message,
      intent,
      riskLevel: "medium",
      traceId: createTrace(
        request,
        intent,
        "medium",
        message,
        ["识别退换货意图", "检查必要信息", "请求补充图片"],
        [],
      ),
      ui: { kind: "upload_prompt" },
    };
  }

  if (intent === "knowledge_query") {
    const sandboxScenario = knowledgeSandbox.getActive();
    if (sandboxScenario) {
      const retrieval = await retrieveKnowledgeByQuery(request.message);
      const conflict = retrieval.status === "conflict";
      const expired = retrieval.status === "expired";
      if (conflict || expired) {
        if (conflict) {
          routeOverrides.set(request, {
            ...(options.route ?? buildRouteDecision(request, intent)),
            requiresHuman: true,
          });
        }
        const message = conflict
          ? "检索到的已发布知识存在冲突，我不会自动选边或给出业务结论，已建议转人工确认。"
          : "检索到的换新政策已经过期，不能用于当前处理；我不会引用过期内容，请由人工确认现行政策。";
        return {
          message,
          intent,
          riskLevel: "medium",
          traceId: createTrace(
            request,
            intent,
            "medium",
            message,
            ["识别知识主题", "执行确定性知识检索", conflict ? "识别知识冲突" : "过滤过期知识", "进入人工确认兜底"],
            [],
            [
              decisionStage("route", "识别隐藏知识路由", "路由到 knowledge_query，并启用隔离的固定评测知识场景。", 12),
              toolStage("knowledge", "检索已发布客服知识", conflict ? "检索器返回冲突，不采用任何候选。" : "检索器过滤过期条目，不采用任何候选。", 20, {
                system: "CustomerKnowledgeBase",
                toolName: "search_published_knowledge",
                operation: "检索客服知识",
                method: "POST",
                endpoint: "/mock/knowledge/search",
                input: { query: request.message, scenario: sandboxScenario },
                output: {
                  retrieval_status: retrieval.status,
                  selected_article_ids: retrieval.selectedArticleIds,
                  conflict_count: retrieval.conflicts.length,
                },
                statusCode: conflict ? 409 : 200,
              }, "knowledge"),
              decisionStage("output", conflict ? "执行冲突兜底" : "执行过期知识兜底", "不采用任何候选知识，不生成未经确认的结论。", 8, "output"),
            ],
          ),
          ui: {
            kind: "knowledge_answer",
            title: conflict ? "知识冲突，需人工确认" : "政策已过期",
            items: conflict ? ["未自动选择任何冲突条目", "未给出业务承诺", "请由人工确认适用规则"] : ["过期内容未被采用", "未生成换新结论", "请由人工确认现行政策"],
            footer: "当前回复未引用冲突或过期知识作为结论",
          },
        };
      }
    }

    const isWarranty = /质保|保修|收费|过保|换新政策|配件购买|售后流程|怎么售后/.test(request.message);
    const isInstallationGuide = /安装视频|安装方法|怎么安装|拆卸|怎么拆|接线/.test(request.message);
    const isConsumerBusiness = /门店|购买渠道|哪里买|验真|真伪|客服电话|企业资质|公司介绍/.test(request.message);

    if (!isWarranty && !isInstallationGuide && !isConsumerBusiness) {
      const product = await queryProductKnowledge(request.message);
      const productKnowledge = await searchKnowledge("product");
      const message = product.data.answer;
      return {
        message,
        intent,
        riskLevel: "low",
        traceId: createTrace(
          request,
          intent,
          "low",
          message,
          ["识别产品知识主题", "查询 PCMP 产品主数据", "检索已发布产品知识", "生成知识回答"],
          [product.source, productKnowledge],
          [
            decisionStage("route", "识别隐藏产品知识路由", `问题不需要新增首页入口，后台路由到 knowledge_query；主题为 ${product.data.topic}。`, 18),
            toolStage("pcmp", "查询 PCMP 产品主数据", "优先读取型号、功能和结构化参数，不从知识库猜测主数据。", 74, {
              system: "PCMP",
              toolName: "query_product_profile",
              operation: "查询产品知识",
              method: "POST",
              endpoint: "/mock/pcmp/products/search",
              input: { query: request.message, fields: ["model", "features", "specifications"], limit: 3 },
              output: { hit_count: 1, record_id: product.source.recordId, title: product.data.title, topic: product.data.topic },
              statusCode: 200,
            }),
            toolStage("knowledge", "检索产品说明知识", "使用客服问题库主题过滤已发布产品知识，补充解释性内容。", 46, {
              system: "CustomerKnowledgeBase",
              toolName: "search_published_knowledge",
              operation: "检索产品知识",
              method: "POST",
              endpoint: "/mock/knowledge/search",
              input: { query: request.message, filters: { status: "published", topic: product.data.topic }, top_k: 3 },
              output: { hit_count: 1, record_id: productKnowledge.recordId, version: productKnowledge.version },
              statusCode: 200,
            }, "knowledge"),
            decisionStage("output", "生成产品知识回答", "合并 PCMP 主数据与已发布知识；不展示内部来源详情，也不触发售后写操作。", 29, "output"),
          ],
        ),
        ui: { kind: "knowledge_answer", title: product.data.title, items: product.data.items, footer: "还可以继续问我订单物流、退换破损或故障报修" },
      };
    }

    const knowledgeType = isWarranty ? "warranty" : isInstallationGuide ? "installation" : "consumer_business";
    const knowledgeHit = await findKnowledge(knowledgeType);
    if (!knowledgeHit) {
      const message = "当前没有找到已发布且适用于这个问题的客服知识。为了避免使用草稿或已停用内容，我先不直接给出结论，可以为你转人工客服确认。";
      return {
        message,
        intent,
        riskLevel: "medium",
        traceId: createTrace(
          request,
          intent,
          "medium",
          message,
          ["识别知识主题", "检索已发布知识", "未命中有效知识", "进入保守兜底"],
          [],
          [
            decisionStage("route", "识别隐藏知识路由", `路由到 knowledge_query，主题为 ${knowledgeType}。`, 17),
            toolStage("knowledge", "检索已发布客服知识", "仅检索 published 状态；草稿和已停用条目被过滤。", 42, {
              system: "CustomerKnowledgeBase",
              toolName: "search_published_knowledge",
              operation: "检索客服知识",
              method: "POST",
              endpoint: "/mock/knowledge/search",
              input: { query: request.message, filters: { status: "published", topic: knowledgeType }, top_k: 3 },
              output: { hit_count: 0, excluded_statuses: ["draft", "inactive"] },
              statusCode: 200,
            }, "knowledge"),
            decisionStage("output", "执行无知识兜底", "不使用草稿或已停用知识，不生成未经审核的结论，建议人工确认。", 14, "output"),
          ],
        ),
        ui: { kind: "knowledge_answer", title: "暂无已发布知识", items: ["没有采用草稿或已停用内容", "不会根据未审核信息自行补全", "可转人工客服进一步确认"], footer: "知识发布后，新的消费者问题会自动使用已发布版本" },
      };
    }
    const knowledgeSource = knowledgeHit.source;
    const title = knowledgeHit.article.title;
    const items = knowledgeHit.article.answerItems;
    const message = knowledgeHit.article.answer;

    return {
      message,
      intent,
      riskLevel: isInstallationGuide && /接线/.test(request.message) ? "medium" : "low",
      traceId: createTrace(
        request,
        intent,
        isInstallationGuide && /接线/.test(request.message) ? "medium" : "low",
        message,
        ["识别知识主题", "检索已发布知识", isInstallationGuide ? "应用安装安全边界" : "核对适用范围", "生成知识回答"],
        [knowledgeSource],
        [
          decisionStage("route", "识别隐藏知识路由", `路由到 knowledge_query，并使用主题 ${isWarranty ? "after_sales.warranty" : isInstallationGuide ? "installation.guide" : "business.consumer_channel"}。`, 17),
          toolStage("knowledge", "检索已发布客服知识", "按问题库主题和适用范围检索当前有效条目。", 55, {
            system: "CustomerKnowledgeBase",
            toolName: "search_published_knowledge",
            operation: "检索客服知识",
            method: "POST",
            endpoint: "/mock/knowledge/search",
            input: { query: request.message, filters: { status: "published", topic: isWarranty ? "after_sales.warranty" : isInstallationGuide ? "installation.guide" : "business.consumer_channel" }, top_k: 3 },
            output: { hit_count: 1, record_id: knowledgeSource.recordId, version: knowledgeSource.version, excerpt: knowledgeSource.excerpt },
            statusCode: 200,
          }, "knowledge"),
          ...(isInstallationGuide ? [decisionStage("guardrail", "应用安装安全边界", "仅输出已审核的断电与说明书指引；涉及接线、拆线或裸露线路时停止自助指导。", 8, "guardrail")] : []),
          decisionStage("output", "生成知识回答", "向消费者展示结论和下一步，不展示知识条目编号或内部依据详情。", 24, "output"),
        ],
      ),
      ui: { kind: "knowledge_answer", title, items, footer: isInstallationGuide ? "需要上门安装时，直接告诉我“预约师傅安装”" : "首页仍只保留三个售后服务入口" },
    };
  }

  if (intent === "troubleshooting") {
    if (request.action === "select_repair") {
      const message = "请直接描述灯具出现的问题，我会先判断是否涉及用电安全，再给出排查或报修方案。";
      return {
        message,
        intent,
        riskLevel: "low",
        traceId: createTrace(
          request,
          intent,
          "low",
          message,
          ["进入故障报修模块", "等待用户描述故障"],
          [],
        ),
        ui: {
          kind: "repair_intake",
          examples: ["灯一直闪", "开灯后不亮", "遥控器没有反应", "有烧焦味或冒烟"],
        },
      };
    }
    const isFlicker = /闪烁|一直闪|闪/.test(request.message);
    const isNoLight = /不亮|没亮|无法点亮/.test(request.message);
    const isRemote = /遥控|按键|控制器/.test(request.message);
    const isSmartSetup = /配网|连不上|搜不到设备|绑定不了|语音控制|小爱|小度|天猫精灵/.test(request.message);
    const isNoise = /异响|嗡嗡/.test(request.message);
    if (!isFlicker && !isNoLight && !isRemote && !isSmartSetup && !isNoise) {
      const message = "请再具体描述一下故障现象，例如灯一直闪、开灯后不亮，或遥控器没有反应。";
      return {
        message,
        intent,
        riskLevel: "low",
        traceId: createTrace(
          request,
          intent,
          "low",
          message,
          ["进入故障报修模块", "未识别具体故障现象", "请求补充信息"],
          [],
        ),
        ui: { kind: "repair_intake", examples: ["灯一直闪", "开灯后不亮", "遥控器没有反应", "有烧焦味或冒烟"] },
      };
    }

    const troubleshootingKnowledge = await searchKnowledge(isSmartSetup ? "smart_setup" : "troubleshooting");
    const title = isSmartSetup ? "智能配网排查" : isNoise ? "灯具异响排查" : isRemote ? "遥控异常排查" : isNoLight ? "灯具不亮排查" : "灯具闪烁排查";
    const steps = isSmartSetup
      ? ["确认手机连接的是 2.4GHz WIFI，并暂时关闭蜂窝网络切换", "让设备重新进入配网状态，手机靠近设备后再次搜索", "仍无法绑定时记录型号和 App 提示，不要拆机检查无线模块"]
      : isNoise
        ? ["关闭灯具并观察异响是否立即停止", "确认灯具外观没有松动、异常发热或烧焦味", "不要拆机紧固内部部件；持续异响时申请报修"]
        : isRemote
      ? ["确认遥控器电池电量，并按正确方向重新安装", "靠近灯具后再次尝试常用开关或模式键", "不要拆开灯体或自行检查内部接收器"]
      : isNoLight
        ? ["关闭墙壁开关并等待 30 秒，再重新开启一次", "确认同一房间的其他照明或电器是否正常", "不要拆开灯体、开关面板或接触线路"]
        : ["关闭灯具并等待 30 秒，再重新开启一次", "切换其他亮度或色温，确认是否只有单一模式闪烁", "不要频繁开关、拆机或自行检查内部线路"];
    const message =
      "先按下面步骤做安全排查。过程中不要拆开灯体或接触线路；如果仍未恢复，我可以继续帮你创建售后报修。";
    return {
      message,
      intent,
      riskLevel: "low",
      traceId: createTrace(
        request,
        intent,
        "low",
        message,
        ["识别普通灯具故障", "排除高风险信号", "检索已发布故障知识", "生成安全排查步骤"],
        [troubleshootingKnowledge],
        [
          decisionStage("classify", "识别普通故障现象", `从用户描述中识别到“${isSmartSetup ? "配网失败" : isNoise ? "普通异响" : isRemote ? "遥控异常" : isNoLight ? "灯具不亮" : "灯具闪烁"}”；未检测到冒烟、烧焦味、火花、触电或异常发热。`, 27),
          decisionStage("safety", "完成安全前置判断", "当前风险为 low，可进入不拆机排查；仍禁止接触线路或拆开灯体。", 11, "guardrail"),
          toolStage("knowledge", "检索故障排查知识", "检索已发布、适用于当前故障类型的售后知识。", 52, {
            system: "CustomerKnowledgeBase",
            toolName: "search_published_knowledge",
            operation: "检索故障排查知识",
            method: "POST",
            endpoint: "/mock/knowledge/search",
            input: { query: request.message, filters: { status: "published", category: isSmartSetup ? "smart_setup" : "troubleshooting", product_family: "ceiling_light" }, top_k: 3 },
            output: { hit_count: 1, record_id: troubleshootingKnowledge.recordId, version: troubleshootingKnowledge.version, excerpt: troubleshootingKnowledge.excerpt },
            statusCode: 200,
          }, "knowledge"),
          decisionStage("output", "生成安全排查方案", `从知识条目中整理 ${steps.length} 个不拆机步骤，并保留“仍未恢复则创建报修”的下一步。`, 34, "output"),
        ],
      ),
      ui: {
        kind: "troubleshooting",
        title,
        steps,
        note: "出现冒烟、烧焦味、火花或异常发热，请立即断电并转人工处理。",
        reportedIssue: request.message,
      },
    };
  }

  if (
    intent === "service_ticket_create" &&
    (request.action === "prepare_service_ticket" || /预约.*安装|上门安装|安装师傅/.test(request.message))
  ) {
    const reportedIssue = request.message.replace(/^准备售后报修[:：]/, "").trim();
    const isInstallation = /安装/.test(request.message);
    const serviceType = isInstallation ? "安装服务" as const : "维修服务" as const;
    const prepared = await prepareIntegratedServiceTicket(
      request,
      isInstallation ? "installation" : "repair",
      isInstallation ? "预约专业师傅上门安装" : reportedIssue || "灯具故障，按建议排查后仍未恢复",
    );
    const message = isInstallation
      ? "我已整理一份上门安装服务单。服务类型、商品、地址和联系时间都可以修改，确认无误后再提交。"
      : "我已根据刚才的故障描述整理报修单。信息可以修改，确认无误后再提交。";
    return {
      message,
      intent,
      riskLevel: "medium",
      traceId: createTrace(
        request,
        intent,
        "medium",
        message,
        [isInstallation ? "识别上门安装需求" : "继承故障排查结果", "生成可编辑服务单", "等待用户确认"],
        [],
        [
          decisionStage("context", isInstallation ? "识别安装服务需求" : "汇总故障与排查上下文", isInstallation ? "用户明确要求预约师傅上门安装，工单类型设置为 installation。" : `继承用户故障描述“${reportedIssue || "灯具故障"}”，确认用户反馈按建议排查后仍未恢复。`, 24),
          decisionStage("guardrail", "检查服务单创建条件", "当前仅生成可编辑草稿，不写入 CRM；服务类型、联系电话、地址和联系时段均需用户确认或修改。", 14, "guardrail"),
          decisionStage("draft", "生成可编辑服务单", "使用商品 Mock 主数据和账号脱敏信息填充草稿，等待用户确认提交。", 31, "output"),
        ],
      ),
      ui: { kind: "confirmation", request: prepared.data },
    };
  }

  if (intent === "service_ticket_create" && request.action === "submit_service_ticket") {
    const isInstallation = request.serviceFormData?.serviceType === "安装服务";
    const serviceLabel = isInstallation ? "安装服务" : "售后报修";
    let ticket: Awaited<ReturnType<typeof submitIntegratedServiceTicket>>;
    try {
      ticket = await submitIntegratedServiceTicket(request, options.toolOutcomes?.serviceTicket);
    } catch (error) {
      if (!options.toolOutcomes?.serviceTicket || options.toolOutcomes.serviceTicket === "success") throw error;
      const message = `${serviceLabel}提交失败，服务系统暂时不可用。工单未创建，请稍后安全重试；如问题紧急可转人工客服。`;
      return {
        message,
        intent,
        riskLevel: "medium",
        traceId: createTrace(
          request,
          intent,
          "medium",
          message,
          ["校验用户确认", `提交${serviceLabel}`, "返回安全重试提示"],
          [],
          [
            decisionStage("confirm", "校验用户确认与服务字段", `用户已确认提交${serviceLabel}，允许执行一次写工具。`, 18, "guardrail"),
            toolStage("crm", `创建 CRM ${serviceLabel}工单`, "CRM 按注入场景返回系统失败，写入未发生。", 20, {
              system: "CRM",
              toolName: "create_service_ticket",
              operation: `创建${serviceLabel}工单`,
              method: "POST",
              endpoint: "/mock/crm/service-tickets",
              input: { user_confirmed: true },
              output: { outcome: options.toolOutcomes.serviceTicket, created: false, retryable: true },
              statusCode: 503,
            }),
            decisionStage("output", "返回安全重试提示", "明确说明工单未创建，允许用户稍后重试。", 8, "output"),
          ],
        ),
      };
    }
    const message = `${serviceLabel}已提交，服务人员会按你填写的联系方式和时段进行预约。具体时间以人工确认结果为准。`;
    return {
      message,
      intent,
      riskLevel: "medium",
      traceId: createTrace(
        request,
        intent,
        "medium",
        message,
        ["校验用户确认", `读取最终编辑的${serviceLabel}信息`, "调用 CRM 售后 Adapter", "返回工单编号"],
        ticket.sources,
        [
          decisionStage("confirm", "校验用户确认与服务字段", `用户已确认提交${serviceLabel}；服务类型、商品、购买渠道、问题描述、联系方式、服务地址和联系时段完整。`, 26, "guardrail"),
          decisionStage("scope", "核对自动化边界", "仅创建待预约服务工单；不承诺上门时间，也不自动判定保修责任或收费。", 12, "guardrail"),
          toolStage("crm", `创建 CRM ${serviceLabel}工单`, "将用户最终编辑后的服务信息写入 CRM Sandbox；隐私字段在 Trace 中脱敏。", 158, {
            system: "CRM",
            toolName: "create_service_ticket",
            operation: "创建售后报修工单",
            method: "POST",
            endpoint: "/mock/crm/service-tickets",
            input: {
              product: request.serviceFormData?.product,
              service_type: isInstallation ? "installation" : "repair",
              purchase_channel: request.serviceFormData?.purchaseChannel,
              fault_description: request.serviceFormData?.faultDescription,
              contact_phone: "138****6821",
              service_address: "上海市浦东新区 ***",
              preferred_contact_time: request.serviceFormData?.preferredContactTime,
              user_confirmed: true,
            },
            output: { success: true, ticket_no: ticket.ticketNo, status: "pending_appointment", service_type: isInstallation ? "installation" : "repair", service_queue: "浦东服务网点" },
            statusCode: 201,
          }),
          decisionStage("output", `返回${serviceLabel}结果`, `返回工单编号 ${ticket.ticketNo}，并说明预约时间由服务人员人工确认。`, 17, "output"),
        ],
      ),
      ui: { kind: "service_ticket_success", ticketNo: ticket.ticketNo, serviceType: request.serviceFormData?.serviceType ?? "维修服务" },
    };
  }

  if (intent === "service_ticket_query" && request.action !== "confirm_service_identity") {
    const message = "售后工单包含联系方式和服务地址，请先确认使用当前账号查询。";
    return {
      message,
      intent,
      riskLevel: "medium",
      traceId: createTrace(
        request,
        intent,
        "medium",
        message,
        ["识别工单查询意图", "命中售后隐私规则", "等待演示身份确认"],
        [],
      ),
      ui: { kind: "identity_confirm", maskedPhone: "尾号 6821", purpose: "service" },
    };
  }

  if (intent === "service_ticket_query") {
    const ticket = await getLatestServiceTicket();
    const message = "已找到最近一笔售后工单，目前服务网点已接单，正在等待电话预约。";
    return {
      message,
      intent,
      riskLevel: "low",
      traceId: createTrace(
        request,
        intent,
        "low",
        message,
        ["确认演示身份", "查询 CRM 售后工单", "读取工单事件", "生成服务进度"],
        [ticket.source],
        [
          decisionStage("identity", "确认查询权限", "用户已确认使用当前账号，允许查询该账号最近售后工单。", 14, "guardrail"),
          toolStage("crm", "查询 CRM 售后工单", "读取最近一笔工单及事件时间线。", 87, {
            system: "CRM",
            toolName: "get_latest_service_ticket",
            operation: "查询报修进度",
            method: "GET",
            endpoint: "/mock/crm/service-tickets/latest",
            input: { account_id: "acct_demo_6821", include: ["ticket", "events"], limit: 1 },
            output: { ticket_no: ticket.data.id, product: ticket.data.product, status: ticket.data.status, latest_event: ticket.data.events[0]?.text, event_count: ticket.data.events.length },
            statusCode: 200,
          }),
          decisionStage("output", "生成服务进度", "将工单状态与事件整理为时间线，不暴露联系方式或服务地址。", 23, "output"),
        ],
      ),
      ui: { kind: "service_ticket", ticket: ticket.data },
    };
  }

  if (intent === "clarification") {
    const moduleHint = request.module === "logistics"
      ? "你是想查询物流进度、联系物流公司，还是催一下配送？"
      : request.module === "return"
        ? "你是想咨询退换规则、提交申请，还是查询已有申请进度？"
        : request.module === "repair"
          ? "请补充具体是哪种情况：不亮、闪烁、异响、配网失败，还是其他现象？"
          : "请补充一下你想处理的是订单物流、退换破损，还是灯具故障？";
    return {
      message: moduleHint,
      intent,
      riskLevel: "low",
      traceId: createTrace(
        request,
        intent,
        "low",
        moduleHint,
        ["识别信息不足", "保留当前模块上下文", "只追问一个关键问题"],
        [],
        [
          decisionStage("route", "识别信息不足", "表达中缺少明确目标或可执行的关键现象，置信度不足以调用业务工具。", 14),
          decisionStage("guardrail", "阻止猜测与误调用", "不猜测订单、商品或用户目标，不读取任何业务数据。", 7, "guardrail"),
          decisionStage("output", "生成单一澄清问题", moduleHint, 8, "output"),
        ],
      ),
      ui: { kind: "clarification" },
    };
  }

  if (intent === "smalltalk") {
    const thanks = /谢谢|感谢|辛苦/.test(request.message);
    const message = thanks
      ? "不客气。订单物流、退换破损或灯具故障需要处理时，随时告诉我。"
      : "你好，我是智享家售后助手。请选择下面的服务，或直接描述你的售后问题。";
    return {
      message,
      intent,
      riskLevel: "low",
      traceId: createTrace(
        request,
        intent,
        "low",
        message,
        ["识别问候或感谢", "返回售后服务引导"],
        [],
      ),
      ui: { kind: "service_menu" },
    };
  }

  const isNonConsumerBusiness = /加盟|代理|供应商|市场活动|促销活动/.test(request.message);
  const message = isNonConsumerBusiness
    ? "这个问题属于加盟、供应商或市场合作渠道，不进入消费者售后流程。请通过品牌官网对应的商务合作入口提交信息；我仍可以继续帮你处理订单物流、退换破损和故障报修。"
    : "我是售后客服助理，目前主要处理订单物流、退换破损和灯具故障报修。请选择下面的服务，或换一种方式描述售后问题。";
  return {
    message,
    intent: "other",
    riskLevel: "low",
    traceId: createTrace(
      request,
      "other",
      "low",
      message,
      isNonConsumerBusiness ? ["识别非消费者业务咨询", "阻止进入售后业务流程", "提供官方渠道指引"] : ["未命中可处理意图", "返回服务范围与兜底引导"],
      [],
    ),
    ui: { kind: "service_menu" },
  };
}
