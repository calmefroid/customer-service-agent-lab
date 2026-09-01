import { readFileSync } from "node:fs";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "@/components/chat/Composer";
import { MessageItem } from "@/components/chat/MessageItem";
import { createRetryMessage, withRetryImageSnapshot } from "@/components/chat/retry-message";
import type { LocalMessage, PendingAttachment } from "@/components/chat/types";
import type { UiCardActions } from "@/components/chat/UiCard";

const noop = vi.fn();

describe("stage 5 consumer live interaction states", () => {
  it("shows a locked image-reading state before a model request starts", () => {
    const pending = {
      file: { name: "damage.png" } as File,
      url: "blob:pending",
      status: "reading",
    } satisfies PendingAttachment;

    const html = renderToStaticMarkup(createElement(Composer, {
      input: "原始描述",
      busy: false,
      readingAttachment: true,
      pending,
      fileRef: createRef<HTMLInputElement>(),
      onInput: noop,
      onSelectFile: noop,
      onRemoveFile: noop,
      onSend: noop,
      onStop: noop,
    }));

    expect(html).toContain("图片读取中…");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="图片读取中"');
    expect(html).not.toContain("停止生成");
  });

  it("shows an explicit completed state without exposing request attachment data", () => {
    const message: LocalMessage = {
      id: "user-ready",
      role: "user",
      text: "请读取图片",
      image: { url: "blob:preview", name: "damage.png", status: "ready" },
      retryRequest: {
        message: "请读取图片",
        attachment: { name: "damage.png", type: "image/png", size: 20, dataUrl: "data:image/png;base64,PRIVATE" },
      },
    };
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message,
      busy: false,
      actions: {} as UiCardActions,
      onRate: noop,
      onCopy: noop,
      onRetry: noop,
    }));

    expect(html).toContain("识别完成");
    expect(html).toContain("blob:preview");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("PRIVATE");
  });

  it("carries the original image preview into a failure-card safe retry", () => {
    const failedUser: LocalMessage = {
      id: "user-failed",
      role: "user",
      text: "这张图有破损",
      image: { url: "blob:failure", name: "damage.png", status: "failed" },
      retryRequest: { message: "这张图有破损", attachment: { name: "damage.png", type: "image/png", size: 20 } },
    };
    const errorWithSnapshot = withRetryImageSnapshot({
      id: "error",
      role: "assistant",
      text: "服务暂时不可用",
      retryRequest: failedUser.retryRequest,
    }, failedUser);

    expect(createRetryMessage(errorWithSnapshot, "retry")?.image).toEqual({
      url: "blob:failure",
      name: "damage.png",
      status: "uploading",
    });
  });

  it("keeps retry controls locked during a real-model request", () => {
    const message: LocalMessage = {
      id: "error",
      role: "assistant",
      text: "服务暂时不可用",
      error: { kind: "failed", title: "服务暂时不可用", message: "输入已保留", retryable: true },
      retryRequest: { message: "原始输入" },
    };
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message,
      busy: true,
      actions: {} as UiCardActions,
      onRate: noop,
      onCopy: noop,
      onRetry: noop,
    }));

    expect(html).toContain("安全重试");
    expect(html).toContain("disabled");
  });

  it("provides a reduced-motion fallback for every animated consumer element", () => {
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedMotion).toContain("scroll-behavior: auto !important");
    expect(reducedMotion).toContain("animation-duration: .01ms !important");
    expect(reducedMotion).toContain("transition-duration: .01ms !important");
  });
});
