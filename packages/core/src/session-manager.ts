// Session manager: maps (channelId, senderId) to conversations

import type { Session, SessionManager } from "./types";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * In-memory session manager backed by a Map.
 * Sessions survive for the lifetime of the process.
 * For durability, swap with a SQLite-backed implementation later.
 */
export class InMemorySessionManager implements SessionManager {
  private sessions = new Map<string, Session>();
  private keyIndex = new Map<string, string>(); // "channelId:senderId" -> sessionId

  async resolve(channelId: string, senderId: string): Promise<Session> {
    const key = `${channelId}:${senderId}`;
    const existingId = this.keyIndex.get(key);

    if (existingId) {
      const session = this.sessions.get(existingId);
      if (session) return session;
    }

    // Create new session
    const session: Session = {
      id: generateId(),
      conversationId: generateId(),
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
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const newSession: Session = {
      id: existing.id,
      conversationId: generateId(),
      channelId: existing.channelId,
      senderId: existing.senderId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(newSession.id, newSession);
    return newSession;
  }

  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async touch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Create updated session (readonly fields require new object)
      const updated: Session = {
        ...session,
        lastActiveAt: Date.now(),
      };
      this.sessions.set(sessionId, updated);
    }
  }
}
