import type { LocalMessage } from "@/components/chat/types";

export const FEEDBACK_IDLE_DELAY_MS = 30_000;

const feedbackCheckpointKinds = new Set([
  "order",
  "logistics_urge_success",
  "return_success",
  "service_ticket",
  "service_ticket_success",
]);

/**
 * Resolution feedback belongs to completed service outcomes, not intermediate
 * turns such as identity checks, confirmation forms, or clarification prompts.
 */
export function isFeedbackCheckpoint(message: LocalMessage): boolean {
  return message.role === "assistant"
    && !message.error
    && !message.progress
    && Boolean(message.ui && feedbackCheckpointKinds.has(message.ui.kind));
}
