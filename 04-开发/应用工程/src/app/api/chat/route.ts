import { NextResponse } from "next/server";

import type { ChatRequest } from "@/lib/contracts";
import { orchestrateMock } from "@/lib/mock-orchestrator";
import { listTraces } from "@/lib/trace-store";

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
  if (body.attachment) {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(body.attachment.type)) {
      return NextResponse.json({ error: "图片格式不支持" }, { status: 400 });
    }
    if (body.attachment.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "图片不能超过 8MB" }, { status: 400 });
    }
  }
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

  const mode = process.env.MODEL_MODE ?? "mock";
  if (mode !== "mock") {
    return NextResponse.json(
      { error: "Live 模型 Adapter 尚未配置，请使用 MODEL_MODE=mock" },
      { status: 503 },
    );
  }

  const response = await orchestrateMock(body as ChatRequest);
  const trace = listTraces(body.sessionId).find((record) => record.traceId === response.traceId);
  return NextResponse.json({ ...response, route: trace?.route });
}
