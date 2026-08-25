import type {
  FulfillmentRecord,
  OrderRecord,
  ProductRecord,
  ServiceTicketRecord,
  ShipmentRecord,
} from "@/lib/domain/business";

export const DEMO_CUSTOMER_ID = "demo-customer-001";

export const initialProducts: ProductRecord[] = [
  {
    recordId: "SKU-MX960-D05-80",
    sourceSystem: "PCMP",
    createdAt: "2026-08-01T09:00:00+08:00",
    updatedAt: "2026-08-18T09:30:00+08:00",
    sku: "SKU-MX960-D05-80",
    name: "悦享系列 LED 吸顶灯",
    model: "MX960-D0.5×80",
    category: "ceiling_light",
    active: true,
    image: "https://images.unsplash.com/photo-1540932239986-30128078f3c5?auto=format&fit=crop&w=520&q=85",
    specs: ["建议空间 18–25㎡", "三档色温", "额定功率 80W"],
  },
  {
    recordId: "SKU-ZC80-WIFI",
    sourceSystem: "PCMP",
    createdAt: "2026-08-01T09:00:00+08:00",
    updatedAt: "2026-08-20T11:05:00+08:00",
    sku: "SKU-ZC80-WIFI",
    name: "智控系列吸顶灯 ZC80",
    model: "ZC80",
    category: "smart_ceiling_light",
    active: true,
    image: "",
    specs: ["2.4GHz WIFI", "智享家 App", "80W"],
  },
];

export const initialOrders: OrderRecord[] = [
  {
    recordId: "OD202608180236",
    sourceSystem: "OMS",
    createdAt: "2026-08-18T14:20:00+08:00",
    updatedAt: "2026-08-20T10:08:00+08:00",
    orderId: "OD202608180236",
    customerId: DEMO_CUSTOMER_ID,
    sku: "SKU-MX960-D05-80",
    productName: "悦享系列 LED 吸顶灯",
    status: "shipped",
    deliveryAddress: "上海市浦东新区演示路 18 号",
    contactPhone: "138****8001",
  },
  {
    recordId: "OD202608100119",
    sourceSystem: "OMS",
    createdAt: "2026-08-10T10:20:00+08:00",
    updatedAt: "2026-08-12T16:00:00+08:00",
    orderId: "OD202608100119",
    customerId: DEMO_CUSTOMER_ID,
    sku: "SKU-ZC80-WIFI",
    productName: "智控系列吸顶灯 ZC80",
    status: "delivered",
    deliveryAddress: "上海市浦东新区演示路 18 号",
    contactPhone: "138****8001",
  },
  {
    recordId: "OD202608050088",
    sourceSystem: "OMS",
    createdAt: "2026-08-05T09:10:00+08:00",
    updatedAt: "2026-08-05T09:10:00+08:00",
    orderId: "OD202608050088",
    customerId: DEMO_CUSTOMER_ID,
    sku: "SKU-MX960-D05-80",
    productName: "悦享系列 LED 吸顶灯",
    status: "paid",
    deliveryAddress: "上海市浦东新区演示路 18 号",
    contactPhone: "138****8001",
  },
];

export const initialFulfillments: FulfillmentRecord[] = [
  {
    recordId: "FF202608180236",
    sourceSystem: "WMS",
    createdAt: "2026-08-18T15:00:00+08:00",
    updatedAt: "2026-08-19T16:06:00+08:00",
    fulfillmentId: "FF202608180236",
    orderId: "OD202608180236",
    warehouse: "苏州一号仓",
    status: "handed_over",
    events: [
      { occurredAt: "2026-08-19T15:30:00+08:00", status: "packed", description: "商品已打包" },
      { occurredAt: "2026-08-19T16:06:00+08:00", status: "handed_over", description: "已交付承运商" },
    ],
  },
];

export const initialShipments: ShipmentRecord[] = [
  {
    recordId: "SHIP-SF14900000628",
    sourceSystem: "TMS",
    createdAt: "2026-08-19T16:06:00+08:00",
    updatedAt: "2026-08-20T09:42:00+08:00",
    shipmentId: "SHIP-SF14900000628",
    orderId: "OD202608180236",
    carrier: "顺丰速运",
    trackingNo: "SF14900000628",
    hotline: "95338",
    status: "已到达上海浦东集散中心",
    eta: "预计明天 18:00 前送达",
    events: [
      { occurredAt: "2026-08-19T16:06:00+08:00", description: "商家已发货" },
      { occurredAt: "2026-08-19T23:18:00+08:00", description: "快件已从苏州转运中心发出" },
      { occurredAt: "2026-08-20T09:42:00+08:00", description: "快件已到达上海浦东集散中心" },
    ],
  },
];

export const initialServiceTickets: ServiceTicketRecord[] = [
  {
    recordId: "WO20260819031",
    sourceSystem: "CRM",
    createdAt: "2026-08-19T18:20:00+08:00",
    updatedAt: "2026-08-20T10:16:00+08:00",
    ticketNo: "WO20260819031",
    customerId: DEMO_CUSTOMER_ID,
    sessionId: "seed-session",
    idempotencyKey: "seed-ticket",
    serviceType: "repair",
    product: "悦享系列 LED 吸顶灯",
    purchaseChannel: "online",
    issueDescription: "开灯后间歇性闪烁",
    contactPhone: "138****8001",
    serviceAddress: "上海市浦东新区演示路 18 号",
    preferredContactTime: "14:00-18:00",
    riskLevel: "low",
    status: "awaiting_appointment",
    events: [
      { occurredAt: "2026-08-19T18:20:00+08:00", description: "售后报修已提交" },
      { occurredAt: "2026-08-19T18:42:00+08:00", description: "客服完成信息审核" },
      { occurredAt: "2026-08-20T10:16:00+08:00", description: "服务网点已接单，等待电话预约" },
    ],
  },
];
