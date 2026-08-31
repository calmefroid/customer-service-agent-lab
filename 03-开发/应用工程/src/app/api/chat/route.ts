import { NextResponse } from "next/server";

import { validateAttachment } from "@/lib/agent-runtime/attachment-validation";
import { createConfiguredAgentRuntime } from "@/lib/agent-runtime/configured-runtime";
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
  const attachmentError = validateAttachment(body.attachment);
  if (attachmentError) return NextResponse.json({ error: attachmentError }, { status: 400 });
  if (body.action === "submit_return") {
    const form = body.formData;
    const complete =
      form &&
      (form.serviceType === "换货" || form.serviceType === "退货") &&
      [form.product, form.issueDescription, form.contactPhone, form.pickupAddress]
        .every((value) => typeof value === "string" && value.trim().length > 0);
    if (!complete) {
      return NextResponse.json({ error: "退换货申请信息不完整" }, { status: 400 });
    }
  }
  if (body.action === "submit_service_ticket") {
    const form = body.serviceFormData;
    const complete =
      form &&
      (form.serviceType === "维修服务" || form.serviceType === "安装服务") &&
      (form.purchaseChannel === "线上商城" || form.purchaseChannel === "线下门店") &&
      [
        form.product,
        form.faultDescription,
        form.contactPhone,
        form.serviceAddress,
        form.preferredContactTime,
      ].every((value) => typeof value === "string" && value.trim().length > 0);
    if (!complete) {
      return NextResponse.json({ error: "售后报修信息不完整" }, { status: 400 });
    }
  }

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
