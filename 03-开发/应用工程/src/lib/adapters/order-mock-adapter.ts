import type { OrderView, TraceSource } from "@/lib/contracts";

const latestOrder: OrderView = {
  id: "OD202608180236",
  product: "悦享系列 LED 吸顶灯",
  status: "运输中",
  eta: "预计明天 18:00 前送达",
  carrier: "顺丰速运",
  trackingNo: "SF14900000628",
  hotline: "95338",
  events: [
    { time: "今天 09:42", text: "快件已到达上海浦东集散中心", active: true },
    { time: "昨天 23:18", text: "快件已从苏州转运中心发出" },
    { time: "昨天 16:06", text: "商家已发货" },
  ],
};

export async function getLatestOrder(): Promise<{
  data: OrderView;
  sources: TraceSource[];
}> {
  return {
    data: latestOrder,
    sources: [
      {
        type: "business",
        sourceSystem: "OMS",
        recordId: latestOrder.id,
        updatedAt: "2026-08-20T10:08:00+08:00",
      },
      {
        type: "business",
        sourceSystem: "TMS",
        recordId: latestOrder.trackingNo,
        updatedAt: "2026-08-20T09:42:00+08:00",
      },
    ],
  };
}
