import { describe, expect, it } from "vitest";

import { FEEDBACK_IDLE_DELAY_MS, isFeedbackCheckpoint } from "@/components/chat/feedback-checkpoint";
import type { LocalMessage } from "@/components/chat/types";

function assistantMessage(ui?: LocalMessage["ui"]): LocalMessage {
  return { id: "assistant-1", role: "assistant", text: "测试消息", ui };
}

describe("consumer feedback checkpoints", () => {
  it("waits for 30 seconds of inactivity", () => {
    expect(FEEDBACK_IDLE_DELAY_MS).toBe(30_000);
  });

  it("does not treat intermediate dialogue nodes as completed service outcomes", () => {
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "identity_confirm", maskedPhone: "尾号 6821", purpose: "order" }))).toBe(false);
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "logistics_urge_confirm", orderId: "ORD-1", carrier: "顺丰速运", trackingNo: "SF1", latestStatus: "运输中" }))).toBe(false);
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "clarification" }))).toBe(false);
    expect(isFeedbackCheckpoint(assistantMessage())).toBe(false);
  });

  it("allows feedback after query and submission completion nodes", () => {
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "order", order: {} as never }))).toBe(true);
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "logistics_urge_success", requestNo: "LG-1", carrier: "顺丰速运", handoff: "已提交催办" }))).toBe(true);
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "return_success", requestNo: "RT-1" }))).toBe(true);
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "service_ticket", ticket: {} as never }))).toBe(true);
    expect(isFeedbackCheckpoint(assistantMessage({ kind: "service_ticket_success", ticketNo: "SV-1", serviceType: "维修服务" }))).toBe(true);
  });
});
