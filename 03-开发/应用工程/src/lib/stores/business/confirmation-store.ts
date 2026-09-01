import { createHash, timingSafeEqual } from "node:crypto";

import type {
  ConfirmationResolution,
  ConfirmationStatus,
  StoredConfirmation,
} from "@/lib/domain/business";
import type { ConfirmationRequest, ToolResult } from "@/lib/contracts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class ConfirmationStore {
  private records = new Map<string, StoredConfirmation>();

  reset(): void {
    this.records.clear();
  }

  savePending(request: ConfirmationRequest): StoredConfirmation {
    const { confirmationToken, ...safeRequest } = clone(request);
    if (this.records.has(request.confirmationRequestId)) {
      throw new Error(`CONFIRMATION_ALREADY_EXISTS:${request.confirmationRequestId}`);
    }
    const record: StoredConfirmation = {
      request: safeRequest,
      tokenDigest: digestToken(confirmationToken),
      status: "pending",
      createdAt: request.createdAt,
      updatedAt: request.createdAt,
    };
    this.records.set(request.confirmationRequestId, record);
    return clone(record);
  }

  get(confirmationRequestId: string): StoredConfirmation | undefined {
    const record = this.records.get(confirmationRequestId);
    return record ? clone(record) : undefined;
  }

  list(): StoredConfirmation[] {
    return [...this.records.values()].map(clone);
  }

  matchesToken(record: StoredConfirmation, token: string): boolean {
    const expected = Buffer.from(record.tokenDigest, "hex");
    const actual = Buffer.from(digestToken(token), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  transition(
    confirmationRequestId: string,
    expected: ConfirmationStatus,
    next: ConfirmationStatus,
    patch: Partial<Pick<StoredConfirmation, "finalSnapshot" | "replacementRequestId">> = {},
    updatedAt = new Date().toISOString(),
  ): boolean {
    const record = this.records.get(confirmationRequestId);
    if (!record || record.status !== expected) return false;
    Object.assign(record, clone(patch), { status: next, updatedAt });
    return true;
  }

  adoptLegacyIdempotencyKey(
    confirmationRequestId: string,
    currentKey: string,
    serverKey: string,
    updatedAt = new Date().toISOString(),
  ): boolean {
    const record = this.records.get(confirmationRequestId);
    if (!record || record.status !== "pending" || record.request.idempotencyKey !== currentKey) return false;
    record.request.idempotencyKey = serverKey;
    record.updatedAt = updatedAt;
    return true;
  }

  finish(
    confirmationRequestId: string,
    result: ToolResult<ConfirmationResolution>,
    updatedAt = new Date().toISOString(),
  ): StoredConfirmation | undefined {
    const record = this.records.get(confirmationRequestId);
    if (!record || record.status !== "executing") return undefined;
    record.status = result.status === "success" ? "completed" : "failed";
    record.result = clone(result);
    record.updatedAt = updatedAt;
    return clone(record);
  }

  failBeforeExecution(
    confirmationRequestId: string,
    result: ToolResult<ConfirmationResolution>,
    updatedAt = new Date().toISOString(),
  ): StoredConfirmation | undefined {
    const record = this.records.get(confirmationRequestId);
    if (!record || record.status !== "pending") return undefined;
    record.status = "failed";
    record.result = clone(result);
    record.updatedAt = updatedAt;
    return clone(record);
  }
}

export const confirmationStore = new ConfirmationStore();
