import { describe, it, expect, beforeEach } from "bun:test";
import { DefaultContextBuilder, DEFAULT_TOKEN_BUDGET, prioritizeProcedures } from "../context-builder";
import { MockConversationStore, MockMemoryStore } from "../__fixtures__/mock-memory";
import { createMessage } from "../__fixtures__/messages";
import { ConsoleLogger } from "../types/logger";
import type { ScoredMemory, MemoryRecord, MemorySource } from "../types";

describe("DefaultContextBuilder", () => {
  let store: MockConversationStore;
  let builder: DefaultContextBuilder;

  beforeEach(() => {
    store = new MockConversationStore();
    builder = new DefaultContextBuilder(store, new ConsoleLogger("error"));
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

  it("should work without a system prompt", async () => {
    const builderNoPrompt = new DefaultContextBuilder(store, new ConsoleLogger("error"));
    await store.appendMessage("conv-1", createMessage({ content: "hello" }));

    const result = await builderNoPrompt.buildContext("conv-1");

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

// ── Helper: build a ScoredMemory from partial overrides ──────────────────────

const defaultSource: MemorySource = { type: "user_message", conversationId: "c1" };

function scored(overrides: Partial<MemoryRecord> & { score?: number }): ScoredMemory {
  const { score = 0.8, ...memOverrides } = overrides;
  const memory: MemoryRecord = {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    kind: "fact",
    title: "untitled",
    content: "test content",
    summary: "test",
    scope: { type: "global" },
    entityRefs: [],
    source: defaultSource,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastSeenAt: Date.now(),
    importance: 0.5,
    confidence: 0.7,
    status: "active",
    tags: [],
    ...memOverrides,
  };
  return { memory, score, matchSource: "hybrid" };
}

// ── prioritizeProcedures ─────────────────────────────────────────────────────

describe("prioritizeProcedures", () => {
  it("orders constraint > workflow > behavioral", () => {
    const procs = [
      scored({ kind: "procedure", procedureSubtype: "behavioral", content: "use friendly tone", score: 0.9 }),
      scored({ kind: "procedure", procedureSubtype: "constraint", content: "never expose PII", score: 0.5 }),
      scored({ kind: "procedure", procedureSubtype: "workflow", content: "run lint before commit", score: 0.7 }),
    ];
    const result = prioritizeProcedures(procs, 3);
    expect(result.map((r) => r.memory.procedureSubtype)).toEqual([
      "constraint",
      "workflow",
      "behavioral",
    ]);
  });

  it("caps at max even when more procedures are available", () => {
    const procs = [
      scored({ kind: "procedure", procedureSubtype: "constraint", content: "a" }),
      scored({ kind: "procedure", procedureSubtype: "constraint", content: "b" }),
      scored({ kind: "procedure", procedureSubtype: "workflow", content: "c" }),
      scored({ kind: "procedure", procedureSubtype: "behavioral", content: "d" }),
    ];
    const result = prioritizeProcedures(procs, 2);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.memory.procedureSubtype === "constraint")).toBe(true);
  });

  it("preserves score order within the same subtype", () => {
    const procs = [
      scored({ kind: "procedure", procedureSubtype: "workflow", content: "low", score: 0.2 }),
      scored({ kind: "procedure", procedureSubtype: "workflow", content: "high", score: 0.9 }),
    ];
    const result = prioritizeProcedures(procs, 3);
    expect(result[0].memory.content).toBe("high");
    expect(result[1].memory.content).toBe("low");
  });

  it("returns empty array for empty input", () => {
    expect(prioritizeProcedures([], 5)).toEqual([]);
  });
});

// ── Memory v2 context injection ──────────────────────────────────────────────

describe("DefaultContextBuilder — Memory v2 context injection", () => {
  let convStore: MockConversationStore;
  let memStore: MockMemoryStore;
  const logger = new ConsoleLogger("error");

  beforeEach(() => {
    convStore = new MockConversationStore();
    memStore = new MockMemoryStore();
  });

  it("injects facts from MemoryStore when v2 is provided", async () => {
    await memStore.store({
      kind: "fact",
      title: "TypeScript preference",
      content: "The user prefers TypeScript for backend work",
      scope: { type: "global" },
      source: defaultSource,
    });

    await convStore.appendMessage("c1", createMessage({ content: "Tell me about TypeScript" }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);
    const result = await builder.buildContext("c1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sysMessages = result.value.filter((m) => m.role === "system");
    expect(sysMessages.length).toBeGreaterThanOrEqual(1);
    const memoriesMsg = sysMessages.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();
    expect(memoriesMsg!.content).toContain("Known facts about the user");
    expect(memoriesMsg!.content).toContain("TypeScript");
  });

  it("injects procedures with subtype tags", async () => {
    await memStore.store({
      kind: "procedure",
      procedureSubtype: "constraint",
      title: "PII constraint",
      content: "Never expose PII in responses",
      scope: { type: "global" },
      source: defaultSource,
    });

    await convStore.appendMessage("c1", createMessage({ content: "How do I expose data safely?" }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);
    const result = await builder.buildContext("c1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();
    expect(memoriesMsg!.content).toContain("Behavioral instructions and constraints");
    expect(memoriesMsg!.content).toContain("[constraint]");
    expect(memoriesMsg!.content).toContain("Never expose PII");
  });

  it("injects episodes with date annotation", async () => {
    const occurredAt = new Date("2025-12-15").getTime();
    await memStore.store({
      kind: "episode",
      title: "Deployed to prod",
      content: "Deployed the new auth service to production",
      scope: { type: "global" },
      source: defaultSource,
      occurredAt,
    });

    await convStore.appendMessage("c1", createMessage({ content: "What happened with the auth service deployment?" }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);
    const result = await builder.buildContext("c1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();
    expect(memoriesMsg!.content).toContain("Relevant past events");
    expect(memoriesMsg!.content).toContain("auth service");
    expect(memoriesMsg!.content).toContain("2025-12-15");
  });

  it("groups all three kinds into a single system message", async () => {
    await memStore.store({
      kind: "fact",
      title: "Language",
      content: "The user speaks Danish and English",
      scope: { type: "global" },
      source: defaultSource,
    });
    await memStore.store({
      kind: "procedure",
      procedureSubtype: "behavioral",
      title: "Tone",
      content: "Always respond in a friendly tone",
      scope: { type: "global" },
      source: defaultSource,
    });
    await memStore.store({
      kind: "episode",
      title: "Setup",
      content: "User set up the project with Bun runtime",
      scope: { type: "global" },
      source: defaultSource,
      occurredAt: Date.now(),
    });

    await convStore.appendMessage("c1", createMessage({
      content: "Tell me about the project setup with Bun and how to respond",
    }));

    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();
    expect(memoriesMsg!.content).toContain("Known facts about the user");
    expect(memoriesMsg!.content).toContain("Behavioral instructions and constraints");
    expect(memoriesMsg!.content).toContain("Relevant past events");
  });

  it("does not inject memories when no matches found", async () => {
    await convStore.appendMessage("c1", createMessage({ content: "hello" }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.find((m) => m.id.startsWith("memories-"))).toBeUndefined();
  });

  it("respects maxProcedures budget and subtype priority", async () => {
    await memStore.store({
      kind: "procedure", procedureSubtype: "behavioral",
      title: "A", content: "behavioral instruction about tone",
      scope: { type: "global" }, source: defaultSource,
    });
    await memStore.store({
      kind: "procedure", procedureSubtype: "constraint",
      title: "B", content: "constraint about security validation",
      scope: { type: "global" }, source: defaultSource,
    });
    await memStore.store({
      kind: "procedure", procedureSubtype: "workflow",
      title: "C", content: "workflow about deployment validation",
      scope: { type: "global" }, source: defaultSource,
    });
    await memStore.store({
      kind: "procedure", procedureSubtype: "behavioral",
      title: "D", content: "behavioral instruction about formatting validation",
      scope: { type: "global" }, source: defaultSource,
    });

    await convStore.appendMessage("c1", createMessage({
      content: "How should I handle validation in tone and formatting for security in deployment?",
    }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);
    const result = await builder.buildContext("c1", { budgetOverrides: { maxProcedures: 2 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();

    const lines = memoriesMsg!.content.split("\n").filter((l) => l.startsWith("- ["));
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0]).toContain("[constraint]");
  });

  it("orders context as: system prompt, memories, messages", async () => {
    await memStore.store({
      kind: "fact",
      title: "Bun",
      content: "User uses Bun runtime for all projects",
      scope: { type: "global" },
      source: defaultSource,
    });

    await convStore.appendMessage("c1", createMessage({ content: "How do I use Bun?" }));

    const builder = new DefaultContextBuilder(
      convStore, logger,
      "You are spaceduck.", memStore,
    );
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value[0].id).toBe("system-prompt");
    expect(result.value[1].id).toMatch(/^memories-/);
    expect(result.value[2].content).toBe("How do I use Bun?");
  });

  it("threads memoryRecallOptions to exclude task memories", async () => {
    await memStore.store({
      kind: "fact",
      title: "User fact",
      content: "User prefers TypeScript for projects",
      scope: { type: "global" },
      source: defaultSource,
    });
    await memStore.store({
      kind: "fact",
      title: "Task fact",
      content: "API pricing changed for TypeScript SDK",
      scope: { type: "global" },
      source: { type: "system", taskId: "task-123" },
    });

    await convStore.appendMessage("c1", createMessage({ content: "Tell me about TypeScript" }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);

    const withAll = await builder.buildContext("c1");
    expect(withAll.ok).toBe(true);
    if (!withAll.ok) return;
    const memMsg = withAll.value.find((m) => m.id.startsWith("memories-"));
    expect(memMsg?.content).toContain("TypeScript");
    expect(memMsg?.content).toContain("API pricing");

    const filtered = await builder.buildContext("c1", {
      memoryRecallOptions: { excludeTaskMemories: true },
    });
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    const filteredMem = filtered.value.find((m) => m.id.startsWith("memories-"));
    expect(filteredMem?.content).toContain("TypeScript");
    expect(filteredMem?.content).not.toContain("API pricing");
  });

  it("threads memoryRecallOptions sourceTaskId filter", async () => {
    await memStore.store({
      kind: "fact",
      title: "Task A fact",
      content: "Deploy result from TypeScript build",
      scope: { type: "global" },
      source: { type: "system", taskId: "task-A" },
    });
    await memStore.store({
      kind: "fact",
      title: "Task B fact",
      content: "Monitoring TypeScript service status",
      scope: { type: "global" },
      source: { type: "system", taskId: "task-B" },
    });

    await convStore.appendMessage("c1", createMessage({ content: "TypeScript" }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);

    const result = await builder.buildContext("c1", {
      memoryRecallOptions: { sourceTaskId: "task-A" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memMsg?.content).toContain("Deploy result");
    expect(memMsg?.content).not.toContain("Monitoring");
  });

  it("accepts budgetOverrides in the new options object", async () => {
    for (let i = 0; i < 5; i++) {
      await memStore.store({
        kind: "procedure",
        title: `Proc ${i}`,
        content: `Always validate user input rule ${i}`,
        scope: { type: "global" },
        source: defaultSource,
        procedureSubtype: "behavioral",
      });
    }

    await convStore.appendMessage("c1", createMessage({ content: "How should I validate user input?" }));
    const builder = new DefaultContextBuilder(convStore, logger, undefined, memStore);
    const result = await builder.buildContext("c1", { budgetOverrides: { maxProcedures: 2 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memMsg = result.value.find((m) => m.id.startsWith("memories-"));
    const lines = memMsg?.content?.split("\n").filter((l) => l.startsWith("- [behavioral]")) ?? [];
    expect(lines.length).toBe(2);
  });
});
