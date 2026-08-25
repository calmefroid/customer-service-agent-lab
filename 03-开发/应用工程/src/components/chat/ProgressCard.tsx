"use client";

import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { LocalProgress } from "./types";

export function ProgressCard({ progress }: { progress: LocalProgress }) {
  const [expanded, setExpanded] = useState(progress.status === "running");

  useEffect(() => {
    if (progress.status !== "completed") return;
    const timer = window.setTimeout(() => setExpanded(false), 650);
    return () => window.clearTimeout(timer);
  }, [progress.status]);

  const completed = progress.steps.filter((step) => step.status === "completed").length;
  const current = progress.steps.find((step) => step.status === "running")?.title;
  const summary = progress.status === "completed"
    ? `已完成 ${progress.steps.map((step) => step.title).join(" → ")}`
    : progress.status === "failed" ? "处理未完成，请查看下方提示"
      : progress.status === "stopped" ? "已停止生成"
        : current ?? "正在开始处理";
  const failure = progress.status === "failed" || progress.status === "stopped";

  return (
    <article className={`public-progress ${progress.status}`} aria-label="任务处理进度">
      <button className="progress-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="progress-state-icon">
          {progress.status === "running" ? <LoaderCircle size={15} /> : failure ? <X size={15} /> : <Check size={15} />}
        </span>
        <span className="progress-copy"><strong>{progress.title}</strong><small>{summary}</small></span>
        <span className="progress-count">
          {progress.status === "completed" ? `${((progress.totalDurationMs ?? 0) / 1000).toFixed(1)}s` : `${completed}/${progress.steps.length}`}
        </span>
        <ChevronDown className={expanded ? "expanded" : ""} size={15} />
      </button>
      {expanded && (
        <ol className="public-progress-steps">
          {progress.steps.map((step) => (
            <li key={step.id} className={step.status}>
              <span>{step.status === "completed" ? <Check size={11} /> : step.status === "running" ? <LoaderCircle size={11} /> : step.status === "failed" || step.status === "stopped" ? <X size={11} /> : null}</span>
              <p>{step.title}</p>
              {step.durationMs !== undefined && <time>{(step.durationMs / 1000).toFixed(1)}s</time>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
