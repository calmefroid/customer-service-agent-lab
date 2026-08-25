import type { ChatRequest, ChatUi } from "@/lib/contracts";

export type ProgressStatus = "running" | "completed" | "failed" | "stopped";

export interface LocalProgressStep {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  durationMs?: number;
}

export interface LocalProgress {
  title: string;
  status: ProgressStatus;
  totalDurationMs?: number;
  steps: LocalProgressStep[];
}

export type RequestPayload = Omit<ChatRequest, "sessionId">;

export interface MessageImage {
  url: string;
  name: string;
  status: "uploading" | "recognizing" | "ready" | "failed";
}

export interface LocalMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  ui?: ChatUi;
  image?: MessageImage;
  feedback?: "up" | "down";
  resolved?: boolean;
  progress?: LocalProgress;
  error?: {
    message: string;
    retryable: boolean;
    stopped?: boolean;
  };
  retryRequest?: RequestPayload;
  canRetry?: boolean;
  confirmationClosed?: boolean;
}

export interface PendingAttachment {
  file: File;
  url: string;
  status: "selected" | "failed";
  error?: string;
}
