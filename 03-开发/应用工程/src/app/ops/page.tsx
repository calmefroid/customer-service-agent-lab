"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Box,
  ChevronRight,
  CircleGauge,
  Clock3,
  Headphones,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  TicketCheck,
  Truck,
  UserRoundCheck,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  OpsChannel,
  OpsQueryResult,
  OpsRecord,
  OpsRecordType,
  OpsRiskLevel,
} from "@/lib/operations";

import styles from "./ops.module.css";

const typeLabels: Record<OpsRecordType, string> = {
  abnormal_order: "异常订单",
  logistics_urge: "物流催办",
  return_exchange: "退换申请",
  service_ticket: "维修 / 安装",
  human_handoff: "人工接管",
  risk_session: "风险会话",
};

const riskLabels: Record<OpsRiskLevel, string> = { low: "低风险", medium: "需关注", high: "高风险" };
const channelLabels: Record<OpsChannel, string> = { online: "线上渠道", store: "门店渠道", unknown: "未记录渠道" };
const statusLabels: Record<string, string> = {
  attention_required: "待跟进",
  submitted: "已提交",
  queued: "排队中",
  reviewing: "审核中",
  awaiting_appointment: "待预约",
  closed: "已完成",
};

type FilterState = {
  query: string;
  type: OpsRecordType | "all";
  status: string;
  risk: OpsRiskLevel | "all";
  channel: OpsChannel | "all";
  from: string;
  to: string;
};

const initialFilters: FilterState = {
  query: "",
  type: "all",
  status: "all",
  risk: "all",
  channel: "all",
  from: "",
  to: "",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function iconFor(type: OpsRecordType) {
  if (type === "abnormal_order") return <PackageSearch size={16} />;
  if (type === "logistics_urge") return <Truck size={16} />;
  if (type === "return_exchange") return <Box size={16} />;
  if (type === "service_ticket") return <Wrench size={16} />;
  if (type === "human_handoff") return <UserRoundCheck size={16} />;
  return <ShieldAlert size={16} />;
}

export default function OperationsPage() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [data, setData] = useState<OpsQueryResult | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError("");
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "all") params.set(key, value);
    });
    try {
      const response = await fetch(`/api/ops?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("数据加载失败");
      const result = await response.json() as OpsQueryResult;
      setData(result);
      setSelectedId((current) => result.items.some((item) => item.id === current) ? current : result.items[0]?.id ?? "");
    } catch {
      setError("运营数据暂时无法读取，请确认 Sandbox 服务与业务 Store 正常运行。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = useMemo(
    () => data?.items.find((item) => item.id === selectedId) ?? data?.items[0] ?? null,
    [data, selectedId],
  );

  function update<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span><Headphones size={20} /></span>
          <div><strong>智享家客服运营台</strong><small>Operations Console · Sandbox</small></div>
        </div>
        <nav className={styles.headerActions}>
          <a href="/knowledge">知识库</a>
          <a href="/trace">Trace 控制台</a>
          <a href="/" target="_blank" rel="noreferrer"><Bot size={14} />消费者端</a>
        </nav>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>客服运营 · 演示数据</span>
            <h1>跟进需要人处理的售后任务</h1>
            <p>聚合 OMS、WMS、TMS 与 CRM 的 Sandbox 记录，查看异常、申请和风险会话，并回溯到来源会话 Trace。</p>
          </div>
          <div className={styles.sandboxBadge}><CircleGauge size={15} /><div><strong>Sandbox / Mock</strong><span>只读视图 · 不处理真实单据</span></div></div>
        </section>

        <section className={styles.stats} aria-label="运营概览">
          <Stat icon={<TicketCheck size={18} />} label="全部运营记录" value={data?.summary.total ?? 0} />
          <Stat icon={<PackageSearch size={18} />} label="异常订单" value={data?.summary.abnormalOrders ?? 0} tone="amber" />
          <Stat icon={<Clock3 size={18} />} label="待跟进事项" value={data?.summary.pendingCases ?? 0} />
          <Stat icon={<ShieldAlert size={18} />} label="高风险 / 人工接管" value={(data?.summary.highRisk ?? 0) + (data?.summary.humanHandoffs ?? 0)} tone="red" />
        </section>

        <section className={styles.toolbar} aria-label="运营筛选">
          <label className={styles.search}><Search size={15} /><input value={filters.query} onChange={(event) => update("query", event.target.value)} placeholder="搜索单号、会话、摘要或来源系统" /></label>
          <select aria-label="按记录类型筛选" value={filters.type} onChange={(event) => update("type", event.target.value as FilterState["type"])}><option value="all">全部类型</option>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="按状态筛选" value={filters.status} onChange={(event) => update("status", event.target.value)}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="按风险筛选" value={filters.risk} onChange={(event) => update("risk", event.target.value as FilterState["risk"])}><option value="all">全部风险</option>{Object.entries(riskLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="按渠道筛选" value={filters.channel} onChange={(event) => update("channel", event.target.value as FilterState["channel"])}><option value="all">全部渠道</option>{Object.entries(channelLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <button onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={14} className={refreshing ? styles.spin : ""} />刷新</button>
          <div className={styles.dates}><input aria-label="开始日期" type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} /><span>至</span><input aria-label="结束日期" type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} /></div>
        </section>

        {error && <div className={styles.error}><AlertCircle size={15} /><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
        {data?.sourceHealth === "degraded" && <div className={styles.degraded}><AlertTriangle size={15} /><span>部分数据源读取异常，当前列表可能不完整。{data.sources.filter((source) => source.health === "degraded").map((source) => source.name).join("、")}</span></div>}

        <div className={styles.workspace}>
          <section className={styles.listPanel} aria-label="运营记录列表">
            <div className={styles.panelTitle}><strong>运营记录</strong><span>{loading ? "加载中" : `${data?.items.length ?? 0} 条`}</span></div>
            {loading && !data ? <ListSkeleton /> : data?.items.length ? data.items.map((item) => (
              <button key={item.id} className={`${styles.recordRow} ${selected?.id === item.id ? styles.selected : ""}`} onClick={() => setSelectedId(item.id)}>
                <div className={styles.rowTop}><span className={styles.typeIcon}>{iconFor(item.type)}</span><strong>{typeLabels[item.type]}</strong><time>{formatTime(item.updatedAt)}</time></div>
                <h3>{item.title}</h3><p>{item.summary}</p>
                <div className={styles.rowMeta}><span className={`${styles.risk} ${styles[item.riskLevel]}`}>{riskLabels[item.riskLevel]}</span><code>{item.sourceSystem}</code><span>{statusLabels[item.status] ?? item.status}</span><ChevronRight size={14} /></div>
              </button>
            )) : !error && <div className={styles.empty}><PackageSearch size={30} /><strong>暂无匹配的运营记录</strong><span>{Object.values(filters).some((value) => value && value !== "all") ? "试试放宽筛选条件。" : "完成一次催办、退换或报修后，记录会出现在这里。"}</span><a href="/" target="_blank" rel="noreferrer">打开消费者端<ArrowUpRight size={13} /></a></div>}
          </section>
          <section className={styles.detailPanel} aria-label="运营记录详情">
            {selected ? <RecordDetail item={selected} /> : <div className={styles.detailEmpty}><CircleGauge size={30} /><strong>选择一条记录查看详情</strong><span>运营台只展示脱敏业务信息，模型调试数据请前往 Trace。</span></div>}
          </section>
        </div>
      </div>
    </main>
  );
}

function Stat({ icon, label, value, tone = "green" }: { icon: React.ReactNode; label: string; value: number; tone?: "green" | "amber" | "red" }) {
  return <div className={`${styles.stat} ${styles[tone]}`}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function ListSkeleton() {
  return <div className={styles.skeletons}>{[1, 2, 3, 4].map((item) => <div key={item}><span /><strong /><p /><small /></div>)}</div>;
}

function RecordDetail({ item }: { item: OpsRecord }) {
  return (
    <article className={styles.detail}>
      <div className={styles.detailHead}>
        <div><div className={styles.detailTags}><span>{typeLabels[item.type]}</span><span className={`${styles.risk} ${styles[item.riskLevel]}`}>{riskLabels[item.riskLevel]}</span><span>{statusLabels[item.status] ?? item.status}</span></div><h2>{item.title}</h2><p>{item.summary}</p></div>
        <div className={styles.detailActions}>{item.traceHref ? <a href={item.traceHref} target="_blank" rel="noreferrer">查看来源 Trace<ArrowUpRight size={14} /></a> : <span>暂无关联 Trace</span>}</div>
      </div>

      <section className={styles.sourceStrip}>
        <div><span>来源系统</span><strong>{item.sourceSystem} · Mock Adapter</strong></div>
        <div><span>来源记录</span><code>{item.sourceRecordId}</code></div>
        <div><span>关联会话</span><code>{item.sessionId ?? "未记录"}</code></div>
        <div><span>最后更新</span><strong>{formatTime(item.updatedAt)}</strong></div>
      </section>

      <section className={styles.detailSection}>
        <div className={styles.sectionTitle}><span>业务摘要</span><small>已自动脱敏</small></div>
        {item.fields.length ? <dl className={styles.fields}>{item.fields.map((entry) => <div key={`${entry.label}-${entry.value}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl> : <div className={styles.inlineEmpty}>该记录没有更多结构化字段。</div>}
      </section>

      <section className={styles.detailSection}>
        <div className={styles.sectionTitle}><span>处理时间线</span><small>{item.timeline.length ? `${item.timeline.length} 个节点` : "尚无状态事件"}</small></div>
        {item.timeline.length ? <ol className={styles.timeline}>{item.timeline.map((event, index) => <li key={`${event.occurredAt}-${index}`}><span /><div><strong>{event.description}</strong><time>{formatTime(event.occurredAt)}</time></div></li>)}</ol> : <div className={styles.inlineEmpty}>来源系统尚未提供后续处理节点。</div>}
      </section>

      <aside className={styles.privacyNote}><AlertCircle size={14} /><span>本页不展示完整手机号、详细地址、Prompt 或工具入参。如需排查 Agent 执行链路，请使用关联 Trace。</span></aside>
    </article>
  );
}
