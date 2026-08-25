import { PUBLIC_CONTRACT_VERSION, type AgentEvent, type ChatResponse, type ChatUi } from "@/lib/contracts";
import { getPublicProgressTitle } from "@/lib/public-progress";

import type { LocalMessage, LocalProgress } from "./types";

export type StreamTerminal =
  | { kind: "completed" }
  | { kind: "stopped" }
  | { kind: "error"; message: string; retryable: boolean };

export interface StreamState {
  requestId: string;
  lastSequence: number;
  startedAt: number;
  draftText: string;
  pendingUi?: ChatUi;
  progress?: LocalProgress;
  message?: LocalMessage;
  terminal?: StreamTerminal;
}

export function createStreamState(requestId: string): StreamState {
  return {
    requestId,
    lastSequence: 0,
    startedAt: Date.now(),
    draftText: "",
  };
}

function updateProgress(state: StreamState, event: Extract<AgentEvent, { type: "progress" }>): LocalProgress {
  const current = state.progress ?? {
    title: getPublicProgressTitle(event.progress.stage),
    status: "running" as const,
    steps: [],
  };
  const existingIndex = current.steps.findIndex((step) => step.id === event.progress.stage);
  const stepStatus = event.progress.status === "started"
    ? "running"
    : event.progress.status === "completed" ? "completed" : "failed";
  const nextStep = {
    id: event.progress.stage,
    title: event.progress.label,
    status: stepStatus,
    ...(event.progress.durationMs === undefined ? {} : { durationMs: event.progress.durationMs }),
  } as const;
  const steps = existingIndex < 0
    ? [...current.steps, nextStep]
    : current.steps.map((step, index) => index === existingIndex ? { ...step, ...nextStep } : step);
  return {
    ...current,
    title: getPublicProgressTitle(event.progress.stage, current.title),
    status: event.progress.status === "failed" ? "failed" : "running",
    steps,
  };
}

export function applyAgentEvent(state: StreamState, event: AgentEvent): StreamState {
  if (event.sequence <= state.lastSequence || state.terminal) return state;
  const next = { ...state, lastSequence: event.sequence };

  switch (event.type) {
    case "progress":
      return { ...next, progress: updateProgress(next, event) };
    case "token":
      return { ...next, draftText: `${state.draftText}${event.delta}` };
    case "ui":
      return { ...next, pendingUi: event.ui };
    case "final": {
      const ui = event.response.ui ?? state.pendingUi;
      const message: LocalMessage = {
        id: event.response.traceId,
        role: "assistant",
        text: event.response.message,
        ...(ui ? { ui } : {}),
      };
      return finishStream({ ...next, message }, { kind: "completed" });
    }
    case "error":
      return finishStream(
        { ...next, pendingUi: undefined },
        event.error.code === "GENERATION_STOPPED"
          ? { kind: "stopped" }
          : { kind: "error", message: event.error.message, retryable: event.error.retryable },
      );
  }
}

export function finishStream(state: StreamState, terminal: StreamTerminal): StreamState {
  const status: LocalProgress["status"] = terminal.kind === "completed" ? "completed" : terminal.kind === "stopped" ? "stopped" : "failed";
  const progress: LocalProgress | undefined = state.progress ? {
    ...state.progress,
    status,
    totalDurationMs: Date.now() - state.startedAt,
    steps: state.progress.steps.map((step) => step.status === "running"
      ? { ...step, status: terminal.kind === "completed" ? "completed" : status }
      : step),
  } : undefined;
  return {
    ...state,
    terminal,
    pendingUi: terminal.kind === "completed" ? state.pendingUi : undefined,
    ...(progress ? { progress } : {}),
  };
}

export function parseAgentEventBlock(block: string): AgentEvent | undefined {
  const eventName = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
  if (!eventName || !["progress", "token", "ui", "final", "error"].includes(eventName)) return undefined;
  const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!data) return undefined;
  try {
    const value = JSON.parse(data) as Partial<AgentEvent>;
    if (value.type !== eventName || typeof value.sequence !== "number" || typeof value.eventId !== "string") return undefined;
    return value as AgentEvent;
  } catch {
    return undefined;
  }
}

export async function consumeAgentEventStream(
  response: Response,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("服务未返回可读数据流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseAgentEventBlock(block);
      if (event) onEvent(event);
    }
    if (done) break;
  }

  const finalEvent = parseAgentEventBlock(buffer);
  if (finalEvent) onEvent(finalEvent);
}

export async function consumeAgentResponse(
  response: Response,
  onEvent: (event: AgentEvent) => void,
  context: { requestId: string; sessionId: string },
): Promise<void> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    await consumeAgentEventStream(response, onEvent);
    return;
  }

  const chatResponse = await response.json() as ChatResponse;
  onEvent({
    type: "final",
    contractVersion: PUBLIC_CONTRACT_VERSION,
    eventId: `${context.requestId}-final`,
    sessionId: context.sessionId,
    sequence: 1,
    createdAt: new Date().toISOString(),
    traceId: chatResponse.traceId,
    response: chatResponse,
  });
}
