import { ModelAdapterError, throwIfModelAborted } from "./model-error";
import { visibleCompletionText, type CompletionContent } from "./completion-content";
import type {
  ModelCallOptions,
  MultimodalInput,
  MultimodalModelAdapter,
  MultimodalObservationOutput,
} from "./types";

type Fetcher = typeof fetch;
type ImageDetail = "low" | "high" | "auto";
interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: CompletionContent };
  }>;
  error?: { message?: string };
  message?: string;
}

interface ObservationPayload {
  summary: string;
  uncertainties: string[];
  responseText: string;
  requiresBusinessRouting: boolean;
}

const FORBIDDEN_IMAGE_CONCLUSION = /可以退换|符合退换资格|退换资格已确认|责任(?:在|属于|由)|应当?赔偿|同意赔偿|(?:确认|判定)(?:为|是)?.{0,4}(?:正品|假货)|(?:就是|属于)(?:正品|假货)/;
const MIN_VISIBLE_COMPLETION_BUDGET = 3000;

function enforceObservationBoundary(observation: ObservationPayload): ObservationPayload {
  const combined = `${observation.summary} ${observation.responseText}`;
  if (!FORBIDDEN_IMAGE_CONCLUSION.test(combined)) return observation;
  const boundary = "无法仅凭图片确认真伪、责任、退换资格或赔偿结果";
  return {
    summary: "图片中存在需要进一步核验的可见信息，无法据此形成业务结论",
    uncertainties: [...new Set([...observation.uncertainties, boundary])],
    responseText: `我只能描述图片中的可见信息，${boundary}。需要继续处理时，我可以帮你进入对应流程核验。`,
    requiresBusinessRouting: observation.requiresBusinessRouting,
  };
}

export interface OpenAICompatibleMultimodalOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider?: string;
  maxTokens?: number;
  imageDetail?: ImageDetail;
  fetcher?: Fetcher;
}

const OBSERVATION_SYSTEM_PROMPT = `你是灯具品牌售后 Agent 的图片观察模块。
只描述图片中可见的客观信息，可读取明确可见的铭牌文字、型号和破损现象。
不得仅凭图片判定责任、真伪、退换资格、故障根因或赔偿结果。
如果图片模糊、遮挡、曝光或关键信息不可读，必须明确说无法确认，并建议用户补拍。
用户要求申请退换、报修、查订单、催物流或图片存在用电安全风险时，requiresBusinessRouting 必须为 true。
仅需回答铭牌、型号或图片可见内容，且不需后续业务操作时，可设为 false。
只输出 JSON 对象：
{"summary":"客观观察摘要","uncertainties":["不确定项"],"responseText":"给消费者的简洁回复","requiresBusinessRouting":true}`;

function parseObservation(raw: string): ObservationPayload {
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? raw.trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    throw new ModelAdapterError("unavailable", "多模态模型未返回有效观察 JSON", true);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelAdapterError("unavailable", "多模态模型观察结果格式无效", true);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || !record.summary.trim()) {
    throw new ModelAdapterError("unavailable", "多模态模型缺少观察摘要", true);
  }
  const rawUncertainties = record.uncertainties;
  const uncertaintyItems = Array.isArray(rawUncertainties)
    ? rawUncertainties
    : typeof rawUncertainties === "string"
      ? /^(?:无|没有|none|n\/a)$/i.test(rawUncertainties.trim()) ? [] : [rawUncertainties]
      : undefined;
  if (!uncertaintyItems || uncertaintyItems.some((item) => typeof item !== "string")) {
    throw new ModelAdapterError("unavailable", "多模态模型不确定项格式无效", true);
  }
  if (typeof record.requiresBusinessRouting !== "boolean") {
    throw new ModelAdapterError("unavailable", "多模态模型缺少业务路由判断", true);
  }
  const summary = record.summary.trim();
  const uncertainties = (uncertaintyItems as string[]).map((item) => item.trim()).filter(Boolean);
  const responseText = typeof record.responseText === "string" && record.responseText.trim()
    ? record.responseText.trim()
    : `我能看到：${summary}${uncertainties.length ? `。还需确认：${uncertainties.join("；")}` : ""}。`;
  return enforceObservationBoundary({ summary, uncertainties, responseText, requiresBusinessRouting: record.requiresBusinessRouting });
}

export class OpenAICompatibleMultimodalModelAdapter implements MultimodalModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly imageDetail: ImageDetail;
  private readonly fetcher: Fetcher;

  constructor(options: OpenAICompatibleMultimodalOptions) {
    this.baseUrl = options.baseUrl.trim();
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.provider = options.provider?.trim() || "OpenAICompatibleModelGateway";
    this.maxTokens = Math.max(options.maxTokens ?? MIN_VISIBLE_COMPLETION_BUDGET, MIN_VISIBLE_COMPLETION_BUDGET);
    this.imageDetail = options.imageDetail ?? "high";
    this.fetcher = options.fetcher ?? fetch;
    if (!this.baseUrl || !this.apiKey || !this.model) {
      throw new ModelAdapterError("unavailable", "多模态模型地址、密钥或模型 ID 未配置", false);
    }
  }

  async observe(input: MultimodalInput, options: ModelCallOptions = {}): Promise<MultimodalObservationOutput> {
    throwIfModelAborted(options.signal);
    if (!input.attachment.dataUrl) {
      throw new ModelAdapterError("unavailable", "未收到可供多模态模型读取的图片内容", false);
    }
    const history = input.history.slice(-6);
    const last = history.at(-1);
    const priorMessages = last?.role === "user" && last.content === input.message ? history.slice(0, -1) : history;

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
          messages: [
            { role: "system", content: OBSERVATION_SYSTEM_PROMPT },
            ...priorMessages.map(({ role, content }) => ({ role, content })),
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: input.attachment.dataUrl, detail: this.imageDetail },
                },
                {
                  type: "text",
                  text: JSON.stringify({ message: input.message, module: input.module ?? null }),
                },
              ],
            },
          ],
          stream: false,
          max_tokens: this.maxTokens,
          enable_thinking: false,
          response_format: { type: "json_object" },
        }),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new ModelAdapterError("cancelled", "生成已停止", false);
      throw new ModelAdapterError("unavailable", error instanceof Error ? error.message : "多模态模型请求失败", true);
    }

    let payload: ChatCompletionResponse;
    try {
      payload = await response.json() as ChatCompletionResponse;
    } catch {
      throw new ModelAdapterError("unavailable", "多模态模型返回了无效 JSON", response.status >= 500);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ModelAdapterError("unavailable", payload.error?.message || payload.message || `多模态模型请求失败 (${response.status})`, retryable);
    }
    const choice = payload.choices?.[0];
    const content = visibleCompletionText(choice?.message?.content);
    if (!content) {
      const refused = choice?.finish_reason === "content_filter";
      throw new ModelAdapterError(refused ? "refusal" : "unavailable", refused ? "多模态模型拒绝处理该图片" : "多模态模型未返回内容", !refused);
    }
    const observation = parseObservation(content);
    return {
      ...observation,
      provider: this.provider,
      model: this.model,
      mode: this.mode,
    };
  }
}
