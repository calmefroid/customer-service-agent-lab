export type OpsRecordType =
  | "abnormal_order"
  | "logistics_urge"
  | "return_exchange"
  | "service_ticket"
  | "human_handoff"
  | "risk_session";

export type OpsRiskLevel = "low" | "medium" | "high";
export type OpsChannel = "online" | "store" | "unknown";
export type OpsSourceHealth = "healthy" | "degraded";

export interface OpsFilters {
  query?: string;
  type?: OpsRecordType | "all";
  status?: string | "all";
  risk?: OpsRiskLevel | "all";
  channel?: OpsChannel | "all";
  from?: string;
  to?: string;
}

export interface OpsField {
  label: string;
  value: string;
}

export interface OpsTimelineEvent {
  occurredAt: string;
  description: string;
}

export interface OpsRecord {
  id: string;
  sourceRecordId: string;
  type: OpsRecordType;
  subtype?: string;
  title: string;
  summary: string;
  status: string;
  riskLevel: OpsRiskLevel;
  channel: OpsChannel;
  sourceSystem: string;
  createdAt: string;
  updatedAt: string;
  sessionId: string | null;
  traceId: string | null;
  traceHref: string | null;
  fields: OpsField[];
  timeline: OpsTimelineEvent[];
}

export interface OpsSourceState {
  name: string;
  health: OpsSourceHealth;
  message?: string;
}

export interface OpsSummary {
  total: number;
  abnormalOrders: number;
  pendingCases: number;
  highRisk: number;
  humanHandoffs: number;
}

export interface OpsQueryResult {
  items: OpsRecord[];
  summary: OpsSummary;
  sourceHealth: OpsSourceHealth;
  sources: OpsSourceState[];
  generatedAt: string;
}

export interface OpsDetailResult {
  item: OpsRecord | null;
  sourceHealth: OpsSourceHealth;
  sources: OpsSourceState[];
  generatedAt: string;
}
