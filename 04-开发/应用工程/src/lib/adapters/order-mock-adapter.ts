import type { OrderView, TraceSource } from "@/lib/contracts";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import { omsMockAdapter } from "@/lib/adapters/oms-mock-adapter";
import { tmsMockAdapter } from "@/lib/adapters/tms-mock-adapter";

function displayTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export async function getLatestOrder(): Promise<{
  data: OrderView;
  sources: TraceSource[];
}> {
  const orderResult = await omsMockAdapter.getLatestOrder(DEMO_CUSTOMER_ID);
  if (orderResult.status !== "success") throw new Error(orderResult.error.message);
  const shipmentResult = await tmsMockAdapter.getShipment(orderResult.data.orderId);
  if (shipmentResult.status !== "success") throw new Error(shipmentResult.error.message);

  const latestOrder: OrderView = {
    id: orderResult.data.orderId,
    product: orderResult.data.productName,
    status: orderResult.data.status === "shipped" ? "运输中" : orderResult.data.status,
    eta: shipmentResult.data.eta,
    carrier: shipmentResult.data.carrier,
    trackingNo: shipmentResult.data.trackingNo,
    hotline: shipmentResult.data.hotline,
    events: shipmentResult.data.events
      .slice()
      .reverse()
      .map((event, index) => ({ time: displayTime(event.occurredAt), text: event.description, active: index === 0 })),
  };
  return {
    data: latestOrder,
    sources: [
      {
        type: "business",
        sourceSystem: "OMS",
        recordId: latestOrder.id,
        updatedAt: orderResult.data.updatedAt,
      },
      {
        type: "business",
        sourceSystem: "TMS",
        recordId: latestOrder.trackingNo,
        updatedAt: shipmentResult.data.updatedAt,
      },
    ],
  };
}
