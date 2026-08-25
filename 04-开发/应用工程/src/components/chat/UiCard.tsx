"use client";

import {
  BellRing,
  Check,
  Clock3,
  Headphones,
  ImagePlus,
  Phone,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import type { ChatUi, OrderView, ReturnFormData, ServiceTicketFormData } from "@/lib/contracts";

import { ConfirmationActions, ReturnConfirmCard, ServiceTicketFormCard } from "./ConfirmationCards";

export interface UiCardActions {
  onIdentity: () => void;
  onReturn: (formData: ReturnFormData) => void;
  onRefresh: () => void;
  onContact: (order: OrderView) => void;
  onPrepareUrge: () => void;
  onSubmitUrge: () => void;
  onServiceIdentity: () => void;
  onPrepareServiceTicket: (reportedIssue: string) => void;
  onSubmitServiceTicket: (formData: ServiceTicketFormData) => void;
  onTroubleshootingResolved: () => void;
  onCancelConfirmation: () => void;
  onEditConfirmation: () => void;
}

export function UiCard({ ui, busy, actions }: { ui: ChatUi; busy: boolean; actions: UiCardActions }) {
  if (ui.kind === "product") return (
    <article className="rich-card product-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ui.product.image} alt={ui.product.name} />
      <div><span className="kicker">适配你的空间</span><h3>{ui.product.name}</h3><p>{ui.product.model}</p><div className="tags">{ui.product.specs.map((spec) => <span key={spec}>{spec}</span>)}</div></div>
    </article>
  );

  if (ui.kind === "repair_intake") return (
    <article className="rich-card repair-intake-card">
      <span className="kicker">故障报修</span><h3>请描述具体故障现象</h3>
      <p>可以直接说发生了什么，不需要判断是不是安全问题。</p>
      <div className="repair-examples">{ui.examples.map((example) => <span key={example}>{example}</span>)}</div>
      <div className="repair-safety-tip"><TriangleAlert size={15} /><span>如有冒烟、烧焦味、火花或异常发热，系统会优先进入安全处理。</span></div>
    </article>
  );

  if (ui.kind === "knowledge_answer") return (
    <article className="rich-card knowledge-answer-card">
      <span className="kicker">智能问答</span><h3>{ui.title}</h3>
      <ul>{ui.items.map((item) => <li key={item}>{item}</li>)}</ul><small>{ui.footer}</small>
    </article>
  );

  if (ui.kind === "human_handoff") return (
    <article className="rich-card handoff-card">
      <span className="kicker">人工接管</span><h3>{ui.title}</h3><p>{ui.reason}</p>
      <div><Headphones size={15} /><span>当前队列：{ui.queue}</span></div>
    </article>
  );

  if (ui.kind === "service_menu") return null;

  if (ui.kind === "identity_confirm") {
    const serviceQuery = ui.purpose === "service";
    return (
      <article className="rich-card identity-card">
        <span className="kicker">安全验证</span><h3>{serviceQuery ? "确认查询当前账号的售后工单" : "确认查询当前账号的订单"}</h3>
        <p>手机号{ui.maskedPhone} · 仅用于本次查询</p>
        <button className="primary wide" disabled={busy} onClick={serviceQuery ? actions.onServiceIdentity : actions.onIdentity}>确认本人</button>
      </article>
    );
  }

  if (ui.kind === "order") return (
    <article className="rich-card order-card">
      <div className="order-head"><div><span>订单号</span><strong>{ui.order.id}</strong></div><em>{ui.order.status}</em></div>
      <div className="logistics-meta"><div><span>承运商</span><strong>{ui.order.carrier}</strong></div><div><span>运单号</span><strong>{ui.order.trackingNo}</strong></div></div>
      <div className="eta"><Clock3 size={17} />{ui.order.eta}</div>
      <div className="timeline">{ui.order.events.map((entry) => <div key={`${entry.time}-${entry.text}`} className={entry.active ? "event active" : "event"}><span>{entry.text}</span><small>{entry.time}</small></div>)}</div>
      <div className="order-actions">
        <button disabled={busy} onClick={() => actions.onContact(ui.order)}><Phone size={14} />联系物流</button>
        <button className="urge" disabled={busy} onClick={actions.onPrepareUrge}><BellRing size={14} />一键催物流</button>
        <button className="refresh" disabled={busy} onClick={actions.onRefresh}>刷新 <RefreshCw size={14} /></button>
      </div>
    </article>
  );

  if (ui.kind === "safety") return (
    <div className="safety-card"><TriangleAlert size={19} /><div><strong>安全风险：请先确保断电</strong><p>如果出现明火，请先远离现场并联系紧急服务。系统已自动升级人工处理。</p></div></div>
  );
  if (ui.kind === "upload_prompt") return <div className="hint-card"><ImagePlus size={18} /><span>点击下方图片按钮上传照片，支持 JPG、PNG、WEBP，单张不超过 8MB。</span></div>;
  if (ui.kind === "return_confirm") return <ReturnConfirmCard initialForm={ui.form} busy={busy} onSubmit={actions.onReturn} onCancel={actions.onCancelConfirmation} />;
  if (ui.kind === "return_success") return <div className="success-card"><span><Check size={15} /></span><div><strong>申请已提交</strong><p>服务编号：{ui.requestNo}</p></div></div>;

  if (ui.kind === "logistics_urge_confirm") return (
    <article className="rich-card confirm-card urge-confirm-card">
      <span className="kicker">提交前确认</span><h3>确认催促这笔物流</h3>
      <div className="confirm-list">
        <div><span>订单号</span><strong>{ui.orderId}</strong></div><div><span>承运商</span><strong>{ui.carrier}</strong></div>
        <div><span>运单号</span><strong>{ui.trackingNo}</strong></div><div><span>最新状态</span><strong>{ui.latestStatus}</strong></div>
      </div>
      <div className="sandbox-note">当前为演示环境；确认后才会创建 Sandbox 催办记录。</div>
      <ConfirmationActions busy={busy} confirmLabel="确认催办" onEdit={actions.onEditConfirmation} onCancel={actions.onCancelConfirmation} onConfirm={actions.onSubmitUrge} />
    </article>
  );

  if (ui.kind === "logistics_urge_success") return (
    <div className="success-card logistics-success"><span><Check size={15} /></span><div><strong>物流催办已提交</strong><p>催办编号：{ui.requestNo}</p><p>已同步：{ui.handoff}</p></div></div>
  );

  if (ui.kind === "troubleshooting") return (
    <article className="rich-card troubleshooting-card">
      <span className="kicker">安全排查</span><h3>{ui.title}</h3><ol>{ui.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <div className="troubleshooting-note"><TriangleAlert size={15} /><span>{ui.note}</span></div>
      <div className="troubleshooting-actions"><button disabled={busy} onClick={actions.onTroubleshootingResolved}>已经恢复</button><button className="primary" disabled={busy} onClick={() => actions.onPrepareServiceTicket(ui.reportedIssue)}>仍未解决，申请报修</button></div>
    </article>
  );
  if (ui.kind === "service_ticket_form") return <ServiceTicketFormCard initialForm={ui.form} busy={busy} onSubmit={actions.onSubmitServiceTicket} onCancel={actions.onCancelConfirmation} />;
  if (ui.kind === "service_ticket_success") return <div className="success-card"><span><Check size={15} /></span><div><strong>{ui.serviceType}已提交</strong><p>工单编号：{ui.ticketNo}</p></div></div>;
  if (ui.kind === "service_ticket") return (
    <article className="rich-card service-ticket-card">
      <div className="order-head"><div><span>工单编号</span><strong>{ui.ticket.id}</strong></div><em>{ui.ticket.status}</em></div>
      <div className="service-summary"><strong>{ui.ticket.product}</strong><span>{ui.ticket.issue}</span><small>更新于 {ui.ticket.updatedAt}</small></div>
      <div className="timeline">{ui.ticket.events.map((entry) => <div key={`${entry.time}-${entry.text}`} className={entry.active ? "event active" : "event"}><span>{entry.text}</span><small>{entry.time}</small></div>)}</div>
    </article>
  );
  return null;
}
