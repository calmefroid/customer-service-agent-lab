import type { TraceSource } from "@/lib/contracts";

export async function createLogisticsUrge(): Promise<{
  requestNo: string;
  sources: TraceSource[];
}> {
  const requestNo = "URGE20260820009";
  const updatedAt = new Date().toISOString();

  return {
    requestNo,
    sources: [
      {
        type: "business",
        sourceSystem: "TMS",
        recordId: requestNo,
        updatedAt,
      },
      {
        type: "business",
        sourceSystem: "CRM",
        recordId: "CS20260820017",
        updatedAt,
      },
    ],
  };
}
