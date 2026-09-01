import type {
  ConfirmationCommand,
  ConfirmationOperation,
  ConfirmationRequest,
  DataSourceMetadata,
  RiskLevel,
  ToolResult,
  ToolResultStatus,
} from "@/lib/contracts";

export type BusinessSourceSystem = "PCMP" | "OMS" | "WMS" | "TMS" | "CRM";
export type MockOutcome = ToolResultStatus;

export interface AdapterCallOptions {
  outcome?: MockOutcome;
  delayMs?: number;
}

export interface VerifiedIdentity {
  customerId: string;
  verified: boolean;
}

export interface BusinessRecord {
  recordId: string;
  sourceSystem: BusinessSourceSystem;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRecord extends BusinessRecord {
  sourceSystem: "PCMP";
  sku: string;
  name: string;
  model: string;
  category: string;
  active: boolean;
  image: string;
  specs: string[];
}

export type OrderStatus = "paid" | "allocated" | "shipped" | "delivered" | "cancelled";

export const ORDER_OPERATION_ALLOWED_STATUSES: readonly OrderStatus[] = ["paid", "allocated"];

export function isOrderOperationAllowed(status: OrderStatus): boolean {
  return ORDER_OPERATION_ALLOWED_STATUSES.includes(status);
}

export interface OrderRecord extends BusinessRecord {
  sourceSystem: "OMS";
  orderId: string;
  customerId: string;
  sku: string;
  productName: string;
  status: OrderStatus;
  deliveryAddress: string;
  contactPhone: string;
}

export interface FulfillmentEvent {
  occurredAt: string;
  status: string;
  description: string;
}

export interface FulfillmentRecord extends BusinessRecord {
  sourceSystem: "WMS";
  fulfillmentId: string;
  orderId: string;
  warehouse: string;
  status: "pending" | "picking" | "packed" | "handed_over";
  events: FulfillmentEvent[];
}

export interface ShipmentEvent {
  occurredAt: string;
  description: string;
}

export interface ShipmentRecord extends BusinessRecord {
  sourceSystem: "TMS";
  shipmentId: string;
  orderId: string;
  carrier: string;
  trackingNo: string;
  hotline: string;
  status: string;
  eta: string;
  events: ShipmentEvent[];
}

export interface OrderChangeDraft extends Record<string, unknown> {
  orderId: string;
  deliveryAddress?: string;
  contactPhone?: string;
}

export interface OrderChangeRecord extends BusinessRecord, OrderChangeDraft {
  sourceSystem: "OMS";
  changeRequestNo: string;
  sessionId: string;
  idempotencyKey: string;
  status: "submitted";
}

export interface OrderCancelDraft extends Record<string, unknown> {
  orderId: string;
  reason: string;
}

export interface OrderCancelRecord extends BusinessRecord, OrderCancelDraft {
  sourceSystem: "OMS";
  cancelRequestNo: string;
  sessionId: string;
  idempotencyKey: string;
  status: "submitted";
}

export interface LogisticsUrgeDraft extends Record<string, unknown> {
  orderId: string;
  shipmentId: string;
  reason: string;
}

export interface LogisticsUrgeRecord extends BusinessRecord, LogisticsUrgeDraft {
  sourceSystem: "TMS";
  urgeRequestNo: string;
  crmRecordId: string;
  sessionId: string;
  idempotencyKey: string;
  status: "submitted";
}

export interface ReturnExchangeDraft extends Record<string, unknown> {
  orderId: string;
  serviceType: "return" | "exchange";
  product: string;
  reason: string;
  itemCondition: string;
  evidence: string[];
  contactPhone: string;
  pickupAddress: string;
}

export type ReturnExchangeStatus =
  | "submitted"
  | "reviewing"
  | "approved"
  | "pickup_scheduled"
  | "completed"
  | "rejected"
  | "cancelled";

export interface ReturnExchangeEvent {
  occurredAt: string;
  status: ReturnExchangeStatus;
  description: string;
}

export interface ReturnExchangeRecord extends BusinessRecord, ReturnExchangeDraft {
  sourceSystem: "CRM";
  requestNo: string;
  customerId: string;
  sessionId: string;
  idempotencyKey: string;
  status: ReturnExchangeStatus;
  events: ReturnExchangeEvent[];
}

export interface ReturnExchangeStatusView {
  recordId: string;
  requestNo: string;
  orderId: string;
  serviceType: ReturnExchangeDraft["serviceType"];
  product: string;
  status: ReturnExchangeStatus;
  updatedAt: string;
  events: ReturnExchangeEvent[];
  source: DataSourceMetadata;
}

export interface ServiceTicketDraft extends Record<string, unknown> {
  serviceType: "repair" | "installation";
  product: string;
  purchaseChannel: "online" | "store";
  issueDescription: string;
  contactPhone: string;
  serviceAddress: string;
  preferredContactTime: string;
  riskLevel: RiskLevel;
}

export interface TicketEvent {
  occurredAt: string;
  description: string;
}

export interface ServiceTicketRecord extends BusinessRecord, ServiceTicketDraft {
  sourceSystem: "CRM";
  ticketNo: string;
  customerId: string;
  sessionId: string;
  idempotencyKey: string;
  status: "submitted" | "reviewing" | "awaiting_appointment" | "closed";
  events: TicketEvent[];
}

export interface HumanHandoffDraft extends Record<string, unknown> {
  sessionId: string;
  customerId: string;
  reason: "safety" | "requested" | "dispute" | "repeated_failure" | "knowledge_conflict";
  riskLevel: RiskLevel;
  summary: string;
  completedActions: string[];
  pendingQuestions: string[];
  relatedRecordIds: string[];
}

export interface HumanHandoffRecord extends BusinessRecord, HumanHandoffDraft {
  sourceSystem: "CRM";
  handoffNo: string;
  status: "queued";
}

export interface OrderLogisticsView {
  order: OrderRecord;
  fulfillment: FulfillmentRecord | null;
  shipment: ShipmentRecord | null;
}

export interface WorkflowContext {
  sessionId: string;
  traceId: string;
  identity: VerifiedIdentity;
}

export type BusinessConfirmation<T extends Record<string, unknown>> = ConfirmationRequest<T>;

export interface ConfirmedWrite<TDraft extends Record<string, unknown>> {
  request: BusinessConfirmation<TDraft>;
  confirmationToken: string;
  idempotencyKey: string;
  finalSnapshot: Readonly<TDraft>;
}

export type BusinessWriteRecord =
  | OrderChangeRecord
  | OrderCancelRecord
  | LogisticsUrgeRecord
  | ReturnExchangeRecord
  | ServiceTicketRecord;

export type ConfirmationStatus =
  | "pending"
  | "modified"
  | "cancelled"
  | "expired"
  | "executing"
  | "completed"
  | "failed";

export type ConfirmationResolution =
  | {
      action: "modify";
      confirmationRequestId: string;
      replacement: ConfirmationRequest;
    }
  | {
      action: "cancel";
      confirmationRequestId: string;
    }
  | {
      action: "confirm";
      confirmationRequestId: string;
      operation: ConfirmationOperation;
      record: BusinessWriteRecord;
    };

export interface StoredConfirmation {
  request: Omit<ConfirmationRequest, "confirmationToken">;
  tokenDigest: string;
  status: ConfirmationStatus;
  finalSnapshot?: Readonly<Record<string, unknown>>;
  replacementRequestId?: string;
  result?: ToolResult<ConfirmationResolution>;
  createdAt: string;
  updatedAt: string;
}

export interface ResolveConfirmationOptions {
  signal?: AbortSignal;
  adapter?: AdapterCallOptions;
}

export type AnyConfirmationCommand = ConfirmationCommand<Record<string, unknown>>;

export interface ProductMasterAdapter {
  getProduct(sku: string, options?: AdapterCallOptions): Promise<ToolResult<ProductRecord>>;
  searchProducts(query: string, options?: AdapterCallOptions): Promise<ToolResult<ProductRecord[]>>;
}

export interface OrderManagementAdapter {
  getOrder(orderId: string, options?: AdapterCallOptions): Promise<ToolResult<OrderRecord>>;
  getLatestOrder(customerId: string, options?: AdapterCallOptions): Promise<ToolResult<OrderRecord>>;
  getLatestMutableOrder(customerId: string, options?: AdapterCallOptions): Promise<ToolResult<OrderRecord>>;
  createOrderChange(
    draft: OrderChangeDraft,
    sessionId: string,
    idempotencyKey: string,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<OrderChangeRecord>>;
  cancelOrder(
    draft: OrderCancelDraft,
    sessionId: string,
    idempotencyKey: string,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<OrderCancelRecord>>;
}

export interface WarehouseManagementAdapter {
  getFulfillment(orderId: string, options?: AdapterCallOptions): Promise<ToolResult<FulfillmentRecord>>;
}

export interface TransportManagementAdapter {
  getShipment(orderId: string, options?: AdapterCallOptions): Promise<ToolResult<ShipmentRecord>>;
  createUrge(
    draft: LogisticsUrgeDraft,
    sessionId: string,
    idempotencyKey: string,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<LogisticsUrgeRecord>>;
}

export interface CustomerRelationshipAdapter {
  createReturnExchange(
    draft: ReturnExchangeDraft,
    sessionId: string,
    idempotencyKey: string,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ReturnExchangeRecord>>;
  getReturnExchangeStatus(
    customerId: string,
    requestNo?: string,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ReturnExchangeStatusView>>;
  createServiceTicket(
    customerId: string,
    draft: ServiceTicketDraft,
    sessionId: string,
    idempotencyKey: string,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<ServiceTicketRecord>>;
  listServiceTickets(customerId: string, options?: AdapterCallOptions): Promise<ToolResult<ServiceTicketRecord[]>>;
  createHumanHandoff(
    draft: HumanHandoffDraft,
    options?: AdapterCallOptions,
  ): Promise<ToolResult<HumanHandoffRecord>>;
}

export function sourceMetadata(
  sourceSystem: BusinessSourceSystem,
  requestId: string,
  record?: Pick<BusinessRecord, "recordId" | "updatedAt">,
): DataSourceMetadata {
  return {
    sourceSystem,
    adapterType: "mock",
    requestId,
    recordId: record?.recordId,
    sourceUpdatedAt: record?.updatedAt,
  };
}
