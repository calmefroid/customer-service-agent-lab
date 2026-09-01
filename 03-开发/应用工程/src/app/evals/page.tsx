"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Beaker,
  CheckCircle2,
  CircleGauge,
  FlaskConical,
  Play,
  RefreshCw,
  ShieldCheck,
  Tag,
  Timer,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BAD_CASE_LABELS,
  type BadCaseLabel,
  type EvalCaseResult,
  type EvalCategory,
  type EvalRun,
} from "@/lib/evals/types";

import styles from "./evals.module.css";

interface EvalCaseListItem {
  id: string;
  title: string;
  category: EvalCategory;
  coverage: string[];
  message: string;
}

interface EvalApiData {
  dataset: { total: number; categories: Partial<Record<EvalCategory, number>> };
  cases: EvalCaseListItem[];
  runs: EvalRun[];
}

const CATEGORY_LABELS: Record<EvalCategory, string> = {
  normal_intent: "正常意图",
  rag: "RAG / 来源",
  no_knowledge: "无知识",
  knowledge_conflict: "知识冲突",
  tool_success: "工具成功",
  tool_failure: "工具失败",
  authorization: "权限",
  image: "图片",
  safety: "安全 / 人工",
  injection: "Prompt Injection",
  smalltalk: "闲聊 / 兜底",
};

const BAD_CASE_LABEL_NAMES: Record<BadCaseLabel, string> = {
  intent: "意图",
  fact: "事实",
  rag: "RAG",
  tool: "工具",
  rule: "规则",
  image: "图片",
  interaction: "交互",
};

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

function compactActual(result: EvalCaseResult) {
  return {
    response: result.actual.response,
    route: result.actual.trace?.route ?? null,
    tools: result.actual.toolCalls,
    sources: result.actual.sourceSystems,
    sourceRecordIds: result.actual.sourceRecordIds,
    simulatedOutcome: result.actual.simulatedOutcome ?? "success",
    error: result.actual.error ?? null,
  };
}

export default function EvalsPage() {
  const [data, setData] = useState<EvalApiData | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedResultId, setSelectedResultId] = useState("");
  const [status, setStatus] = useState<"all" | "pass" | "fail">("all");
  const [category, setCategory] = useState<EvalCategory | "all">("all");
  const [badCaseLabel, setBadCaseLabel] = useState<BadCaseLabel | "all">("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/evals", { cache: "no-store" });
      if (!response.ok) throw new Error("LOAD_FAILED");
      const next = await response.json() as EvalApiData;
      setData(next);
      setSelectedRunId((current) => current || next.runs[0]?.runId || "");
    } catch {
      setError("评测记录暂时无法读取，请确认本地服务仍在运行。");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedRun = data?.runs.find((run) => run.runId === selectedRunId) ?? data?.runs[0];
  const filteredResults = useMemo(() => selectedRun?.results.filter((result) => {
    const statusMatches = status === "all" || (status === "pass" ? result.passed : !result.passed);
    const categoryMatches = category === "all" || result.category === category;
    const labels = [...result.badCaseLabels, ...result.manualLabels];
    const labelMatches = badCaseLabel === "all" || labels.includes(badCaseLabel);
    return statusMatches && categoryMatches && labelMatches;
  }) ?? [], [badCaseLabel, category, selectedRun, status]);

  useEffect(() => {
    if (filteredResults.length && !filteredResults.some((item) => item.resultId === selectedResultId)) {
      setSelectedResultId(filteredResults[0].resultId);
    }
  }, [filteredResults, selectedResultId]);

  const selectedResult = filteredResults.find((item) => item.resultId === selectedResultId) ?? filteredResults[0];

  async function run(caseId?: string) {
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/evals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(caseId ? { caseId } : {}),
      });
      const payload = await response.json() as { run?: EvalRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "RUN_FAILED");
      await load();
      setSelectedRunId(payload.run.runId);
      setSelectedResultId(payload.run.results[0]?.resultId ?? "");
    } catch {
      setError("评测运行失败。Runner 已保留已完成案例，请查看服务端日志。");
    } finally {
      setRunning(false);
    }
  }

  async function toggleLabel(label: BadCaseLabel) {
    if (!selectedRun || !selectedResult) return;
    const current = selectedResult.manualLabels;
    const labels = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
    const response = await fetch("/api/evals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: selectedRun.runId, resultId: selectedResult.resultId, labels }),
    });
    if (response.ok) await load();
    else setError("人工标签保存失败。");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span><FlaskConical size={20} /></span>
          <div><strong>售后 Agent · Evals</strong><small>固定案例 · 确定性 Grader · Sandbox</small></div>
        </div>
        <nav className={styles.headerActions}>
          <a href="/ops">运营台</a>
          <a href="/trace">Trace 控制台</a>
          <a href="/knowledge">知识库</a>
          <a href="/" target="_blank" rel="noreferrer">消费者端 <ArrowUpRight size={13} /></a>
        </nav>
      </header>

      <section className={styles.content}>
        <div className={styles.hero}>
          <div><span className={styles.eyebrow}>QUALITY BASELINE</span><h1>可重复运行，可定位到失败阶段</h1><p>同时检查 route、risk、tool、confirmation、source 与 response boundary。评测失败不会中断后续案例。</p></div>
          <div className={styles.heroActions}>
            <button className={styles.secondaryButton} onClick={() => void load()} disabled={running}><RefreshCw size={15} />刷新</button>
            <button className={styles.runButton} onClick={() => void run()} disabled={running}><Play size={15} fill="currentColor" />{running ? "运行中…" : `运行全部 ${data?.dataset.total ?? ""} 项`}</button>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.stats}>
          <Stat icon={<Beaker size={18} />} label="固定案例" value={data?.dataset.total ?? 0} />
          <Stat icon={<CircleGauge size={18} />} label="最新通过率" value={selectedRun ? `${selectedRun.passRate}%` : "—"} tone={selectedRun?.failed ? "warning" : "normal"} />
          <Stat icon={<XCircle size={18} />} label="最新失败" value={selectedRun?.failed ?? 0} tone={selectedRun?.failed ? "danger" : "normal"} />
          <Stat icon={<Timer size={18} />} label="套件指纹" value={selectedRun?.stableFingerprint ?? "待运行"} code />
        </div>

        {selectedRun ? (
          <>
            <section className={styles.runBar}>
              <label><span>运行记录</span><select value={selectedRun.runId} onChange={(event) => { setSelectedRunId(event.target.value); setSelectedResultId(""); }}>
                {data?.runs.map((runItem) => <option key={runItem.runId} value={runItem.runId}>{formatTime(runItem.completedAt)} · {runItem.total} 项 · {runItem.passRate}%</option>)}
              </select></label>
              <div><span>{selectedRun.suiteVersion}</span><span>{selectedRun.mockVersion}</span><span>{selectedRun.durationMs} ms</span></div>
            </section>

            <section className={styles.categoryGrid}>
              {selectedRun.categories.map((item) => <button key={item.category} className={category === item.category ? styles.activeCategory : ""} onClick={() => setCategory(category === item.category ? "all" : item.category)}>
                <div><strong>{CATEGORY_LABELS[item.category]}</strong><span>{item.passed}/{item.total}</span></div>
                <div className={styles.meter}><i style={{ width: `${item.passRate}%` }} /></div>
                <small>{item.passRate}%</small>
              </button>)}
            </section>

            <div className={styles.toolbar}>
              <div className={styles.segmented}>
                {(["all", "pass", "fail"] as const).map((value) => <button key={value} className={status === value ? styles.active : ""} onClick={() => setStatus(value)}>{value === "all" ? "全部" : value === "pass" ? "通过" : "失败"}</button>)}
              </div>
              <select value={category} onChange={(event) => setCategory(event.target.value as EvalCategory | "all")} aria-label="按评测类别筛选"><option value="all">全部类别</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select value={badCaseLabel} onChange={(event) => setBadCaseLabel(event.target.value as BadCaseLabel | "all")} aria-label="按 bad case 标签筛选"><option value="all">全部 bad case</option>{BAD_CASE_LABELS.map((label) => <option key={label} value={label}>{BAD_CASE_LABEL_NAMES[label]}</option>)}</select>
              <span className={styles.count}>{filteredResults.length} 条</span>
            </div>

            <div className={styles.workspace}>
              <section className={styles.listPanel} aria-label="评测结果列表">
                {filteredResults.map((result) => <button key={result.resultId} className={`${styles.resultRow} ${selectedResult?.resultId === result.resultId ? styles.selected : ""}`} onClick={() => setSelectedResultId(result.resultId)}>
                  <div className={styles.rowTop}>{result.passed ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<strong>{CATEGORY_LABELS[result.category]}</strong><time>{result.durationMs} ms</time></div>
                  <p>{result.title}</p>
                  <div className={styles.rowMeta}><code>{result.caseId}</code><span>{result.passed ? "6 Graders 通过" : `${result.graders.filter((item) => item.status === "fail").length} 个失败点`}</span></div>
                </button>)}
                {!filteredResults.length && <div className={styles.empty}>没有符合当前筛选条件的结果。</div>}
              </section>

              <section className={styles.detailPanel} aria-label="评测结果详情">
                {selectedResult ? <ResultDetail run={selectedRun} result={selectedResult} onToggleLabel={toggleLabel} onRun={() => run(selectedResult.caseId)} running={running} /> : <div className={styles.empty}>选择一条评测记录查看预期与实际。</div>}
              </section>
            </div>
          </>
        ) : (
          <section className={styles.firstRun}><FlaskConical size={30} /><strong>还没有评测运行记录</strong><p>数据集已包含 {data?.dataset.total ?? 0} 条固定虚拟案例。运行后会生成通过率、失败归因和 Trace 关联。</p><button onClick={() => void run()} disabled={running}><Play size={15} />运行全部案例</button></section>
        )}
      </section>
    </main>
  );
}

function Stat({ icon, label, value, tone = "normal", code = false }: { icon: React.ReactNode; label: string; value: string | number; tone?: "normal" | "warning" | "danger"; code?: boolean }) {
  return <div className={`${styles.stat} ${styles[tone]}`}><span>{icon}</span><div><strong className={code ? styles.codeValue : ""}>{value}</strong><small>{label}</small></div></div>;
}

function ResultDetail({ run, result, onToggleLabel, onRun, running }: { run: EvalRun; result: EvalCaseResult; onToggleLabel: (label: BadCaseLabel) => Promise<void>; onRun: () => Promise<void>; running: boolean }) {
  const failures = result.graders.filter((item) => item.status === "fail");
  return <div className={styles.detail}>
    <div className={styles.detailHead}>
      <div><div className={`${styles.outcome} ${result.passed ? styles.pass : styles.fail}`}>{result.passed ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{result.passed ? "通过" : "BAD CASE"}</div><h2>{result.title}</h2><p><code>{result.caseId}</code> · {CATEGORY_LABELS[result.category]} · {result.durationMs} ms</p></div>
      <button onClick={() => void onRun()} disabled={running}><Play size={13} />单条重跑</button>
    </div>

    <section className={styles.traceCard}><div><ShieldCheck size={17} /><span><strong>Trace ID</strong><code>{result.traceId}</code></span></div><a href={`/trace?traceId=${encodeURIComponent(result.traceId)}`} target="_blank" rel="noreferrer">打开 Trace <ArrowUpRight size={13} /></a></section>

    <section className={styles.graderGrid}>
      {result.graders.map((grader) => <article key={grader.grader} className={grader.status === "fail" ? styles.graderFail : grader.status === "pass" ? styles.graderPass : styles.graderSkip}>
        <div>{grader.status === "fail" ? <XCircle size={14} /> : grader.status === "pass" ? <CheckCircle2 size={14} /> : <CircleGauge size={14} />}<strong>{grader.grader}</strong><span>{grader.status}</span></div><p>{grader.message}</p><code>{grader.code}</code>
      </article>)}
    </section>

    {!result.passed && <section className={styles.badCaseSection}><div><Tag size={16} /><span><strong>bad case 归因</strong><small>自动标签用实线，可叠加人工标签</small></span></div><div className={styles.labels}>{BAD_CASE_LABELS.map((label) => {
      const auto = result.badCaseLabels.includes(label);
      const manual = result.manualLabels.includes(label);
      return <button key={label} className={`${auto ? styles.autoLabel : ""} ${manual ? styles.manualLabel : ""}`} onClick={() => void onToggleLabel(label)} disabled={auto}>{BAD_CASE_LABEL_NAMES[label]}{auto ? " · 自动" : manual ? " · 人工" : ""}</button>;
    })}</div></section>}

    {failures.length > 0 && <section className={styles.failureSummary}><AlertTriangle size={17} /><div><strong>失败定位</strong>{failures.map((failure) => <p key={failure.grader}><code>{failure.grader}</code>{failure.message}</p>)}</div></section>}

    <div className={styles.compareGrid}><section><h3>预期</h3><pre>{JSON.stringify(result.expected, null, 2)}</pre></section><section><h3>实际</h3><pre>{JSON.stringify(compactActual(result), null, 2)}</pre></section></div>
    <footer className={styles.detailFoot}><span>运行 {run.runId}</span><span>{run.suiteVersion} / {run.mockVersion}</span></footer>
  </div>;
}
