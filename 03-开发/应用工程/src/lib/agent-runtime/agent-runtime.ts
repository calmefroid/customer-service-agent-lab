import { randomUUID } from "node:crypto";

import type {
  AgentEvent,
  AgentPublicError,
  ChatRequest,
  ChatResponse,
  RiskLevel,
  RouteDecision,
  TraceEvent,
} from "@/lib/contracts";
import { PUBLIC_CONTRACT_VERSION } from "@/lib/contracts";
import { ModelAdapterError } from "@/lib/models";
import { InMemorySessionStore, type ImageObservation } from "@/lib/sessions";

import { fallbackRoute, parseStructuredRoute, ROUTER_SYSTEM_PROMPT, ROUTE_RESPONSE_SCHEMA } from "./route-schema";
import type { AgentRuntimeDependencies, RuntimeRunOptions } from "./types";

function redactString(value: string): string {
  return value
    .replace(/1\d{2}\d{4}(\d{4})/g, "1********$1")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "***@***")
    .replace(/(sk-|api[_-]?key[=: ]+)[A-Za-z0-9_-]+/gi, "$1***");
}

function sanitizeForTrace(value: unknown, key = ""): unknown {
  if (/api.?key|authorization|secret|token/i.test(key)) return "***";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForTrace(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeForTrace(childValue, childKey)]));
  }
  return value;
}

function riskForRoute(route: RouteDecision): RiskLevel {
  if (route.requiresHuman || route.topic.startsWith("safety.")) return "high";
  if (route.requiresConfirmation) return "medium";
  return "low";
}

function chunks(message: string, size = 8): string[] {
  if (!message) return [];
  const result: string[] = [];
  for (let index = 0; index < message.length; index += size) result.push(message.slice(index, index + size));
  return result;
}

function mapModelError(error: unknown): AgentPublicError {
  if (error instanceof ModelAdapterError) {
    if (error.code === "cancelled") return { code: "GENERATION_STOPPED", message: "已停止生成", retryable: false };
    if (error.code === "timeout") return { code: "MODEL_TIMEOUT", message: "模型响应超时，请重试", retryable: true };
    if (error.code === "refusal") return { code: "MODEL_REFUSED", message: "模型无法处理该请求，请换一种表达", retryable: false };
    return { code: "MODEL_UNAVAILABLE", message: "模型服务暂时不可用，请稍后重试", retryable: true };
  }
  return { code: "RUNTIME_FAILURE", message: "处理请求时发生错误，请重试", retryable: true };
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(() => controller.abort("model-timeout"), timeoutMs);

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          if (parentSignal?.aborted) reject(new ModelAdapterError("cancelled", "生成已停止", false));
          else reject(new ModelAdapterError("timeout", "模型响应超时", true));
        }, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

export class AgentRuntime {
  private readonly sessions;
  private readonly modelTimeoutMs;
  private readonly now;
  private readonly idFactory;

  constructor(private readonly dependencies: AgentRuntimeDependencies) {
    this.sessions = dependencies.sessions ?? new InMemorySessionStore();
    this.modelTimeoutMs = dependencies.modelTimeoutMs ?? 15_000;
    this.now = dependencies.now ?? (() => new Date());
    this.idFactory = dependencies.idFactory ?? randomUUID;
  }

  async *run(request: ChatRequest, options: RuntimeRunOptions = {}): AsyncGenerator<AgentEvent> {
    const traceId = `TR-RUNTIME-${this.idFactory()}`;
    const messageId = `MSG-${this.idFactory()}`;
    let eventSequence = 0;
    let traceSequence = 0;
    const createdAt = () => this.now().toISOString();
    const makeEvent = <T extends AgentEvent>(event: Omit<T, "contractVersion" | "eventId" | "sessionId" | "sequence" | "createdAt" | "traceId">): T => ({
      contractVersion: PUBLIC_CONTRACT_VERSION,
      eventId: `EV-${this.idFactory()}`,
      sessionId: request.sessionId,
      sequence: ++eventSequence,
      createdAt: createdAt(),
      traceId,
      ...event,
    }) as T;
    const appendTrace = (event: Omit<TraceEvent, "contractVersion" | "eventId" | "traceId" | "sessionId" | "sequence" | "createdAt">) => {
      this.dependencies.traceSink?.append({
        contractVersion: PUBLIC_CONTRACT_VERSION,
        eventId: `TE-${this.idFactory()}`,
        traceId,
        sessionId: request.sessionId,
        sequence: ++traceSequence,
        createdAt: createdAt(),
        ...event,
      } as TraceEvent);
    };
    const stopped = () => options.signal?.aborted === true;
    const stoppedEvent = () => makeEvent<Extract<AgentEvent, { type: "error" }>>({
      type: "error",
      error: { code: "GENERATION_STOPPED", message: "已停止生成", retryable: false },
    });

    this.sessions.getOrCreate(request.sessionId);
    this.sessions.appendMessage(request.sessionId, { role: "user", content: request.message, createdAt: createdAt() });
    if (stopped()) {
      yield stoppedEvent();
      return;
    }

    try {
      let observation: ImageObservation | undefined;
      if (request.attachment) {
        const startedAt = this.now().getTime();
        yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
          type: "progress",
          progress: { stage: "image_observation", label: "正在识别图片中的可见信息", status: "started" },
        });
        if (stopped()) {
          yield stoppedEvent();
          return;
        }

        const session = this.sessions.getOrCreate(request.sessionId);
        const output = await withTimeout(
          (signal) => this.dependencies.multimodalModel.observe({
            message: request.message,
            module: request.module,
            attachment: request.attachment!,
            history: session.messages,
          }, { signal }),
          options.signal,
          this.modelTimeoutMs,
        );
        appendTrace({
          type: "model",
          status: "completed",
          durationMs: this.now().getTime() - startedAt,
          payload: {
            provider: output.provider,
            model: output.model,
            mode: output.mode,
            inputSummary: JSON.stringify(sanitizeForTrace({ message: request.message, attachment: request.attachment })),
            outputSummary: JSON.stringify(sanitizeForTrace({ summary: output.summary, uncertainties: output.uncertainties, requiresBusinessRouting: output.requiresBusinessRouting })),
          },
        });
        observation = {
          attachmentName: request.attachment.name,
          summary: output.summary,
          uncertainties: output.uncertainties,
          createdAt: createdAt(),
        };
        this.sessions.addObservation(request.sessionId, observation);
        yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
          type: "progress",
          progress: { stage: "image_observation", label: "图片可见信息识别完成", status: "completed", durationMs: this.now().getTime() - startedAt },
        });

        if (!output.requiresBusinessRouting) {
          const route = fallbackRoute({ ...request, observations: [output.summary] });
          appendTrace({ type: "route", status: "completed", payload: { selected: route, candidates: [{ intent: route.intent, topic: route.topic, score: route.confidence }] } });
          for (const delta of chunks(output.responseText)) {
            if (stopped()) {
              yield stoppedEvent();
              return;
            }
            yield makeEvent<Extract<AgentEvent, { type: "token" }>>({ type: "token", messageId, delta });
          }
          const finalResponse: ChatResponse = {
            message: output.responseText,
            intent: route.intent,
            riskLevel: riskForRoute(route),
            traceId,
          };
          appendTrace({ type: "output", status: "completed", payload: { audience: "consumer", summary: redactString(output.responseText) } });
          this.sessions.setRemainingIntents(request.sessionId, route.remainingIntents);
          this.sessions.appendMessage(request.sessionId, { role: "assistant", content: output.responseText, createdAt: createdAt() });
          yield makeEvent<Extract<AgentEvent, { type: "final" }>>({ type: "final", response: finalResponse });
          return;
        }
      }

      const routeStartedAt = this.now().getTime();
      yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
        type: "progress",
        progress: { stage: "routing", label: "正在理解问题并选择处理路径", status: "started" },
      });
      if (stopped()) {
        yield stoppedEvent();
        return;
      }

      const session = this.sessions.getOrCreate(request.sessionId);
      const observations = session.observations.map((item) => `${item.summary}；不确定项：${item.uncertainties.join("；")}`);
      const modelInput = {
        message: request.message,
        module: request.module,
        action: request.action,
        attachment: request.attachment,
        history: session.messages,
        observations,
        remainingIntents: session.remainingIntents,
        applicationSystemPrompt: ROUTER_SYSTEM_PROMPT,
        responseSchema: ROUTE_RESPONSE_SCHEMA,
      };
      const modelOutput = await withTimeout(
        (signal) => this.dependencies.textModel.route(modelInput, { signal }),
        options.signal,
        this.modelTimeoutMs,
      );
      appendTrace({
        type: "model",
        status: "completed",
        durationMs: this.now().getTime() - routeStartedAt,
        payload: {
          provider: modelOutput.provider,
          model: modelOutput.model,
          mode: modelOutput.mode,
          inputSummary: JSON.stringify(sanitizeForTrace({
            templateId: "intent-router-system",
            version: "runtime-v1",
            applicationSystemPrompt: ROUTER_SYSTEM_PROMPT,
            messages: session.messages,
            observations,
            responseSchema: ROUTE_RESPONSE_SCHEMA,
          })),
          outputSummary: redactString(modelOutput.raw),
        },
      });

      const parsed = parseStructuredRoute(modelOutput.raw);
      let route: RouteDecision;
      if (parsed.ok) route = parsed.value;
      else {
        route = fallbackRoute({ ...request, observations });
        appendTrace({
          type: "error",
          status: "completed",
          payload: {
            code: "MODEL_OUTPUT_INVALID",
            message: "模型结构化路由输出无效，已使用确定性规则兜底",
            retryable: false,
            internalCode: "MODEL_OUTPUT_INVALID",
          },
        });
      }
      this.sessions.setRemainingIntents(request.sessionId, route.remainingIntents);
      appendTrace({ type: "route", status: "completed", durationMs: this.now().getTime() - routeStartedAt, payload: { selected: route, candidates: [{ intent: route.intent, topic: route.topic, score: route.confidence }] } });
      yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
        type: "progress",
        progress: { stage: "routing", label: "处理路径已确认", status: "completed", durationMs: this.now().getTime() - routeStartedAt },
      });

      if (stopped()) {
        yield stoppedEvent();
        return;
      }
      const workflowStartedAt = this.now().getTime();
      yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
        type: "progress",
        progress: { stage: "workflow", label: route.requiresConfirmation ? "正在准备可确认的信息" : "正在处理你的请求", status: "started" },
      });
      // yield 之后再次检查，使客户端“停止生成”可以在任何写工具启动前生效。
      if (stopped()) {
        appendTrace({ type: "error", status: "completed", payload: { code: "GENERATION_STOPPED", message: "写操作启动前收到中断", retryable: false, internalCode: "ABORT_BEFORE_WORKFLOW" } });
        yield stoppedEvent();
        return;
      }

      const workflowResponse = await this.dependencies.workflow.execute(request, {
        traceId,
        route,
        observation,
        session: this.sessions.getOrCreate(request.sessionId),
        signal: options.signal,
      });
      if (stopped()) {
        yield stoppedEvent();
        return;
      }
      yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
        type: "progress",
        progress: { stage: "workflow", label: "请求处理完成", status: "completed", durationMs: this.now().getTime() - workflowStartedAt },
      });

      if (workflowResponse.ui) {
        yield makeEvent<Extract<AgentEvent, { type: "ui" }>>({ type: "ui", ui: workflowResponse.ui });
      }
      for (const delta of chunks(workflowResponse.message)) {
        if (stopped()) {
          yield stoppedEvent();
          return;
        }
        yield makeEvent<Extract<AgentEvent, { type: "token" }>>({ type: "token", messageId, delta });
      }

      // 不把 workflow 内部 route/debug 对象带到消费者流中。
      const finalResponse: ChatResponse = {
        message: workflowResponse.message,
        intent: workflowResponse.intent,
        riskLevel: workflowResponse.riskLevel,
        traceId,
        ...(workflowResponse.ui ? { ui: workflowResponse.ui } : {}),
      };
      appendTrace({ type: "output", status: "completed", payload: { audience: "consumer", summary: redactString(finalResponse.message) } });
      this.sessions.appendMessage(request.sessionId, { role: "assistant", content: finalResponse.message, createdAt: createdAt() });
      yield makeEvent<Extract<AgentEvent, { type: "final" }>>({ type: "final", response: finalResponse });
    } catch (error) {
      const publicError = mapModelError(error);
      appendTrace({ type: "error", status: "failed", payload: { ...publicError, internalCode: error instanceof Error ? error.name : "UNKNOWN_RUNTIME_ERROR" } });
      yield makeEvent<Extract<AgentEvent, { type: "error" }>>({ type: "error", error: publicError });
    }
  }
}
