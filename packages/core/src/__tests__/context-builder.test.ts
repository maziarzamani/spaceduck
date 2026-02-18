import { describe, it, expect, beforeEach } from "bun:test";
import { DefaultContextBuilder, DEFAULT_TOKEN_BUDGET } from "../context-builder";
import { MockConversationStore, MockLongTermMemory } from "../__fixtures__/mock-memory";
import { MockProvider } from "../__fixtures__/mock-provider";
import { createMessage } from "../__fixtures__/messages";
import { ConsoleLogger } from "../types/logger";

describe("DefaultContextBuilder", () => {
  let store: MockConversationStore;
  let ltm: MockLongTermMemory;
  let builder: DefaultContextBuilder;

  beforeEach(() => {
    store = new MockConversationStore();
    ltm = new MockLongTermMemory();
    builder = new DefaultContextBuilder(store, ltm, new ConsoleLogger("error"));
  });

  it("should build context from conversation messages", async () => {
    await store.appendMessage("conv-1", createMessage({ content: "hello" }));
    await store.appendMessage("conv-1", createMessage({ role: "assistant", content: "hi there" }));

    const result = await builder.buildContext("conv-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("should include relevant facts from LTM", async () => {
    await ltm.remember({ conversationId: "conv-1", content: "user likes TypeScript" });
    await store.appendMessage("conv-1", createMessage({ content: "Tell me about TypeScript" }));

    const result = await builder.buildContext("conv-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const systemMessages = result.value.filter((m) => m.role === "system");
      expect(systemMessages.length).toBeGreaterThanOrEqual(1);
      expect(systemMessages[0].content).toContain("TypeScript");
    }
  });

  it("should work without LTM", async () => {
    const builderNoLtm = new DefaultContextBuilder(store, undefined, new ConsoleLogger("error"));
    await store.appendMessage("conv-1", createMessage({ content: "hello" }));

    const result = await builderNoLtm.buildContext("conv-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
    }
  });

  it("should return empty array for empty conversation", async () => {
    const result = await builder.buildContext("nonexistent");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("should prepend system prompt when configured", async () => {
    const builderWithPrompt = new DefaultContextBuilder(
      store,
      undefined,
      new ConsoleLogger("error"),
      "You are spaceduck, a helpful AI.",
    );
    await store.appendMessage("conv-1", createMessage({ content: "hello" }));

    const result = await builderWithPrompt.buildContext("conv-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
      expect(result.value[0].role).toBe("system");
      expect(result.value[0].content).toBe("You are spaceduck, a helpful AI.");
      expect(result.value[1].content).toBe("hello");
    }
  });

  it("should order context as: system prompt, facts, messages", async () => {
    const builderFull = new DefaultContextBuilder(
      store,
      ltm,
      new ConsoleLogger("error"),
      "You are spaceduck.",
    );
    await ltm.remember({ conversationId: "conv-1", content: "user likes Rust" });
    await store.appendMessage("conv-1", createMessage({ content: "Tell me about Rust" }));

    const result = await builderFull.buildContext("conv-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].content).toBe("You are spaceduck.");
      expect(result.value[1].content).toContain("Rust");
      expect(result.value[2].content).toBe("Tell me about Rust");
    }
  });

  describe("estimateTokens", () => {
    it("should estimate tokens from message content", () => {
      const messages = [
        createMessage({ content: "a".repeat(400) }), // ~100 tokens
      ];
      const estimate = builder.estimateTokens(messages);
      expect(estimate).toBeGreaterThan(90);
      expect(estimate).toBeLessThan(120);
    });
  });

  describe("needsCompaction", () => {
    it("should return false for small context", () => {
      const messages = [createMessage({ content: "hello" })];
      expect(builder.needsCompaction(messages, DEFAULT_TOKEN_BUDGET)).toBe(false);
    });

    it("should return true when context exceeds threshold", () => {
      // Create enough messages to exceed 85% of 200k tokens
      const bigContent = "x".repeat(800_000); // ~200k tokens
      const messages = [createMessage({ content: bigContent })];
      expect(builder.needsCompaction(messages, DEFAULT_TOKEN_BUDGET)).toBe(true);
    });
  });
});

// ── Pre-compaction memory flush tests ─────────────────────────────────────────

describe("DefaultContextBuilder — pre-compaction memory flush", () => {
  let store: MockConversationStore;
  let ltm: MockLongTermMemory;
  const logger = new ConsoleLogger("error");

  beforeEach(() => {
    store = new MockConversationStore();
    ltm = new MockLongTermMemory();
  });

  it("compact() stores flush facts with source=compaction-flush", async () => {
    // MockProvider returns a JSON array of facts
    const provider = new MockProvider([
      '["User prefers TypeScript for backend work", "User uses Bun runtime"]',
    ]);

    const builderWithLtm = new DefaultContextBuilder(store, ltm, logger);

    // Seed 15 messages so compaction triggers (threshold = 10)
    await store.create("conv-1");
    for (let i = 0; i < 15; i++) {
      await store.appendMessage(
        "conv-1",
        createMessage({ role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` }),
      );
    }

    await builderWithLtm.compact("conv-1", provider);

    const facts = await ltm.listAll("conv-1");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const flushFacts = facts.value.filter((f) => f.source === "compaction-flush");
    expect(flushFacts.length).toBeGreaterThan(0);
  });

  it("compact() flush facts have confidence in [0.6, 0.75] range", async () => {
    const provider = new MockProvider([
      '["User builds personal AI systems with TypeScript and SQLite"]',
    ]);
    const builderWithLtm = new DefaultContextBuilder(store, ltm, logger);

    await store.create("conv-1");
    for (let i = 0; i < 15; i++) {
      await store.appendMessage(
        "conv-1",
        createMessage({ role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` }),
      );
    }

    await builderWithLtm.compact("conv-1", provider);

    const facts = await ltm.listAll("conv-1");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const flushFacts = facts.value.filter((f) => f.source === "compaction-flush");
    for (const fact of flushFacts) {
      expect(fact.confidence).toBeGreaterThanOrEqual(0.6);
      expect(fact.confidence).toBeLessThanOrEqual(0.75);
    }
  });

  it("rate-limit: second compact() on same chunk does not double-store facts", async () => {
    const provider = new MockProvider([
      '["User prefers dark mode across all tools"]',
      // Second call returns a summary (not facts)
      "Summary of conversation.",
    ]);
    const builderWithLtm = new DefaultContextBuilder(store, ltm, logger);

    await store.create("conv-1");
    for (let i = 0; i < 15; i++) {
      await store.appendMessage(
        "conv-1",
        createMessage({ role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` }),
      );
    }

    // First compact — should flush
    await builderWithLtm.compact("conv-1", provider);
    const afterFirst = await ltm.listAll("conv-1");
    const countAfterFirst = afterFirst.ok ? afterFirst.value.length : 0;

    // Second compact with same messages — rate-limited, should not flush again
    await builderWithLtm.compact("conv-1", provider);
    const afterSecond = await ltm.listAll("conv-1");
    const countAfterSecond = afterSecond.ok ? afterSecond.value.length : 0;

    // SHA-256 dedup in remember() prevents exact duplicates so count stays the same
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("compact() works without LTM (no flush, no crash)", async () => {
    const provider = new MockProvider(["Summary text."]);
    const builderNoLtm = new DefaultContextBuilder(store, undefined, logger);

    await store.create("conv-1");
    for (let i = 0; i < 15; i++) {
      await store.appendMessage(
        "conv-1",
        createMessage({ content: `message ${i}` }),
      );
    }

    const result = await builderNoLtm.compact("conv-1", provider);
    expect(result.ok).toBe(true);
  });
});
