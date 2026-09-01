import type {
  ConfirmationCommand,
  ConfirmationDecisionAction,
  ConfirmationOperation,
  ConfirmationRequest,
} from "@/lib/contracts";

export type ConfirmationSnapshot = Record<string, unknown>;

export interface ConfirmationFieldOption {
  label: string;
  value: string;
}

export interface ConfirmationFieldDefinition {
  key: string;
  label: string;
  input: "text" | "tel" | "textarea" | "select";
  editable: boolean;
  required?: boolean;
  options?: ConfirmationFieldOption[];
}

export interface ConfirmationPresentation {
  title: string;
  confirmLabel: string;
  fields: ConfirmationFieldDefinition[];
}

export type ConfirmationTransportResult =
  | { status: "completed" }
  | { status: "stopped" }
  | { status: "ignored" }
  | { status: "error"; message: string; retryable: boolean; code?: string };

const orderFields: ConfirmationFieldDefinition[] = [
  { key: "orderId", label: "订单号", input: "text", editable: false },
];

const presentations: Record<ConfirmationOperation, ConfirmationPresentation> = {
  order_change: {
    title: "确认修改订单地址申请",
    confirmLabel: "提交修改地址申请",
    fields: [
      ...orderFields,
      { key: "deliveryAddress", label: "收货地址", input: "textarea", editable: true },
      { key: "contactPhone", label: "联系电话", input: "tel", editable: true },
    ],
  },
  order_cancel: {
    title: "确认取消订单申请",
    confirmLabel: "提交取消订单申请",
    fields: [
      ...orderFields,
      { key: "reason", label: "取消原因", input: "textarea", editable: true, required: true },
    ],
  },
  logistics_urge: {
    title: "确认物流催办",
    confirmLabel: "确认提交催办",
    fields: [
      ...orderFields,
      { key: "reason", label: "催办原因", input: "textarea", editable: true, required: true },
    ],
  },
  return_exchange_create: {
    title: "确认退换申请",
    confirmLabel: "确认提交申请",
    fields: [
      ...orderFields,
      {
        key: "serviceType",
        label: "服务类型",
        input: "select",
        editable: true,
        required: true,
        options: [{ label: "换货", value: "exchange" }, { label: "退货", value: "return" }],
      },
      { key: "product", label: "商品", input: "text", editable: true, required: true },
      { key: "reason", label: "申请原因", input: "textarea", editable: true, required: true },
      { key: "itemCondition", label: "商品现状", input: "textarea", editable: true, required: true },
      { key: "contactPhone", label: "联系电话", input: "tel", editable: true, required: true },
      { key: "pickupAddress", label: "取件地址", input: "textarea", editable: true, required: true },
    ],
  },
  service_ticket_create: {
    title: "确认服务工单",
    confirmLabel: "确认提交工单",
    fields: [
      {
        key: "serviceType",
        label: "服务类型",
        input: "select",
        editable: true,
        required: true,
        options: [{ label: "维修服务", value: "repair" }, { label: "安装服务", value: "installation" }],
      },
      { key: "product", label: "商品", input: "text", editable: true, required: true },
      {
        key: "purchaseChannel",
        label: "购买渠道",
        input: "select",
        editable: true,
        required: true,
        options: [{ label: "线上商城", value: "online" }, { label: "线下门店", value: "store" }],
      },
      { key: "issueDescription", label: "服务需求", input: "textarea", editable: true, required: true },
      { key: "contactPhone", label: "联系电话", input: "tel", editable: true, required: true },
      { key: "serviceAddress", label: "服务地址", input: "textarea", editable: true, required: true },
      { key: "preferredContactTime", label: "方便联系时段", input: "text", editable: true, required: true },
    ],
  },
};

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

export function cloneConfirmationSnapshot(snapshot: Readonly<ConfirmationSnapshot>): ConfirmationSnapshot {
  return cloneValue(snapshot) as ConfirmationSnapshot;
}

export function getConfirmationPresentation(
  request: ConfirmationRequest,
  snapshot: Readonly<ConfirmationSnapshot> = request.draftSnapshot,
): ConfirmationPresentation {
  const base = presentations[request.operation];
  if (request.operation !== "service_ticket_create") return base;
  const installation = snapshot.serviceType === "installation";
  return {
    ...base,
    title: installation ? "确认安装工单" : "确认维修工单",
    confirmLabel: installation ? "确认提交安装工单" : "确认提交维修工单",
  };
}

export function formatConfirmationValue(field: ConfirmationFieldDefinition, value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "—";
  const normalized = String(value);
  return field.options?.find((option) => option.value === normalized)?.label ?? normalized;
}

export function updateConfirmationSnapshot(
  snapshot: Readonly<ConfirmationSnapshot>,
  key: string,
  value: string,
): ConfirmationSnapshot {
  return { ...cloneConfirmationSnapshot(snapshot), [key]: value };
}

export function validateConfirmationSnapshot(
  request: ConfirmationRequest,
  snapshot: Readonly<ConfirmationSnapshot>,
): string | undefined {
  if (request.operation === "order_change") {
    const address = snapshot.deliveryAddress;
    const phone = snapshot.contactPhone;
    if ((typeof address !== "string" || !address.trim()) && (typeof phone !== "string" || !phone.trim())) {
      return "请至少填写收货地址或联系电话";
    }
  }
  for (const field of getConfirmationPresentation(request, snapshot).fields) {
    if (!field.required) continue;
    const value = snapshot[field.key];
    if (typeof value !== "string" || !value.trim()) return `请补充${field.label}`;
  }
  return undefined;
}

export function createConfirmationCommand(
  request: ConfirmationRequest,
  action: "confirm" | "modify",
  finalSnapshot: Readonly<ConfirmationSnapshot>,
): ConfirmationCommand;
export function createConfirmationCommand(
  request: ConfirmationRequest,
  action: "cancel",
): ConfirmationCommand;
export function createConfirmationCommand(
  request: ConfirmationRequest,
  action: ConfirmationDecisionAction,
  finalSnapshot?: Readonly<ConfirmationSnapshot>,
): ConfirmationCommand {
  const opaque = {
    confirmationRequestId: request.confirmationRequestId,
    confirmationToken: request.confirmationToken,
    idempotencyKey: request.idempotencyKey,
  };
  if (action === "cancel") return { ...opaque, action };
  if (!finalSnapshot) throw new Error("FINAL_SNAPSHOT_REQUIRED");
  return { ...opaque, action, finalSnapshot: cloneConfirmationSnapshot(finalSnapshot) };
}

export function isConfirmationExpired(request: ConfirmationRequest, now = Date.now()): boolean {
  const expiresAt = Date.parse(request.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function isConfirmationExpiryError(code?: string, message?: string): boolean {
  return code === "CONFIRMATION_EXPIRED" || message?.includes("CONFIRMATION_EXPIRED") === true;
}

export function isWriteConfirmationAction(action: ConfirmationDecisionAction): boolean {
  return action === "confirm";
}

export class ConfirmationSubmissionGate {
  private inFlight = false;

  get locked(): boolean {
    return this.inFlight;
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<{ accepted: true; value: T } | { accepted: false; reason: "duplicate" | "stopped" }> {
    if (signal?.aborted) return { accepted: false, reason: "stopped" };
    if (this.inFlight) return { accepted: false, reason: "duplicate" };
    this.inFlight = true;
    try {
      if (signal?.aborted) return { accepted: false, reason: "stopped" };
      return { accepted: true, value: await task() };
    } finally {
      this.inFlight = false;
    }
  }
}
