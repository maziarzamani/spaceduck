// SQLite-backed SessionManager using bun:sqlite

import { Database } from "bun:sqlite";
import type { Session, SessionManager, Logger } from "@spaceduck/core";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export class SqliteSessionManager implements SessionManager {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async resolve(channelId: string, senderId: string): Promise<Session> {
    // Try to find existing session
    const row = this.db
      .query(
        "SELECT id, conversation_id, channel_id, sender_id, created_at, last_active_at FROM sessions WHERE channel_id = ?1 AND sender_id = ?2",
      )
      .get(channelId, senderId) as {
      id: string;
      conversation_id: string;
      channel_id: string;
      sender_id: string;
      created_at: number;
      last_active_at: number;
    } | null;

    if (row) {
      return {
        id: row.id,
        conversationId: row.conversation_id,
        channelId: row.channel_id,
        senderId: row.sender_id,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
      };
    }

    // Create new session
    const id = generateId();
    const conversationId = generateId();
    const now = Date.now();

    this.db
      .query(
        `INSERT INTO sessions (id, conversation_id, channel_id, sender_id, created_at, last_active_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .run(id, conversationId, channelId, senderId, now, now);

    return { id, conversationId, channelId, senderId, createdAt: now, lastActiveAt: now };
  }

  async reset(sessionId: string): Promise<Session> {
    const existing = await this.get(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const newConversationId = generateId();
    const now = Date.now();

    this.db
      .query(
        "UPDATE sessions SET conversation_id = ?1, created_at = ?2, last_active_at = ?2 WHERE id = ?3",
      )
      .run(newConversationId, now, sessionId);

    return {
      id: existing.id,
      conversationId: newConversationId,
      channelId: existing.channelId,
      senderId: existing.senderId,
      createdAt: now,
      lastActiveAt: now,
    };
  }

  async get(sessionId: string): Promise<Session | null> {
    const row = this.db
      .query(
        "SELECT id, conversation_id, channel_id, sender_id, created_at, last_active_at FROM sessions WHERE id = ?1",
      )
      .get(sessionId) as {
      id: string;
      conversation_id: string;
      channel_id: string;
      sender_id: string;
      created_at: number;
      last_active_at: number;
    } | null;

    if (!row) return null;

    return {
      id: row.id,
      conversationId: row.conversation_id,
      channelId: row.channel_id,
      senderId: row.sender_id,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    };
  }

  async touch(sessionId: string): Promise<void> {
    this.db
      .query("UPDATE sessions SET last_active_at = ?1 WHERE id = ?2")
      .run(Date.now(), sessionId);
  }
}
