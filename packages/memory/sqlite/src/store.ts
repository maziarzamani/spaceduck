// SQLite-backed ConversationStore using bun:sqlite

import { Database } from "bun:sqlite";
import type {
  ConversationStore,
  Conversation,
  Message,
  Result,
  Logger,
} from "@spaceduck/core";
import { ok, err, MemoryError } from "@spaceduck/core";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export class SqliteConversationStore implements ConversationStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async create(id: string, title?: string): Promise<Result<Conversation>> {
    try {
      const now = Date.now();
      this.db
        .query(
          "INSERT INTO conversations (id, title, created_at, last_active_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .run(id, title ?? null, now, now);

      return ok({
        id,
        title,
        createdAt: now,
        lastActiveAt: now,
        messages: [],
      });
    } catch (cause) {
      return err(new MemoryError(`Failed to create conversation: ${cause}`, cause));
    }
  }

  async load(id: string): Promise<Result<Conversation | null>> {
    try {
      const row = this.db
        .query("SELECT id, title, created_at, last_active_at FROM conversations WHERE id = ?1")
        .get(id) as {
        id: string;
        title: string | null;
        created_at: number;
        last_active_at: number;
      } | null;

      if (!row) return ok(null);

      const msgs = await this.loadMessages(id);
      if (!msgs.ok) return msgs as Result<null>;

      return ok({
        id: row.id,
        title: row.title ?? undefined,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        messages: msgs.value,
      });
    } catch (cause) {
      return err(new MemoryError(`Failed to load conversation: ${cause}`, cause));
    }
  }

  async list(): Promise<Result<Conversation[]>> {
    try {
      const rows = this.db
        .query(
          "SELECT id, title, created_at, last_active_at FROM conversations ORDER BY last_active_at DESC",
        )
        .all() as {
        id: string;
        title: string | null;
        created_at: number;
        last_active_at: number;
      }[];

      return ok(
        rows.map((row) => ({
          id: row.id,
          title: row.title ?? undefined,
          createdAt: row.created_at,
          lastActiveAt: row.last_active_at,
          messages: [],
        })),
      );
    } catch (cause) {
      return err(new MemoryError(`Failed to list conversations: ${cause}`, cause));
    }
  }

  async appendMessage(conversationId: string, message: Message): Promise<Result<void>> {
    try {
      // Upsert conversation if needed
      this.db
        .query(
          `INSERT INTO conversations (id, created_at, last_active_at)
           VALUES (?1, ?2, ?2)
           ON CONFLICT(id) DO UPDATE SET last_active_at = ?2`,
        )
        .run(conversationId, Date.now());

      // Serialize tool_calls array to JSON if present
      const toolCallsJson =
        message.toolCalls && message.toolCalls.length > 0
          ? JSON.stringify(message.toolCalls)
          : null;

      this.db
        .query(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp, status, trace_id, source, request_id, tool_calls, tool_call_id, tool_name)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .run(
          message.id,
          conversationId,
          message.role,
          message.content,
          message.timestamp,
          message.status ?? null,
          message.traceId ?? null,
          message.source ?? null,
          message.requestId ?? null,
          toolCallsJson,
          message.toolCallId ?? null,
          message.toolName ?? null,
        );

      return ok(undefined);
    } catch (cause) {
      return err(new MemoryError(`Failed to append message: ${cause}`, cause));
    }
  }

  async updateTitle(conversationId: string, title: string): Promise<Result<void>> {
    try {
      this.db
        .query("UPDATE conversations SET title = ?1 WHERE id = ?2")
        .run(title, conversationId);
      return ok(undefined);
    } catch (cause) {
      return err(new MemoryError(`Failed to update title: ${cause}`, cause));
    }
  }

  async delete(conversationId: string): Promise<Result<void>> {
    try {
      this.db.query("DELETE FROM messages WHERE conversation_id = ?1").run(conversationId);
      this.db.query("DELETE FROM conversations WHERE id = ?1").run(conversationId);
      return ok(undefined);
    } catch (cause) {
      return err(new MemoryError(`Failed to delete conversation: ${cause}`, cause));
    }
  }

  async loadMessages(
    conversationId: string,
    limit?: number,
    before?: number,
  ): Promise<Result<Message[]>> {
    try {
      let sql =
        "SELECT id, conversation_id, role, content, timestamp, status, trace_id, source, request_id, tool_calls, tool_call_id, tool_name FROM messages WHERE conversation_id = ?1";
      const params: (string | number)[] = [conversationId];

      if (before !== undefined) {
        sql += " AND timestamp < ?2";
        params.push(before);
      }

      sql += " ORDER BY timestamp ASC";

      if (limit !== undefined) {
        // Get the last N messages by using a subquery
        sql = `SELECT * FROM (${sql} LIMIT ?${params.length + 1}) ORDER BY timestamp ASC`;
        params.push(limit);
      }

      const rows = this.db.query(sql).all(...params) as {
        id: string;
        conversation_id: string;
        role: "user" | "assistant" | "system" | "tool";
        content: string;
        timestamp: number;
        status: string | null;
        trace_id: string | null;
        source: string | null;
        request_id: string | null;
        tool_calls: string | null;
        tool_call_id: string | null;
        tool_name: string | null;
      }[];

      return ok(
        rows.map((row) => {
          const msg: Message = {
            id: row.id,
            role: row.role,
            content: row.content,
            timestamp: row.timestamp,
            status: (row.status as Message["status"]) ?? undefined,
            traceId: row.trace_id ?? undefined,
            source: (row.source as Message["source"]) ?? undefined,
            requestId: row.request_id ?? undefined,
            toolCallId: row.tool_call_id ?? undefined,
            toolName: row.tool_name ?? undefined,
          };

          // Deserialize tool_calls JSON
          if (row.tool_calls) {
            try {
              (msg as any).toolCalls = JSON.parse(row.tool_calls);
            } catch {
              // Ignore malformed JSON
            }
          }

          return msg;
        }),
      );
    } catch (cause) {
      return err(new MemoryError(`Failed to load messages: ${cause}`, cause));
    }
  }
}
