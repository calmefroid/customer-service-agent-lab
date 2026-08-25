export type FeedbackRating = "up" | "down";

export interface FeedbackInput {
  sessionId: string;
  messageId: string;
  rating?: FeedbackRating;
  resolved?: boolean;
  reason?: string;
}

export interface FeedbackRecord extends FeedbackInput {
  recordId: string;
  sourceSystem: "consumer-feedback";
  createdAt: string;
  updatedAt: string;
}

class FeedbackStore {
  private records = new Map<string, FeedbackRecord>();

  save(input: FeedbackInput): FeedbackRecord {
    const key = `${input.sessionId}:${input.messageId}`;
    const existing = this.records.get(key);
    const now = new Date().toISOString();
    const record: FeedbackRecord = {
      ...(existing ?? {
        recordId: `FDB-${crypto.randomUUID()}`,
        sourceSystem: "consumer-feedback" as const,
        createdAt: now,
      }),
      ...input,
      reason: input.reason?.trim() || existing?.reason,
      updatedAt: now,
    };
    this.records.set(key, record);
    return { ...record };
  }

  list(sessionId?: string): FeedbackRecord[] {
    return [...this.records.values()]
      .filter((record) => !sessionId || record.sessionId === sessionId)
      .map((record) => ({ ...record }));
  }

  reset(): void {
    this.records.clear();
  }
}

const globalFeedback = globalThis as typeof globalThis & { __consumerFeedbackStore?: FeedbackStore };
export const feedbackStore = globalFeedback.__consumerFeedbackStore ??= new FeedbackStore();
