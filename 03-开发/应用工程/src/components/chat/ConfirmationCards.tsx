"use client";

import { useEffect, useRef, useState } from "react";

import type { ConfirmationDecisionAction, ConfirmationRequest, ReturnFormData, ServiceTicketFormData } from "@/lib/contracts";

import { confirmationDecision, type ConfirmationAction } from "./confirmation-decision";
import {
  cloneConfirmationSnapshot,
  ConfirmationSubmissionGate,
  formatConfirmationValue,
  getConfirmationPresentation,
  isConfirmationExpired,
  isConfirmationExpiryError,
  type ConfirmationSnapshot,
  type ConfirmationTransportResult,
  updateConfirmationSnapshot,
  validateConfirmationSnapshot,
} from "./confirmation-flow";

type ConfirmationCardLifecycle = "active" | "cancelled" | "modified" | "confirmed";

export function UnifiedConfirmationCard({
  request,
  busy,
  onDecision,
  onRegenerate,
}: {
  request: ConfirmationRequest;
  busy: boolean;
  onDecision: (
    request: ConfirmationRequest,
    action: ConfirmationDecisionAction,
    finalSnapshot?: Readonly<ConfirmationSnapshot>,
  ) => Promise<ConfirmationTransportResult>;
  onRegenerate: () => Promise<ConfirmationTransportResult>;
}) {
  const [snapshot, setSnapshot] = useState<ConfirmationSnapshot>(() => cloneConfirmationSnapshot(request.draftSnapshot));
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState<ConfirmationDecisionAction | "regenerate" | null>(null);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(() => isConfirmationExpired(request));
  const [lifecycle, setLifecycle] = useState<ConfirmationCardLifecycle>("active");
  const gateRef = useRef(new ConfirmationSubmissionGate());
  const presentation = getConfirmationPresentation(request, snapshot);

  useEffect(() => {
    const expiresAt = Date.parse(request.expiresAt);
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [request.expiresAt]);

  async function decide(action: ConfirmationDecisionAction) {
    if (busy || gateRef.current.locked || lifecycle !== "active") return;
    if (expired) {
      setError("确认草稿已过期，请重新生成后再提交");
      return;
    }
    if (action !== "cancel") {
      const validationError = validateConfirmationSnapshot(request, snapshot);
      if (validationError) {
        setEditing(true);
        setError(validationError);
        return;
      }
    }

    setError("");
    setSubmitting(action);
    const gated = await gateRef.current.run(() => onDecision(
      request,
      action,
      action === "cancel" ? undefined : cloneConfirmationSnapshot(snapshot),
    ));
    if (!gated.accepted) {
      setSubmitting(null);
      return;
    }

    const result = gated.value;
    if (result.status === "completed") {
      setLifecycle(action === "cancel" ? "cancelled" : action === "modify" ? "modified" : "confirmed");
      return;
    }
    setSubmitting(null);
    if (result.status === "stopped") {
      setError("已停止，本次没有继续提交；最终编辑内容已保留");
      return;
    }
    if (result.status === "error") {
      if (isConfirmationExpiryError(result.code, result.message)) {
        setExpired(true);
        setError("确认草稿已过期，请重新生成后再提交");
      } else {
        setError(result.retryable
          ? "网络或服务暂时异常，最终编辑内容已保留，可安全重试"
          : result.message);
      }
    }
  }

  async function regenerate() {
    if (busy || gateRef.current.locked || lifecycle !== "active") return;
    setError("");
    setSubmitting("regenerate");
    const gated = await gateRef.current.run(onRegenerate);
    if (!gated.accepted) {
      setSubmitting(null);
      return;
    }
    const result = gated.value;
    if (result.status === "completed") {
      setLifecycle("modified");
      return;
    }
    setSubmitting(null);
    if (result.status === "stopped") setError("已停止重新生成，你仍可以再次尝试");
    if (result.status === "error") setError("暂时无法重新生成确认草稿，请稍后再试");
  }

  if (lifecycle !== "active") {
    const copy = lifecycle === "cancelled"
      ? "本次操作已取消，确认卡已关闭"
      : lifecycle === "modified"
        ? "原确认卡已关闭，请使用最新生成的确认草稿"
        : "已确认提交，正在等待服务端处理结果";
    return <article className="rich-card confirm-card confirmation-closed" aria-label="已关闭的确认卡"><strong>{copy}</strong></article>;
  }

  const locked = busy || submitting !== null;
  return (
    <article className="rich-card confirm-card unified-confirm-card" aria-label={presentation.title} aria-busy={locked}>
      <span className="kicker">{editing ? "编辑字段" : "查看草稿"}</span>
      <h3>{presentation.title}</h3>
      {editing ? (
        <div className="return-form">
          {presentation.fields.map((field) => {
            const value = typeof snapshot[field.key] === "string" ? snapshot[field.key] as string : "";
            if (!field.editable) return (
              <div className="confirmation-readonly" key={field.key}><span>{field.label}</span><strong>{formatConfirmationValue(field, snapshot[field.key])}</strong></div>
            );
            if (field.input === "select") return (
              <label key={field.key}><span>{field.label}</span><select aria-label={field.label} value={value} disabled={locked} onChange={(event) => { setSnapshot((current) => updateConfirmationSnapshot(current, field.key, event.target.value)); setError(""); }}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            );
            if (field.input === "textarea") return (
              <label key={field.key}><span>{field.label}</span><textarea aria-label={field.label} rows={2} value={value} disabled={locked} onChange={(event) => { setSnapshot((current) => updateConfirmationSnapshot(current, field.key, event.target.value)); setError(""); }} /></label>
            );
            return (
              <label key={field.key}><span>{field.label}</span><input aria-label={field.label} inputMode={field.input === "tel" ? "tel" : "text"} value={value} disabled={locked} onChange={(event) => { setSnapshot((current) => updateConfirmationSnapshot(current, field.key, event.target.value)); setError(""); }} /></label>
            );
          })}
        </div>
      ) : (
        <div className="confirm-list">
          {presentation.fields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{formatConfirmationValue(field, snapshot[field.key])}</strong></div>)}
        </div>
      )}
      {request.risks.length > 0 && <div className="confirmation-risks"><strong>提交前请留意</strong><ul>{request.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>}
      {expired && <p className="form-error" role="alert">确认草稿已过期，旧确认信息已停用</p>}
      {error && !expired && <p className="form-error" role="alert">{error}</p>}
      {expired ? (
        <button className="primary wide" disabled={locked} onClick={() => void regenerate()}>{submitting === "regenerate" ? "正在重新生成…" : "重新生成确认草稿"}</button>
      ) : (
        <div className="confirmation-actions">
          <button disabled={locked} onClick={() => setEditing((value) => !value)}>{editing ? "查看草稿" : "返回修改"}</button>
          <button disabled={locked} onClick={() => void decide("cancel")}>{submitting === "cancel" ? "正在取消…" : "取消"}</button>
          <button className="primary" disabled={locked} onClick={() => void decide(editing ? "modify" : "confirm")}>{submitting ? "正在处理…" : editing ? "保存修改" : presentation.confirmLabel}</button>
        </div>
      )}
    </article>
  );
}

export function ConfirmationActions({
  busy,
  editing,
  confirmLabel,
  onEdit,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  editing?: boolean;
  confirmLabel: string;
  onEdit: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  function act(action: ConfirmationAction) {
    const decision = confirmationDecision(action);
    if (decision.shouldEdit) onEdit();
    if (decision.shouldCancel) onCancel();
    if (decision.shouldSubmit) onConfirm();
  }

  return (
    <div className="confirmation-actions">
      <button disabled={busy} onClick={() => act("edit")}>{editing ? "返回确认" : "返回修改"}</button>
      <button disabled={busy} onClick={() => act("cancel")}>取消</button>
      <button className="primary" disabled={busy} onClick={() => act("confirm")}>{confirmLabel}</button>
    </div>
  );
}

export function ReturnConfirmCard({
  initialForm,
  busy,
  onSubmit,
  onCancel,
}: {
  initialForm: ReturnFormData;
  busy: boolean;
  onSubmit: (formData: ReturnFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof ReturnFormData>(key: K, value: ReturnFormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function submit() {
    const required = [form.product, form.issueDescription, form.contactPhone, form.pickupAddress];
    if (required.some((value) => !value.trim())) {
      setEditing(true);
      setError("请补全所有申请信息后再提交");
      return;
    }
    onSubmit({ ...form });
  }

  return (
    <article className="rich-card confirm-card return-form-card">
      <span className="kicker">提交前确认</span><h3>{editing ? "修改退换货申请" : "确认退换货申请"}</h3>
      {editing ? (
        <div className="return-form">
          <label><span>服务类型</span><select aria-label="服务类型" value={form.serviceType} onChange={(event) => update("serviceType", event.target.value as ReturnFormData["serviceType"])}><option value="换货">换货</option><option value="退货">退货</option></select></label>
          <label><span>商品</span><input aria-label="商品" value={form.product} onChange={(event) => update("product", event.target.value)} /></label>
          <label><span>问题描述</span><textarea aria-label="问题描述" rows={3} value={form.issueDescription} onChange={(event) => update("issueDescription", event.target.value)} /></label>
          <label><span>联系电话</span><input aria-label="联系电话" inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></label>
          <label><span>取件地址</span><textarea aria-label="取件地址" rows={2} value={form.pickupAddress} onChange={(event) => update("pickupAddress", event.target.value)} /></label>
        </div>
      ) : (
        <div className="confirm-list">
          <div><span>操作</span><strong>{form.serviceType}申请</strong></div>
          <div><span>商品</span><strong>{form.product}</strong></div>
          <div><span>问题</span><strong>{form.issueDescription}</strong></div>
          <div><span>联系电话</span><strong>{form.contactPhone}</strong></div>
          <div><span>取件地址</span><strong>{form.pickupAddress}</strong></div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="sandbox-note">当前为演示环境；确认后才会创建 Sandbox 申请。</div>
      <ConfirmationActions busy={busy} editing={editing} confirmLabel="确认提交" onEdit={() => setEditing((value) => !value)} onCancel={onCancel} onConfirm={submit} />
    </article>
  );
}

export function ServiceTicketFormCard({
  initialForm,
  busy,
  onSubmit,
  onCancel,
}: {
  initialForm: ServiceTicketFormData;
  busy: boolean;
  onSubmit: (formData: ServiceTicketFormData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof ServiceTicketFormData>(key: K, value: ServiceTicketFormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function submit() {
    const required = [form.product, form.faultDescription, form.contactPhone, form.serviceAddress, form.preferredContactTime];
    if (required.some((value) => !value.trim())) {
      setEditing(true);
      setError("请补全所有服务信息后再提交");
      return;
    }
    onSubmit({ ...form });
  }

  return (
    <article className="rich-card confirm-card service-form-card">
      <span className="kicker">提交前确认</span><h3>{editing ? `修改${form.serviceType}` : `确认${form.serviceType}`}</h3>
      {editing ? (
        <div className="return-form">
          <label><span>服务类型</span><select aria-label="服务类型" value={form.serviceType} onChange={(event) => update("serviceType", event.target.value as ServiceTicketFormData["serviceType"])}><option value="维修服务">维修服务</option><option value="安装服务">安装服务</option></select></label>
          <label><span>商品</span><input aria-label="报修商品" value={form.product} onChange={(event) => update("product", event.target.value)} /></label>
          <label><span>购买渠道</span><select aria-label="购买渠道" value={form.purchaseChannel} onChange={(event) => update("purchaseChannel", event.target.value as ServiceTicketFormData["purchaseChannel"])}><option value="线上商城">线上商城</option><option value="线下门店">线下门店</option></select></label>
          <label><span>{form.serviceType === "安装服务" ? "安装需求" : "故障描述"}</span><textarea aria-label="服务问题描述" rows={3} value={form.faultDescription} onChange={(event) => update("faultDescription", event.target.value)} /></label>
          <label><span>联系电话</span><input aria-label="报修联系电话" inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></label>
          <label><span>服务地址</span><textarea aria-label="服务地址" rows={2} value={form.serviceAddress} onChange={(event) => update("serviceAddress", event.target.value)} /></label>
          <label><span>方便联系时段</span><input aria-label="方便联系时段" value={form.preferredContactTime} onChange={(event) => update("preferredContactTime", event.target.value)} /></label>
        </div>
      ) : (
        <div className="confirm-list">
          <div><span>操作</span><strong>创建{form.serviceType}</strong></div>
          <div><span>商品</span><strong>{form.product}</strong></div>
          <div><span>问题</span><strong>{form.faultDescription}</strong></div>
          <div><span>购买渠道</span><strong>{form.purchaseChannel}</strong></div>
          <div><span>联系时段</span><strong>{form.preferredContactTime}</strong></div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="sandbox-note">当前为演示环境；确认后才会创建 Sandbox 工单。</div>
      <ConfirmationActions busy={busy} editing={editing} confirmLabel={`确认提交${form.serviceType}`} onEdit={() => setEditing((value) => !value)} onCancel={onCancel} onConfirm={submit} />
    </article>
  );
}
