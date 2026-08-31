import {
  CONFIRMATION_DECISION_ACTIONS,
  type ConfirmationCommand,
  type ConfirmationDecisionAction,
} from "@/lib/contracts";

export const CONFIRMATION_PROTOCOL_ERROR_CODES = [
  "INVALID_CONFIRMATION_COMMAND",
  "CONFIRMATION_OPERATION_FORBIDDEN",
  "CONFIRMATION_ACTION_CONFLICT",
  "CONFIRMATION_SNAPSHOT_REQUIRED",
  "CONFIRMATION_CANCEL_SNAPSHOT_FORBIDDEN",
] as const;

export type ConfirmationProtocolErrorCode = (typeof CONFIRMATION_PROTOCOL_ERROR_CODES)[number];

export type ConfirmationCommandValidation =
  | { ok: true; value?: ConfirmationCommand }
  | { ok: false; code: ConfirmationProtocolErrorCode; message: string };

const COMMAND_KEYS = new Set([
  "confirmationRequestId",
  "confirmationToken",
  "idempotencyKey",
  "action",
  "finalSnapshot",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isConfirmationDecisionAction(value: unknown): value is ConfirmationDecisionAction {
  return typeof value === "string" && (CONFIRMATION_DECISION_ACTIONS as readonly string[]).includes(value);
}

export function validateConfirmationCommand(
  value: unknown,
  legacyAction?: string,
): ConfirmationCommandValidation {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) {
    return { ok: false, code: "INVALID_CONFIRMATION_COMMAND", message: "confirmation 必须为对象" };
  }
  if ("operation" in value) {
    return {
      ok: false,
      code: "CONFIRMATION_OPERATION_FORBIDDEN",
      message: "operation 只能由服务端确认记录解析，消费者不得提交",
    };
  }
  if (legacyAction) {
    return {
      ok: false,
      code: "CONFIRMATION_ACTION_CONFLICT",
      message: "confirmation 与旧版 action 不能同时提交",
    };
  }
  if (Object.keys(value).some((key) => !COMMAND_KEYS.has(key))) {
    return { ok: false, code: "INVALID_CONFIRMATION_COMMAND", message: "confirmation 包含未允许字段" };
  }
  if (
    !isNonEmptyString(value.confirmationRequestId)
    || !isNonEmptyString(value.confirmationToken)
    || !isNonEmptyString(value.idempotencyKey)
    || !isConfirmationDecisionAction(value.action)
  ) {
    return { ok: false, code: "INVALID_CONFIRMATION_COMMAND", message: "confirmation 缺少有效的请求 ID、令牌、幂等键或动作" };
  }
  if (value.action === "cancel") {
    if (value.finalSnapshot !== undefined) {
      return {
        ok: false,
        code: "CONFIRMATION_CANCEL_SNAPSHOT_FORBIDDEN",
        message: "cancel 不得携带 finalSnapshot",
      };
    }
    return {
      ok: true,
      value: {
        confirmationRequestId: value.confirmationRequestId,
        confirmationToken: value.confirmationToken,
        idempotencyKey: value.idempotencyKey,
        action: "cancel",
      },
    };
  }
  if (!isRecord(value.finalSnapshot)) {
    return {
      ok: false,
      code: "CONFIRMATION_SNAPSHOT_REQUIRED",
      message: "confirm 或 modify 必须携带 finalSnapshot",
    };
  }
  return {
    ok: true,
    value: {
      confirmationRequestId: value.confirmationRequestId,
      confirmationToken: value.confirmationToken,
      idempotencyKey: value.idempotencyKey,
      action: value.action,
      finalSnapshot: value.finalSnapshot,
    } as ConfirmationCommand,
  };
}
