import { NextResponse } from "next/server";

import { validateAttachment } from "@/lib/agent-runtime/attachment-validation";
import { createConfiguredAgentRuntime } from "@/lib/agent-runtime/configured-runtime";
import type { AgentEvent, ChatRequest } from "@/lib/contracts";
import { unifiedTraceSink } from "@/lib/trace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function invalidRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function validateChatRequest(body: Partial<ChatRequest>): string | undefined {
  if (!body.sessionId || typeof body.sessionId !== "string") return "缺少 sessionId";
  if (typeof body.message !== "string") return "message 必须为字符串";
  const attachmentError = validateAttachment(body.attachment);
  if (attachmentError) return attachmentError;
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

  const agent = createConfiguredAgentRuntime({ traceSink: unifiedTraceSink });
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
