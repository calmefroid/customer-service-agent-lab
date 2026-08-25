import type { TraceSource } from "@/lib/contracts";
import { tmsMockAdapter } from "@/lib/adapters/tms-mock-adapter";

export async function createLogisticsUrge(): Promise<{
  requestNo: string;
  sources: TraceSource[];
}> {
  const result = await tmsMockAdapter.createUrge(
    {
      orderId: "OD202608180236",
      shipmentId: "SHIP-SF14900000628",
      reason: "用户确认一键催办",
    },
    "legacy-orchestrator",
    "legacy-logistics-urge",
  );
  if (result.status !== "success") throw new Error(result.error.message);

  return {
    requestNo: result.data.urgeRequestNo,
    sources: [
      {
        type: "business",
        sourceSystem: "TMS",
        recordId: result.data.urgeRequestNo,
        updatedAt: result.data.updatedAt,
      },
      {
        type: "business",
        sourceSystem: "CRM",
        recordId: result.data.crmRecordId,
        updatedAt: result.data.updatedAt,
      },
    ],
  };
}
