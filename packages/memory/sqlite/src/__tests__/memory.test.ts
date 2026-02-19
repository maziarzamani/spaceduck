import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { ConsoleLogger } from "@spaceduck/core";
import { SchemaManager, ensureCustomSQLite } from "../schema";
import { SqliteConversationStore } from "../store";
import { SqliteLongTermMemory } from "../long-term";
import { SqliteSessionManager } from "../session-store";
import type { Message } from "@spaceduck/core";

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

  it("should be idempotent and reach version 9", async () => {
    const db = createTestDb();
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();
    await schema.migrate(); // Should not throw

    const row = db.query("SELECT MAX(version) as version FROM schema_version").get() as {
      version: number;
    };
    expect(row.version).toBe(9);

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
