import { describe, expect, it } from "vitest";

import type { ChatRequest, ChatUi } from "@/lib/contracts";

describe("stage-4 compatible public contract", () => {
  it.each([
    "prepare_order_change",
    "prepare_order_cancel",
    "confirm_return_identity",
  ] as const)("accepts deterministic action %s", (action) => {
    const request = { sessionId: "S-stage4", message: "阶段 4", action } satisfies ChatRequest;
    expect(request.action).toBe(action);
  });

  it("uses existing ui events for order results and return status", () => {
    const values: ChatUi[] = [
      {
        kind: "identity_confirm",
        maskedPhone: "尾号 6821",
        purpose: "order_change",
      },
      {
        kind: "order_operation_success",
        result: {
          operation: "order_change",
          orderId: "OD-stage4",
          requestNo: "OCR-stage4",
          status: "submitted",
        },
      },
      {
        kind: "return_status",
        request: {
          requestNo: "RR-stage4",
          orderId: "OD-stage4",
          serviceType: "换货",
          product: "虚拟商品",
          status: "审核中",
          updatedAt: "2026-09-01T10:00:00.000Z",
          events: [],
        },
      },
    ];
    expect(values.map((value) => value.kind)).toEqual([
      "identity_confirm",
      "order_operation_success",
      "return_status",
    ]);
  });
});
