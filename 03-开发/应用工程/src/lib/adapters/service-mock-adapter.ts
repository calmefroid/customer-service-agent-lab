import type { ServiceTicketFormData, ServiceTicketView, TraceSource } from "@/lib/contracts";

const latestTicket: ServiceTicketView = {
  id: "WO20260819031",
  product: "悦享系列 LED 吸顶灯",
  issue: "开灯后间歇性闪烁",
  status: "待预约",
  updatedAt: "今天 10:16",
  events: [
    { time: "今天 10:16", text: "服务网点已接单，等待电话预约", active: true },
    { time: "昨天 18:42", text: "客服完成信息审核" },
    { time: "昨天 18:20", text: "售后报修已提交" },
  ],
};

export async function createServiceTicket(form: ServiceTicketFormData): Promise<{
  ticketNo: string;
  source: TraceSource;
}> {
  return {
    ticketNo: "WO20260821008",
    source: {
      type: "business",
      sourceSystem: "CRM",
      recordId: "WO20260821008",
      updatedAt: new Date().toISOString(),
      excerpt: `${form.serviceType}；${form.purchaseChannel}；${form.product}；${form.faultDescription}`,
    },
  };
}

export async function getLatestServiceTicket(): Promise<{
  data: ServiceTicketView;
  source: TraceSource;
}> {
  return {
    data: latestTicket,
    source: {
      type: "business",
      sourceSystem: "CRM",
      recordId: latestTicket.id,
      updatedAt: "2026-08-21T10:16:00+08:00",
    },
  };
}
