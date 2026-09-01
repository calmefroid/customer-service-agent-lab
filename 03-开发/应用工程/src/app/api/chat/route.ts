import { NextResponse } from "next/server";

import { validateAttachment } from "@/lib/agent-runtime/attachment-validation";
import { createConfiguredAgentRuntime } from "@/lib/agent-runtime/configured-runtime";
import { isLegacyWriteAction, validateConfirmationCommand } from "@/lib/confirmation-protocol";
import type { AgentPublicError, ChatRequest, ChatResponse } from "@/lib/contracts";
import { unifiedTraceSink } from "@/lib/trace-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: Partial<ChatRequest>;
  try {
    body = (await request.json()) as Partial<ChatRequest>;
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }

  if (!body.sessionId || typeof body.sessionId !== "string") {
    return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  }
  if (typeof body.message !== "string") {
    return NextResponse.json({ error: "message 必须为字符串" }, { status: 400 });
  }
  const confirmationValidation = validateConfirmationCommand(body.confirmation, body.action);
  if (!confirmationValidation.ok) {
    return NextResponse.json(
      { error: confirmationValidation.message, code: confirmationValidation.code },
      { status: 400 },
    );
  }
  if (isLegacyWriteAction(body.action)) {
    return NextResponse.json(
      { error: "写操作必须使用服务端签发的 ConfirmationRequest", code: "CONFIRMATION_REQUIRED" },
      { status: 400 },
    );
  }
  const attachmentError = validateAttachment(body.attachment);
  if (attachmentError) return NextResponse.json({ error: attachmentError }, { status: 400 });

  const agent = createConfiguredAgentRuntime({ traceSink: unifiedTraceSink });
  let finalResponse: ChatResponse | undefined;
  let publicError: AgentPublicError | undefined;
  for await (const event of agent.run(body as ChatRequest, { signal: request.signal })) {
    if (event.type === "final") finalResponse = event.response;
    if (event.type === "error") publicError = event.error;
  }
  if (finalResponse) return NextResponse.json(finalResponse);
  return NextResponse.json(
    { error: publicError?.message ?? "请求未完成", code: publicError?.code },
    { status: publicError?.retryable ? 503 : 422 },
  );
}
