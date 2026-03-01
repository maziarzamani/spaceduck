/**
 * Live integration tests for DefaultContextBuilder with Memory v2.
 *
 * Verifies that the context builder correctly injects recalled memories
 * (facts, procedures, episodes) into the LLM prompt using real Bedrock
 * embeddings and a real SqliteMemoryStore.
 *
 * Skipped unless RUN_LIVE_TESTS=1 is set.
 * Requires: AWS_BEARER_TOKEN_BEDROCK (or BEDROCK_API_KEY) and AWS_REGION in env.
 *
 * Run:
 *   RUN_LIVE_TESTS=1 bun test packages/memory/sqlite/src/__tests__/e2e-context-builder.integration.test.ts
 *
 * Debug logging:
 *   RUN_LIVE_TESTS=1 DEBUG_LIVE_TESTS=1 bun test ...
 */

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { ConsoleLogger, DefaultContextBuilder } from "@spaceduck/core";
import { BedrockEmbeddingProvider } from "@spaceduck/provider-bedrock";
import {
  SchemaManager,
  ensureCustomSQLite,
  reconcileVecMemories,
  SqliteMemoryStore,
} from "../index";
import type { MemoryInput, Message } from "@spaceduck/core";
import { MockConversationStore } from "@spaceduck/core/src/__fixtures__/mock-memory";

const LIVE =
  Bun.env.RUN_LIVE_TESTS === "1" &&
  !!(Bun.env.AWS_BEARER_TOKEN_BEDROCK ?? Bun.env.BEDROCK_API_KEY);

const DEBUG = Bun.env.DEBUG_LIVE_TESTS === "1";

const apiKey = Bun.env.AWS_BEARER_TOKEN_BEDROCK ?? Bun.env.BEDROCK_API_KEY ?? "";
const region = Bun.env.AWS_REGION ?? "us-east-1";

ensureCustomSQLite();

const logger = new ConsoleLogger("error");

let _embedding: BedrockEmbeddingProvider | null = null;
function getEmbedding(): BedrockEmbeddingProvider {
  if (!_embedding) {
    _embedding = new BedrockEmbeddingProvider({
      model: "amazon.nova-2-multimodal-embeddings-v1:0",
      dimensions: 1024,
      apiKey,
      region,
    });
  }
  return _embedding;
}

function log(...args: unknown[]) {
  if (DEBUG) console.log(...args);
}

function msg(content: string, role: Message["role"] = "user"): Message {
  return {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

async function createIsolatedSetup() {
  const embedding = getEmbedding();
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  reconcileVecMemories(db, embedding, logger);

  const memoryStore = new SqliteMemoryStore(db, logger, embedding);
  const convStore = new MockConversationStore();
  return { db, memoryStore, convStore };
}

// ---------------------------------------------------------------------------
// E2E: Context builder with real Bedrock + SqliteMemoryStore
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("DefaultContextBuilder — Memory v2 live integration", () => {

  it("injects facts into context from real vector recall", async () => {
    const { memoryStore, convStore } = await createIsolatedSetup();

    await memoryStore.store({
      kind: "fact",
      title: "Language preference",
      content: "The user prefers TypeScript over JavaScript for all backend projects",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
    });

    await convStore.appendMessage("c1", msg("What programming language should I use for the backend?"));

    const builder = new DefaultContextBuilder(
      convStore, logger, undefined, memoryStore,
    );
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();
    expect(memoriesMsg!.content).toContain("Known facts about the user");
    expect(memoriesMsg!.content).toContain("TypeScript");
    log("Fact injection:", memoriesMsg!.content);
  });

  it("injects procedures with subtype tags from real recall", async () => {
    const { memoryStore, convStore } = await createIsolatedSetup();

    await memoryStore.store({
      kind: "procedure",
      procedureSubtype: "constraint",
      title: "PII guard",
      content: "Never include personally identifiable information in API responses",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
    });

    await memoryStore.store({
      kind: "procedure",
      procedureSubtype: "behavioral",
      title: "Tone",
      content: "Always respond in a concise and professional tone",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
    });

    await convStore.appendMessage("c1", msg("How should I handle user data in API responses?"));

    const builder = new DefaultContextBuilder(
      convStore, logger, undefined, memoryStore,
    );
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();
    expect(memoriesMsg!.content).toContain("Behavioral instructions and constraints");
    expect(memoriesMsg!.content).toContain("[constraint]");
    log("Procedure injection:", memoriesMsg!.content);
  });

  it("injects episodes with date annotation from real recall", async () => {
    const { memoryStore, convStore } = await createIsolatedSetup();

    await memoryStore.store({
      kind: "episode",
      title: "Production deployment",
      content: "Deployed the authentication service to production successfully",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
      occurredAt: new Date("2025-12-15").getTime(),
    });

    await convStore.appendMessage("c1", msg("What happened with the authentication deployment?"));

    const builder = new DefaultContextBuilder(
      convStore, logger, undefined, memoryStore,
    );
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();
    expect(memoriesMsg!.content).toContain("Relevant past events");
    expect(memoriesMsg!.content).toContain("authentication");
    expect(memoriesMsg!.content).toContain("2025-12-15");
    log("Episode injection:", memoriesMsg!.content);
  });

  it("injects all three kinds grouped into a single system message", async () => {
    const { memoryStore, convStore } = await createIsolatedSetup();

    const memories: MemoryInput[] = [
      {
        kind: "fact",
        title: "Runtime",
        content: "The user uses Bun runtime for all TypeScript projects",
        scope: { type: "global" },
        source: { type: "user_message", conversationId: "c1" },
      },
      {
        kind: "procedure",
        procedureSubtype: "workflow",
        title: "Lint workflow",
        content: "Always run the linter before committing code changes to the repository",
        scope: { type: "global" },
        source: { type: "user_message", conversationId: "c1" },
      },
      {
        kind: "episode",
        title: "Bun migration",
        content: "Migrated the entire project from Node.js to Bun runtime",
        scope: { type: "global" },
        source: { type: "user_message", conversationId: "c1" },
        occurredAt: new Date("2025-11-01").getTime(),
      },
    ];

    for (const m of memories) await memoryStore.store(m);

    await convStore.appendMessage("c1", msg(
      "Tell me about using Bun runtime, the linting workflow, and when we migrated",
    ));

    const builder = new DefaultContextBuilder(
      convStore, logger, "You are spaceduck.", memoryStore,
    );
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();

    const content = memoriesMsg!.content;
    expect(content).toContain("Known facts about the user");
    expect(content).toContain("Behavioral instructions and constraints");
    expect(content).toContain("Relevant past events");

    expect(result.value[0].id).toBe("system-prompt");
    expect(result.value[1].id).toMatch(/^memories-/);

    log("Full context injection:\n", content);
  });

  it("procedure subtype priority: constraint appears before behavioral in context", async () => {
    const { memoryStore, convStore } = await createIsolatedSetup();

    await memoryStore.store({
      kind: "procedure",
      procedureSubtype: "behavioral",
      title: "Friendly tone",
      content: "Always use a friendly and approachable tone when responding to questions",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
    });

    await memoryStore.store({
      kind: "procedure",
      procedureSubtype: "constraint",
      title: "Schema validation",
      content: "Always validate JSON schemas before saving data to the database",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
    });

    await memoryStore.store({
      kind: "procedure",
      procedureSubtype: "workflow",
      title: "Code review",
      content: "Always request a code review before merging pull requests",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
    });

    await convStore.appendMessage("c1", msg(
      "What are my rules for handling data validation, code review, and communication tone?",
    ));

    const builder = new DefaultContextBuilder(
      convStore, logger, undefined, memoryStore,
    );
    const result = await builder.buildContext("c1", { budgetOverrides: { maxProcedures: 3 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const memoriesMsg = result.value.find((m) => m.id.startsWith("memories-"));
    expect(memoriesMsg).toBeDefined();

    const lines = memoriesMsg!.content
      .split("\n")
      .filter((l) => l.startsWith("- ["));

    log("Procedure lines:", lines);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);

    const constraintIdx = lines.findIndex((l) => l.includes("[constraint]"));
    const behavioralIdx = lines.findIndex((l) => l.includes("[behavioral]"));
    if (constraintIdx >= 0 && behavioralIdx >= 0) {
      expect(constraintIdx).toBeLessThan(behavioralIdx);
    }
  });

  it("empty store produces no memories injection", async () => {
    const { memoryStore, convStore } = await createIsolatedSetup();

    await convStore.appendMessage("c1", msg("Hello world"));

    const builder = new DefaultContextBuilder(
      convStore, logger, undefined, memoryStore,
    );
    const result = await builder.buildContext("c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.find((m) => m.id.startsWith("memories-"))).toBeUndefined();
    expect(result.value.length).toBe(1);
  });
});
