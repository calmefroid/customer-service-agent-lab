"use client";

import { Check, Clock3, ShieldCheck } from "lucide-react";

import type { ChatRequest, ChatUi, OrderOperationResultView, ReturnExchangeStatusView } from "@/lib/contracts";

export type IdentityConfirmationPurpose = Extract<ChatUi, { kind: "identity_confirm" }>["purpose"];

export interface IdentityConfirmationConfig {
  title: string;
  note: string;
  action: NonNullable<ChatRequest["action"]>;
  requestMessage: string;
}

const identityConfirmationConfigs: Record<IdentityConfirmationPurpose, IdentityConfirmationConfig> = {
  order: {
    title: "确认查询当前演示账号的订单",
    note: "确认后仅查询当前演示身份下的订单与物流信息。",
    action: "confirm_identity",
    requestMessage: "查询最近订单",
  },
  service: {
    title: "确认查询当前演示账号的售后工单",
    note: "确认后仅查询当前演示身份下的售后工单。",
    action: "confirm_service_identity",
    requestMessage: "查询最近售后工单",
  },
  order_change: {
    title: "确认申请修改当前订单地址",
    note: "确认身份后只会生成修改地址草稿，不会直接修改订单。",
    action: "prepare_order_change",
    requestMessage: "准备修改订单地址申请",
  },
  order_cancel: {
    title: "确认申请取消当前订单",
    note: "确认身份后只会生成取消申请草稿，不会直接取消订单。",
    action: "prepare_order_cancel",
    requestMessage: "准备取消订单申请",
  },
  return: {
    title: "确认查询当前演示账号的退换进度",
    note: "确认后仅展示当前演示身份下的退换申请。",
    action: "confirm_return_identity",
    requestMessage: "查询最近退换申请进度",
  },
};

export function getIdentityConfirmationConfig(purpose: IdentityConfirmationPurpose): IdentityConfirmationConfig {
  return identityConfirmationConfigs[purpose];
}

export function IdentityConfirmationCard({
  maskedPhone,
  purpose,
  busy,
  onConfirm,
}: {
  maskedPhone: string;
  purpose: IdentityConfirmationPurpose;
  busy: boolean;
  onConfirm: (purpose: IdentityConfirmationPurpose) => void;
}) {
  const config = getIdentityConfirmationConfig(purpose);
  return (
    <article className="rich-card identity-card stage4-identity-card">
      <span className="kicker"><ShieldCheck size={13} />演示身份确认</span>
      <h3>{config.title}</h3>
      <p>手机号 {maskedPhone}</p>
      <div className="identity-note">{config.note}</div>
      <button className="primary wide" disabled={busy} onClick={() => onConfirm(purpose)}>确认演示身份</button>
    </article>
  );
}

export function OrderOperationSuccessCard({ result }: { result: OrderOperationResultView }) {
  const addressChange = result.operation === "order_change";
  return (
    <article className="success-card order-operation-result" aria-label={addressChange ? "修改地址申请已提交" : "取消订单申请已提交"}>
      <span><Check size={15} /></span>
      <div>
        <strong>{addressChange ? "修改地址申请已提交" : "取消订单申请已提交"}</strong>
        <p>申请编号：{result.requestNo}</p>
        <p>订单号：{result.orderId}</p>
        <small>申请已进入业务处理流程，请以后续处理结果为准。</small>
      </div>
    </article>
  );
}

const returnStatusLabels: Record<string, string> = {
  submitted: "申请已提交",
  reviewing: "审核中",
  approved: "审核通过",
  pickup_scheduled: "等待取件",
  completed: "已完成",
  rejected: "未通过",
  cancelled: "已取消",
};

export function getPublicReturnStatus(status: string): string {
  return returnStatusLabels[status] ?? "处理中";
}

export function ReturnStatusCard({ request }: { request: ReturnExchangeStatusView }) {
  const serviceType = request.serviceType;
  const status = getPublicReturnStatus(request.status);
  return (
    <article className="rich-card return-status-card" aria-label="退换申请进度">
      <div className="order-head">
        <div><span>退换申请编号</span><strong>{request.requestNo}</strong></div>
        <em>{status}</em>
      </div>
      <div className="return-status-summary">
        <div><span>服务类型</span><strong>{serviceType}</strong></div>
        <div><span>订单号</span><strong>{request.orderId}</strong></div>
        <div className="wide-row"><span>商品</span><strong>{request.product}</strong></div>
      </div>
      <div className="return-status-updated"><Clock3 size={14} />最近更新：{request.updatedAt}</div>
      {request.events.length > 0 ? (
        <div className="timeline return-timeline">
          {request.events.map((entry) => (
            <div key={`${entry.time}-${entry.text}`} className={entry.active ? "event active" : "event"}>
              <span>{entry.text}</span><small>{entry.time}</small>
            </div>
          ))}
        </div>
      ) : (
        <div className="timeline-empty"><strong>暂无新的进度记录</strong><span>当前状态为“{status}”，有新进展后会显示在这里。</span></div>
      )}
      <div className="identity-scope-note">仅展示当前演示身份下的申请数据</div>
    </article>
  );
}
