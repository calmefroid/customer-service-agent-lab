import { NextResponse } from "next/server";

import { AgentRuntime } from "@/lib/agent-runtime/agent-runtime";
import { defaultRuntimeSessions, defaultRuntimeTraceStore } from "@/lib/agent-runtime/runtime-singletons";
import type { RuntimeWorkflowExecutor } from "@/lib/agent-runtime/types";
import type { AgentEvent, ChatRequest } from "@/lib/contracts";
import { createDefaultModelAdapters } from "@/lib/models";
import { runRegisteredAgent } from "@/lib/orchestration/mock-compatibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function invalidRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function validateChatRequest(body: Partial<ChatRequest>): string | undefined {
  if (!body.sessionId || typeof body.sessionId !== "string") return "缺少 sessionId";
  if (typeof body.message !== "string") return "message 必须为字符串";
  if (body.attachment) {
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(body.attachment.type)) return "图片格式不支持";
    if (body.attachment.size > 8 * 1024 * 1024) return "图片不能超过 8MB";
    if (body.attachment.size < 0) return "图片大小无效";
  }
  if (body.action === "submit_return") {
    const form = body.formData;
    if (!form || ![form.product, form.issueDescription, form.contactPhone, form.pickupAddress].every((value) => typeof value === "string" && value.trim())) return "退换货申请信息不完整";
  }
  if (body.action === "submit_service_ticket") {
    const form = body.serviceFormData;
    if (!form || ![form.product, form.faultDescription, form.contactPhone, form.serviceAddress, form.preferredContactTime].every((value) => typeof value === "string" && value.trim())) return "售后报修信息不完整";
  }
  return undefined;
}

function sse(event: AgentEvent): Uint8Array {
  return new TextEncoder().encode(`id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  let body: Partial<ChatRequest>;
  try {
    body = await request.json() as Partial<ChatRequest>;
  } catch {
    return invalidRequest("请求内容不是有效 JSON");
  }
  const validationError = validateChatRequest(body);
  if (validationError) return invalidRequest(validationError);

  const mode = process.env.MODEL_MODE === "live" ? "live" : "mock";
  const adapters = createDefaultModelAdapters({
    mode,
    textApiKey: process.env.TEXT_MODEL_API_KEY,
    multimodalApiKey: process.env.MULTIMODAL_MODEL_API_KEY,
  });
  const workflow: RuntimeWorkflowExecutor = {
    execute: (chatRequest) => runRegisteredAgent(chatRequest),
  };
  const agent = new AgentRuntime({
    ...adapters,
    workflow,
    sessions: defaultRuntimeSessions,
    traceSink: defaultRuntimeTraceStore,
  });
  const chatRequest = body as ChatRequest;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of agent.run(chatRequest, { signal: request.signal })) {
          if (request.signal.aborted) break;
          controller.enqueue(sse(event));
        }
      } catch {
        // Runtime 通常会把失败映射为 AgentEvent.error；这里只处理连接层异常。
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
