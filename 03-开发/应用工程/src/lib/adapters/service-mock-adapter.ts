import type { ServiceTicketFormData, ServiceTicketView, TraceSource } from "@/lib/contracts";
import { crmMockAdapter } from "@/lib/adapters/crm-mock-adapter";
import { DEMO_CUSTOMER_ID } from "@/lib/mock-data/business-fixtures";
import type { ServiceTicketRecord } from "@/lib/domain/business";

function toView(ticket: ServiceTicketRecord): ServiceTicketView {
  return {
    id: ticket.ticketNo,
    product: ticket.product,
    issue: ticket.issueDescription,
    status: ticket.status === "awaiting_appointment" ? "待预约" : ticket.status === "submitted" ? "已提交" : ticket.status,
    updatedAt: ticket.updatedAt,
    events: ticket.events
      .slice()
      .reverse()
      .map((event, index) => ({ time: event.occurredAt, text: event.description, active: index === 0 })),
  };
}

export async function createServiceTicket(form: ServiceTicketFormData): Promise<{
  ticketNo: string;
  source: TraceSource;
}> {
  const result = await crmMockAdapter.createServiceTicket(
    DEMO_CUSTOMER_ID,
    {
      serviceType: form.serviceType === "安装服务" ? "installation" : "repair",
      product: form.product,
      purchaseChannel: form.purchaseChannel === "线上商城" ? "online" : "store",
      issueDescription: form.faultDescription,
      contactPhone: form.contactPhone,
      serviceAddress: form.serviceAddress,
      preferredContactTime: form.preferredContactTime,
      riskLevel: "low",
    },
    "legacy-orchestrator",
    `legacy-ticket-${JSON.stringify(form)}`,
  );
  if (result.status !== "success") throw new Error(result.error.message);
  return {
    ticketNo: result.data.ticketNo,
    source: {
      type: "business",
      sourceSystem: "CRM",
      recordId: result.data.ticketNo,
      updatedAt: result.data.updatedAt,
      excerpt: `${form.serviceType}；${form.purchaseChannel}；${form.product}；${form.faultDescription}`,
    },
  };
}

export async function getLatestServiceTicket(): Promise<{
  data: ServiceTicketView;
  source: TraceSource;
}> {
  const result = await crmMockAdapter.listServiceTickets(DEMO_CUSTOMER_ID);
  if (result.status !== "success") throw new Error(result.error.message);
  const ticket = result.data.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latestTicket = toView(ticket);
  return {
    data: latestTicket,
    source: {
      type: "business",
      sourceSystem: "CRM",
      recordId: latestTicket.id,
      updatedAt: ticket.updatedAt,
    },
  };
}
