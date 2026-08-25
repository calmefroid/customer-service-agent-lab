import { NextRequest, NextResponse } from "next/server";

import { businessStore } from "@/lib/stores/business/business-store";
import { getOperationDetail, queryOperations } from "@/lib/operations";
import type { OpsChannel, OpsFilters, OpsRecordType, OpsRiskLevel } from "@/lib/operations";

export const dynamic = "force-dynamic";

const recordTypes = new Set<OpsRecordType>([
  "abnormal_order",
  "logistics_urge",
  "return_exchange",
  "service_ticket",
  "human_handoff",
  "risk_session",
]);
const risks = new Set<OpsRiskLevel>(["low", "medium", "high"]);
const channels = new Set<OpsChannel>(["online", "store", "unknown"]);

function value<T extends string>(input: string | null, allowed: Set<T>): T | "all" {
  return input && allowed.has(input as T) ? input as T : "all";
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const result = getOperationDetail(businessStore, id);
      if (!result.item) {
        return NextResponse.json({ error: "未找到该 Sandbox 记录", ...result }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const filters: OpsFilters = {
      query: request.nextUrl.searchParams.get("query") ?? "",
      type: value(request.nextUrl.searchParams.get("type"), recordTypes),
      status: request.nextUrl.searchParams.get("status") || "all",
      risk: value(request.nextUrl.searchParams.get("risk"), risks),
      channel: value(request.nextUrl.searchParams.get("channel"), channels),
      from: request.nextUrl.searchParams.get("from") ?? "",
      to: request.nextUrl.searchParams.get("to") ?? "",
    };
    return NextResponse.json(queryOperations(businessStore, filters));
  } catch (error) {
    return NextResponse.json({
      error: "运营数据暂时无法读取",
      message: error instanceof Error ? error.message : "unknown error",
    }, { status: 503 });
  }
}
