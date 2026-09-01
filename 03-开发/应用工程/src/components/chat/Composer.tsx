"use client";

import { ImagePlus, LoaderCircle, SendHorizontal, Square, X } from "lucide-react";
import { type KeyboardEvent, type RefObject } from "react";

import type { PendingAttachment } from "./types";

export function Composer({
  input,
  busy,
  readingAttachment,
  pending,
  fileRef,
  onInput,
  onSelectFile,
  onRemoveFile,
  onSend,
  onStop,
}: {
  input: string;
  busy: boolean;
  readingAttachment: boolean;
  pending: PendingAttachment | null;
  fileRef: RefObject<HTMLInputElement | null>;
  onInput: (value: string) => void;
  onSelectFile: (file?: File) => void;
  onRemoveFile: () => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const inputLocked = busy || readingAttachment;

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <footer className="composer-wrap">
      {pending && (
        <div className={`pending-file ${pending.status}`} aria-busy={pending.status === "reading"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending.url} alt="待发送图片预览" />
          <div className="pending-copy">
            <strong>{pending.file.name}</strong>
            <span>{pending.status === "reading" ? "图片读取中…" : pending.error ?? "可补充描述后一起发送"}</span>
          </div>
          <button aria-label="移除图片" disabled={readingAttachment} onClick={onRemoveFile}><X size={16} /></button>
        </div>
      )}
      <div className="composer">
        <button className="upload-button" aria-label="上传图片" disabled={inputLocked} onClick={() => fileRef.current?.click()}><ImagePlus size={20} /></button>
        <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { onSelectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <textarea
          value={input}
          rows={1}
          placeholder={readingAttachment ? "正在读取图片" : busy ? "正在处理当前消息" : "请输入你的问题"}
          aria-label="消息内容"
          disabled={inputLocked}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={keyDown}
        />
        {busy ? (
          <button className="stop-button" aria-label="停止生成" onClick={onStop}><Square size={15} fill="currentColor" /></button>
        ) : readingAttachment ? (
          <button className="send-button reading" aria-label="图片读取中" disabled><LoaderCircle size={18} /></button>
        ) : (
          <button className="send-button" aria-label="发送" disabled={!input.trim() && !pending} onClick={onSend}><SendHorizontal size={18} /></button>
        )}
      </div>
      {busy && <p className="stop-hint">停止后不会继续启动尚未执行的提交操作</p>}
    </footer>
  );
}
