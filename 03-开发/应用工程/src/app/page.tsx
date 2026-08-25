"use client";

import {
  CircleHelp,
  Ellipsis,
  Headphones,
  PackageOpen,
  Phone,
  RotateCcw,
  Sparkles,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Composer } from "@/components/chat/Composer";
import { FeedbackSheet, ResolutionPrompt } from "@/components/chat/Feedback";
import { BotAvatar, MessageItem } from "@/components/chat/MessageItem";
import { ProgressCard } from "@/components/chat/ProgressCard";
import { createRetryMessage } from "@/components/chat/retry-message";
import {
  applyAgentEvent,
  consumeAgentEventStream,
  createStreamState,
  finishStream,
  type StreamState,
} from "@/components/chat/stream-state";
import type { LocalMessage, PendingAttachment, RequestPayload } from "@/components/chat/types";
import type { UiCardActions } from "@/components/chat/UiCard";
import type {
  AttachmentMeta,
  ChatRequest,
  ChatUi,
  OrderView,
  ReturnFormData,
  ServiceModule,
  ServiceTicketFormData,
} from "@/lib/contracts";

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

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function closeLatestConfirmation(messages: LocalMessage[]): LocalMessage[] {
  const confirmationKinds = new Set<ChatUi["kind"]>(["return_confirm", "logistics_urge_confirm", "service_ticket_form"]);
  const index = messages.findLastIndex((message) => message.ui && confirmationKinds.has(message.ui.kind));
  return index < 0 ? messages : messages.map((message, messageIndex) => messageIndex === index ? { ...message, confirmationClosed: true } : message);
}

export default function Home() {
  const [messages, setMessages] = useState<LocalMessage[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeStream, setActiveStream] = useState<StreamState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [humanSheet, setHumanSheet] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [logisticsContact, setLogisticsContact] = useState<OrderView | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [toast, setToast] = useState("");
  const [sessionId, setSessionId] = useState(createSessionId);
  const [activeModule, setActiveModule] = useState<ServiceModule | undefined>();
  const chatRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(sessionId);

  const showQuickActions = useMemo(
    () => messages.length === 1 || messages.at(-1)?.ui?.kind === "service_menu",
    [messages],
  );
  const latestAnswer = useMemo(
    () => messages.findLast((message) => message.role === "assistant" && message.id !== "welcome" && !message.progress && !message.error),
    [messages],
  );

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, activeStream, pendingAttachment]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function updateImageStatus(messageId: string | undefined, status: NonNullable<LocalMessage["image"]>["status"]) {
    if (!messageId) return;
    setMessages((current) => current.map((message) => message.id === messageId && message.image
      ? { ...message, image: { ...message.image, status } }
      : message));
  }

  async function callChat(
    payload: RequestPayload,
    options: { userMessageId?: string; replaceUiKind?: ChatUi["kind"] } = {},
  ) {
    const requestId = createId("request");
    const controller = new AbortController();
    const requestSessionId = sessionRef.current;
    let stream = createStreamState(requestId);
    abortRef.current = controller;
    setActiveStream(stream);
    setBusy(true);

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...payload, sessionId: requestSessionId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let reason = "服务暂时不可用";
        try {
          const body = await response.json() as { error?: string };
          if (body.error) reason = body.error;
        } catch {
          // Keep the public fallback message.
        }
        throw new Error(reason);
      }
      if (payload.attachment) updateImageStatus(options.userMessageId, "recognizing");

      await consumeAgentEventStream(response, (event) => {
        stream = applyAgentEvent(stream, event);
        setActiveStream(stream);
        if (event.type === "progress" && event.progress.stage === "image_observation") {
          updateImageStatus(options.userMessageId, event.progress.status === "failed" ? "failed" : event.progress.status === "started" ? "recognizing" : "ready");
        }
      });

      if (!stream.terminal) {
        stream = finishStream(stream, { kind: "error", message: "连接意外中断，你的输入已保留", retryable: true });
      }
    } catch (error) {
      stream = finishStream(
        stream,
        controller.signal.aborted
          ? { kind: "stopped" }
          : { kind: "error", message: error instanceof Error ? error.message : "服务连接失败", retryable: true },
      );
    } finally {
      const progressMessage: LocalMessage | undefined = stream.progress ? {
        id: `${requestId}-progress`,
        role: "assistant" as const,
        text: "",
        progress: stream.progress,
      } : undefined;
      const terminal = stream.terminal;
      updateImageStatus(options.userMessageId, terminal?.kind === "completed" ? "ready" : "failed");

      setMessages((current) => {
        if (sessionRef.current !== requestSessionId) return current;
        const retryReady = terminal?.kind === "completed" ? current : current.map((message) => message.id === options.userMessageId ? { ...message, canRetry: true } : message);
        const next = progressMessage ? [...retryReady, progressMessage] : [...retryReady];
        if (terminal?.kind === "completed" && stream.message) {
          if (options.replaceUiKind) {
            const index = next.findLastIndex((message) => message.ui?.kind === options.replaceUiKind);
            if (index >= 0) return next.map((message, messageIndex) => messageIndex === index ? stream.message! : message);
          }
          return [...next, stream.message];
        }
        const stopped = terminal?.kind === "stopped";
        return [...next, {
          id: createId(stopped ? "stopped" : "error"),
          role: "assistant",
          text: stopped ? "已停止生成" : terminal?.kind === "error" ? terminal.message : "这次没有处理完",
          error: {
            message: stopped ? "未完成的回复和尚未执行的提交已终止。" : terminal?.kind === "error" ? terminal.message : "请稍后重试",
            retryable: stopped || terminal?.kind === "error" && terminal.retryable,
            stopped,
          },
          retryRequest: payload,
        }];
      });
      abortRef.current = null;
      setActiveStream(null);
      setBusy(false);
    }
  }

  async function appendAndCall(
    text: string,
    payload: RequestPayload,
    image?: LocalMessage["image"],
    options?: { replaceUiKind?: ChatUi["kind"] },
  ) {
    if (busy || abortRef.current) return;
    const userMessage: LocalMessage = {
      id: createId("user"),
      role: "user",
      text,
      retryRequest: payload,
      ...(image ? { image } : {}),
    };
    setMessages((current) => [...current, userMessage]);
    await callChat(payload, { ...options, userMessageId: userMessage.id });
  }

  async function sendMessage(message = input.trim(), module = activeModule) {
    if (busy || (!message && !pendingAttachment)) return;
    const attachment: AttachmentMeta | undefined = pendingAttachment
      ? { name: pendingAttachment.file.name, type: pendingAttachment.file.type, size: pendingAttachment.file.size }
      : undefined;
    const text = message || "这是刚收到的灯具照片";
    const payload: RequestPayload = { message: text, ...(attachment ? { attachment } : {}), ...(module ? { module } : {}) };
    const image = pendingAttachment ? {
      url: pendingAttachment.url,
      name: pendingAttachment.file.name,
      status: "uploading" as const,
    } : undefined;
    setInput("");
    setPendingAttachment(null);
    await appendAndCall(text, payload, image);
  }

  async function runAction(
    userText: string,
    message: string,
    action: ChatRequest["action"],
    payload?: Pick<ChatRequest, "formData" | "serviceFormData">,
    options?: { replaceUiKind?: ChatUi["kind"] },
  ) {
    if (action === "submit_return" || action === "submit_logistics_urge" || action === "submit_service_ticket") {
      setMessages(closeLatestConfirmation);
    }
    const request: RequestPayload = { message, action, ...(activeModule ? { module: activeModule } : {}), ...payload };
    await appendAndCall(userText, request, undefined, options);
  }

  async function startModule(action: (typeof quickActions)[number]) {
    const module = action.id as ServiceModule;
    setActiveModule(module);
    if ("action" in action) await appendAndCall(action.title, { message: action.message, action: action.action, module });
    else await appendAndCall(action.message, { message: action.message, module });
  }

  function selectFile(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setToast("仅支持 JPG、PNG、WEBP 图片，请重新选择");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setToast("图片不能超过 8MB，请压缩后重试");
      return;
    }
    if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.url);
    try {
      setPendingAttachment({ file, url: URL.createObjectURL(file), status: "selected" });
    } catch {
      setToast("图片读取失败，文字已保留，请重新选择或直接补充描述");
    }
  }

  function removePendingFile() {
    if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.url);
    setPendingAttachment(null);
  }

  async function retry(message: LocalMessage) {
    if (!message.retryRequest || busy) return;
    const retryMessage = createRetryMessage(message, createId("user"));
    if (!retryMessage) return;
    setMessages((current) => [...current, retryMessage]);
    await callChat(retryMessage.retryRequest!, { userMessageId: retryMessage.id });
  }

  function restart() {
    abortRef.current?.abort();
    if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.url);
    for (const message of messages) if (message.image) URL.revokeObjectURL(message.image.url);
    setMessages([welcomeMessage]);
    const nextSessionId = createSessionId();
    sessionRef.current = nextSessionId;
    setSessionId(nextSessionId);
    setActiveModule(undefined);
    setPendingAttachment(null);
    setMenuOpen(false);
    setToast("已开始新会话");
  }

  async function saveFeedback(messageId: string, feedback: { rating?: "up" | "down"; resolved?: boolean; reason?: string }) {
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messageId, ...feedback }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setToast("反馈暂未保存，请稍后再试");
    }
  }

  function rate(id: string, feedback: "up" | "down") {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, feedback } : message));
    void saveFeedback(id, { rating: feedback });
    if (feedback === "down") setFeedbackTarget(id);
    else setToast("感谢反馈，已记录“有帮助”");
  }

  function resolve(id: string, resolved: boolean) {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, resolved } : message));
    void saveFeedback(id, { resolved });
    if (!resolved) setFeedbackTarget(id);
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("回答已复制");
    } catch {
      setToast("当前浏览器不支持自动复制");
    }
  }

  function cancelConfirmation() {
    setMessages((current) => [...closeLatestConfirmation(current),
      { id: createId("user"), role: "user", text: "取消本次操作" },
      { id: createId("cancelled"), role: "assistant", text: "已取消，未提交任何业务操作。你可以继续补充信息或问其他问题。" },
    ]);
  }

  const uiActions: UiCardActions = {
    onIdentity: () => void runAction("确认本人", "查询最近订单", "confirm_identity"),
    onReturn: (formData: ReturnFormData) => void runAction("确认提交退换货申请", "提交退换货申请", "submit_return", { formData }),
    onRefresh: () => void runAction("刷新物流", "刷新最近订单物流", "confirm_identity", undefined, { replaceUiKind: "order" }),
    onContact: setLogisticsContact,
    onPrepareUrge: () => void runAction("物流有点慢，帮我催一下", "准备物流催办", "prepare_logistics_urge"),
    onSubmitUrge: () => void runAction("确认催物流", "提交物流催办", "submit_logistics_urge"),
    onServiceIdentity: () => void runAction("确认本人", "查询最近售后工单", "confirm_service_identity"),
    onPrepareServiceTicket: (reportedIssue: string) => void runAction("排查后仍未恢复，申请报修", `准备售后报修：${reportedIssue}`, "prepare_service_ticket"),
    onSubmitServiceTicket: (serviceFormData: ServiceTicketFormData) => void runAction(`确认提交${serviceFormData.serviceType}`, `提交${serviceFormData.serviceType}`, "submit_service_ticket", { serviceFormData }),
    onTroubleshootingResolved: () => setToast("已记录问题恢复，无需创建报修"),
    onCancelConfirmation: cancelConfirmation,
    onEditConfirmation: () => { setInput("我想修改这次操作的信息："); setToast("请在输入框补充要修改的内容"); },
  };

  return (
    <main className="phone" aria-label="手机端智能客服">
      <header className="app-header">
        <div className="brand-avatar"><Sparkles size={20} /></div>
        <div className="header-copy"><div className="header-title">智享家售后助手</div><div className="header-status"><span className="status-dot" />全天在线</div></div>
        <button className="icon-button" aria-label="转人工" onClick={() => setHumanSheet(true)}><Headphones size={19} /></button>
        <button className="icon-button" aria-label="更多" onClick={() => setMenuOpen((open) => !open)}><Ellipsis size={20} /></button>
      </header>

      <section className="chat" ref={chatRef} aria-live="polite" aria-busy={busy}>
        <div className="date-label">今天</div>
        {messages.map((message) => <MessageItem key={message.id} message={message} busy={busy} actions={uiActions} onRate={(feedback) => rate(message.id, feedback)} onCopy={() => void copyMessage(message.text)} onRetry={() => void retry(message)} />)}
        {showQuickActions && !busy && <div className="quick-grid">{quickActions.map((action) => { const Icon = action.icon; return <button key={action.id} className="quick-card" onClick={() => void startModule(action)}><span className="quick-icon"><Icon size={16} /></span><span className="quick-title">{action.title}</span><span className="quick-subtitle">{action.subtitle}</span></button>; })}</div>}
        {activeStream?.progress && <ProgressCard progress={activeStream.progress} />}
        {activeStream?.draftText && <MessageItem message={{ id: `stream-${activeStream.requestId}`, role: "assistant", text: activeStream.draftText }} busy actions={uiActions} onRate={() => {}} onCopy={() => {}} onRetry={() => {}} />}
        {busy && !activeStream?.progress && !activeStream?.draftText && <div className="message-row"><BotAvatar /><div className="bubble typing" aria-label="正在回复"><span /><span /><span /></div></div>}
        {!busy && latestAnswer && <ResolutionPrompt value={latestAnswer.resolved} onChange={(resolved) => resolve(latestAnswer.id, resolved)} />}
      </section>

      <Composer input={input} busy={busy} pending={pendingAttachment} fileRef={fileRef} onInput={setInput} onSelectFile={selectFile} onRemoveFile={removePendingFile} onSend={() => void sendMessage()} onStop={() => abortRef.current?.abort()} />
      {menuOpen && <div className="menu-panel"><button onClick={restart}><RotateCcw size={17} />重新开始会话</button><button onClick={() => { setMenuOpen(false); setToast("支持订单物流、退换破损与故障报修"); }}><CircleHelp size={17} />查看服务范围</button></div>}

      {humanSheet && <><button className="backdrop" aria-label="关闭弹窗" onClick={() => setHumanSheet(false)} /><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="human-title"><div className="sheet-handle" /><button className="sheet-close" aria-label="关闭" onClick={() => setHumanSheet(false)}><X size={17} /></button><h2 id="human-title">转接人工客服</h2><p>当前问题和已确认信息会一并转交，你不需要重复描述。</p><div className="summary-card"><strong>本次会话摘要</strong><span>当前共有 {messages.filter((message) => message.role === "user").length} 条用户消息，将同步给人工客服。</span></div><div className="sheet-actions"><button onClick={() => setHumanSheet(false)}>继续问机器人</button><button className="primary" onClick={() => { setHumanSheet(false); setMessages((current) => [...current, { id: createId("human"), role: "assistant", text: "已进入人工客服队列，当前会话摘要已同步。你可以继续补充信息。" }]); }}>确认转人工</button></div></section></>}
      {logisticsContact && <><button className="backdrop" aria-label="关闭物流联系方式" onClick={() => setLogisticsContact(null)} /><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="logistics-contact-title"><div className="sheet-handle" /><button className="sheet-close" aria-label="关闭" onClick={() => setLogisticsContact(null)}><X size={17} /></button><h2 id="logistics-contact-title">联系物流公司</h2><p>拨打时可向客服提供运单号，便于快速定位当前快件。</p><div className="summary-card contact-summary"><div><span>承运商</span><strong>{logisticsContact.carrier}</strong></div><div><span>客服电话</span><strong>{logisticsContact.hotline}</strong></div><div><span>运单号</span><strong>{logisticsContact.trackingNo}</strong></div></div><div className="sheet-actions"><button onClick={() => void copyMessage(logisticsContact.hotline)}>复制电话</button><a className="primary" href={`tel:${logisticsContact.hotline}`}><Phone size={15} />拨打 {logisticsContact.hotline}</a></div></section></>}
      {feedbackTarget && <FeedbackSheet onClose={() => setFeedbackTarget(null)} onSubmit={(reason) => { void saveFeedback(feedbackTarget, { rating: "down", reason }); setFeedbackTarget(null); setToast("感谢反馈，我们会继续改进"); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
