// Test fixture: mock session manager

import type { Session, SessionManager } from "../types";

export class MockSessionManager implements SessionManager {
  private sessions = new Map<string, Session>();
  private keyIndex = new Map<string, string>();
  private counter = 0;

  private nextId(): string {
    this.counter++;
    return `session-${this.counter}`;
  }

  async resolve(channelId: string, senderId: string): Promise<Session> {
    const key = `${channelId}:${senderId}`;
    const existingId = this.keyIndex.get(key);

    if (existingId) {
      const session = this.sessions.get(existingId);
      if (session) return session;
    }

    const session: Session = {
      id: this.nextId(),
      conversationId: `conv-${this.counter}`,
      channelId,
      senderId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    this.keyIndex.set(key, session.id);
    return session;
  }

  async reset(sessionId: string): Promise<Session> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);

    const newSession: Session = {
      ...existing,
      conversationId: `conv-${++this.counter}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(sessionId, newSession);
    return newSession;
  }

  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async touch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, lastActiveAt: Date.now() });
    }
  }
}
