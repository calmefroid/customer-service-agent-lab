"use client";

import { CircleCheck, Copy, LoaderCircle, RefreshCw, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";

import { ProgressCard } from "./ProgressCard";
import type { ConsumerRequestState } from "./consumer-error";
import type { LocalMessage } from "./types";
import { UiCard, type UiCardActions } from "./UiCard";

export function BotAvatar() {
  return <span className="bot-avatar"><Sparkles size={15} /></span>;
}

export function ConsumerRequestStateCard({
  state,
  busy,
  canRetry,
  onRetry,
}: {
  state: ConsumerRequestState;
  busy: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={`bubble error-bubble consumer-state ${state.kind}`}>
      <strong>{state.title}</strong>
      <p>{state.message}</p>
      {state.retryable && canRetry && <button disabled={busy} onClick={onRetry}><RefreshCw size={13} />安全重试</button>}
    </div>
  );
}

export function MessageItem({
  message,
  busy,
  actions,
  onRate,
  onCopy,
  onRetry,
}: {
  message: LocalMessage;
  busy: boolean;
  actions: UiCardActions;
  onRate: (feedback: "up" | "down") => void;
  onCopy: () => void;
  onRetry: () => void;
}) {
  if (message.progress) return <ProgressCard progress={message.progress} />;

  if (message.role === "user") return (
    <div className="user-message-block">
      <div className="message-row user">
        <div className={`bubble ${message.image ? "image-bubble" : ""}`}>
          {message.image && (
            <div className="message-image-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={message.image.url} alt="用户上传的图片" />
              <span className={`image-state ${message.image.status}`}>
                {message.image.status === "uploading" && <><LoaderCircle size={12} />上传中</>}
                {message.image.status === "recognizing" && <><LoaderCircle size={12} />识别中</>}
                {message.image.status === "ready" && <><CircleCheck size={12} />识别完成</>}
                {message.image.status === "failed" && <><TriangleAlert size={12} />识别失败</>}
              </span>
            </div>
          )}
          <p>{message.text}</p>
        </div>
      </div>
      {message.canRetry && message.retryRequest && !busy && <button className="resend-button" onClick={onRetry}><RotateCcw size={12} />重新发送</button>}
    </div>
  );

  if (message.error) return (
    <div className="message-row">
      <BotAvatar />
      <ConsumerRequestStateCard state={message.error} busy={busy} canRetry={message.retryRequest !== undefined} onRetry={onRetry} />
    </div>
  );

  return (
    <>
      <div className="message-row">
        <BotAvatar />
        <div className="bubble"><p>{message.text}{message.id.startsWith("stream-") && <span className="stream-caret" aria-hidden="true" />}</p></div>
      </div>
      {message.ui && <UiCard ui={message.ui} busy={busy || message.confirmationClosed === true} actions={actions} />}
      {message.id !== "welcome" && !message.id.startsWith("stream-") && (
        <div className="assistant-tools">
          <button className={message.feedback === "up" ? "selected" : ""} aria-label="有帮助" onClick={() => onRate("up")}><ThumbsUp size={14} /></button>
          <button className={message.feedback === "down" ? "selected" : ""} aria-label="没帮助" onClick={() => onRate("down")}><ThumbsDown size={14} /></button>
          <button aria-label="复制" onClick={onCopy}><Copy size={14} /></button>
        </div>
      )}
    </>
  );
}
