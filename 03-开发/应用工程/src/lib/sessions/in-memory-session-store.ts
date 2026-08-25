import type { AgentSession, ImageObservation, SessionMessage, SessionStore } from "./types";

function copySession(session: AgentSession): AgentSession {
  return {
    ...session,
    messages: session.messages.map((message) => ({ ...message })),
    observations: session.observations.map((observation) => ({
      ...observation,
      uncertainties: [...observation.uncertainties],
    })),
    remainingIntents: [...session.remainingIntents],
  };
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AgentSession>();

  get(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? copySession(session) : undefined;
  }

  getOrCreate(sessionId: string): AgentSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return copySession(existing);

    const now = new Date().toISOString();
    const session: AgentSession = {
      sessionId,
      messages: [],
      observations: [],
      remainingIntents: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, session);
    return copySession(session);
  }

  appendMessage(sessionId: string, message: SessionMessage): AgentSession {
    const session = this.mutableSession(sessionId);
    session.messages.push({ ...message });
    session.updatedAt = message.createdAt;
    return copySession(session);
  }

  addObservation(sessionId: string, observation: ImageObservation): AgentSession {
    const session = this.mutableSession(sessionId);
    session.observations.push({ ...observation, uncertainties: [...observation.uncertainties] });
    session.updatedAt = observation.createdAt;
    return copySession(session);
  }

  setRemainingIntents(sessionId: string, intents: string[]): AgentSession {
    const session = this.mutableSession(sessionId);
    session.remainingIntents = [...new Set(intents)];
    session.updatedAt = new Date().toISOString();
    return copySession(session);
  }

  reset(sessionId?: string): void {
    if (sessionId) this.sessions.delete(sessionId);
    else this.sessions.clear();
  }

  private mutableSession(sessionId: string): AgentSession {
    if (!this.sessions.has(sessionId)) this.getOrCreate(sessionId);
    return this.sessions.get(sessionId)!;
  }
}
