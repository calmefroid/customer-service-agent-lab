import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/lib/contracts";
import {
  applyAgentEvent,
  createStreamState,
  finishStream,
  parseAgentEventBlock,
} from "@/components/chat/stream-state";

const base = {
  contractVersion: "1.1.0",
  sessionId: "consumer-test",
  createdAt: "2026-08-25T00:00:00.000Z",
  traceId: "TR-consumer",
} as const;

type EventInput = AgentEvent extends infer T
  ? T extends AgentEvent ? Omit<T, keyof typeof base> : never
  : never;

function event(value: EventInput): AgentEvent {
  return { ...base, ...value } as unknown as AgentEvent;
}

describe("consumer AgentEvent stream state", () => {
  it("updates public stages strictly in server event order", () => {
    let state = createStreamState("request-1");
    state = applyAgentEvent(state, event({
      type: "progress",
      eventId: "e-1",
      sequence: 1,
      progress: { stage: "routing", label: "正在理解问题并选择处理路径", status: "started" },
    }));
    state = applyAgentEvent(state, event({
      type: "progress",
      eventId: "e-2",
      sequence: 2,
      progress: { stage: "routing", label: "处理路径已确认", status: "completed", durationMs: 24 },
    }));
    state = applyAgentEvent(state, event({
      type: "progress",
      eventId: "e-3",
      sequence: 3,
      progress: { stage: "workflow", label: "正在处理你的请求", status: "started" },
    }));

    expect(state.progress?.steps).toEqual([
      expect.objectContaining({ id: "routing", status: "completed", durationMs: 24 }),
      expect.objectContaining({ id: "workflow", status: "running" }),
    ]);

    const stale = applyAgentEvent(state, event({
      type: "token",
      eventId: "stale",
      sequence: 2,
      messageId: "message-1",
      delta: "不应出现",
    }));
    expect(stale).toBe(state);
  });

  it("assembles tokens but only commits UI on final", () => {
    let state = createStreamState("request-2");
    state = applyAgentEvent(state, event({
      type: "ui",
      eventId: "e-1",
      sequence: 1,
      ui: { kind: "return_success", requestNo: "SR-100" },
    }));
    state = applyAgentEvent(state, event({
      type: "token",
      eventId: "e-2",
      sequence: 2,
      messageId: "message-2",
      delta: "已提",
    }));
    state = applyAgentEvent(state, event({
      type: "token",
      eventId: "e-3",
      sequence: 3,
      messageId: "message-2",
      delta: "交",
    }));

    expect(state.draftText).toBe("已提交");
    expect(state.message).toBeUndefined();

    state = applyAgentEvent(state, event({
      type: "final",
      eventId: "e-4",
      sequence: 4,
      response: {
        message: "已提交",
        intent: "create_return",
        riskLevel: "low",
        traceId: "TR-consumer",
        ui: { kind: "return_success", requestNo: "SR-100" },
        route: { debug: "must-not-leak" },
      } as never,
    }));

    expect(state.message).toEqual({
      id: "TR-consumer",
      role: "assistant",
      text: "已提交",
      ui: { kind: "return_success", requestNo: "SR-100" },
    });
    expect(JSON.stringify(state.message)).not.toContain("debug");
    expect(JSON.stringify(state.message)).not.toContain("route");
  });

  it("drops a buffered success card when the stream fails", () => {
    let state = createStreamState("request-3");
    state = applyAgentEvent(state, event({
      type: "ui",
      eventId: "e-1",
      sequence: 1,
      ui: { kind: "service_ticket_success", ticketNo: "WO-100", serviceType: "维修服务" },
    }));
    state = applyAgentEvent(state, event({
      type: "error",
      eventId: "e-2",
      sequence: 2,
      error: { code: "TOOL_TIMEOUT", message: "提交超时", retryable: true },
    }));

    expect(state.message).toBeUndefined();
    expect(state.pendingUi).toBeUndefined();
    expect(state.terminal).toEqual({ kind: "error", message: "提交超时", retryable: true, code: "TOOL_TIMEOUT" });
  });

  it("returns to an idle, retryable state after local abort", () => {
    const state = finishStream(createStreamState("request-4"), { kind: "stopped" });
    expect(state.terminal).toEqual({ kind: "stopped" });
    expect(state.progress?.status).not.toBe("running");
  });

  it("parses SSE data blocks and rejects unrelated payloads", () => {
    const parsed = parseAgentEventBlock([
      "id: e-1",
      "event: token",
      `data: ${JSON.stringify({ ...base, type: "token", eventId: "e-1", sequence: 1, messageId: "m-1", delta: "你好" })}`,
    ].join("\n"));
    expect(parsed).toMatchObject({ type: "token", delta: "你好" });
    expect(parseAgentEventBlock("event: ping\ndata: {}")) .toBeUndefined();
  });
});
