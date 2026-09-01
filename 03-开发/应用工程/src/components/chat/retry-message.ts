import type { LocalMessage } from "./types";

export function withRetryImageSnapshot(message: LocalMessage, source?: LocalMessage): LocalMessage {
  return source?.image ? { ...message, image: { ...source.image } } : message;
}

export function createRetryMessage(source: LocalMessage, id: string): LocalMessage | undefined {
  if (!source.retryRequest) return undefined;
  return {
    id,
    role: "user",
    text: source.role === "user" ? source.text : source.retryRequest.message,
    retryRequest: source.retryRequest,
    ...(source.image ? { image: { ...source.image, status: "uploading" } } : {}),
  };
}
