import type {
  OpsChannel,
  OpsDetailResult,
  OpsField,
  OpsFilters,
  OpsQueryResult,
  OpsRecord,
  OpsRiskLevel,
  OpsSourceState,
  OpsTimelineEvent,
} from "./types";

export interface BusinessStoreQuery {
  listOrders(customerId?: string): readonly unknown[];
  listFulfillments(): readonly unknown[];
  listShipments(): readonly unknown[];
  listOrderChanges(): readonly unknown[];
  listOrderCancellations(): readonly unknown[];
  listLogisticsUrges(): readonly unknown[];
  listReturnExchanges(): readonly unknown[];
  listServiceTickets(customerId?: string): readonly unknown[];
  listHumanHandoffs(): readonly unknown[];
}

export type OpsTraceResolver = (sessionId: string) => string | null | undefined;

type UnknownRecord = Record<string, unknown>;

const terminalStatuses = new Set(["closed", "cancelled", "completed", "resolved"]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(record: UnknownRecord, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function risk(record: UnknownRecord): OpsRiskLevel {
  const value = text(record, "riskLevel");
  return value === "high" || value === "medium" ? value : "low";
}

function channel(record: UnknownRecord): OpsChannel {
  const value = text(record, "purchaseChannel");
  return value === "online" || value === "store" ? value : "unknown";
}

function redact(value: string): string {
  const maskedPhone = value.replace(/(?<!\d)1\d{10}(?!\d)/g, (phone) => `${phone.slice(0, 3)}****${phone.slice(-4)}`);
  if (/(?:省|市|区|县).*(?:街|路|号|室)|(?:街|路).*(?:号|室)/.test(maskedPhone)) {
    return "已隐藏（运营台不展示完整地址）";
  }
  return maskedPhone;
}

function field(label: string, value: unknown): OpsField | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return { label, value: redact(value) };
}

function fields(...values: Array<OpsField | null>): OpsField[] {
  return values.filter((value): value is OpsField => Boolean(value));
}

function timeline(record: UnknownRecord): OpsTimelineEvent[] {
  const events = record.events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!isRecord(event)) return [];
    const occurredAt = text(event, "occurredAt");
    const description = text(event, "description");
    return occurredAt && description ? [{ occurredAt, description: redact(description) }] : [];
  });
}

function traceLink(traceId: string): string {
  return `/trace?traceId=${encodeURIComponent(traceId)}`;
}

function sessionTraceLink(sessionId: string): string {
  return `/trace?sessionId=${encodeURIComponent(sessionId)}`;
}

function baseRecord(record: UnknownRecord) {
  const sourceRecordId = text(record, "recordId", "unknown-record");
  const createdAt = text(record, "createdAt", new Date(0).toISOString());
  const updatedAt = text(record, "updatedAt", createdAt);
  const sessionId = text(record, "sessionId") || null;
  const traceId = text(record, "traceId") || null;
  return {
    sourceRecordId,
    sourceSystem: text(record, "sourceSystem", "Sandbox"),
    createdAt,
    updatedAt,
    sessionId,
    traceId,
    traceHref: traceId ? traceLink(traceId) : sessionId ? sessionTraceLink(sessionId) : null,
  };
}

function attachTraceIds(records: UnknownRecord[], resolveTraceId?: OpsTraceResolver): UnknownRecord[] {
  if (!resolveTraceId) return records;
  return records.map((record) => {
    if (text(record, "traceId")) return record;
    const sessionId = text(record, "sessionId");
    const traceId = sessionId ? resolveTraceId(sessionId) : null;
    return traceId ? { ...record, traceId } : record;
  });
}

function safeRead(
  name: string,
  read: () => readonly unknown[],
  sources: OpsSourceState[],
): UnknownRecord[] {
  try {
    const records = read().filter(isRecord);
    sources.push({ name, health: "healthy" });
    return records;
  } catch (error) {
    sources.push({
      name,
      health: "degraded",
      message: error instanceof Error ? error.message : "数据源读取失败",
    });
    return [];
  }
}

function abnormalOrders(
  orders: UnknownRecord[],
  fulfillments: UnknownRecord[],
  shipments: UnknownRecord[],
): OpsRecord[] {
  const fulfillmentOrderIds = new Set(fulfillments.map((item) => text(item, "orderId")));
  const shipmentOrderIds = new Set(shipments.map((item) => text(item, "orderId")));

  return orders.flatMap((order) => {
    const orderId = text(order, "orderId");
    const status = text(order, "status", "unknown");
    let reason = "";
    let level: OpsRiskLevel = "medium";
    if ((status === "paid" || status === "allocated") && !fulfillmentOrderIds.has(orderId)) {
      reason = "订单尚未产生履约记录";
    } else if (status === "shipped" && !shipmentOrderIds.has(orderId)) {
      reason = "已发货但未查到运单";
      level = "high";
    }
    if (!reason) return [];
    const base = baseRecord(order);
    return [{
      ...base,
      id: `abnormal-order:${base.sourceRecordId}`,
      type: "abnormal_order" as const,
      title: `异常订单 · ${orderId}`,
      summary: reason,
      status: "attention_required",
      riskLevel: level,
      channel: "online" as const,
      fields: fields(
        field("订单编号", orderId),
        field("商品", order.productName),
        field("当前状态", status),
        field("联系方式", order.contactPhone),
        field("收货地址", order.deliveryAddress),
      ),
      timeline: [],
    }];
  });
}

function logisticsUrges(records: UnknownRecord[]): OpsRecord[] {
  return records.map((record) => {
    const base = baseRecord(record);
    const orderId = text(record, "orderId", "未知订单");
    return {
      ...base,
      id: `logistics-urge:${base.sourceRecordId}`,
      type: "logistics_urge",
      title: `物流催办 · ${text(record, "urgeRequestNo", base.sourceRecordId)}`,
      summary: redact(text(record, "reason", "用户已提交物流催办")),
      status: text(record, "status", "submitted"),
      riskLevel: "low",
      channel: "online",
      fields: fields(
        field("订单编号", orderId),
        field("运单记录", record.shipmentId),
        field("CRM 留痕", record.crmRecordId),
      ),
      timeline: [],
    };
  });
}

function orderChanges(records: UnknownRecord[]): OpsRecord[] {
  return records.map((record) => {
    const base = baseRecord(record);
    return {
      ...base,
      id: `order-change:${base.sourceRecordId}`,
      type: "order_change",
      title: `订单变更申请 · ${text(record, "changeRequestNo", base.sourceRecordId)}`,
      summary: "用户已确认并提交订单收货信息变更",
      status: text(record, "status", "submitted"),
      riskLevel: "medium",
      channel: "online",
      fields: fields(
        field("订单编号", record.orderId),
        field("变更后联系方式", record.contactPhone),
        field("变更后收货地址", record.deliveryAddress),
      ),
      timeline: [{ occurredAt: base.createdAt, description: "订单变更申请已提交至 OMS Sandbox" }],
    };
  });
}

function orderCancellations(records: UnknownRecord[]): OpsRecord[] {
  return records.map((record) => {
    const base = baseRecord(record);
    return {
      ...base,
      id: `order-cancel:${base.sourceRecordId}`,
      type: "order_cancel",
      title: `订单取消申请 · ${text(record, "cancelRequestNo", base.sourceRecordId)}`,
      summary: redact(text(record, "reason", "用户已确认并提交订单取消申请")),
      status: text(record, "status", "submitted"),
      riskLevel: "medium",
      channel: "online",
      fields: fields(
        field("订单编号", record.orderId),
        field("取消原因", record.reason),
      ),
      timeline: [{ occurredAt: base.createdAt, description: "订单取消申请已提交至 OMS Sandbox" }],
    };
  });
}

function returnExchanges(records: UnknownRecord[]): OpsRecord[] {
  return records.map((record) => {
    const base = baseRecord(record);
    const serviceType = text(record, "serviceType", "return");
    return {
      ...base,
      id: `return-exchange:${base.sourceRecordId}`,
      type: "return_exchange",
      subtype: serviceType,
      title: `${serviceType === "exchange" ? "换货" : "退货"}申请 · ${text(record, "requestNo", base.sourceRecordId)}`,
      summary: redact(text(record, "reason", "用户已提交退换申请")),
      status: text(record, "status", "submitted"),
      riskLevel: "medium",
      channel: "online",
      fields: fields(
        field("订单编号", record.orderId),
        field("商品", record.product),
        field("商品状态", record.itemCondition),
        field("联系方式", record.contactPhone),
        field("上门地址", record.pickupAddress),
      ),
      timeline: timeline(record),
    };
  });
}

function serviceTickets(records: UnknownRecord[]): OpsRecord[] {
  return records.map((record) => {
    const base = baseRecord(record);
    const serviceType = text(record, "serviceType", "repair");
    return {
      ...base,
      id: `service-ticket:${base.sourceRecordId}`,
      type: "service_ticket",
      subtype: serviceType,
      title: `${serviceType === "installation" ? "安装" : "维修"}工单 · ${text(record, "ticketNo", base.sourceRecordId)}`,
      summary: redact(text(record, "issueDescription", "售后工单待处理")),
      status: text(record, "status", "submitted"),
      riskLevel: risk(record),
      channel: channel(record),
      fields: fields(
        field("产品", record.product),
        field("服务类型", serviceType),
        field("期望联系时间", record.preferredContactTime),
        field("联系方式", record.contactPhone),
        field("服务地址", record.serviceAddress),
      ),
      timeline: timeline(record),
    };
  });
}

function humanHandoffs(records: UnknownRecord[]): OpsRecord[] {
  return records.map((record) => {
    const base = baseRecord(record);
    return {
      ...base,
      id: `human-handoff:${base.sourceRecordId}`,
      type: "human_handoff",
      subtype: text(record, "reason"),
      title: `人工接管 · ${text(record, "handoffNo", base.sourceRecordId)}`,
      summary: redact(text(record, "summary", "会话已转交人工客服")),
      status: text(record, "status", "queued"),
      riskLevel: risk(record),
      channel: "unknown",
      fields: fields(
        field("升级原因", record.reason),
        field("客户标识", record.customerId),
      ),
      timeline: [],
    };
  });
}

function riskSessions(tickets: OpsRecord[], handoffs: OpsRecord[]): OpsRecord[] {
  return [...tickets, ...handoffs]
    .filter((record) => record.riskLevel === "high")
    .map((record) => ({
      ...record,
      id: `risk-session:${record.sourceRecordId}`,
      type: "risk_session",
      title: `高风险会话 · ${record.sessionId ?? record.sourceRecordId}`,
      summary: record.summary,
      fields: [{ label: "关联业务记录", value: record.sourceRecordId }, ...record.fields],
    }));
}

function matches(record: OpsRecord, filters: OpsFilters): boolean {
  if (filters.type && filters.type !== "all" && record.type !== filters.type) return false;
  if (filters.status && filters.status !== "all" && record.status !== filters.status) return false;
  if (filters.risk && filters.risk !== "all" && record.riskLevel !== filters.risk) return false;
  if (filters.channel && filters.channel !== "all" && record.channel !== filters.channel) return false;
  if (filters.from && new Date(record.updatedAt) < new Date(filters.from)) return false;
  if (filters.to && new Date(record.updatedAt) > new Date(`${filters.to}T23:59:59.999`)) return false;
  const query = filters.query?.trim().toLocaleLowerCase();
  if (!query) return true;
  const haystack = [
    record.id,
    record.sourceRecordId,
    record.title,
    record.summary,
    record.sourceSystem,
    record.sessionId,
    record.traceId,
    ...record.fields.flatMap((item) => [item.label, item.value]),
  ].join(" ").toLocaleLowerCase();
  return haystack.includes(query);
}

export function queryOperations(
  store: BusinessStoreQuery,
  filters: OpsFilters = {},
  resolveTraceId?: OpsTraceResolver,
): OpsQueryResult {
  const sources: OpsSourceState[] = [];
  const orders = safeRead("OMS 订单", () => store.listOrders(), sources);
  const fulfillments = safeRead("WMS 履约", () => store.listFulfillments(), sources);
  const shipments = safeRead("TMS 物流", () => store.listShipments(), sources);
  const changeRecords = attachTraceIds(safeRead("OMS 订单变更", () => store.listOrderChanges(), sources), resolveTraceId);
  const cancelRecords = attachTraceIds(safeRead("OMS 订单取消", () => store.listOrderCancellations(), sources), resolveTraceId);
  const urgeRecords = attachTraceIds(safeRead("TMS 催办", () => store.listLogisticsUrges(), sources), resolveTraceId);
  const returnRecords = attachTraceIds(safeRead("CRM 退换", () => store.listReturnExchanges(), sources), resolveTraceId);
  const ticketRecords = attachTraceIds(safeRead("CRM 工单", () => store.listServiceTickets(), sources), resolveTraceId);
  const handoffRecords = attachTraceIds(safeRead("CRM 人工接管", () => store.listHumanHandoffs(), sources), resolveTraceId);

  const tickets = serviceTickets(ticketRecords);
  const handoffs = humanHandoffs(handoffRecords);
  const allItems = [
    ...abnormalOrders(orders, fulfillments, shipments),
    ...orderChanges(changeRecords),
    ...orderCancellations(cancelRecords),
    ...logisticsUrges(urgeRecords),
    ...returnExchanges(returnRecords),
    ...tickets,
    ...handoffs,
    ...riskSessions(tickets, handoffs),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const items = allItems.filter((item) => matches(item, filters));
  return {
    items,
    summary: {
      total: allItems.length,
      abnormalOrders: allItems.filter((item) => item.type === "abnormal_order").length,
      orderOperations: allItems.filter((item) => item.type === "order_change" || item.type === "order_cancel").length,
      pendingCases: allItems.filter((item) => !terminalStatuses.has(item.status)).length,
      highRisk: allItems.filter((item) => item.riskLevel === "high" && item.type !== "risk_session").length,
      humanHandoffs: allItems.filter((item) => item.type === "human_handoff").length,
    },
    sourceHealth: sources.some((source) => source.health === "degraded") ? "degraded" : "healthy",
    sources,
    generatedAt: new Date().toISOString(),
  };
}

export function getOperationDetail(store: BusinessStoreQuery, id: string, resolveTraceId?: OpsTraceResolver): OpsDetailResult {
  const result = queryOperations(store, {}, resolveTraceId);
  return {
    item: result.items.find((item) => item.id === id) ?? null,
    sourceHealth: result.sourceHealth,
    sources: result.sources,
    generatedAt: result.generatedAt,
  };
}
