import { NextResponse } from "next/server";

import { clearTraces, listTraces } from "@/lib/trace-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId") ?? undefined;
  return NextResponse.json({ records: listTraces(sessionId) });
}

export async function DELETE() {
  clearTraces();
  return NextResponse.json({ success: true });
}
