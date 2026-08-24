"use client";

import {
  BellRing,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Ellipsis,
  Headphones,
  ImagePlus,
  LoaderCircle,
  PackageOpen,
  Phone,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AttachmentMeta,
  ChatRequest,
  ChatResponse,
  ChatUi,
  OrderView,
  ReturnFormData,
  ServiceModule,
  ServiceTicketFormData,
} from "@/lib/contracts";
import { getPublicProgressPlan } from "@/lib/public-progress";

type LocalProgressStep = {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  durationMs?: number;
};

type LocalProgress = {
  title: string;
  status: "running" | "completed" | "failed";
  totalDurationMs?: number;
  steps: LocalProgressStep[];
};

type LocalMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  ui?: ChatUi;
  imageUrl?: string;
  feedback?: "up" | "down";
  progress?: LocalProgress;
};

const quickActions = [
  { id: "logistics", title: "查订单物流", subtitle: "查进度 · 催物流", message: "帮我查一下订单到哪里了", icon: Truck },
  { id: "return", title: "退换与破损", subtitle: "识别问题 · 建申请", message: "商品有破损，我要申请退换", icon: PackageOpen },
  { id: "repair", title: "故障报修", subtitle: "安全判断 · 建工单", message: "进入故障报修", action: "select_repair", icon: Wrench },
] as const;

const welcomeMessage: LocalMessage = {
  id: "welcome",
  role: "assistant",
  text: "你好，我是智享家售后助手。订单物流、退换破损和灯具故障，都可以帮你处理。请选择下面的服务，或直接描述问题。",
};

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function Home() {
  const [messages, setMessages] = useState<LocalMessage[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [humanSheet, setHumanSheet] = useState(false);
  const [logisticsContact, setLogisticsContact] = useState<OrderView | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState("");
  const [toast, setToast] = useState("");
  const [sessionId, setSessionId] = useState(createSessionId);
  const [activeModule, setActiveModule] = useState<ServiceModule | undefined>();
  const chatRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showQuickActions = useMemo(
    () => messages.length === 1 || messages.at(-1)?.ui?.kind === "service_menu",
    [messages],
  );
  const hasRunningProgress = messages.some((message) => message.progress?.status === "running");

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, pendingFile]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function callChat(
    payload: Omit<ChatRequest, "sessionId">,
    replaceUiKind?: ChatUi["kind"],
  ) {
    setBusy(true);
    const progressPlan = getPublicProgressPlan(payload);
    const progressId = `progress-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const progressStartedAt = performance.now();

    if (progressPlan) {
      setMessages((current) => [...current, {
        id: progressId,
        role: "assistant",
        text: "",
        progress: {
          title: progressPlan.title,
          status: "running",
          steps: progressPlan.steps.map((title, index) => ({
            id: `public-step-${index + 1}`,
            title,
            status: index === 0 ? "running" : "pending",
          })),
        },
      }]);
    }

    function updateProgress(update: (progress: LocalProgress) => LocalProgress) {
      setMessages((current) => current.map((message) =>
        message.id === progressId && message.progress
          ? { ...message, progress: update(message.progress) }
          : message,
      ));
    }

    try {
      const responsePromise = fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sessionId }),
      });

      let response: Response;
      if (progressPlan) {
        for (let index = 0; index < progressPlan.steps.length - 1; index += 1) {
          const stepStartedAt = performance.now();
          await delay(420 + index * 80);
          updateProgress((progress) => ({
            ...progress,
            steps: progress.steps.map((step, stepIndex) => stepIndex === index
              ? { ...step, status: "completed", durationMs: Math.round(performance.now() - stepStartedAt) }
              : stepIndex === index + 1 ? { ...step, status: "running" } : step),
          }));
        }
        [response] = await Promise.all([responsePromise, delay(520)]);
      } else {
        response = await responsePromise;
      }

      if (!response.ok) throw new Error("服务暂时不可用");
      const data = (await response.json()) as ChatResponse;

      if (progressPlan) {
        updateProgress((progress) => ({
          ...progress,
          status: "completed",
          totalDurationMs: Math.round(performance.now() - progressStartedAt),
          steps: progress.steps.map((step) => step.status === "running"
            ? { ...step, status: "completed", durationMs: 520 }
            : step),
        }));
      }

      setMessages((current) => {
        const nextMessage: LocalMessage = {
          id: data.traceId,
          role: "assistant",
          text: data.message,
          ui: data.ui,
        };
        if (replaceUiKind) {
          const index = current.findLastIndex((message) => message.ui?.kind === replaceUiKind);
          if (index >= 0) {
            return current.map((message, messageIndex) => messageIndex === index ? nextMessage : message);
          }
        }
        return [...current, nextMessage];
      });
    } catch {
      if (progressPlan) {
        updateProgress((progress) => ({
          ...progress,
          status: "failed",
          totalDurationMs: Math.round(performance.now() - progressStartedAt),
          steps: progress.steps.map((step) => step.status === "running" ? { ...step, status: "failed" } : step),
        }));
      }
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          text: "服务连接失败，请稍后重试。你的信息尚未提交。",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(message = input.trim(), module = activeModule) {
    if (busy || (!message && !pendingFile)) return;
    const attachment: AttachmentMeta | undefined = pendingFile
      ? { name: pendingFile.name, type: pendingFile.type, size: pendingFile.size }
      : undefined;
    const userMessage: LocalMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: message || "这是刚收到的灯具照片",
      imageUrl: pendingUrl || undefined,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setPendingFile(null);
    setPendingUrl("");
    await callChat({ message: userMessage.text, attachment, module });
  }

  async function runAction(
    userText: string,
    message: string,
    action: ChatRequest["action"],
    payload?: Pick<ChatRequest, "formData" | "serviceFormData">,
  ) {
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text: userText },
    ]);
    await callChat({ message, action, module: activeModule, ...payload });
  }

  async function startModule(action: (typeof quickActions)[number]) {
    const module = action.id as ServiceModule;
    setActiveModule(module);
    if ("action" in action) {
      setMessages((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: "user", text: action.title },
      ]);
      await callChat({ message: action.message, action: action.action, module });
      return;
    }
    await sendMessage(action.message, module);
  }

  function selectFile(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setToast("仅支持 JPG、PNG、WEBP 图片");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setToast("图片不能超过 8MB");
      return;
    }
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    setPendingFile(file);
    setPendingUrl(URL.createObjectURL(file));
  }

  function restart() {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    setMessages([welcomeMessage]);
    setSessionId(createSessionId());
    setActiveModule(undefined);
    setPendingFile(null);
    setPendingUrl("");
    setMenuOpen(false);
    setToast("已开始新会话");
  }

  function rate(id: string, feedback: "up" | "down") {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, feedback } : message));
    setToast(feedback === "up" ? "感谢反馈，已记录“有帮助”" : "已记录，我们会继续改进");
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("回答已复制");
    } catch {
      setToast("当前浏览器不支持自动复制");
    }
  }

  return (
    <main className="phone" aria-label="手机端智能客服">
      <header className="app-header">
        <div className="brand-avatar"><Sparkles size={20} /></div>
        <div className="header-copy">
          <div className="header-title">智享家售后助手</div>
          <div className="header-status"><span className="status-dot" />全天在线</div>
        </div>
        <button className="icon-button" aria-label="转人工" onClick={() => setHumanSheet(true)}><Headphones size={19} /></button>
        <button className="icon-button" aria-label="更多" onClick={() => setMenuOpen((open) => !open)}><Ellipsis size={20} /></button>
      </header>

      <section className="chat" ref={chatRef} aria-live="polite">
        <div className="date-label">今天</div>
        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            busy={busy}
            onIdentity={() => runAction("确认本人", "查询最近订单", "confirm_identity")}
            onReturn={(formData) => runAction("确认提交退换货申请", "提交退换货申请", "submit_return", { formData })}
            onRefresh={() => callChat({ message: "刷新最近订单物流", action: "confirm_identity" }, "order")}
            onContact={(order) => setLogisticsContact(order)}
            onPrepareUrge={() => runAction("物流有点慢，帮我催一下", "准备物流催办", "prepare_logistics_urge")}
            onSubmitUrge={() => runAction("确认催物流", "提交物流催办", "submit_logistics_urge")}
            onServiceIdentity={() => runAction("确认本人", "查询最近售后工单", "confirm_service_identity")}
            onPrepareServiceTicket={(reportedIssue) => runAction("排查后仍未恢复，申请报修", `准备售后报修：${reportedIssue}`, "prepare_service_ticket")}
            onSubmitServiceTicket={(serviceFormData) => runAction(`确认提交${serviceFormData.serviceType}`, `提交${serviceFormData.serviceType}`, "submit_service_ticket", { serviceFormData })}
            onTroubleshootingResolved={() => setToast("已记录问题恢复，无需创建报修")}
            onRate={(feedback) => rate(message.id, feedback)}
            onCopy={() => copyMessage(message.text)}
          />
        ))}

        {showQuickActions && !busy && (
          <div className="quick-grid">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  className="quick-card"
                  onClick={() => void startModule(action)}
                >
                  <span className="quick-icon"><Icon size={16} /></span>
                  <span className="quick-title">{action.title}</span>
                  <span className="quick-subtitle">{action.subtitle}</span>
                </button>
              );
            })}
          </div>
        )}

        {busy && !hasRunningProgress && (
          <div className="message-row">
            <BotAvatar />
            <div className="bubble typing" aria-label="正在回复"><span /><span /><span /></div>
          </div>
        )}
      </section>

      <footer className="composer-wrap">
        {pendingFile && (
          <div className="pending-file">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingUrl} alt="待发送图片预览" />
            <div className="pending-copy"><strong>{pendingFile.name}</strong><span>可补充描述后一起发送</span></div>
            <button aria-label="移除图片" onClick={() => { URL.revokeObjectURL(pendingUrl); setPendingFile(null); setPendingUrl(""); }}><X size={16} /></button>
          </div>
        )}
        <div className="composer">
          <button className="upload-button" aria-label="上传图片" onClick={() => fileRef.current?.click()}><ImagePlus size={20} /></button>
          <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectFile(event.target.files?.[0])} />
          <textarea
            value={input}
            rows={1}
            placeholder="请输入你的问题"
            aria-label="消息内容"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <button className="send-button" aria-label="发送" disabled={busy || (!input.trim() && !pendingFile)} onClick={() => void sendMessage()}><SendHorizontal size={18} /></button>
        </div>
      </footer>

      {menuOpen && (
        <div className="menu-panel">
          <button onClick={restart}><RotateCcw size={17} />重新开始会话</button>
          <button onClick={() => { setMenuOpen(false); setToast("支持订单物流、退换破损与故障报修"); }}><CircleHelp size={17} />查看服务范围</button>
        </div>
      )}

      {humanSheet && (
        <>
          <button className="backdrop" aria-label="关闭弹窗" onClick={() => setHumanSheet(false)} />
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="human-title">
            <div className="sheet-handle" />
            <button className="sheet-close" aria-label="关闭" onClick={() => setHumanSheet(false)}><X size={17} /></button>
            <h2 id="human-title">转接人工客服</h2>
            <p>当前问题和已确认信息会一并转交，你不需要重复描述。</p>
            <div className="summary-card"><strong>本次会话摘要</strong><span>当前共有 {messages.filter((message) => message.role === "user").length} 条用户消息，将同步给人工客服。</span></div>
            <div className="sheet-actions"><button onClick={() => setHumanSheet(false)}>继续问机器人</button><button className="primary" onClick={() => { setHumanSheet(false); setMessages((current) => [...current, { id: `human-${Date.now()}`, role: "assistant", text: "已进入人工客服队列，当前会话摘要已同步。你可以继续补充信息。" }]); }}>确认转人工</button></div>
          </section>
        </>
      )}

      {logisticsContact && (
        <>
          <button className="backdrop" aria-label="关闭物流联系方式" onClick={() => setLogisticsContact(null)} />
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="logistics-contact-title">
            <div className="sheet-handle" />
            <button className="sheet-close" aria-label="关闭" onClick={() => setLogisticsContact(null)}><X size={17} /></button>
            <h2 id="logistics-contact-title">联系物流公司</h2>
            <p>拨打时可向客服提供运单号，便于快速定位当前快件。</p>
            <div className="summary-card contact-summary">
              <div><span>承运商</span><strong>{logisticsContact.carrier}</strong></div>
              <div><span>客服电话</span><strong>{logisticsContact.hotline}</strong></div>
              <div><span>运单号</span><strong>{logisticsContact.trackingNo}</strong></div>
            </div>
            <div className="sheet-actions">
              <button onClick={() => void copyMessage(logisticsContact.hotline)}>复制电话</button>
              <a className="primary" href={`tel:${logisticsContact.hotline}`}><Phone size={15} />拨打 {logisticsContact.hotline}</a>
            </div>
          </section>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function BotAvatar() {
  return <span className="bot-avatar"><Sparkles size={15} /></span>;
}

function Message({
  message,
  busy,
  onIdentity,
  onReturn,
  onRate,
  onCopy,
  onRefresh,
  onContact,
  onPrepareUrge,
  onSubmitUrge,
  onServiceIdentity,
  onPrepareServiceTicket,
  onSubmitServiceTicket,
  onTroubleshootingResolved,
}: {
  message: LocalMessage;
  busy: boolean;
  onIdentity: () => void;
  onReturn: (formData: ReturnFormData) => void;
  onRate: (feedback: "up" | "down") => void;
  onCopy: () => void;
  onRefresh: () => void;
  onContact: (order: OrderView) => void;
  onPrepareUrge: () => void;
  onSubmitUrge: () => void;
  onServiceIdentity: () => void;
  onPrepareServiceTicket: (reportedIssue: string) => void;
  onSubmitServiceTicket: (formData: ServiceTicketFormData) => void;
  onTroubleshootingResolved: () => void;
}) {
  if (message.progress) return <PublicProgressCard progress={message.progress} />;

  if (message.role === "user") {
    return (
      <div className="message-row user">
        <div className={`bubble ${message.imageUrl ? "image-bubble" : ""}`}>
          {message.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={message.imageUrl} alt="用户上传的图片" />
          )}
          <p>{message.text}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="message-row">
        <BotAvatar />
        <div className="bubble"><p>{message.text}</p></div>
      </div>
      {message.ui && (
        <UiCard
          ui={message.ui}
          busy={busy}
          onIdentity={onIdentity}
          onReturn={onReturn}
          onRefresh={onRefresh}
          onContact={onContact}
          onPrepareUrge={onPrepareUrge}
          onSubmitUrge={onSubmitUrge}
          onServiceIdentity={onServiceIdentity}
          onPrepareServiceTicket={onPrepareServiceTicket}
          onSubmitServiceTicket={onSubmitServiceTicket}
          onTroubleshootingResolved={onTroubleshootingResolved}
        />
      )}
      {message.id !== "welcome" && (
        <div className="assistant-tools">
          <button className={message.feedback === "up" ? "selected" : ""} aria-label="有帮助" onClick={() => onRate("up")}><ThumbsUp size={14} /></button>
          <button className={message.feedback === "down" ? "selected" : ""} aria-label="没帮助" onClick={() => onRate("down")}><ThumbsDown size={14} /></button>
          <button aria-label="复制" onClick={onCopy}><Copy size={14} /></button>
        </div>
      )}
    </>
  );
}

function PublicProgressCard({ progress }: { progress: LocalProgress }) {
  const [expanded, setExpanded] = useState(progress.status === "running");

  useEffect(() => {
    if (progress.status !== "completed") return;
    const timer = window.setTimeout(() => setExpanded(false), 650);
    return () => window.clearTimeout(timer);
  }, [progress.status]);

  const completed = progress.steps.filter((step) => step.status === "completed").length;
  const summary = progress.status === "completed"
    ? `已完成 ${progress.steps.map((step) => step.title).join(" → ")}`
    : progress.status === "failed" ? "处理未完成，请查看下方提示" : progress.steps.find((step) => step.status === "running")?.title;

  return (
    <article className={`public-progress ${progress.status}`} aria-label="任务处理进度">
      <button className="progress-summary" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <span className="progress-state-icon">
          {progress.status === "running" ? <LoaderCircle size={15} /> : <Check size={15} />}
        </span>
        <span className="progress-copy"><strong>{progress.title}</strong><small>{summary}</small></span>
        <span className="progress-count">{progress.status === "completed" ? `${((progress.totalDurationMs ?? 0) / 1000).toFixed(1)}s` : `${completed}/${progress.steps.length}`}</span>
        <ChevronDown className={expanded ? "expanded" : ""} size={15} />
      </button>
      {expanded && (
        <ol className="public-progress-steps">
          {progress.steps.map((step) => (
            <li key={step.id} className={step.status}>
              <span>{step.status === "completed" ? <Check size={11} /> : step.status === "running" ? <LoaderCircle size={11} /> : null}</span>
              <p>{step.title}</p>
              {step.durationMs && <time>{(step.durationMs / 1000).toFixed(1)}s</time>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function UiCard({
  ui,
  busy,
  onIdentity,
  onReturn,
  onRefresh,
  onContact,
  onPrepareUrge,
  onSubmitUrge,
  onServiceIdentity,
  onPrepareServiceTicket,
  onSubmitServiceTicket,
  onTroubleshootingResolved,
}: {
  ui: ChatUi;
  busy: boolean;
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
}) {
  if (ui.kind === "product") {
    return (
      <article className="rich-card product-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ui.product.image} alt={ui.product.name} />
        <div><span className="kicker">适配你的空间</span><h3>{ui.product.name}</h3><p>{ui.product.model}</p><div className="tags">{ui.product.specs.map((spec) => <span key={spec}>{spec}</span>)}</div></div>
      </article>
    );
  }

  if (ui.kind === "repair_intake") {
    return (
      <article className="rich-card repair-intake-card">
        <span className="kicker">故障报修</span><h3>请描述具体故障现象</h3>
        <p>可以直接说发生了什么，不需要判断是不是安全问题。</p>
        <div className="repair-examples">{ui.examples.map((example) => <span key={example}>{example}</span>)}</div>
        <div className="repair-safety-tip"><TriangleAlert size={15} /><span>如有冒烟、烧焦味、火花或异常发热，系统会优先进入安全处理。</span></div>
      </article>
    );
  }

  if (ui.kind === "knowledge_answer") {
    return (
      <article className="rich-card knowledge-answer-card">
        <span className="kicker">智能问答</span><h3>{ui.title}</h3>
        <ul>{ui.items.map((item) => <li key={item}>{item}</li>)}</ul>
        <small>{ui.footer}</small>
      </article>
    );
  }

  if (ui.kind === "human_handoff") {
    return (
      <article className="rich-card handoff-card">
        <span className="kicker">人工接管</span><h3>{ui.title}</h3>
        <p>{ui.reason}</p><div><Headphones size={15} /><span>当前队列：{ui.queue}</span></div>
      </article>
    );
  }

  if (ui.kind === "service_menu") return null;

  if (ui.kind === "identity_confirm") {
    const serviceQuery = ui.purpose === "service";
    return (
      <article className="rich-card identity-card">
        <span className="kicker">安全验证</span><h3>{serviceQuery ? "确认查询当前账号的售后工单" : "确认查询当前账号的订单"}</h3><p>手机号{ui.maskedPhone} · 仅用于本次查询</p>
        <button className="primary wide" disabled={busy} onClick={serviceQuery ? onServiceIdentity : onIdentity}>确认本人</button>
      </article>
    );
  }

  if (ui.kind === "order") {
    return (
      <article className="rich-card order-card">
        <div className="order-head"><div><span>订单号</span><strong>{ui.order.id}</strong></div><em>{ui.order.status}</em></div>
        <div className="logistics-meta">
          <div><span>承运商</span><strong>{ui.order.carrier}</strong></div>
          <div><span>运单号</span><strong>{ui.order.trackingNo}</strong></div>
        </div>
        <div className="eta"><Clock3 size={17} />{ui.order.eta}</div>
        <div className="timeline">{ui.order.events.map((event) => <div key={`${event.time}-${event.text}`} className={event.active ? "event active" : "event"}><span>{event.text}</span><small>{event.time}</small></div>)}</div>
        <div className="order-actions">
          <button disabled={busy} onClick={() => onContact(ui.order)}><Phone size={14} />联系物流</button>
          <button className="urge" disabled={busy} onClick={onPrepareUrge}><BellRing size={14} />一键催物流</button>
          <button className="refresh" disabled={busy} onClick={onRefresh}>刷新 <RefreshCw size={14} /></button>
        </div>
      </article>
    );
  }

  if (ui.kind === "safety") {
    return (
      <div className="safety-card"><TriangleAlert size={19} /><div><strong>安全风险：请先确保断电</strong><p>如果出现明火，请先远离现场并联系紧急服务。系统已自动升级人工处理。</p></div></div>
    );
  }

  if (ui.kind === "upload_prompt") {
    return <div className="hint-card"><ImagePlus size={18} /><span>点击下方图片按钮上传照片，支持 JPG、PNG、WEBP，单张不超过 8MB。</span></div>;
  }

  if (ui.kind === "return_confirm") {
    return <ReturnConfirmCard initialForm={ui.form} busy={busy} onSubmit={onReturn} />;
  }

  if (ui.kind === "return_success") {
    return <div className="success-card"><span><Check size={15} /></span><div><strong>申请已提交</strong><p>服务编号：{ui.requestNo}</p></div></div>;
  }

  if (ui.kind === "logistics_urge_confirm") {
    return (
      <article className="rich-card confirm-card urge-confirm-card">
        <span className="kicker">催办前确认</span><h3>确认催促这笔物流</h3>
        <div className="confirm-list">
          <div><span>订单号</span><strong>{ui.orderId}</strong></div>
          <div><span>承运商</span><strong>{ui.carrier}</strong></div>
          <div><span>运单号</span><strong>{ui.trackingNo}</strong></div>
          <div><span>最新状态</span><strong>{ui.latestStatus}</strong></div>
        </div>
        <button className="primary wide" disabled={busy} onClick={onSubmitUrge}>确认催办</button>
        <small>确认后将提交物流平台，并同步人工客服</small>
      </article>
    );
  }

  if (ui.kind === "logistics_urge_success") {
    return (
      <div className="success-card logistics-success">
        <span><Check size={15} /></span>
        <div><strong>物流催办已提交</strong><p>催办编号：{ui.requestNo}</p><p>已同步：{ui.handoff}</p></div>
      </div>
    );
  }

  if (ui.kind === "troubleshooting") {
    return (
      <article className="rich-card troubleshooting-card">
        <span className="kicker">安全排查</span><h3>{ui.title}</h3>
        <ol>{ui.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <div className="troubleshooting-note"><TriangleAlert size={15} /><span>{ui.note}</span></div>
        <div className="troubleshooting-actions">
          <button disabled={busy} onClick={onTroubleshootingResolved}>已经恢复</button>
          <button className="primary" disabled={busy} onClick={() => onPrepareServiceTicket(ui.reportedIssue)}>仍未解决，申请报修</button>
        </div>
      </article>
    );
  }

  if (ui.kind === "service_ticket_form") {
    return <ServiceTicketFormCard initialForm={ui.form} busy={busy} onSubmit={onSubmitServiceTicket} />;
  }

  if (ui.kind === "service_ticket_success") {
    return <div className="success-card"><span><Check size={15} /></span><div><strong>{ui.serviceType}已提交</strong><p>工单编号：{ui.ticketNo}</p></div></div>;
  }

  if (ui.kind === "service_ticket") {
    return (
      <article className="rich-card service-ticket-card">
        <div className="order-head"><div><span>工单编号</span><strong>{ui.ticket.id}</strong></div><em>{ui.ticket.status}</em></div>
        <div className="service-summary"><strong>{ui.ticket.product}</strong><span>{ui.ticket.issue}</span><small>更新于 {ui.ticket.updatedAt}</small></div>
        <div className="timeline">{ui.ticket.events.map((event) => <div key={`${event.time}-${event.text}`} className={event.active ? "event active" : "event"}><span>{event.text}</span><small>{event.time}</small></div>)}</div>
      </article>
    );
  }

  return null;
}

function ReturnConfirmCard({
  initialForm,
  busy,
  onSubmit,
}: {
  initialForm: ReturnFormData;
  busy: boolean;
  onSubmit: (formData: ReturnFormData) => void;
}) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");

  function update<K extends keyof ReturnFormData>(key: K, value: ReturnFormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function submit() {
    const required = [form.product, form.issueDescription, form.contactPhone, form.pickupAddress];
    if (required.some((value) => !value.trim())) {
      setError("请补全所有申请信息后再提交");
      return;
    }
    onSubmit(form);
  }

  return (
    <article className="rich-card confirm-card return-form-card">
      <span className="kicker">信息可修改</span><h3>编辑退换货申请</h3>
      <div className="return-form">
        <label><span>服务类型</span><select aria-label="服务类型" value={form.serviceType} onChange={(event) => update("serviceType", event.target.value as ReturnFormData["serviceType"])}><option value="换货">换货</option><option value="退货">退货</option></select></label>
        <label><span>商品</span><input aria-label="商品" value={form.product} onChange={(event) => update("product", event.target.value)} /></label>
        <label><span>问题描述</span><textarea aria-label="问题描述" rows={3} value={form.issueDescription} onChange={(event) => update("issueDescription", event.target.value)} /></label>
        <label><span>联系电话</span><input aria-label="联系电话" inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></label>
        <label><span>取件地址</span><textarea aria-label="取件地址" rows={2} value={form.pickupAddress} onChange={(event) => update("pickupAddress", event.target.value)} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy} onClick={submit}>确认提交</button>
      <small>提交后由售后人员审核，最终结果以审核为准</small>
    </article>
  );
}

function ServiceTicketFormCard({
  initialForm,
  busy,
  onSubmit,
}: {
  initialForm: ServiceTicketFormData;
  busy: boolean;
  onSubmit: (formData: ServiceTicketFormData) => void;
}) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");

  function update<K extends keyof ServiceTicketFormData>(key: K, value: ServiceTicketFormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function submit() {
    const required = [form.product, form.faultDescription, form.contactPhone, form.serviceAddress, form.preferredContactTime];
    if (required.some((value) => !value.trim())) {
      setError("请补全所有服务信息后再提交");
      return;
    }
    onSubmit(form);
  }

  return (
    <article className="rich-card confirm-card service-form-card">
      <span className="kicker">信息可修改</span><h3>编辑{form.serviceType === "安装服务" ? "安装服务单" : "售后报修单"}</h3>
      <div className="return-form">
        <label><span>服务类型</span><select aria-label="服务类型" value={form.serviceType} onChange={(event) => update("serviceType", event.target.value as ServiceTicketFormData["serviceType"])}><option value="维修服务">维修服务</option><option value="安装服务">安装服务</option></select></label>
        <label><span>商品</span><input aria-label="报修商品" value={form.product} onChange={(event) => update("product", event.target.value)} /></label>
        <label><span>购买渠道</span><select aria-label="购买渠道" value={form.purchaseChannel} onChange={(event) => update("purchaseChannel", event.target.value as ServiceTicketFormData["purchaseChannel"])}><option value="线上商城">线上商城</option><option value="线下门店">线下门店</option></select></label>
        <label><span>{form.serviceType === "安装服务" ? "安装需求" : "故障描述"}</span><textarea aria-label="服务问题描述" rows={3} value={form.faultDescription} onChange={(event) => update("faultDescription", event.target.value)} /></label>
        <label><span>联系电话</span><input aria-label="报修联系电话" inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></label>
        <label><span>服务地址</span><textarea aria-label="服务地址" rows={2} value={form.serviceAddress} onChange={(event) => update("serviceAddress", event.target.value)} /></label>
        <label><span>方便联系时段</span><input aria-label="方便联系时段" value={form.preferredContactTime} onChange={(event) => update("preferredContactTime", event.target.value)} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy} onClick={submit}>确认提交{form.serviceType}</button>
      <small>提交后由服务人员人工确认上门或处理时间</small>
    </article>
  );
}
