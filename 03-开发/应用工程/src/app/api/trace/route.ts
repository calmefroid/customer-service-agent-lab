import { NextResponse } from "next/server";

import {
  clearTraces,
  isTraceEventStatus,
  isTraceEventType,
  listTraceEvents,
  listTraceViews,
  type TraceEventQuery,
} from "@/lib/trace-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  if (type && !isTraceEventType(type)) {
    return NextResponse.json({ error: "INVALID_TRACE_EVENT_TYPE" }, { status: 400 });
  }
  if (status && !isTraceEventStatus(status)) {
    return NextResponse.json({ error: "INVALID_TRACE_EVENT_STATUS" }, { status: 400 });
  }
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))) {
    return NextResponse.json({ error: "INVALID_TRACE_TIME_RANGE" }, { status: 400 });
  }
  if (from && to && Date.parse(from) > Date.parse(to)) {
    return NextResponse.json({ error: "INVALID_TRACE_TIME_RANGE" }, { status: 400 });
  }
  const query: TraceEventQuery = {
    traceId: searchParams.get("traceId") ?? undefined,
    sessionId: searchParams.get("sessionId") ?? undefined,
    from,
    to,
    type: isTraceEventType(type) ? type : undefined,
    status: isTraceEventStatus(status) ? status : undefined,
  };
  return NextResponse.json({ records: listTraceViews(query), events: listTraceEvents(query) });
}

export async function DELETE() {
  clearTraces();
  return NextResponse.json({ success: true });
}
