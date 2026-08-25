import type { LocalMessage } from "./types";

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
