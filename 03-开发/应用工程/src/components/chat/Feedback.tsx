"use client";

import { Check, MessageCircle, X } from "lucide-react";
import { useState } from "react";

export function ResolutionPrompt({ value, onChange }: { value?: boolean; onChange: (resolved: boolean) => void }) {
  return (
    <section className="resolution-prompt" aria-label="会话解决反馈" data-feedback-prompt>
      <div><MessageCircle size={15} /><span>{value === undefined ? "这次解决了你的问题吗？" : <><Check size={13} />感谢反馈，你可以随时修改</>}</span></div>
      <div><button className={value === true ? "selected" : ""} onClick={() => onChange(true)}>已解决</button><button className={value === false ? "selected" : ""} onClick={() => onChange(false)}>未解决</button></div>
    </section>
  );
}

const reasons = ["回答不准确", "没有解决问题", "步骤看不懂", "等待时间太长"];

export function FeedbackSheet({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason?: string) => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <>
      <button className="backdrop" aria-label="关闭反馈" onClick={onClose} />
      <section className="sheet feedback-sheet" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <div className="sheet-handle" /><button className="sheet-close" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        <h2 id="feedback-title">哪里需要改进？</h2><p>可选。反馈仅保存于当前本地演示环境。</p>
        <div className="feedback-reasons">{reasons.map((item) => <button key={item} className={reason === item ? "selected" : ""} onClick={() => setReason(item)}>{item}</button>)}</div>
        <textarea rows={3} maxLength={200} value={note} aria-label="补充说明" placeholder="补充说明（选填）" onChange={(event) => setNote(event.target.value)} />
        <button className="primary feedback-submit" onClick={() => onSubmit([reason, note.trim()].filter(Boolean).join("；") || undefined)}>提交反馈</button>
      </section>
    </>
  );
}
