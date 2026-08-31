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

const TRACE_PROMPTS = {
  imageObservation: {
    templateId: "image-observation-system",
    templateVersion: "runtime-v2",
    schemaVersion: "image-observation-1.0.0",
  },
  textRoute: {
    templateId: "intent-router-system",
    templateVersion: "runtime-v2",
    schemaVersion: "route-decision-1.1.0",
  },
  lowRiskAnswer: {
    templateId: "consumer-answer-system",
    templateVersion: "runtime-v2",
    schemaVersion: "consumer-answer-1.1.0",
  },
} as const;

type ModelOperation = "image_observation" | "text_route" | "low_risk_answer";
type ModelIdentity = { provider: string; model: string; mode: "mock" | "live" };

function redactString(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "[REDACTED_PRIVATE_REASONING]")
    .replace(/<think>[\s\S]*$/gi, "[REDACTED_PRIVATE_REASONING]")
    .replace(/(?:chain[_ -]?of[_ -]?thought|private[_ -]?reasoning)\s*[:=][^\n]*/gi, "[REDACTED_PRIVATE_REASONING]")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, "[REDACTED_IMAGE_PAYLOAD]")
    .replace(/data.?url|image.?data/gi, "[REDACTED_IMAGE_FIELD]")
    .replace(/base64/gi, "[REDACTED_ENCODING]")
    .replace(/[A-Za-z0-9+/]{64,}={0,2}/g, "[REDACTED_ENCODED_PAYLOAD]")
    .replace(/1\d{2}\d{4}(\d{4})/g, "1********$1")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "***@***")
    .replace(/(?:北京市|上海市|天津市|重庆市|[\p{Script=Han}]{2,8}(?:省|自治区))[\p{Script=Han}A-Za-z0-9* -]{2,50}(?:路|街|道|巷)[\p{Script=Han}A-Za-z0-9* -]{0,20}(?:号|室)/gu, "[REDACTED_ADDRESS]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "Authorization: ***")
    .replace(/(sk-|api[_-]?key[=: ]+)[A-Za-z0-9_-]+/gi, "$1***");
}

function sanitizeForTrace(value: unknown, key = ""): unknown {
  if (/api.?key|authorization|secret|token/i.test(key)) return "***";
  if (/data.?url|base64|image.?data/i.test(key)) return undefined;
  if (/chain.?of.?thought|private.?reasoning|hidden.?reasoning|thinking/i.test(key)) return "[OMITTED]";
  if (/(?:phone|mobile)$/i.test(key)) return "[REDACTED_PHONE]";
  if (/address$/i.test(key)) return "[REDACTED_ADDRESS]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForTrace(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([childKey]) => !/data.?url|base64|image.?data/i.test(childKey))
        .map(([childKey, childValue]) => [childKey, sanitizeForTrace(childValue, childKey)]),
    );
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

function modelFailureReason(error: unknown, defaultReason: string): string {
  if (error instanceof ModelAdapterError) {
    if (error.code === "cancelled") return "abort";
    return error.code;
  }
  return defaultReason;
}

function modelInputSummary(
  operation: ModelOperation,
  prompt: typeof TRACE_PROMPTS[keyof typeof TRACE_PROMPTS],
  input: unknown,
): string {
  return JSON.stringify(sanitizeForTrace({ operation, prompt, input }));
}

function modelOutputSummary(output: unknown, fallbackReason?: string): string {
  return JSON.stringify(sanitizeForTrace({
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(output === undefined ? {} : { output }),
  }));
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (parentSignal?.aborted) throw new ModelAdapterError("cancelled", "生成已停止", false);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(() => controller.abort("model-timeout"), timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => {
      if (parentSignal?.aborted) reject(new ModelAdapterError("cancelled", "生成已停止", false));
      else reject(new ModelAdapterError("timeout", "模型响应超时", true));
    }, { once: true });
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      aborted,
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
    const traceId = options.traceId ?? `TR-RUNTIME-${this.idFactory()}`;
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
    const appendModelTrace = ({
      identity,
      operation,
      status,
      inputSummary,
      output,
      fallbackReason,
      durationMs,
    }: {
      identity: ModelIdentity;
      operation: ModelOperation;
      status: "started" | "completed" | "failed";
      inputSummary: string;
      output?: unknown;
      fallbackReason?: string;
      durationMs?: number;
    }) => appendTrace({
      type: "model",
      status,
      ...(durationMs === undefined ? {} : { durationMs }),
      payload: {
        provider: identity.provider,
        model: identity.model,
        mode: identity.mode,
        inputSummary,
        outputSummary: modelOutputSummary({ operation, status, result: output }, fallbackReason),
      },
    });
    let abortTraceRecorded = false;
    const appendAbortTrace = (internalCode: string, message: string) => {
      if (abortTraceRecorded) return;
      abortTraceRecorded = true;
      appendTrace({
        type: "error",
        status: "failed",
        payload: { code: "GENERATION_STOPPED", message, retryable: false, internalCode },
      });
    };
    const stopped = () => options.signal?.aborted === true;
    const stoppedEvent = () => makeEvent<Extract<AgentEvent, { type: "error" }>>({
      type: "error",
      error: { code: "GENERATION_STOPPED", message: "已停止生成", retryable: false },
    });

    this.sessions.getOrCreate(request.sessionId);
    this.sessions.appendMessage(request.sessionId, { role: "user", content: request.message, createdAt: createdAt() });
    if (stopped()) {
      appendAbortTrace("ABORT_BEFORE_RUNTIME", "请求开始前收到中断");
      yield stoppedEvent();
      return;
    }

    try {
      let observation: ImageObservation | undefined;
      if (request.attachment) {
        const startedAt = this.now().getTime();
        const imageInputSummary = modelInputSummary(
          "image_observation",
          TRACE_PROMPTS.imageObservation,
          {
            message: request.message,
            module: request.module,
            attachment: {
              name: request.attachment.name,
              type: request.attachment.type,
              size: request.attachment.size,
            },
          },
        );
        yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
          type: "progress",
          progress: { stage: "image_observation", label: "正在识别图片中的可见信息", status: "started" },
        });
        if (stopped()) {
          appendAbortTrace("ABORT_BEFORE_IMAGE_OBSERVATION", "图片观察启动前收到中断");
          yield stoppedEvent();
          return;
        }

        const session = this.sessions.getOrCreate(request.sessionId);
        const imageIdentity = this.dependencies.multimodalModel;
        appendModelTrace({
          identity: imageIdentity,
          operation: "image_observation",
          status: "started",
          inputSummary: imageInputSummary,
        });
        let output;
        try {
          output = await withTimeout(
            (signal) => this.dependencies.multimodalModel.observe({
              message: request.message,
              module: request.module,
              attachment: request.attachment!,
              history: session.messages,
            }, { signal }),
            options.signal,
            this.modelTimeoutMs,
          );
          appendModelTrace({
            identity: output,
            operation: "image_observation",
            status: "completed",
            inputSummary: imageInputSummary,
            output: {
              summary: output.summary,
              uncertainties: output.uncertainties,
              requiresBusinessRouting: output.requiresBusinessRouting,
            },
            durationMs: this.now().getTime() - startedAt,
          });
        } catch (error) {
          appendModelTrace({
            identity: imageIdentity,
            operation: "image_observation",
            status: "failed",
            inputSummary: imageInputSummary,
            fallbackReason: modelFailureReason(error, "image_observation_failed"),
            durationMs: this.now().getTime() - startedAt,
          });
          throw error;
        }
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
              appendAbortTrace("ABORT_DURING_IMAGE_RESPONSE", "图片观察回复生成时收到中断");
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
        appendAbortTrace("ABORT_BEFORE_TEXT_ROUTE", "文字模型路由启动前收到中断");
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
      const routeInputSummary = modelInputSummary("text_route", TRACE_PROMPTS.textRoute, {
        message: request.message,
        module: request.module,
        action: request.action,
        attachment: request.attachment ? {
          name: request.attachment.name,
          type: request.attachment.type,
          size: request.attachment.size,
        } : undefined,
        history: session.messages,
        observations,
        remainingIntents: session.remainingIntents,
      });
      const routeIdentity = this.dependencies.textModel;
      appendModelTrace({
        identity: routeIdentity,
        operation: "text_route",
        status: "started",
        inputSummary: routeInputSummary,
      });
      let modelOutput;
      try {
        modelOutput = await withTimeout(
          (signal) => this.dependencies.textModel.route(modelInput, { signal }),
          options.signal,
          this.modelTimeoutMs,
        );
      } catch (error) {
        appendModelTrace({
          identity: routeIdentity,
          operation: "text_route",
          status: "failed",
          inputSummary: routeInputSummary,
          fallbackReason: modelFailureReason(error, "text_route_failed"),
          durationMs: this.now().getTime() - routeStartedAt,
        });
        throw error;
      }

      const parsed = parseStructuredRoute(modelOutput.raw);
      appendModelTrace({
        identity: modelOutput,
        operation: "text_route",
        status: "completed",
        inputSummary: routeInputSummary,
        output: {
          raw: modelOutput.raw,
          structuredOutput: parsed.ok ? "accepted" : "rejected",
        },
        ...(parsed.ok ? {} : { fallbackReason: parsed.reason }),
        durationMs: this.now().getTime() - routeStartedAt,
      });
      appendTrace({
        type: "rule",
        status: "completed",
        payload: {
          ruleId: "RULE-STRUCTURED-OUTPUT-PARSE-001",
          matched: parsed.ok,
          evidence: [TRACE_PROMPTS.textRoute.schemaVersion, ...(parsed.ok ? [] : parsed.issues)],
          effect: parsed.ok ? "accept_structured_route" : `fallback_to_deterministic_route:${parsed.reason}`,
        },
      });
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
      const deterministicGuard = fallbackRoute({ ...request, observations });
      if (request.action || deterministicGuard.topic.startsWith("safety.") || deterministicGuard.requiresHuman) {
        route = deterministicGuard;
        appendTrace({
          type: "rule",
          status: "completed",
          payload: {
            ruleId: "RULE-DETERMINISTIC-GUARD-001",
            matched: true,
            evidence: [request.action ?? deterministicGuard.topic],
            effect: "override_model_route",
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
        appendAbortTrace("ABORT_AFTER_TEXT_ROUTE", "文字模型路由完成后收到中断");
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
        appendAbortTrace("ABORT_BEFORE_WORKFLOW", "写操作启动前收到中断");
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
        appendAbortTrace("ABORT_AFTER_WORKFLOW", "业务工作流完成后收到中断");
        yield stoppedEvent();
        return;
      }
      yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
        type: "progress",
        progress: { stage: "workflow", label: "请求处理完成", status: "completed", durationMs: this.now().getTime() - workflowStartedAt },
      });
      if (stopped()) {
        appendAbortTrace("ABORT_AFTER_WORKFLOW_PROGRESS", "业务工作流完成后收到中断");
        yield stoppedEvent();
        return;
      }

      let responseMessage = workflowResponse.message;
      if (this.dependencies.textModel.mode === "live" && workflowResponse.riskLevel === "low") {
        const answerStartedAt = this.now().getTime();
        const answerInput = {
          message: request.message,
          route,
          history: this.sessions.getOrCreate(request.sessionId).messages,
          observations,
          workflowResult: {
            message: workflowResponse.message,
            intent: workflowResponse.intent,
            riskLevel: workflowResponse.riskLevel,
            ...(workflowResponse.ui ? { uiKind: workflowResponse.ui.kind } : {}),
          },
        };
        const answerInputSummary = modelInputSummary("low_risk_answer", TRACE_PROMPTS.lowRiskAnswer, answerInput);
        const answerIdentity = this.dependencies.textModel;
        yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
          type: "progress",
          progress: { stage: "answer_generation", label: "正在整理回复", status: "started" },
        });
        if (stopped()) {
          appendAbortTrace("ABORT_BEFORE_ANSWER_GENERATION", "低风险回复模型启动前收到中断");
          yield stoppedEvent();
          return;
        }
        appendModelTrace({
          identity: answerIdentity,
          operation: "low_risk_answer",
          status: "started",
          inputSummary: answerInputSummary,
        });
        try {
          const answer = await withTimeout(
            (signal) => this.dependencies.textModel.answer(answerInput, { signal }),
            options.signal,
            this.modelTimeoutMs,
          );
          responseMessage = answer.text;
          appendModelTrace({
            identity: answer,
            operation: "low_risk_answer",
            status: "completed",
            inputSummary: answerInputSummary,
            output: { text: answer.text },
            durationMs: this.now().getTime() - answerStartedAt,
          });
          yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
            type: "progress",
            progress: { stage: "answer_generation", label: "回复已生成", status: "completed", durationMs: this.now().getTime() - answerStartedAt },
          });
        } catch (error) {
          const fallbackReason = modelFailureReason(error, "answer_generation_failed");
          appendModelTrace({
            identity: answerIdentity,
            operation: "low_risk_answer",
            status: "failed",
            inputSummary: answerInputSummary,
            fallbackReason,
            durationMs: this.now().getTime() - answerStartedAt,
          });
          if (options.signal?.aborted || error instanceof ModelAdapterError && error.code === "cancelled") throw error;
          appendTrace({
            type: "error",
            status: "completed",
            payload: {
              code: "MODEL_ANSWER_FALLBACK",
              message: "模型回答生成失败，已使用工作流安全回复",
              retryable: false,
              internalCode: "MODEL_ANSWER_FALLBACK",
            },
          });
          yield makeEvent<Extract<AgentEvent, { type: "progress" }>>({
            type: "progress",
            progress: { stage: "answer_generation", label: "已使用安全回复", status: "completed", durationMs: this.now().getTime() - answerStartedAt },
          });
        }
      }

      if (workflowResponse.ui) {
        yield makeEvent<Extract<AgentEvent, { type: "ui" }>>({ type: "ui", ui: workflowResponse.ui });
      }
      for (const delta of chunks(responseMessage)) {
        if (stopped()) {
          appendAbortTrace("ABORT_DURING_TOKEN_STREAM", "回复流式输出时收到中断");
          yield stoppedEvent();
          return;
        }
        yield makeEvent<Extract<AgentEvent, { type: "token" }>>({ type: "token", messageId, delta });
      }

      // 不把 workflow 内部 route/debug 对象带到消费者流中。
      const finalResponse: ChatResponse = {
        message: responseMessage,
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
      if (publicError.code === "GENERATION_STOPPED") {
        appendAbortTrace("ABORT_DURING_MODEL", "模型调用期间收到中断");
      } else {
        appendTrace({
          type: "error",
          status: "failed",
          payload: {
            ...publicError,
            internalCode: error instanceof ModelAdapterError
              ? `MODEL_${error.code.toUpperCase()}`
              : error instanceof Error ? error.name : "UNKNOWN_RUNTIME_ERROR",
          },
        });
      }
      yield makeEvent<Extract<AgentEvent, { type: "error" }>>({ type: "error", error: publicError });
    }
  }
}
