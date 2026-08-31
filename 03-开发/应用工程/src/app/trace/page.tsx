"use client";

import {
  AlertTriangle,
  BookOpenText,
  Bot,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Database,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  Trash2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Intent,
  RiskLevel,
  TraceDebugContext,
  TraceEvent,
  TraceEventType,
  TraceSource,
  TraceStage,
} from "@/lib/contracts";
import type { TraceEventStatus, TraceView } from "@/lib/trace-store";

import styles from "./trace.module.css";

const intentLabels: Record<Intent, string> = {
  logistics_query: "订单物流",
  return_exchange: "退换与破损",
  troubleshooting: "故障排查",
  service_ticket_create: "创建报修",
  service_ticket_query: "报修进度",
  knowledge_query: "知识问答",
  human_escalation: "人工 / 风险升级",
  smalltalk: "闲聊",
  clarification: "澄清追问",
  other: "兜底",
};

const riskLabels: Record<RiskLevel, string> = {
  low: "低风险",
  medium: "需确认",
  high: "高风险",
};

const sourceLabels: Record<TraceSource["type"], string> = {
  business: "业务数据",
  knowledge: "知识库",
  rule: "安全规则",
};

const eventTypeLabels: Record<TraceEventType, string> = {
  model: "模型",
  route: "路由",
  rag: "RAG",
  tool: "工具",
  rule: "风险规则",
  confirmation: "确认",
  output: "输出",
  error: "错误",
};

function getIntentLabel(intent: string) {
  return intentLabels[intent as Intent] ?? "历史意图";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function TracePage() {
  const [records, setRecords] = useState<TraceView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [intent, setIntent] = useState<Intent | "all">("all");
  const [risk, setRisk] = useState<RiskLevel | "all">("all");
  const [eventType, setEventType] = useState<TraceEventType | "all">("all");
  const [eventStatus, setEventStatus] = useState<TraceEventStatus | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const linkedTraceId = new URLSearchParams(window.location.search).get("traceId") ?? "";
      const endpoint = linkedTraceId ? `/api/trace?traceId=${encodeURIComponent(linkedTraceId)}` : "/api/trace";
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("加载失败");
      const data = (await response.json()) as { records: TraceView[] };
      const next = [...data.records].reverse();
      setRecords(next);
      setSelectedId((current) => linkedTraceId && next.some((record) => record.traceId === linkedTraceId)
        ? linkedTraceId
        : next.some((record) => record.traceId === current) ? current : next[0]?.traceId ?? "");
    } catch {
      setError("Trace 暂时无法读取，请确认本地服务仍在运行。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesIntent = intent === "all" || record.intent === intent;
      const matchesRisk = risk === "all" || record.riskLevel === risk;
      const matchesEventType = eventType === "all" || record.events.some((event) => event.type === eventType);
      const matchesEventStatus = eventStatus === "all" || record.events.some((event) => event.status === eventStatus);
      const fromTime = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
      const toTime = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
      const matchesTime = record.events.some((event) => {
        const eventTime = Date.parse(event.createdAt);
        return eventTime >= fromTime && eventTime <= toTime;
      });
      const text = [
        record.traceId,
        record.sessionId,
        record.inputSummary,
        record.outputSummary,
        record.route?.module,
        record.route?.topic,
        record.route?.action,
        ...record.sources.flatMap((source) => [source.sourceSystem, source.recordId]),
      ].join(" ").toLowerCase();
      return matchesIntent && matchesRisk && matchesEventType && matchesEventStatus && matchesTime && (!keyword || text.includes(keyword));
    });
  }, [eventStatus, eventType, from, intent, query, records, risk, to]);

  useEffect(() => {
    if (filtered.length && !filtered.some((record) => record.traceId === selectedId)) {
      setSelectedId(filtered[0].traceId);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((record) => record.traceId === selectedId) ?? filtered[0];
  const highRiskCount = records.filter((record) => record.riskLevel === "high").length;
  const sourceCount = records.reduce((total, record) => total + record.sources.length, 0);
  const sessionCount = new Set(records.map((record) => record.sessionId)).size;

  async function clearAll() {
    if (!window.confirm("确定清空当前本地 Mock Trace 吗？此操作不会影响业务数据。")) return;
    const response = await fetch("/api/trace", { method: "DELETE" });
    if (!response.ok) {
      setError("清空失败，请稍后重试。");
      return;
    }
    setRecords([]);
    setSelectedId("");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span><CircleGauge size={21} /></span>
          <div>
            <strong>售后 Agent · Trace 控制台</strong>
            <small>本地 Mock 环境 · 仅供排障与评测</small>
          </div>
        </div>
        <div className={styles.headerActions}>
          <a href="/knowledge">知识库管理</a>
          <a href="/" target="_blank" rel="noreferrer">打开消费者端</a>
          <button onClick={() => void load()} disabled={loading}><RefreshCw size={15} />刷新</button>
        </div>
      </header>

      <section className={styles.content}>
        <div className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>后台可观测性</span>
            <h1>查看每次回答是怎么得出的</h1>
            <p>消费者端只展示精简进度；这里保留应用 Prompt、模型输入输出、候选意图、规则证据、执行步骤，以及 WMS / OMS / TMS / CRM 与知识库记录来源。</p>
          </div>
          <div className={styles.mockBadge}><Bot size={16} />Sandbox / Mock</div>
        </div>

        <div className={styles.stats}>
          <Stat icon={<CircleGauge size={18} />} label="回答记录" value={records.length} />
          <Stat icon={<Database size={18} />} label="数据依据" value={sourceCount} />
          <Stat icon={<AlertTriangle size={18} />} label="高风险升级" value={highRiskCount} danger />
          <Stat icon={<ShieldCheck size={18} />} label="会话数量" value={sessionCount} />
        </div>

        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题、Trace ID、来源记录" />
          </label>
          <select aria-label="按意图筛选" value={intent} onChange={(event) => setIntent(event.target.value as Intent | "all")}>
            <option value="all">全部意图</option>
            {Object.entries(intentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="按风险筛选" value={risk} onChange={(event) => setRisk(event.target.value as RiskLevel | "all")}>
            <option value="all">全部风险</option>
            <option value="low">低风险</option>
            <option value="medium">需确认</option>
            <option value="high">高风险</option>
          </select>
          <select aria-label="按事件类型筛选" value={eventType} onChange={(event) => setEventType(event.target.value as TraceEventType | "all")}>
            <option value="all">全部事件</option>
            {Object.entries(eventTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="按事件状态筛选" value={eventStatus} onChange={(event) => setEventStatus(event.target.value as TraceEventStatus | "all")}>
            <option value="all">全部状态</option>
            <option value="started">已开始</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="skipped">已跳过</option>
          </select>
          <input aria-label="起始时间" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
          <input aria-label="结束时间" type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
          <button className={styles.clear} onClick={() => void clearAll()} disabled={!records.length}><Trash2 size={15} />清空 Mock Trace</button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.workspace}>
          <section className={styles.listPanel} aria-label="Trace 列表">
            <div className={styles.panelTitle}><strong>执行记录</strong><span>{filtered.length} 条</span></div>
            {loading && !records.length ? (
              <div className={styles.empty}>正在读取 Trace…</div>
            ) : filtered.length ? filtered.map((record) => (
              <button
                key={record.traceId}
                className={`${styles.traceRow} ${record.traceId === selected?.traceId ? styles.selected : ""}`}
                onClick={() => setSelectedId(record.traceId)}
              >
                <div className={styles.rowTop}>
                  <span className={`${styles.riskDot} ${styles[record.riskLevel]}`} />
                  <strong>{getIntentLabel(record.intent)}</strong>
                  <time>{formatTime(record.createdAt)}</time>
                </div>
                <p>{record.inputSummary}</p>
                <div className={styles.rowMeta}><code>{record.route?.topic ?? record.traceId}</code><span>{record.sources.length} 个依据</span><ChevronRight size={14} /></div>
              </button>
            )) : (
              <div className={styles.empty}>暂无匹配记录。先在消费者端完成一段对话，Trace 会自动出现在这里。</div>
            )}
          </section>

          <section className={styles.detailPanel} aria-label="Trace 详情">
            {selected ? <TraceDetail record={selected} /> : (
              <div className={styles.detailEmpty}><BookOpenText size={28} /><strong>选择一条记录查看详情</strong><span>执行步骤与回答依据仅在后台显示</span></div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function Stat({ icon, label, value, danger = false }: { icon: React.ReactNode; label: string; value: number; danger?: boolean }) {
  return <div className={`${styles.stat} ${danger ? styles.statDanger : ""}`}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function TraceDetail({ record }: { record: TraceView }) {
  const stages = record.stages?.length ? record.stages : record.steps.map((step, index) => ({
    id: `legacy-${index}`,
    title: step,
    kind: index === record.steps.length - 1 ? "output" as const : "decision" as const,
    status: "completed" as const,
    durationMs: 0,
    summary: "该记录来自旧版简化 Trace，未保存详细参数。",
  }));
  const totalDurationMs = record.totalDurationMs ?? stages.reduce((total, stage) => total + stage.durationMs, 0);

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <div>
          <div className={styles.detailTags}>
            <span>{getIntentLabel(record.intent)}</span>
            <span className={styles[`riskTag${record.riskLevel}`]}>{riskLabels[record.riskLevel]}</span>
          </div>
          <h2>{record.inputSummary}</h2>
          <p>{formatTime(record.createdAt)} · 会话 {record.sessionId} · 总耗时 {(totalDurationMs / 1000).toFixed(2)}s</p>
        </div>
        <code>{record.traceId}</code>
      </div>

      <section className={styles.answer}>
        <span>Agent 回答摘要</span>
        <p>{record.outputSummary}</p>
      </section>

      {record.route && (
        <section className={styles.routeSummary} aria-label="结构化意图路由">
          <div><span>业务模块 module</span><strong>{record.route.module}</strong></div>
          <div><span>用户目标 intent</span><strong>{record.route.intent}</strong></div>
          <div><span>知识主题 topic</span><strong>{record.route.topic}</strong></div>
          <div><span>执行动作 action</span><strong>{record.route.action}</strong></div>
          <div><span>置信度</span><strong>{Math.round(record.route.confidence * 100)}%</strong></div>
          <div><span>路由控制</span><strong>{record.route.requiresHuman ? "转人工" : record.route.requiresConfirmation ? "需确认" : record.route.needsClarification ? "需澄清" : "可继续"}</strong></div>
        </section>
      )}

      {record.debug && <DebugContextPanel debug={record.debug} />}

      <section className={styles.detailSection}>
        <div className={styles.sectionTitle}><span>统一 TraceEvent</span><small>{record.events.length} 个事件 · 单一 Trace ID</small></div>
        <div className={styles.traceNotice}><ShieldCheck size={14} /><span>模型、路由、RAG、工具、规则、确认、输出与错误按统一事件契约排序；载荷在写入和查询时均执行脱敏。</span></div>
        <TraceEventTimeline events={record.events} />
      </section>

      <section className={styles.detailSection}>
        <div className={styles.sectionTitle}><span>详细执行过程</span><small>{stages.length} 阶段 · {(totalDurationMs / 1000).toFixed(2)}s</small></div>
        <div className={styles.traceNotice}><ShieldCheck size={14} /><span>以下阶段保留完整的可审计执行摘要、规则命中和脱敏工具入参 / 出参；消费者端仅接收对应的精简进度。</span></div>
        <ExecutionTimeline stages={stages} />
      </section>

      <section className={styles.detailSection}>
        <div className={styles.sectionTitle}><span>回答依据</span><small>{record.sources.length} 条</small></div>
        {record.sources.length ? (
          <div className={styles.sources}>
            {record.sources.map((source, index) => <SourceCard key={`${source.sourceSystem}-${source.recordId}-${index}`} source={source} />)}
          </div>
        ) : (
          <div className={styles.noSources}>本次仅执行意图识别与引导话术，没有读取知识库或业务系统。</div>
        )}
      </section>
    </div>
  );
}

function TraceEventTimeline({ events }: { events: TraceEvent[] }) {
  const displayLabel = (event: TraceEvent) => {
    const serialized = JSON.stringify(event.payload);
    const fallback = /fallback|fallbackReason|兜底/i.test(serialized);
    return fallback ? `${eventTypeLabels[event.type]} / fallback` : eventTypeLabels[event.type];
  };
  return (
    <div className={styles.eventTimeline}>
      {events.map((event) => (
        <details key={event.eventId} className={styles.debugBlock}>
          <summary>
            <span>{String(event.sequence).padStart(2, "0")} · {displayLabel(event)}</span>
            <code>{event.status}</code>
            <time>{formatTime(event.createdAt)}</time>
          </summary>
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}

function DebugContextPanel({ debug }: { debug: TraceDebugContext }) {
  return (
    <section className={styles.detailSection}>
      <div className={styles.sectionTitle}><span>Mock 模型调试上下文</span><small>应用层全量记录</small></div>
      <div className={styles.debugNotice}>
        <Braces size={14} />
        <span>完整展示应用定义的 Prompt、模型输入输出、候选分类、规则判断、实体抽取与最终决策。该数据只由 Trace 接口提供，不进入消费者聊天响应。</span>
      </div>

      <div className={styles.debugMeta}>
        <div><span>运行环境</span><strong>{debug.environment}</strong></div>
        <div><span>记录级别</span><strong>{debug.recordLevel}</strong></div>
        <div><span>模型</span><strong>{debug.model.model}</strong></div>
        <div><span>输出格式</span><strong>{debug.model.responseFormat}</strong></div>
        <div><span>Temperature</span><strong>{debug.model.temperature}</strong></div>
        <div><span>Prompt 版本</span><strong>{debug.prompt.templateId} / {debug.prompt.version}</strong></div>
      </div>

      <details className={styles.debugBlock} open>
        <summary>应用 System Prompt（完整）</summary>
        <pre>{debug.prompt.applicationSystemPrompt}</pre>
      </details>

      <details className={styles.debugBlock} open>
        <summary>模型消息与约束</summary>
        <div className={styles.promptMessages}>
          {debug.prompt.messages.map((message, index) => (
            <article key={`${message.role}-${index}`}>
              <span>{message.role}</span><pre>{message.content}</pre>
            </article>
          ))}
        </div>
        <div className={styles.ioGrid}>
          <JsonBlock label="JSON Schema" value={debug.prompt.responseSchema} tone="input" />
          <JsonBlock label="Few-shot 案例 ID" value={debug.prompt.fewShotExampleIds} tone="input" />
        </div>
      </details>

      <details className={styles.debugBlock} open>
        <summary>候选意图与置信度</summary>
        <div className={styles.candidateTable}>
          {debug.classification.candidates.map((candidate, index) => (
            <div key={`${candidate.intent}-${index}`} className={index === 0 ? styles.candidateSelected : ""}>
              <span>#{index + 1}</span>
              <strong>{candidate.intent}</strong>
              <code>{candidate.topic}</code>
              <em>{Math.round(candidate.score * 100)}%</em>
              <small>{candidate.matchedSignals.join(" · ")}</small>
            </div>
          ))}
        </div>
      </details>

      <details className={styles.debugBlock} open>
        <summary>规则判断与命中证据</summary>
        <div className={styles.ruleTable}>
          {debug.classification.rules.map((rule) => (
            <article key={rule.ruleId} className={rule.matched ? styles.ruleMatched : ""}>
              <div><code>{rule.ruleId}</code><strong>{rule.name}</strong><span>{rule.matched ? "命中" : "未命中"}</span></div>
              <p>证据：{rule.evidence.join("、") || "无"}</p><small>效果：{rule.effect}</small>
            </article>
          ))}
        </div>
      </details>

      <details className={styles.debugBlock} open>
        <summary>实体、观察与模型输出</summary>
        <div className={styles.ioGrid}>
          <JsonBlock label="实体与缺失字段" value={{ entities: debug.extraction.entities, missingFields: debug.extraction.missingFields, observations: debug.extraction.observations }} tone="input" />
          <JsonBlock label="解析后的模型输出" value={debug.modelOutput.parsed} tone="output" />
        </div>
        <div className={styles.rawOutput}><span>模型原始输出</span><pre>{debug.modelOutput.raw}</pre></div>
      </details>

      <div className={styles.finalDecision}><span>最终决策摘要</span><p>{debug.finalDecisionSummary}</p><small>{debug.boundaryNote}</small></div>
    </section>
  );
}

const stageKindLabels: Record<TraceStage["kind"], string> = {
  decision: "决策",
  guardrail: "规则",
  knowledge: "知识检索",
  tool: "工具调用",
  output: "结果组织",
};

function ExecutionTimeline({ stages }: { stages: TraceStage[] }) {
  const firstTool = stages.find((stage) => stage.toolCall)?.id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(firstTool ? [firstTool] : [stages[0]?.id].filter(Boolean)));

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ol className={styles.executionTimeline}>
      {stages.map((stage, index) => {
        const open = expanded.has(stage.id);
        const Icon = stage.kind === "tool" || stage.kind === "knowledge" ? Wrench : stage.kind === "guardrail" ? ShieldCheck : stage.kind === "output" ? Braces : CircleGauge;
        return (
          <li key={stage.id} className={styles.executionStage}>
            <span className={styles.stageIndex}>{index + 1}</span>
            <article>
              <button className={styles.stageHeader} onClick={() => toggle(stage.id)} aria-expanded={open}>
                <span className={styles.stageIcon}><Icon size={15} /></span>
                <span className={styles.stageTitle}><strong>{stage.title}</strong><small>{stageKindLabels[stage.kind]}</small></span>
                <span className={styles.stageStatus}><CheckCircle2 size={13} />完成</span>
                <time><Timer size={12} />{stage.durationMs}ms</time>
                <ChevronDown className={open ? styles.chevronOpen : ""} size={15} />
              </button>
              {open && (
                <div className={styles.stageBody}>
                  <div className={styles.decisionSummary}><span>执行摘要</span><p>{stage.summary}</p></div>
                  {stage.toolCall && <ToolCallDetails call={stage.toolCall} />}
                </div>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function ToolCallDetails({ call }: { call: NonNullable<TraceStage["toolCall"]> }) {
  return (
    <div className={styles.toolDetails}>
      <div className={styles.toolMeta}>
        <span>{call.system}</span>
        <strong>{call.toolName}</strong>
        <code><b>{call.method}</b>{call.endpoint}</code>
        <em>{call.statusCode}</em>
      </div>
      <div className={styles.ioGrid}>
        <JsonBlock label="脱敏入参" value={call.input} tone="input" />
        <JsonBlock label="返回摘要" value={call.output} tone="output" />
      </div>
    </div>
  );
}

function JsonBlock({ label, value, tone }: { label: string; value: unknown; tone: "input" | "output" }) {
  return (
    <section className={`${styles.jsonBlock} ${styles[tone]}`}>
      <div><Braces size={13} /><span>{label}</span></div>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function SourceCard({ source }: { source: TraceSource }) {
  const Icon = source.type === "knowledge" ? BookOpenText : source.type === "rule" ? ShieldCheck : Database;
  return (
    <article className={styles.sourceCard}>
      <div className={styles.sourceIcon}><Icon size={17} /></div>
      <div className={styles.sourceBody}>
        <div><span>{sourceLabels[source.type]}</span><strong>{source.sourceSystem}</strong></div>
        <code>{source.recordId}</code>
        {source.excerpt && <p>{source.excerpt}</p>}
        <small>{[source.version, source.updatedAt ? `更新于 ${formatTime(source.updatedAt)}` : ""].filter(Boolean).join(" · ")}</small>
      </div>
    </article>
  );
}
