import { describe, expect, it } from "vitest";

import { POST as chat } from "@/app/api/chat/route";
import { POST as streamChat } from "@/app/api/chat/stream/route";
import { validateConfirmationCommand } from "@/lib/confirmation-protocol";
import type { AgentEvent, ConfirmationRequest } from "@/lib/contracts";

const base = {
  confirmationRequestId: "confirmation-001",
  confirmationToken: "opaque-token",
  idempotencyKey: "idem-001",
};

describe("stage-3 confirmation protocol", () => {
  it.each(["confirm", "modify"] as const)("requires finalSnapshot for %s", (action) => {
    expect(validateConfirmationCommand({ ...base, action })).toMatchObject({
      ok: false,
      code: "CONFIRMATION_SNAPSHOT_REQUIRED",
    });
    expect(validateConfirmationCommand({ ...base, action, finalSnapshot: { orderId: "OD-1" } })).toMatchObject({
      ok: true,
      value: { action, finalSnapshot: { orderId: "OD-1" } },
    });
  });

  it("accepts cancel without a snapshot and rejects a cancel payload", () => {
    expect(validateConfirmationCommand({ ...base, action: "cancel" })).toMatchObject({ ok: true });
    expect(validateConfirmationCommand({ ...base, action: "cancel", finalSnapshot: {} })).toMatchObject({
      ok: false,
      code: "CONFIRMATION_CANCEL_SNAPSHOT_FORBIDDEN",
    });
  });

  it("rejects client operation selection and mixed legacy action", () => {
    expect(validateConfirmationCommand({ ...base, action: "confirm", operation: "order_cancel", finalSnapshot: {} })).toMatchObject({
      ok: false,
      code: "CONFIRMATION_OPERATION_FORBIDDEN",
    });
    expect(validateConfirmationCommand({ ...base, action: "confirm", finalSnapshot: {} }, "submit_return")).toMatchObject({
      ok: false,
      code: "CONFIRMATION_ACTION_CONFLICT",
    });
  });

  it.each([
    ["sync", chat],
    ["stream", streamChat],
  ] as const)("rejects forged operation at the %s Chat API boundary", async (_name, handler) => {
    const response = await handler(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "S-confirmation-forgery",
        message: "确认",
        confirmation: { ...base, action: "confirm", operation: "order_cancel", finalSnapshot: {} },
      }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "CONFIRMATION_OPERATION_FORBIDDEN" });
  });

  it("uses the existing AgentEvent.ui channel for a formal ConfirmationRequest", () => {
    const request: ConfirmationRequest = {
      confirmationRequestId: "confirmation-001",
      sessionId: "S-confirmation-ui",
      traceId: "TR-confirmation-ui",
      operation: "logistics_urge",
      target: { type: "shipment", id: "SHIP-1" },
      draftSnapshot: { orderId: "OD-1" },
      riskLevel: "medium",
      risks: ["将创建物流催办记录"],
      confirmationToken: "opaque-token",
      idempotencyKey: "idem-001",
      createdAt: "2026-08-31T10:00:00.000Z",
      expiresAt: "2026-08-31T10:15:00.000Z",
    };
    const event: AgentEvent = {
      contractVersion: "1.1.0",
      eventId: "EV-confirmation-ui",
      sessionId: request.sessionId,
      sequence: 1,
      createdAt: request.createdAt,
      traceId: request.traceId,
      type: "ui",
      ui: { kind: "confirmation", request },
    };
    expect(event.ui).toEqual({ kind: "confirmation", request });
  });
});
