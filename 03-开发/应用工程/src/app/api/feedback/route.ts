import { NextResponse } from "next/server";

import { feedbackStore, type FeedbackInput } from "@/lib/stores/feedback-store";

function validInput(input: Partial<FeedbackInput>): input is FeedbackInput {
  return typeof input.sessionId === "string"
    && input.sessionId.length > 0
    && typeof input.messageId === "string"
    && input.messageId.length > 0
    && (input.rating === undefined || input.rating === "up" || input.rating === "down")
    && (input.resolved === undefined || typeof input.resolved === "boolean")
    && (input.reason === undefined || typeof input.reason === "string" && input.reason.length <= 200)
    && (input.rating !== undefined || input.resolved !== undefined || Boolean(input.reason?.trim()));
}

export async function POST(request: Request) {
  let input: Partial<FeedbackInput>;
  try {
    input = await request.json() as Partial<FeedbackInput>;
  } catch {
    return NextResponse.json({ error: "反馈内容不是有效 JSON" }, { status: 400 });
  }
  if (!validInput(input)) return NextResponse.json({ error: "反馈字段不完整" }, { status: 400 });
  return NextResponse.json({ ok: true, feedback: feedbackStore.save(input) });
}
