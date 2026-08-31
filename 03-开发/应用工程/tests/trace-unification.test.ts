import { beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET } from "@/app/api/trace/route";
import { POST as streamChat } from "@/app/api/chat/stream/route";
import { defaultRuntimeTraceStore } from "@/lib/agent-runtime/runtime-singletons";
import { PUBLIC_CONTRACT_VERSION, type AgentEvent, type TraceEvent } from "@/lib/contracts";
import {
  appendTraceEvent,
  clearTraces,
  listTraceEvents,
  listTraces,
  listTraceViews,
} from "@/lib/trace-store";

function parseAgentEvents(value: string): AgentEvent[] {
  return value
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as AgentEvent);
}

function modelEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    contractVersion: PUBLIC_CONTRACT_VERSION,
    eventId: "TE-query-model",
    traceId: "TR-query",
    sessionId: "S-query",
    sequence: 1,
    createdAt: "2026-08-31T08:00:00.000Z",
    type: "model",
    status: "completed",
    payload: { provider: "test", model: "test", mode: "mock", inputSummary: "safe" },
    ...overrides,
  } as TraceEvent;
}

describe("unified TraceEvent architecture", () => {
  beforeEach(() => clearTraces());

  it("keeps Runtime, business projection and consumer response on one traceId", async () => {
    const response = await streamChat(new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "S-unified", message: "查询最近订单", action: "confirm_identity" }),
    }));
    const agentEvents = parseAgentEvents(await response.text());
    const final = agentEvents.find((event) => event.type === "final");
    expect(final?.type).toBe("final");
    if (final?.type !== "final") throw new Error("FINAL_EVENT_MISSING");

    const traceId = final.response.traceId;
    const traceEvents = listTraceEvents({ traceId });
    expect(new Set(traceEvents.map((event) => event.traceId))).toEqual(new Set([traceId]));
    expect(traceEvents.map((event) => event.type)).toEqual(expect.arrayContaining(["model", "route", "tool", "output"]));
    expect(traceEvents.map((event) => event.sequence)).toEqual(traceEvents.map((_, index) => index + 1));
    expect(listTraces("S-unified")[0].traceId).toBe(traceId);
    expect(defaultRuntimeTraceStore.list(traceId)).toHaveLength(0);
    expect(listTraceViews({ traceId })).toHaveLength(1);
    const traceResponse = await GET(new Request(`http://localhost/api/trace?traceId=${encodeURIComponent(traceId)}`));
    const traceBody = await traceResponse.json() as { records: Array<{ traceId: string; events: TraceEvent[] }>; events: TraceEvent[] };
    expect(traceBody.records).toHaveLength(1);
    expect(traceBody.records[0].traceId).toBe(traceId);
    expect(traceBody.records[0].events.map((event) => event.type)).toEqual(expect.arrayContaining(["model", "route", "rule", "tool", "output"]));
    expect(new Set(traceBody.events.map((event) => event.traceId))).toEqual(new Set([traceId]));
    expect(final.response).not.toHaveProperty("debug");
    expect(final.response).not.toHaveProperty("route");
  });

  it("queries by trace, session, time, event type and status", async () => {
    appendTraceEvent(modelEvent());
    appendTraceEvent(modelEvent({
      eventId: "TE-query-error",
      sequence: 2,
      createdAt: "2026-08-31T09:00:00.000Z",
      type: "error",
      status: "failed",
      payload: { code: "RUNTIME_FAILURE", message: "failed", retryable: true },
    }));

    expect(listTraceEvents({
      traceId: "TR-query",
      sessionId: "S-query",
      from: "2026-08-31T07:59:00.000Z",
      to: "2026-08-31T08:01:00.000Z",
      type: "model",
      status: "completed",
    }).map((event) => event.eventId)).toEqual(["TE-query-model"]);

    const apiResponse = await GET(new Request("http://localhost/api/trace?traceId=TR-query&sessionId=S-query&type=error&status=failed&from=2026-08-31T08:30:00.000Z"));
    expect(apiResponse.status).toBe(200);
    const body = await apiResponse.json() as { events: TraceEvent[] };
    expect(body.events.map((event) => event.eventId)).toEqual(["TE-query-error"]);
    expect((await GET(new Request("http://localhost/api/trace?type=unknown"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/trace?from=2026-08-31T09:00:00.000Z&to=2026-08-31T08:00:00.000Z"))).status).toBe(400);
  });

  it("records confirmed business writes on the Runtime trace and clears every trace store", async () => {
    const response = await streamChat(new Request("http://localhost/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "S-confirmation-trace", message: "确认催物流", action: "submit_logistics_urge" }),
    }));
    const final = parseAgentEvents(await response.text()).find((event) => event.type === "final");
    if (final?.type !== "final") throw new Error("FINAL_EVENT_MISSING");

    const traceEvents = listTraceEvents({ traceId: final.response.traceId });
    const confirmations = traceEvents.filter(
      (event): event is Extract<TraceEvent, { type: "confirmation" }> => event.type === "confirmation",
    );
    expect(confirmations.map((event) => event.status)).toEqual(["started", "completed"]);
    expect(confirmations.every((event) => event.traceId === final.response.traceId)).toBe(true);
    expect(confirmations.every((event) => event.payload.request.confirmationToken === "***")).toBe(true);
    expect(confirmations.every((event) => event.payload.request.idempotencyKey === "***")).toBe(true);

    expect((await DELETE()).status).toBe(200);
    expect(listTraceEvents()).toHaveLength(0);
    expect(listTraces()).toHaveLength(0);
    expect(defaultRuntimeTraceStore.list()).toHaveLength(0);
  });

  it("redacts image payloads, credentials, personal data and private reasoning", () => {
    appendTraceEvent(modelEvent({
      payload: {
        provider: "test",
        model: "test",
        mode: "mock",
        inputSummary: "data:image/png;base64,AA== Authorization: Bearer secret-token api_key=live-secret 手机 13800006821 地址 上海市浦东新区测试路18号",
        outputSummary: "<think>private chain</think> public answer",
      },
    }));
    const serialized = JSON.stringify(listTraceEvents({ traceId: "TR-query" }));
    expect(serialized).not.toMatch(/AA==|secret-token|live-secret|13800006821|测试路18号|private chain/);
    expect(serialized).toContain("REDACTED");
  });
});
