import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { ConsoleLogger } from "@spaceduck/core";
import { SchemaManager, ensureCustomSQLite } from "../schema";
import { SqliteConversationStore } from "../store";
import { SqliteLongTermMemory } from "../long-term";
import { SqliteSessionManager } from "../session-store";
import { SqliteMemoryStore } from "../memory-store";
import type { MemoryInput, MemoryRecord, Message } from "@spaceduck/core";

const logger = new ConsoleLogger("error");

// Must be called BEFORE any new Database() — swaps to Homebrew SQLite on macOS
ensureCustomSQLite();

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

async function setupDb(): Promise<Database> {
  const db = createTestDb();
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  return db;
}

function testMessage(overrides?: Partial<Message>): Message {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "user",
    content: "test message",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("SchemaManager", () => {
  it("should apply initial migration", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("conversations");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("facts");
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("schema_version");

    db.close();
  });

  it("should be idempotent and reach version 13", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();
    await schema.migrate(); // Should not throw

    const row = db.query("SELECT MAX(version) as version FROM schema_version").get() as {
      version: number;
    };
    expect(row.version).toBe(13);

    db.close();
  });

  it("migration 005: v2 columns exist and application-layer rows carry all fields", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    // Insert via the application layer so all v2 fields are populated
    const ltm = new SqliteLongTermMemory(db, logger);
    const result = await ltm.remember({
      conversationId: "conv-1",
      content: "Migration 005 test fact stored via app layer",
      source: "manual",
      confidence: 0.8,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { db.close(); return; }

    expect(result.value.source).toBe("manual");
    expect(result.value.confidence).toBe(0.8);
    expect(result.value.expiresAt).toBeUndefined();
    expect(result.value.updatedAt).toBeGreaterThan(0);
    expect(result.value.updatedAt).toBe(result.value.createdAt);

    db.close();
  });

  it("migration 005: backfill SQL sets updated_at = created_at on NULL rows", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const now = Date.now();
    // Directly insert a row with NULL updated_at (simulates a pre-v2 row)
    db.exec(
      `INSERT INTO facts (id, conversation_id, content, created_at, content_hash, updated_at)
       VALUES ('pre-v2', 'conv-1', 'Old fact before v2', ${now}, 'hash-backfill-test', NULL)`,
    );

    // Verify it's NULL
    const before = db.query("SELECT updated_at FROM facts WHERE id = 'pre-v2'").get() as { updated_at: number | null };
    expect(before.updated_at).toBeNull();

    // Run the backfill SQL (same as in migration 005)
    db.exec("UPDATE facts SET updated_at = created_at WHERE updated_at IS NULL");

    const after = db.query("SELECT updated_at, created_at FROM facts WHERE id = 'pre-v2'").get() as { updated_at: number; created_at: number };
    expect(after.updated_at).toBe(after.created_at);
    expect(after.updated_at).toBe(now);

    db.close();
  });

  it("migration 013: memories table, FTS, triggers, and vec_memories_meta exist", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("memories");
    expect(tableNames).toContain("memories_fts");
    expect(tableNames).toContain("vec_memories_meta");

    const columns = db
      .query("PRAGMA table_info(memories)")
      .all() as { name: string; type: string; notnull: number }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("id");
    expect(colNames).toContain("kind");
    expect(colNames).toContain("title");
    expect(colNames).toContain("content");
    expect(colNames).toContain("summary");
    expect(colNames).toContain("scope_type");
    expect(colNames).toContain("scope_id");
    expect(colNames).toContain("entity_refs");
    expect(colNames).toContain("source_type");
    expect(colNames).toContain("source_id");
    expect(colNames).toContain("source_conversation_id");
    expect(colNames).toContain("source_run_id");
    expect(colNames).toContain("source_tool_name");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");
    expect(colNames).toContain("last_seen_at");
    expect(colNames).toContain("occurred_at");
    expect(colNames).toContain("expires_at");
    expect(colNames).toContain("procedure_subtype");
    expect(colNames).toContain("importance");
    expect(colNames).toContain("confidence");
    expect(colNames).toContain("status");
    expect(colNames).toContain("superseded_by");
    expect(colNames).toContain("embedding_version");
    expect(colNames).toContain("tags");
    expect(colNames).toContain("content_hash");

    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'")
      .all() as { name: string }[];
    const idxNames = indexes.map((i) => i.name);

    expect(idxNames).toContain("idx_memories_kind_status");
    expect(idxNames).toContain("idx_memories_scope");
    expect(idxNames).toContain("idx_memories_updated");
    expect(idxNames).toContain("idx_memories_importance");
    expect(idxNames).toContain("idx_memories_status");
    expect(idxNames).toContain("idx_memories_content_hash");
    expect(idxNames).toContain("idx_memories_occurred_at");

    const triggers = db
      .query("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='memories'")
      .all() as { name: string }[];
    const triggerNames = triggers.map((t) => t.name);

    expect(triggerNames).toContain("memories_ai");
    expect(triggerNames).toContain("memories_ad");
    expect(triggerNames).toContain("memories_au");

    db.close();
  });

  it("migration 013: kind CHECK constraint rejects invalid values", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const now = Date.now();

    // Valid kinds should work
    for (const kind of ["fact", "episode", "procedure"]) {
      db.exec(
        `INSERT INTO memories (id, kind, title, content, source_type, created_at, updated_at, last_seen_at)
         VALUES ('test-${kind}', '${kind}', 'Test', 'Content', 'system', ${now}, ${now}, ${now})`,
      );
    }

    // Invalid kind should throw
    expect(() => {
      db.exec(
        `INSERT INTO memories (id, kind, title, content, source_type, created_at, updated_at, last_seen_at)
         VALUES ('test-bad', 'invalid_kind', 'Test', 'Content', 'system', ${now}, ${now}, ${now})`,
      );
    }).toThrow();

    db.close();
  });

  it("migration 013: status CHECK constraint rejects invalid values", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const now = Date.now();

    for (const status of ["candidate", "active", "stale", "superseded", "archived"]) {
      db.exec(
        `INSERT INTO memories (id, kind, title, content, source_type, status, created_at, updated_at, last_seen_at)
         VALUES ('test-${status}', 'fact', 'Test', 'Content', 'system', '${status}', ${now}, ${now}, ${now})`,
      );
    }

    expect(() => {
      db.exec(
        `INSERT INTO memories (id, kind, title, content, source_type, status, created_at, updated_at, last_seen_at)
         VALUES ('test-bad-status', 'fact', 'Test', 'Content', 'system', 'deleted', ${now}, ${now}, ${now})`,
      );
    }).toThrow();

    db.close();
  });

  it("migration 013: procedure_subtype CHECK constraint allows valid subtypes and NULL", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const now = Date.now();

    // NULL is valid (for facts/episodes)
    db.exec(
      `INSERT INTO memories (id, kind, title, content, source_type, created_at, updated_at, last_seen_at)
       VALUES ('test-null-subtype', 'fact', 'Test', 'Content', 'system', ${now}, ${now}, ${now})`,
    );

    for (const subtype of ["behavioral", "workflow", "constraint"]) {
      db.exec(
        `INSERT INTO memories (id, kind, title, content, source_type, procedure_subtype, created_at, updated_at, last_seen_at)
         VALUES ('test-${subtype}', 'procedure', 'Test', 'Content', 'system', '${subtype}', ${now}, ${now}, ${now})`,
      );
    }

    expect(() => {
      db.exec(
        `INSERT INTO memories (id, kind, title, content, source_type, procedure_subtype, created_at, updated_at, last_seen_at)
         VALUES ('test-bad-sub', 'procedure', 'Test', 'Content', 'system', 'invalid', ${now}, ${now}, ${now})`,
      );
    }).toThrow();

    db.close();
  });

  it("migration 013: FTS triggers sync on insert/update/delete", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const now = Date.now();

    // Insert
    db.exec(
      `INSERT INTO memories (id, kind, title, content, summary, source_type, created_at, updated_at, last_seen_at)
       VALUES ('fts-test', 'fact', 'Bun Runtime', 'Bun is fast', 'Fast JS runtime', 'system', ${now}, ${now}, ${now})`,
    );

    const afterInsert = db
      .query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'Bun'")
      .all();
    expect(afterInsert.length).toBe(1);

    // Update
    db.exec(
      `UPDATE memories SET content = 'Bun is extremely fast', summary = 'Extremely fast JS runtime' WHERE id = 'fts-test'`,
    );

    const afterUpdate = db
      .query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'extremely'")
      .all();
    expect(afterUpdate.length).toBe(1);

    const oldMatch = db
      .query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'Bun'")
      .all();
    expect(oldMatch.length).toBe(1);

    // Delete
    db.exec("DELETE FROM memories WHERE id = 'fts-test'");

    const afterDelete = db
      .query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'Bun'")
      .all();
    expect(afterDelete.length).toBe(0);

    db.close();
  });

  it("migration 013: content_hash is non-unique (allows duplicates)", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const now = Date.now();
    const hash = "abc123deadbeef";

    db.exec(
      `INSERT INTO memories (id, kind, title, content, source_type, content_hash, scope_type, created_at, updated_at, last_seen_at)
       VALUES ('dup-1', 'fact', 'Test', 'Same content', 'system', '${hash}', 'global', ${now}, ${now}, ${now})`,
    );

    // Same hash, different scope -- should NOT throw
    db.exec(
      `INSERT INTO memories (id, kind, title, content, source_type, content_hash, scope_type, scope_id, created_at, updated_at, last_seen_at)
       VALUES ('dup-2', 'fact', 'Test', 'Same content', 'system', '${hash}', 'project', 'proj-1', ${now}, ${now}, ${now})`,
    );

    const rows = db
      .query("SELECT id FROM memories WHERE content_hash = ?")
      .all(hash) as { id: string }[];
    expect(rows.length).toBe(2);

    db.close();
  });
});

describe("SqliteConversationStore", () => {
  let db: Database;
  let store: SqliteConversationStore;

  beforeEach(async () => {
    db = await setupDb();
    store = new SqliteConversationStore(db, logger);
  });

  afterEach(() => db.close());

  it("should create and load a conversation", async () => {
    const result = await store.create("conv-1", "Test Chat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe("conv-1");
    expect(result.value.title).toBe("Test Chat");

    const loaded = await store.load("conv-1");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value?.id).toBe("conv-1");
      expect(loaded.value?.title).toBe("Test Chat");
    }
  });

  it("should return null for non-existent conversation", async () => {
    const result = await store.load("nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("should list conversations ordered by last_active_at", async () => {
    await store.create("conv-1", "First");
    await new Promise((r) => setTimeout(r, 5));
    await store.create("conv-2", "Second");

    const result = await store.list();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].id).toBe("conv-2"); // most recent first
    }
  });

  it("should append and load messages", async () => {
    await store.create("conv-1");

    const msg1 = testMessage({ content: "Hello" });
    const msg2 = testMessage({ role: "assistant", content: "Hi there!" });

    await store.appendMessage("conv-1", msg1);
    await store.appendMessage("conv-1", msg2);

    const result = await store.loadMessages("conv-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].content).toBe("Hello");
      expect(result.value[1].content).toBe("Hi there!");
    }
  });

  it("should respect limit on loadMessages", async () => {
    await store.create("conv-1");

    for (let i = 0; i < 10; i++) {
      await store.appendMessage(
        "conv-1",
        testMessage({ content: `Message ${i}`, timestamp: Date.now() + i }),
      );
    }

    const result = await store.loadMessages("conv-1", 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
    }
  });

  it("should auto-create conversation on appendMessage", async () => {
    const msg = testMessage({ content: "Hello" });
    await store.appendMessage("auto-conv", msg);

    const loaded = await store.load("auto-conv");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).not.toBeNull();
    }
  });

  it("should update conversation title", async () => {
    await store.create("conv-1", "Old Title");
    await store.updateTitle("conv-1", "New Title");

    const result = await store.load("conv-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.title).toBe("New Title");
    }
  });

  it("should delete conversation and its messages", async () => {
    await store.create("conv-1");
    await store.appendMessage("conv-1", testMessage({ content: "Hello" }));
    await store.delete("conv-1");

    const result = await store.load("conv-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("should persist message metadata fields", async () => {
    await store.create("conv-1");
    const msg = testMessage({
      status: "completed",
      traceId: "trace-123",
      source: "assistant",
      requestId: "req-456",
    });

    await store.appendMessage("conv-1", msg);
    const result = await store.loadMessages("conv-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].status).toBe("completed");
      expect(result.value[0].traceId).toBe("trace-123");
      expect(result.value[0].source).toBe("assistant");
      expect(result.value[0].requestId).toBe("req-456");
    }
  });

  // ── Tool-calling persistence ──────────────────────────────────────────
  // These tests prevent a regression where tool_calls, tool role messages,
  // and tool_call_id were silently dropped, causing infinite tool loops.

  it("should persist assistant message with toolCalls", async () => {
    await store.create("conv-1");

    const msg = testMessage({
      role: "assistant",
      content: "",
      source: "assistant",
      toolCalls: [
        { id: "tc-1", name: "web_fetch", args: { url: "https://example.com" } },
        { id: "tc-2", name: "browser_navigate", args: { url: "https://example.com" } },
      ],
    });

    await store.appendMessage("conv-1", msg);
    const result = await store.loadMessages("conv-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loaded = result.value[0];
    expect(loaded.toolCalls).toBeDefined();
    expect(loaded.toolCalls).toHaveLength(2);
    expect(loaded.toolCalls![0].id).toBe("tc-1");
    expect(loaded.toolCalls![0].name).toBe("web_fetch");
    expect(loaded.toolCalls![0].args).toEqual({ url: "https://example.com" });
    expect(loaded.toolCalls![1].id).toBe("tc-2");
    expect(loaded.toolCalls![1].name).toBe("browser_navigate");
  });

  it("should persist tool result messages (role=tool)", async () => {
    await store.create("conv-1");

    const toolMsg: Message = {
      id: "tool-result-1",
      role: "tool",
      content: '{"headers":{"User-Agent":"Spaceduck/1.0"}}',
      timestamp: Date.now(),
      source: "tool",
      toolCallId: "tc-1",
      toolName: "web_fetch",
    };

    await store.appendMessage("conv-1", toolMsg);
    const result = await store.loadMessages("conv-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loaded = result.value[0];
    expect(loaded.role).toBe("tool");
    expect(loaded.toolCallId).toBe("tc-1");
    expect(loaded.toolName).toBe("web_fetch");
    expect(loaded.content).toContain("User-Agent");
  });

  it("should round-trip a full tool-calling sequence", async () => {
    // This is the exact sequence the AgentLoop produces:
    //   1. user message
    //   2. assistant message with toolCalls
    //   3. tool result message
    //   4. final assistant text response
    //
    // If any part is lost, the LLM loops because it never sees
    // its own tool call or the result.

    await store.create("conv-1");

    // 1. User message
    await store.appendMessage("conv-1", testMessage({
      id: "msg-user",
      role: "user",
      content: "Fetch https://httpbin.org/get",
    }));

    // 2. Assistant with tool call
    await store.appendMessage("conv-1", testMessage({
      id: "msg-assistant-tc",
      role: "assistant",
      content: "",
      source: "assistant",
      toolCalls: [{ id: "tc-1", name: "web_fetch", args: { url: "https://httpbin.org/get" } }],
    }));

    // 3. Tool result
    await store.appendMessage("conv-1", {
      id: "msg-tool-result",
      role: "tool",
      content: '{"origin":"1.2.3.4","headers":{"User-Agent":"bun/1.3"}}',
      timestamp: Date.now(),
      source: "tool",
      toolCallId: "tc-1",
      toolName: "web_fetch",
    });

    // 4. Final assistant response
    await store.appendMessage("conv-1", testMessage({
      id: "msg-assistant-final",
      role: "assistant",
      content: "Your User-Agent is bun/1.3",
      source: "assistant",
    }));

    // Load and verify entire sequence is intact
    const result = await store.loadMessages("conv-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(4);

    // Verify each message preserves its critical fields
    const [user, assistantTC, toolResult, assistantFinal] = result.value;

    expect(user.role).toBe("user");

    expect(assistantTC.role).toBe("assistant");
    expect(assistantTC.toolCalls).toHaveLength(1);
    expect(assistantTC.toolCalls![0].id).toBe("tc-1");
    expect(assistantTC.toolCalls![0].name).toBe("web_fetch");
    expect(assistantTC.toolCalls![0].args).toEqual({ url: "https://httpbin.org/get" });

    expect(toolResult.role).toBe("tool");
    expect(toolResult.toolCallId).toBe("tc-1");
    expect(toolResult.toolName).toBe("web_fetch");
    expect(toolResult.content).toContain("User-Agent");

    expect(assistantFinal.role).toBe("assistant");
    expect(assistantFinal.content).toContain("bun/1.3");
    expect(assistantFinal.toolCalls).toBeUndefined();
  });

  it("should not lose toolCalls when content is empty", async () => {
    // Thinking models often produce empty content with tool calls
    // (thinking text is stripped). The toolCalls must survive.
    await store.create("conv-1");

    await store.appendMessage("conv-1", testMessage({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc-1", name: "web_fetch", args: { url: "https://example.com" } }],
    }));

    const result = await store.loadMessages("conv-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value[0].content).toBe("");
    expect(result.value[0].toolCalls).toBeDefined();
    expect(result.value[0].toolCalls).toHaveLength(1);
  });
});

describe("SqliteLongTermMemory", () => {
  let db: Database;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = await setupDb();
    ltm = new SqliteLongTermMemory(db, logger);
  });

  afterEach(() => db.close());

  it("should remember and recall facts", async () => {
    await ltm.remember({ conversationId: "conv-1", content: "User likes TypeScript" });
    await ltm.remember({ conversationId: "conv-1", content: "User prefers dark mode" });

    const result = await ltm.recall("TypeScript");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThanOrEqual(1);
      expect(result.value[0].content).toContain("TypeScript");
    }
  });

  it("should forget a fact", async () => {
    const remembered = await ltm.remember({
      conversationId: "conv-1",
      content: "Temporary fact",
    });
    expect(remembered.ok).toBe(true);
    if (!remembered.ok) return;

    await ltm.forget(remembered.value.id);

    const result = await ltm.listAll();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((f) => f.id === remembered.value.id)).toBeUndefined();
    }
  });

  it("should list all facts, optionally by conversation", async () => {
    await ltm.remember({ conversationId: "conv-1", content: "Fact A" });
    await ltm.remember({ conversationId: "conv-2", content: "Fact B" });

    const all = await ltm.listAll();
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value).toHaveLength(2);

    const filtered = await ltm.listAll("conv-1");
    expect(filtered.ok).toBe(true);
    if (filtered.ok) expect(filtered.value).toHaveLength(1);
  });

  it("should respect recall limit", async () => {
    for (let i = 0; i < 5; i++) {
      await ltm.remember({ conversationId: "conv-1", content: `TypeScript fact ${i}` });
    }

    const result = await ltm.recall("TypeScript", 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  // ── Memory v2 write path tests ─────────────────────────────────────

  it("v2: remember() stores source, confidence, updatedAt", async () => {
    const result = await ltm.remember({
      conversationId: "conv-1",
      content: "User prefers TypeScript over JavaScript for large projects",
      source: "manual",
      confidence: 0.9,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("manual");
    expect(result.value.confidence).toBe(0.9);
    expect(result.value.updatedAt).toBeGreaterThan(0);
    expect(result.value.updatedAt).toBe(result.value.createdAt);
  });

  it("v2: remember() defaults to source=auto-extracted, confidence=1.0", async () => {
    const result = await ltm.remember({
      conversationId: "conv-1",
      content: "User uses Bun runtime with SQLite for persistence",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("auto-extracted");
    expect(result.value.confidence).toBe(1.0);
    expect(result.value.expiresAt).toBeUndefined();
  });

  it("v2: remember() stores expiresAt for transient facts", async () => {
    const future = Date.now() + 86_400_000; // 24h
    const result = await ltm.remember({
      conversationId: "conv-1",
      content: "User is working on deadline today",
      source: "auto-extracted",
      confidence: 0.3,
      expiresAt: future,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.expiresAt).toBe(future);
  });

  it("v2: SHA-256 dedup still works and returns new Fact fields", async () => {
    const r1 = await ltm.remember({ conversationId: "conv-1", content: "User likes dark mode" });
    const r2 = await ltm.remember({ conversationId: "conv-1", content: "User likes dark mode" });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    expect(r2.value.id).toBe(r1.value.id);
    expect(r2.value.source).toBeDefined();
    expect(r2.value.confidence).toBeDefined();
    expect(r2.value.updatedAt).toBeDefined();

    const count = db.query("SELECT COUNT(*) as c FROM facts").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("v2: listAll() returns new Fact fields", async () => {
    await ltm.remember({ conversationId: "conv-1", content: "User builds AI systems" });
    const result = await ltm.listAll("conv-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fact = result.value[0];
    expect(fact.source).toBeDefined();
    expect(typeof fact.confidence).toBe("number");
    expect(typeof fact.updatedAt).toBe("number");
    expect(fact.updatedAt).toBeGreaterThan(0);
  });

  it("v2: expired facts are not returned by recall", async () => {
    const past = Date.now() - 1000;
    await ltm.remember({
      conversationId: "conv-1",
      content: "User had a meeting today and is currently busy",
      source: "auto-extracted",
      confidence: 0.3,
      expiresAt: past,
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User prefers TypeScript for all projects",
    });

    const result = await ltm.recall("TypeScript meeting", 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contents = result.value.map((f) => f.content);
    expect(contents.some((c) => c.includes("meeting"))).toBe(false);
    expect(contents.some((c) => c.includes("TypeScript"))).toBe(true);
  });
});

describe("SqliteSessionManager", () => {
  let db: Database;
  let sessions: SqliteSessionManager;

  beforeEach(async () => {
    db = await setupDb();
    sessions = new SqliteSessionManager(db, logger);
  });

  afterEach(() => db.close());

  it("should create a new session", async () => {
    const session = await sessions.resolve("web", "user-1");
    expect(session.channelId).toBe("web");
    expect(session.senderId).toBe("user-1");
    expect(session.conversationId).toBeTruthy();
  });

  it("should return existing session for same sender", async () => {
    const s1 = await sessions.resolve("web", "user-1");
    const s2 = await sessions.resolve("web", "user-1");
    expect(s1.id).toBe(s2.id);
    expect(s1.conversationId).toBe(s2.conversationId);
  });

  it("should reset session with new conversation", async () => {
    const original = await sessions.resolve("web", "user-1");
    const reset = await sessions.reset(original.id);
    expect(reset.id).toBe(original.id);
    expect(reset.conversationId).not.toBe(original.conversationId);
  });

  it("should get and touch session", async () => {
    const session = await sessions.resolve("web", "user-1");
    const before = session.lastActiveAt;

    await new Promise((r) => setTimeout(r, 5));
    await sessions.touch(session.id);

    const updated = await sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated!.lastActiveAt).toBeGreaterThan(before);
  });

  it("should return null for unknown session", async () => {
    const result = await sessions.get("nonexistent");
    expect(result).toBeNull();
  });
});

// ── FTS ranking contract ───────────────────────────────────────────────────────
// This test is the behavioural truth for bm25() ordering.
// SQLite FTS5 bm25() returns smaller (more negative) values for better matches.
// ORDER BY bm25(facts_fts) ASC puts the best match first.

describe("FTS ranking contract", () => {
  let db: Database;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = await setupDb();
    ltm = new SqliteLongTermMemory(db, logger);
  });

  afterEach(() => db.close());

  it("two-term match ranks above single-term match", async () => {
    // Fact A matches both "bun" AND "websocket"
    await ltm.remember({
      conversationId: "conv-1",
      content: "bun websocket handler that manages connections efficiently",
    });
    // Fact B matches only "bun"
    await ltm.remember({
      conversationId: "conv-1",
      content: "bun is a fast JavaScript runtime",
    });

    const result = await ltm.recall("bun websocket", 2, { strategy: "fts" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBe(2);
    // The fact containing both terms must be ranked first
    expect(result.value[0].content).toContain("websocket");
  });

  it("fact matching all query terms ranks above fact matching fewer terms", async () => {
    // Unique terms so IDF is unambiguous
    await ltm.remember({
      conversationId: "conv-1",
      content: "Spaceduck uses zephyr framework with typescript compilation pipeline",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "typescript is a language",
    });

    // Query uses terms from the first fact only
    const result = await ltm.recall("zephyr typescript compilation", 2, { strategy: "fts" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBeGreaterThan(0);
    // The fact that contains all three query terms must rank first
    expect(result.value[0].content).toContain("zephyr");
  });
});

// ── Hybrid recall — RRF + decay + expiry ──────────────────────────────────────

describe("hybrid recall — RRF + decay + expiry", () => {
  let db: Database;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = await setupDb();
    ltm = new SqliteLongTermMemory(db, logger);
  });

  afterEach(() => db.close());

  it("missing-rank safe: FTS-only fact still appears in hybrid results", async () => {
    // Insert fact without embedding (no embedding provider) so vec_facts is empty
    await ltm.remember({
      conversationId: "conv-1",
      content: "User uses SQLite for all persistence needs",
    });

    // Hybrid recall with no embedding provider falls back gracefully
    const result = await ltm.recall("SQLite persistence", 5, { strategy: "hybrid" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should still find via FTS contribution
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0].content).toContain("SQLite");
  });

  it("expiry filtering: expired facts never appear in results", async () => {
    const past = Date.now() - 1000; // already expired
    await ltm.remember({
      conversationId: "conv-1",
      content: "User was working on a demo today",
      source: "auto-extracted",
      confidence: 0.3,
      expiresAt: past,
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User prefers working on demos and experiments",
    });

    const result = await ltm.recall("demo working", 5, { strategy: "hybrid" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contents = result.value.map((f) => f.content);
    // Expired fact must not appear
    expect(contents.some((c) => c.includes("today"))).toBe(false);
    // Non-expired fact should appear
    expect(contents.some((c) => c.includes("experiments"))).toBe(true);
  });

  it("post-filter trap: returns valid facts even when most candidates are expired", async () => {
    // Insert 8 expired facts
    const past = Date.now() - 1000;
    for (let i = 0; i < 8; i++) {
      await ltm.remember({
        conversationId: "conv-1",
        content: `User was thinking about bun topic number ${i} today`,
        source: "auto-extracted",
        confidence: 0.3,
        expiresAt: past,
      });
    }
    // Insert 2 valid non-expired facts
    await ltm.remember({
      conversationId: "conv-1",
      content: "User uses bun for all server-side JavaScript work",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User prefers bun over Node.js for performance",
    });

    const result = await ltm.recall("bun", 5, { strategy: "hybrid" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Must return the 2 non-expired facts (not empty result)
    expect(result.value.length).toBe(2);
    for (const fact of result.value) {
      expect(fact.expiresAt == null || fact.expiresAt > Date.now()).toBe(true);
    }
  });

  it("minConfidence filter excludes low-confidence facts", async () => {
    await ltm.remember({
      conversationId: "conv-1",
      content: "User is currently working on something TypeScript related",
      source: "auto-extracted",
      confidence: 0.3,
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User has been using TypeScript professionally for five years",
      source: "auto-extracted",
      confidence: 0.9,
    });

    const result = await ltm.recall("TypeScript", 5, {
      strategy: "hybrid",
      minConfidence: 0.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const fact of result.value) {
      expect(fact.confidence).toBeGreaterThanOrEqual(0.5);
    }
    // The high-confidence fact should be present
    expect(result.value.some((f) => f.content.includes("professionally"))).toBe(true);
  });
});

// ── Slot vs turn-flush deactivation E2E ─────────────────────────────

describe("Slot deactivation of turn-flush facts", () => {
  let db: Database;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = await setupDb();
    ltm = new SqliteLongTermMemory(db, logger);
  });

  afterEach(() => db.close());

  it("deactivates slot-less turn-flush facts when a slot fact is upserted", async () => {
    // 1. Store a slot fact: "User's name is John"
    await ltm.upsertSlotFact({
      conversationId: "conv-1",
      content: "User's name is John",
      slot: "name",
      slotValue: "John",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-1",
    });

    // 2. Turn-flush stores raw assistant response (no slot)
    await ltm.remember({
      conversationId: "conv-1",
      content: "Your name is John.",
      source: "turn-flush",
      confidence: 0.75,
    });

    // Both should be active at this point
    const allActive = db
      .query("SELECT content, is_active FROM facts WHERE is_active = 1")
      .all() as Array<{ content: string; is_active: number }>;
    expect(allActive.length).toBe(2);

    // 3. In a new conversation, user corrects: "My name is Peter"
    await ltm.upsertSlotFact({
      conversationId: "conv-2",
      content: "User's name is Peter",
      slot: "name",
      slotValue: "Peter",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-2",
    });

    // 4. Verify: only the Peter fact should be active
    const activeAfter = db
      .query("SELECT content, slot, is_active FROM facts WHERE is_active = 1")
      .all() as Array<{ content: string; slot: string | null; is_active: number }>;

    expect(activeAfter.length).toBe(1);
    expect(activeAfter[0].content).toBe("User's name is Peter");

    // The turn-flush "Your name is John." should be deactivated
    const johnFact = db
      .query("SELECT is_active FROM facts WHERE content = 'Your name is John.'")
      .get() as { is_active: number };
    expect(johnFact.is_active).toBe(0);
  });

  it("deactivates slot-less facts via remember() with slot conflict resolution", async () => {
    // 1. Seed a slot fact with slotValue="Alice" so remember() has old values to match
    await ltm.remember({
      conversationId: "conv-0",
      content: "User's name is Alice",
      slot: "name",
      slotValue: "Alice",
      source: "pre_regex",
      confidence: 0.55,
    });

    // 2. Turn-flush stores "Your name is Alice." (no slot)
    await ltm.remember({
      conversationId: "conv-1",
      content: "Your name is Alice.",
      source: "turn-flush",
      confidence: 0.75,
    });

    // Both should be active
    const before = db
      .query("SELECT is_active FROM facts WHERE content = 'Your name is Alice.'")
      .get() as { is_active: number };
    expect(before.is_active).toBe(1);

    // 3. Slot-based remember stores a new name — old "Alice" turn-flush should be deactivated
    await ltm.remember({
      conversationId: "conv-2",
      content: "User's name is Bob",
      slot: "name",
      slotValue: "Bob",
      source: "pre_regex",
      confidence: 0.55,
    });

    const after = db
      .query("SELECT is_active FROM facts WHERE content = 'Your name is Alice.'")
      .get() as { is_active: number };
    expect(after.is_active).toBe(0);

    const active = db
      .query("SELECT content FROM facts WHERE is_active = 1 AND content LIKE '%name%'")
      .all() as Array<{ content: string }>;
    expect(active.length).toBe(1);
    expect(active[0].content).toBe("User's name is Bob");
  });

  it("recall only returns the latest slot value, not stale turn-flush facts", async () => {
    // Full pipeline: John stored → turn-flush "John" → Peter stored → recall
    await ltm.upsertSlotFact({
      conversationId: "conv-1",
      content: "User's name is John",
      slot: "name",
      slotValue: "John",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-1",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "Your name is John.",
      source: "turn-flush",
      confidence: 0.75,
    });
    await ltm.upsertSlotFact({
      conversationId: "conv-2",
      content: "User's name is Peter",
      slot: "name",
      slotValue: "Peter",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-2",
    });

    // Recall for "name"
    const result = await ltm.recall("name", 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should NOT contain any John reference
    const contents = result.value.map((f) => f.content);
    expect(contents.some((c) => c.includes("John"))).toBe(false);
    expect(contents.some((c) => c.includes("Peter"))).toBe(true);
  });

  // ── Age slot (value-based: "25" appears in turn-flush) ──────────────

  it("deactivates turn-flush containing old age value when age slot changes", async () => {
    // First set age=25 via slot
    await ltm.upsertSlotFact({
      conversationId: "conv-1",
      content: "User is 25 years old",
      slot: "age",
      slotValue: "25",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-1",
    });
    // Turn-flush echoes "25"
    await ltm.remember({
      conversationId: "conv-1",
      content: "You are 25 years old.",
      source: "turn-flush",
      confidence: 0.75,
    });

    // Now correct to age=30 — old "25" turn-flush should be deactivated
    await ltm.upsertSlotFact({
      conversationId: "conv-2",
      content: "User is 30 years old",
      slot: "age",
      slotValue: "30",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-2",
    });

    const old = db
      .query("SELECT is_active FROM facts WHERE content = 'You are 25 years old.'")
      .get() as { is_active: number };
    expect(old.is_active).toBe(0);

    const active = db
      .query("SELECT content FROM facts WHERE is_active = 1")
      .all() as Array<{ content: string }>;
    expect(active.length).toBe(1);
    expect(active[0].content).toBe("User is 30 years old");
  });

  it("deactivates turn-flush age via remember() slot conflict", async () => {
    // Seed an old age slot fact so remember() has something to collect
    await ltm.remember({
      conversationId: "conv-0",
      content: "User is 25 years old",
      slot: "age",
      slotValue: "25",
      source: "pre_regex",
      confidence: 0.55,
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "Your age is 25.",
      source: "turn-flush",
      confidence: 0.75,
    });

    await ltm.remember({
      conversationId: "conv-2",
      content: "User is 30 years old",
      slot: "age",
      slotValue: "30",
      source: "pre_regex",
      confidence: 0.55,
    });

    const old = db
      .query("SELECT is_active FROM facts WHERE content = 'Your age is 25.'")
      .get() as { is_active: number };
    expect(old.is_active).toBe(0);
  });

  // ── Location slot (language-agnostic via value match) ──────────────

  it("deactivates turn-flush containing old city when location changes", async () => {
    await ltm.upsertSlotFact({
      conversationId: "conv-1",
      content: "User lives in New York",
      slot: "location",
      slotValue: "New York",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-1",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "You live in New York.",
      source: "turn-flush",
      confidence: 0.75,
    });

    await ltm.upsertSlotFact({
      conversationId: "conv-2",
      content: "User lives in Copenhagen",
      slot: "location",
      slotValue: "Copenhagen",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-2",
    });

    const after = db
      .query("SELECT is_active FROM facts WHERE content = 'You live in New York.'")
      .get() as { is_active: number };
    expect(after.is_active).toBe(0);
  });

  it("deactivates Danish turn-flush via old value when location changes", async () => {
    await ltm.upsertSlotFact({
      conversationId: "conv-1",
      content: "User lives in København",
      slot: "location",
      slotValue: "København",
      source: "pre_regex",
      confidence: 0.55,
      lang: "da",
      derivedFromMessageId: "msg-1",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "Du bor i København.",
      source: "turn-flush",
      confidence: 0.75,
    });

    await ltm.upsertSlotFact({
      conversationId: "conv-2",
      content: "User lives in Aarhus",
      slot: "location",
      slotValue: "Aarhus",
      source: "pre_regex",
      confidence: 0.55,
      lang: "da",
      derivedFromMessageId: "msg-2",
    });

    const old = db
      .query("SELECT is_active FROM facts WHERE content = 'Du bor i København.'")
      .get() as { is_active: number };
    expect(old.is_active).toBe(0);
  });

  it("deactivates turn-flush location via remember() slot conflict", async () => {
    await ltm.remember({
      conversationId: "conv-0",
      content: "User lives in London",
      slot: "location",
      slotValue: "London",
      source: "pre_regex",
      confidence: 0.55,
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "You are based in London.",
      source: "turn-flush",
      confidence: 0.75,
    });

    await ltm.remember({
      conversationId: "conv-2",
      content: "User lives in Copenhagen",
      slot: "location",
      slotValue: "Copenhagen",
      source: "pre_regex",
      confidence: 0.55,
    });

    const old = db
      .query("SELECT is_active FROM facts WHERE content = 'You are based in London.'")
      .get() as { is_active: number };
    expect(old.is_active).toBe(0);
  });

  // ── Cross-slot isolation ───────────────────────────────────────────

  it("does NOT deactivate turn-flush facts for unrelated slots", async () => {
    await ltm.remember({
      conversationId: "conv-1",
      content: "You live in Berlin.",
      source: "turn-flush",
      confidence: 0.75,
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "You are 40 years old.",
      source: "turn-flush",
      confidence: 0.75,
    });

    // First name upsert (no old value to match) — should NOT affect others
    await ltm.upsertSlotFact({
      conversationId: "conv-2",
      content: "User's name is Alice",
      slot: "name",
      slotValue: "Alice",
      source: "pre_regex",
      confidence: 0.55,
      lang: "en",
      derivedFromMessageId: "msg-2",
    });

    const locationFact = db
      .query("SELECT is_active FROM facts WHERE content = 'You live in Berlin.'")
      .get() as { is_active: number };
    expect(locationFact.is_active).toBe(1);

    const ageFact = db
      .query("SELECT is_active FROM facts WHERE content = 'You are 40 years old.'")
      .get() as { is_active: number };
    expect(ageFact.is_active).toBe(1);
  });

  // ── 'other' slot should not trigger deactivation ───────────────────

  it("does NOT deactivate turn-flush facts when storing 'other' slot facts", async () => {
    await ltm.remember({
      conversationId: "conv-1",
      content: "You prefer Python.",
      source: "turn-flush",
      confidence: 0.75,
    });

    await ltm.remember({
      conversationId: "conv-2",
      content: "User mentioned working on a project",
      slot: "other",
      source: "llm",
      confidence: 0.55,
    });

    const prefFact = db
      .query("SELECT is_active FROM facts WHERE content = 'You prefer Python.'")
      .get() as { is_active: number };
    expect(prefFact.is_active).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SqliteMemoryStore (Memory v2)
// ---------------------------------------------------------------------------

function testInput(overrides?: Partial<MemoryInput>): MemoryInput {
  return {
    kind: "fact",
    title: "Test memory",
    content: "Test content for memory v2",
    scope: { type: "global" },
    source: { type: "system" },
    ...overrides,
  } as MemoryInput;
}

describe("SqliteMemoryStore", () => {
  let db: Database;
  let store: SqliteMemoryStore;

  beforeEach(async () => {
    db = await setupDb();
    store = new SqliteMemoryStore(db, logger);
  });

  afterEach(() => db.close());

  it("store() and get() round-trip a fact", async () => {
    const result = await store.store(testInput({
      title: "Prefers Bun",
      content: "User prefers Bun over Node for TypeScript projects",
      tags: ["preference", "runtime"],
      importance: 0.8,
      confidence: 0.9,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const record = result.value;
    expect(record.kind).toBe("fact");
    expect(record.title).toBe("Prefers Bun");
    expect(record.tags).toEqual(["preference", "runtime"]);
    expect(record.importance).toBe(0.8);
    expect(record.confidence).toBe(0.9);
    expect(record.status).toBe("active");
    expect(record.scope).toEqual({ type: "global" });

    const got = await store.get(record.id);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value?.id).toBe(record.id);
      expect(got.value?.title).toBe("Prefers Bun");
    }
  });

  it("store() an episode requires occurredAt", async () => {
    const result = await store.store({
      kind: "episode",
      title: "Deployed auth service",
      content: "Successfully deployed the auth service to production",
      occurredAt: Date.now() - 3600_000,
      scope: { type: "project", projectId: "proj-1" },
      source: { type: "tool_result", toolName: "deploy" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("episode");
    expect(result.value.occurredAt).toBeDefined();
    expect(result.value.scope).toEqual({ type: "project", projectId: "proj-1" });
  });

  it("store() a procedure requires procedureSubtype", async () => {
    const result = await store.store({
      kind: "procedure",
      title: "Always validate schemas",
      content: "Before any write operation, validate the input against the schema",
      procedureSubtype: "constraint",
      scope: { type: "global" },
      source: { type: "user_message" },
      importance: 0.9,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("procedure");
    expect(result.value.procedureSubtype).toBe("constraint");
  });

  it("store() deduplicates by content_hash + kind + scope", async () => {
    const input = testInput({ content: "Duplicate test content" });
    const r1 = await store.store(input);
    const r2 = await store.store(input);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.id).toBe(r2.value.id);
    }
  });

  it("store() allows same content in different scopes", async () => {
    const r1 = await store.store(testInput({
      content: "Same content different scope",
      scope: { type: "global" },
    }));
    const r2 = await store.store(testInput({
      content: "Same content different scope",
      scope: { type: "project", projectId: "proj-1" },
    }));

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.id).not.toBe(r2.value.id);
    }
  });

  it("list() filters by kind and status", async () => {
    await store.store(testInput({ kind: "fact", title: "Fact 1", content: "fact content 1" }));
    await store.store({
      kind: "episode", title: "Episode 1", content: "episode content 1",
      occurredAt: Date.now(), scope: { type: "global" }, source: { type: "system" },
    });
    await store.store({
      kind: "procedure", title: "Proc 1", content: "procedure content 1",
      procedureSubtype: "behavioral", scope: { type: "global" }, source: { type: "system" },
    });

    const facts = await store.list({ kinds: ["fact"] });
    expect(facts.ok).toBe(true);
    if (facts.ok) {
      expect(facts.value.length).toBe(1);
      expect(facts.value[0].kind).toBe("fact");
    }

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(3);
  });

  it("update() patches allowed fields and preserves immutables", async () => {
    const r = await store.store(testInput({ title: "Original", content: "Original content" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const updated = await store.update(r.value.id, {
      title: "Updated title",
      tags: ["new-tag"],
      status: "stale",
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.title).toBe("Updated title");
    expect(updated.value.tags).toEqual(["new-tag"]);
    expect(updated.value.status).toBe("stale");
    expect(updated.value.kind).toBe("fact");
    expect(updated.value.source).toEqual({ type: "system" });
  });

  it("supersede() marks old as superseded and creates new", async () => {
    const r1 = await store.store(testInput({ title: "V1", content: "Version 1" }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = await store.supersede(r1.value.id, testInput({ title: "V2", content: "Version 2" }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    const old = await store.get(r1.value.id);
    expect(old.ok).toBe(true);
    if (old.ok) {
      expect(old.value?.status).toBe("superseded");
      expect(old.value?.supersededBy).toBe(r2.value.id);
    }

    expect(r2.value.status).toBe("active");
  });

  it("archive() sets status to archived", async () => {
    const r = await store.store(testInput({ content: "To be archived" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await store.archive(r.value.id);
    const got = await store.get(r.value.id);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value?.status).toBe("archived");
  });

  it("delete() removes the memory", async () => {
    const r = await store.store(testInput({ content: "To be deleted" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await store.delete(r.value.id);
    const got = await store.get(r.value.id);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value).toBeNull();
  });

  it("recall() via FTS finds memories by keyword", async () => {
    await store.store(testInput({ title: "Bun Runtime", content: "Bun is an extremely fast JavaScript runtime" }));
    await store.store(testInput({ title: "SQLite DB", content: "SQLite is a lightweight embedded database" }));

    const results = await store.recall("fast JavaScript runtime");
    expect(results.ok).toBe(true);
    if (!results.ok) return;
    expect(results.value.length).toBeGreaterThan(0);
    expect(results.value[0].memory.title).toBe("Bun Runtime");
  });

  it("recall() filters by kind", async () => {
    await store.store(testInput({ kind: "fact", title: "Fact A", content: "TypeScript is great for type safety" }));
    await store.store({
      kind: "procedure", title: "Proc A", content: "TypeScript should always use strict mode",
      procedureSubtype: "constraint", scope: { type: "global" }, source: { type: "system" },
    });

    const factsOnly = await store.recall("TypeScript", { kinds: ["fact"] });
    expect(factsOnly.ok).toBe(true);
    if (factsOnly.ok) {
      expect(factsOnly.value.every((s) => s.memory.kind === "fact")).toBe(true);
    }
  });

  it("recall() excludes expired memories", async () => {
    await store.store(testInput({
      content: "This memory is expired already",
      expiresAt: Date.now() - 1000,
    }));
    await store.store(testInput({ content: "This memory is still valid and fresh" }));

    const results = await store.recall("memory");
    expect(results.ok).toBe(true);
    if (results.ok) {
      expect(results.value.every((s) => s.memory.content !== "This memory is expired already")).toBe(true);
    }
  });

  it("get() returns null for non-existent id", async () => {
    const got = await store.get("non-existent-id");
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value).toBeNull();
  });
});

// --- Semantic Dedup Tests ---

import type { EmbeddingProvider } from "@spaceduck/core";
import { MockProvider } from "@spaceduck/core/src/__fixtures__/mock-provider";
import { reconcileVecMemories } from "../schema";

/**
 * Embedding provider that returns pre-configured vectors.
 * Call queueVector() before each embed() call.
 */
class ControlledEmbeddingProvider implements EmbeddingProvider {
  readonly name = "controlled";
  readonly model = "controlled-model";
  readonly dimensions = 4;
  private queue: Float32Array[] = [];

  queueVector(v: number[]): void {
    const vec = new Float32Array(v);
    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    this.queue.push(vec);
  }

  async embed(): Promise<Float32Array> {
    const v = this.queue.shift();
    if (!v) return new Float32Array(this.dimensions);
    return v;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = this.queue.shift();
      return v ?? new Float32Array(this.dimensions);
    });
  }
}

async function createDedupDb(embedding: EmbeddingProvider): Promise<{ db: Database; store: SqliteMemoryStore }> {
  const db = createTestDb();
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  reconcileVecMemories(db, embedding, logger);
  const store = new SqliteMemoryStore(db, logger, embedding);
  return { db, store };
}

async function createDedupDbWithProvider(
  embedding: EmbeddingProvider,
  provider: MockProvider,
): Promise<{ db: Database; store: SqliteMemoryStore }> {
  const db = createTestDb();
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  reconcileVecMemories(db, embedding, logger);
  const store = new SqliteMemoryStore(db, logger, embedding, provider);
  return { db, store };
}

const dedupInput = (overrides?: Partial<MemoryInput>): MemoryInput => ({
  kind: "fact",
  title: "Test",
  content: "The user prefers TypeScript for all projects",
  scope: { type: "global" },
  source: { type: "user_message", conversationId: "c1" },
  ...overrides,
} as MemoryInput);

describe("SqliteMemoryStore — semantic dedup", () => {
  it("skips near-duplicate when vector similarity >= threshold", async () => {
    const embed = new ControlledEmbeddingProvider();
    const { store } = await createDedupDb(embed);

    const v1 = [1, 0, 0, 0];
    embed.queueVector(v1); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput());
    expect(first.ok).toBe(true);

    // Second store: dedup query -> should find near-duplicate -> skip (no insert needed)
    embed.queueVector(v1); // checkSemanticDedup query -> matches first memory
    const second = await store.store(dedupInput({
      content: "The user likes TypeScript for all projects",
    }));
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;

    expect(second.value.id).toBe(first.value.id);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(1);
  });

  it("does NOT dedup when vectors are dissimilar", async () => {
    const embed = new ControlledEmbeddingProvider();
    const { store } = await createDedupDb(embed);

    embed.queueVector([1, 0, 0, 0]); // first store: dedup query (no matches) → reused for insert
    await store.store(dedupInput());

    embed.queueVector([0, 0, 0, 1]); // second store: dedup query (dissimilar) → reused for insert
    const second = await store.store(dedupInput({
      content: "The user builds mobile apps with React Native",
    }));
    expect(second.ok).toBe(true);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(2);
  });

  it("only dedup within the same kind", async () => {
    const embed = new ControlledEmbeddingProvider();
    const { store } = await createDedupDb(embed);

    const v = [1, 0, 0, 0];
    embed.queueVector(v); // fact store: dedup query → reused for insert
    await store.store(dedupInput({ kind: "fact" }));

    // Same vector but different kind -> should NOT dedup
    embed.queueVector(v); // procedure store: dedup query (no match for this kind) → reused for insert
    const proc = await store.store(dedupInput({
      kind: "procedure",
      procedureSubtype: "behavioral",
      content: "The user prefers TypeScript for all projects",
    }) as MemoryInput);
    expect(proc.ok).toBe(true);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(2);
  });

  it("updates lastSeenAt on the existing record when deduped", async () => {
    const embed = new ControlledEmbeddingProvider();
    const { store } = await createDedupDb(embed);

    const v = [1, 0, 0, 0];
    embed.queueVector(v); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const originalLastSeen = first.value.lastSeenAt;
    await new Promise((r) => setTimeout(r, 5));

    embed.queueVector(v); // second store dedup query
    const second = await store.store(dedupInput({
      content: "The user likes TypeScript for all projects",
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.value.id);
    expect(second.value.lastSeenAt).toBeGreaterThan(originalLastSeen);
  });
});

describe("SqliteMemoryStore — contradiction detection", () => {
  it("supersedes when LLM detects contradiction", async () => {
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider(["contradiction"]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    const v = [1, 0, 0, 0];
    embed.queueVector(v); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput({
      content: "The user prefers TypeScript over Python",
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Near-duplicate vector but contradicting content
    embed.queueVector(v); // second store: dedup query -> finds first, calls contradiction check
    // After supersede, the new memory goes through store() again:
    embed.queueVector(v); // supersede -> store() dedup query → reused for insert
    const second = await store.store(dedupInput({
      content: "The user dislikes TypeScript and prefers Python",
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).not.toBe(first.value.id);

    const old = await store.get(first.value.id);
    expect(old.ok).toBe(true);
    if (old.ok && old.value) {
      expect(old.value.status).toBe("superseded");
      expect(old.value.supersededBy).toBe(second.value.id);
    }
  });

  it("skips (no supersede) when LLM says consistent", async () => {
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider(["consistent"]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    const v = [1, 0, 0, 0];
    embed.queueVector(v); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput({
      content: "The user prefers TypeScript for backend",
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    embed.queueVector(v); // second store dedup query -> finds first, LLM says consistent -> skip
    const second = await store.store(dedupInput({
      content: "The user likes TypeScript for backend work",
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.value.id);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(1);
  });

  it("proceeds normally without provider (no contradiction check)", async () => {
    const embed = new ControlledEmbeddingProvider();
    const { store } = await createDedupDb(embed); // no provider

    const v = [1, 0, 0, 0];
    embed.queueVector(v); // first store: dedup query → reused for insert
    await store.store(dedupInput({ content: "User prefers TypeScript" }));

    // Near-duplicate: without provider, should skip (no contradiction check)
    embed.queueVector(v); // second store: dedup query -> matches -> skip
    const second = await store.store(dedupInput({ content: "User likes TypeScript" }));
    expect(second.ok).toBe(true);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Threshold boundary tests — validate dedup/contradiction at specific cosine
// values to prevent threshold regressions.
//
// The ControlledEmbeddingProvider normalizes vectors to unit length, so
// cos(a,b) = dot(a,b). We craft 4D vector pairs at exact cosine targets.
// ---------------------------------------------------------------------------

/**
 * Build two 4D unit vectors with a target cosine similarity.
 * Returns [vecA, vecB]. Both are already normalized.
 *
 * Strategy: vecA = [1,0,0,0], vecB = [cos, sin, 0, 0] where sin = sqrt(1-cos²).
 * Since ControlledEmbeddingProvider normalizes, we can pass raw values.
 */
function vectorPairAtCosine(targetCos: number): [number[], number[]] {
  const sinVal = Math.sqrt(1 - targetCos * targetCos);
  return [
    [1, 0, 0, 0],
    [targetCos, sinVal, 0, 0],
  ];
}

describe("SqliteMemoryStore — threshold boundary tests", () => {

  it("Tier 2: contradicts at cosine 0.70 (below old 0.75 threshold)", async () => {
    const [vA, vB] = vectorPairAtCosine(0.70);
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider(["contradiction"]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    embed.queueVector(vA); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput({
      content: "The user lives in Paris",
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    embed.queueVector(vB); // second store: dedup query → cos 0.70 → LLM → contradiction
    embed.queueVector(vB); // supersede → store() dedup query → reused for insert
    const second = await store.store(dedupInput({
      content: "The user lives in Tokyo",
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).not.toBe(first.value.id);

    const old = await store.get(first.value.id);
    expect(old.ok).toBe(true);
    if (old.ok && old.value) {
      expect(old.value.status).toBe("superseded");
      expect(old.value.supersededBy).toBe(second.value.id);
    }

    const active = await store.list({ status: ["active"] });
    expect(active.ok).toBe(true);
    if (active.ok) expect(active.value.length).toBe(1);
  });

  it("Tier 2: consistent at cosine 0.70 stores both", async () => {
    const [vA, vB] = vectorPairAtCosine(0.70);
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider(["consistent"]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    embed.queueVector(vA); // first store: dedup query → reused for insert
    await store.store(dedupInput({ content: "The user lives in Copenhagen" }));

    embed.queueVector(vB); // cos 0.70 → LLM says consistent → action "none" → reused for insert
    const second = await store.store(dedupInput({
      content: "The user recently moved to Copenhagen",
    }));
    expect(second.ok).toBe(true);

    const all = await store.list({ status: ["active"] });
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(2);
  });

  it("below threshold: cosine 0.55 skips contradiction check entirely", async () => {
    const [vA, vB] = vectorPairAtCosine(0.55);
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider([]); // empty: will error if called
    const { store } = await createDedupDbWithProvider(embed, provider);

    embed.queueVector(vA); // first store: dedup query → reused for insert
    await store.store(dedupInput({ content: "The user's name is Alice" }));

    embed.queueVector(vB); // cos 0.55 < 0.60 → no LLM → action "none" → reused for insert
    const second = await store.store(dedupInput({
      content: "The user works at a startup",
    }));
    expect(second.ok).toBe(true);

    const all = await store.list({ status: ["active"] });
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(2);
  });

  it("Tier 2 boundary: cosine exactly at 0.60 triggers contradiction check", async () => {
    const [vA, vB] = vectorPairAtCosine(0.60);
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider(["contradiction"]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    embed.queueVector(vA); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput({ content: "User prefers dark mode" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    embed.queueVector(vB); // cos 0.60 → LLM → contradiction → supersede
    embed.queueVector(vB); // supersede → store() dedup query → reused for insert
    const second = await store.store(dedupInput({ content: "User prefers light mode" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).not.toBe(first.value.id);
    const old = await store.get(first.value.id);
    if (old.ok && old.value) {
      expect(old.value.status).toBe("superseded");
    }
  });

  it("Tier 1: cosine 0.93 dedup-skips without LLM when consistent", async () => {
    const [vA, vB] = vectorPairAtCosine(0.93);
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider(["consistent"]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    embed.queueVector(vA); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput({
      content: "The user prefers TypeScript for backend",
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    embed.queueVector(vB); // cos 0.93 → Tier 1 → LLM says consistent → skip (no insert)
    const second = await store.store(dedupInput({
      content: "The user likes TypeScript for backend work",
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.value.id);
  });

  it("Tier 1: cosine 0.93 supersedes on contradiction", async () => {
    const [vA, vB] = vectorPairAtCosine(0.93);
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider(["contradiction"]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    embed.queueVector(vA); // first store: dedup query → reused for insert
    const first = await store.store(dedupInput({ content: "User likes Python" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    embed.queueVector(vB); // cos 0.93 → Tier 1 → LLM → contradiction → supersede
    embed.queueVector(vB); // supersede → store() dedup query → reused for insert
    const second = await store.store(dedupInput({ content: "User dislikes Python" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).not.toBe(first.value.id);
    const old = await store.get(first.value.id);
    if (old.ok && old.value) {
      expect(old.value.status).toBe("superseded");
    }
  });

  it("gap zone: cosine 0.59 does NOT trigger contradiction check", async () => {
    const [vA, vB] = vectorPairAtCosine(0.59);
    const embed = new ControlledEmbeddingProvider();
    const provider = new MockProvider([]);
    const { store } = await createDedupDbWithProvider(embed, provider);

    embed.queueVector(vA); // first store: dedup query → reused for insert
    await store.store(dedupInput({ content: "User has 3 cats" }));

    embed.queueVector(vB); // cos 0.59 < 0.60 → no LLM → action "none" → reused for insert
    const second = await store.store(dedupInput({ content: "User has 5 dogs" }));
    expect(second.ok).toBe(true);

    const all = await store.list({ status: ["active"] });
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.value.length).toBe(2);
  });
});
