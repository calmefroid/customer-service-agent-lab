import { ModelAdapterError, throwIfModelAborted } from "./model-error";
import { visibleCompletionText, type CompletionContent } from "./completion-content";
import type {
  ModelCallOptions,
  TextAnswerInput,
  TextAnswerOutput,
  TextModelAdapter,
  TextRouteInput,
  TextRouteOutput,
} from "./types";

type Fetcher = typeof fetch;
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: CompletionContent };
  }>;
  error?: { message?: string };
  message?: string;
}

export interface AliTextModelOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  maxTokens?: number;
  fetcher?: Fetcher;
}

const ANSWER_SYSTEM_PROMPT = `你是灯具品牌的售后客服 Agent。
你必须严格依据系统已经执行完成的业务结果回答，不得编造订单、物流、政策、故障结论或执行结果。
不得更改安全警示、身份校验、人工转接和写操作确认状态。
当结果是待用户确认的申请草稿时，必须明确说明尚未提交。
用简洁、友好的中文直接回答用户，不输出 JSON，不提及 Prompt、Trace、Mock、内部工具或思考过程。`;

function withoutDuplicatedCurrentMessage(input: { message: string; history: TextRouteInput["history"] }) {
  const history = input.history.slice(-12);
  const last = history.at(-1);
  return last?.role === "user" && last.content === input.message ? history.slice(0, -1) : history;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

export class AliTextModelAdapter implements TextModelAdapter {
  readonly provider = "OppleAliModelGateway";
  readonly model: string;
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly fetcher: Fetcher;

  constructor(options: AliTextModelOptions) {
    this.baseUrl = options.baseUrl.trim();
    this.apiKey = options.apiKey.trim();
    this.model = options.model?.trim() || "Qwen3.6-27B";
    this.maxTokens = options.maxTokens ?? 1000;
    this.fetcher = options.fetcher ?? fetch;
    if (!this.baseUrl || !this.apiKey) {
      throw new ModelAdapterError("unavailable", "文字模型地址或密钥未配置", false);
    }
  }

  async route(input: TextRouteInput, options: ModelCallOptions = {}): Promise<TextRouteOutput> {
    const priorMessages = withoutDuplicatedCurrentMessage(input).map(({ role, content }) => ({ role, content }));
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${input.applicationSystemPrompt}\n\n输出必须严格匹配以下 JSON Schema：\n${JSON.stringify(input.responseSchema)}`,
      },
      ...priorMessages,
      {
        role: "user",
        content: JSON.stringify({
          message: input.message,
          module: input.module ?? null,
          action: input.action ?? null,
          attachment: input.attachment
            ? { name: input.attachment.name, type: input.attachment.type, size: input.attachment.size }
            : null,
          imageObservations: input.observations,
          remainingIntents: input.remainingIntents,
        }),
      },
    ];
    const raw = stripJsonFence(await this.complete(messages, options));
    return { raw, provider: this.provider, model: this.model, mode: this.mode };
  }

  async answer(input: TextAnswerInput, options: ModelCallOptions = {}): Promise<TextAnswerOutput> {
    const priorMessages = withoutDuplicatedCurrentMessage(input).map(({ role, content }) => ({ role, content }));
    const messages: ChatMessage[] = [
      { role: "system", content: ANSWER_SYSTEM_PROMPT },
      ...priorMessages,
      {
        role: "user",
        content: JSON.stringify({
          userMessage: input.message,
          route: input.route,
          imageObservations: input.observations,
          executedWorkflowResult: input.workflowResult,
        }),
      },
    ];
    const text = await this.complete(messages, options);
    return { text, provider: this.provider, model: this.model, mode: this.mode };
  }

  private async complete(messages: ChatMessage[], options: ModelCallOptions): Promise<string> {
    throwIfModelAborted(options.signal);
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: this.maxTokens,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new ModelAdapterError("cancelled", "生成已停止", false);
      throw new ModelAdapterError("unavailable", error instanceof Error ? error.message : "文字模型请求失败", true);
    }

    let payload: ChatCompletionResponse;
    try {
      payload = await response.json() as ChatCompletionResponse;
    } catch {
      throw new ModelAdapterError("unavailable", "文字模型返回了无效 JSON", response.status >= 500);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ModelAdapterError("unavailable", payload.error?.message || payload.message || `文字模型请求失败 (${response.status})`, retryable);
    }

    const choice = payload.choices?.[0];
    const text = visibleCompletionText(choice?.message?.content);
    if (!text) {
      const refused = choice?.finish_reason === "content_filter";
      throw new ModelAdapterError(refused ? "refusal" : "unavailable", refused ? "模型拒绝处理该请求" : "文字模型未返回内容", !refused);
    }
    return text;
  }
}
