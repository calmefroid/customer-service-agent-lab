export type SessionMessageRole = "user" | "assistant";

export interface SessionMessage {
  role: SessionMessageRole;
  content: string;
  createdAt: string;
}

export interface ImageObservation {
  attachmentName: string;
  summary: string;
  uncertainties: string[];
  createdAt: string;
}

export interface AgentSession {
  sessionId: string;
  messages: SessionMessage[];
  observations: ImageObservation[];
  remainingIntents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  get(sessionId: string): AgentSession | undefined;
  getOrCreate(sessionId: string): AgentSession;
  appendMessage(sessionId: string, message: SessionMessage): AgentSession;
  addObservation(sessionId: string, observation: ImageObservation): AgentSession;
  setRemainingIntents(sessionId: string, intents: string[]): AgentSession;
  reset(sessionId?: string): void;
}
