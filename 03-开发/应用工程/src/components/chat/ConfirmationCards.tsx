"use client";

import { useState } from "react";

import type { ReturnFormData, ServiceTicketFormData } from "@/lib/contracts";

import { confirmationDecision, type ConfirmationAction } from "./confirmation-decision";

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
