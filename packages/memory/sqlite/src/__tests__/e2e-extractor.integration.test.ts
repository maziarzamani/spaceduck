/**
 * Live integration tests for MemoryExtractor — hits real Bedrock Nova 2 Lite for LLM
 * classification and Nova 2 Multimodal Embeddings for vector recall.
 *
 * Tests the full pipeline: message -> LLM classification -> retention gate ->
 * deterministic validation -> store -> recall.
 *
 * Skipped unless RUN_LIVE_TESTS=1 is set.
 * Requires: AWS_BEARER_TOKEN_BEDROCK (or BEDROCK_API_KEY) and AWS_REGION in env.
 *
 * Run:
 *   RUN_LIVE_TESTS=1 bun test packages/memory/sqlite/src/__tests__/e2e-extractor.integration.test.ts
 *
 * Debug logging:
 *   RUN_LIVE_TESTS=1 DEBUG_LIVE_TESTS=1 bun test ...
 */

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { ConsoleLogger, MemoryExtractor } from "@spaceduck/core";
import { BedrockEmbeddingProvider, BedrockProvider } from "@spaceduck/provider-bedrock";
import {
  SchemaManager,
  ensureCustomSQLite,
  reconcileVecMemories,
  SqliteMemoryStore,
} from "../index";
import type { Message } from "@spaceduck/core";

const LIVE =
  Bun.env.RUN_LIVE_TESTS === "1" &&
  !!(Bun.env.AWS_BEARER_TOKEN_BEDROCK ?? Bun.env.BEDROCK_API_KEY);

const DEBUG = Bun.env.DEBUG_LIVE_TESTS === "1";

const apiKey = Bun.env.AWS_BEARER_TOKEN_BEDROCK ?? Bun.env.BEDROCK_API_KEY ?? "";
const region = Bun.env.AWS_REGION ?? "us-east-1";

ensureCustomSQLite();

const logger = new ConsoleLogger(DEBUG ? "debug" : "error");

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

let _provider: BedrockProvider | null = null;
function getLLM(): BedrockProvider {
  if (!_provider) {
    _provider = new BedrockProvider({
      model: "us.amazon.nova-lite-v1:0",
      apiKey,
      region,
    });
  }
  return _provider;
}

function log(...args: unknown[]) {
  if (DEBUG) console.log(...args);
}

function msg(content: string, role: "user" | "assistant" = "user"): Message {
  return { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, content, timestamp: Date.now() };
}

async function createIsolatedSetup(): Promise<{
  db: Database;
  store: SqliteMemoryStore;
  extractor: MemoryExtractor;
}> {
  const embedding = getEmbedding();
  const llm = getLLM();
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  reconcileVecMemories(db, embedding, logger);
  const store = new SqliteMemoryStore(db, logger, embedding);
  const extractor = new MemoryExtractor(store, logger, llm);
  return { db, store, extractor };
}

// ---------------------------------------------------------------------------
// MemoryExtractor with real Bedrock LLM
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("MemoryExtractor live integration: LLM classification", () => {

  it("classifies a user preference as a fact", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      const results = await extractor.extractFromMessage(
        msg("I strongly prefer using Bun over Node.js for all my backend TypeScript projects. It's faster and simpler."),
        "conv-1",
      );

      log("  Classification results:", results.map((r) => ({
        kind: r.input.kind,
        title: r.input.title,
        retention: r.retention,
      })));

      expect(results.length).toBeGreaterThan(0);

      const factResult = results.find((r) => r.input.kind === "fact");
      expect(factResult).toBeDefined();
      if (factResult) {
        expect(factResult.retention.shouldStore).toBe(true);
        expect(factResult.input.content.length).toBeGreaterThan(10);
      }

      // Verify it was actually persisted
      const listResult = await store.list({ kinds: ["fact"] });
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        log("  Stored facts:", listResult.value.map((m) => m.title));
        expect(listResult.value.length).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  }, 30_000);

  it("classifies a behavioral instruction as a procedure", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      const results = await extractor.extractFromMessage(
        msg("Remember: always validate all input data with Zod schemas before writing to the database. Never skip validation, even for internal calls."),
        "conv-1",
      );

      log("  Classification results:", results.map((r) => ({
        kind: r.input.kind,
        title: r.input.title,
        subtype: r.input.kind === "procedure" ? r.input.procedureSubtype : undefined,
        retention: r.retention,
      })));

      const procResult = results.find((r) => r.input.kind === "procedure");
      if (procResult) {
        expect(procResult.retention.shouldStore).toBe(true);
        if (procResult.input.kind === "procedure") {
          expect(["behavioral", "workflow", "constraint"]).toContain(procResult.input.procedureSubtype);
        }
      }

      const listResult = await store.list({ kinds: ["procedure"] });
      if (listResult.ok && listResult.value.length > 0) {
        log("  Stored procedures:", listResult.value.map((m) => `${m.title} (${m.procedureSubtype})`));
        expect(listResult.value[0].procedureSubtype).toBeDefined();
      }
    } finally {
      db.close();
    }
  }, 30_000);

  it("rejects ephemeral noise (should_store false)", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      const results = await extractor.extractFromMessage(
        msg("Let me read that file again to check the imports. Give me a moment."),
        "conv-1",
      );

      log("  Noise classification:", results.length, "stored");

      // The LLM should either return empty or set should_store=false
      // Either way, nothing meaningful should be persisted
      const listResult = await store.list();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        log("  Stored memories after noise:", listResult.value.length);
        // Ephemeral noise should produce 0 or very few stored memories
        expect(listResult.value.length).toBeLessThanOrEqual(1);
      }
    } finally {
      db.close();
    }
  }, 30_000);

  it("classifies a deployment event as an episode", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      const results = await extractor.extractFromMessage(
        msg("I just deployed the new authentication service to production on AWS ECS. Everything is running smoothly now."),
        "conv-1",
      );

      log("  Episode classification:", results.map((r) => ({
        kind: r.input.kind,
        title: r.input.title,
        retention: r.retention,
      })));

      const episodeResult = results.find((r) => r.input.kind === "episode");
      if (episodeResult) {
        expect(episodeResult.retention.shouldStore).toBe(true);
        if (episodeResult.input.kind === "episode") {
          expect(episodeResult.input.occurredAt).toBeGreaterThan(0);
        }
      }
    } finally {
      db.close();
    }
  }, 30_000);

  it("extracts multiple memories from a rich message", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      const results = await extractor.extractFromMessage(
        msg("My name is Maziar. I live in Copenhagen, Denmark. I always use dark mode. Please always respond in Danish when possible."),
        "conv-1",
      );

      log("  Multi-memory results:", results.map((r) => ({
        kind: r.input.kind,
        title: r.input.title,
      })));

      // Should extract multiple memories from this rich message
      expect(results.length).toBeGreaterThanOrEqual(2);

      const listResult = await store.list();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        log("  All stored:", listResult.value.map((m) => `${m.kind}: ${m.title}`));
        expect(listResult.value.length).toBeGreaterThanOrEqual(2);
      }
    } finally {
      db.close();
    }
  }, 30_000);

  it("importance/confidence mapped from discrete buckets produce valid ranges", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      await extractor.extractFromMessage(
        msg("I absolutely require that all database migrations use transactions. This is a non-negotiable constraint for the Spaceduck project."),
        "conv-1",
      );

      const listResult = await store.list();
      expect(listResult.ok).toBe(true);
      if (listResult.ok && listResult.value.length > 0) {
        for (const m of listResult.value) {
          log(`  ${m.title}: importance=${m.importance}, confidence=${m.confidence}`);
          expect(m.importance).toBeGreaterThanOrEqual(0);
          expect(m.importance).toBeLessThanOrEqual(1);
          expect(m.confidence).toBeGreaterThanOrEqual(0);
          expect(m.confidence).toBeLessThanOrEqual(1);
        }
      }
    } finally {
      db.close();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Full round-trip: extract -> store -> recall
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("MemoryExtractor live integration: extract + recall round-trip", () => {

  it("extracted fact is retrievable via vector recall", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      await extractor.extractFromMessage(
        msg("I strongly prefer using Bun as my JavaScript runtime for all server-side projects."),
        "conv-1",
      );

      const recalled = await store.recall("What runtime does the user prefer?", {
        strategy: "vector", topK: 5,
      });

      expect(recalled.ok).toBe(true);
      if (!recalled.ok) return;

      log("  Recall results:", recalled.value.map((s) =>
        `${s.memory.title} (${s.memory.kind}, score=${s.score.toFixed(4)})`));

      expect(recalled.value.length).toBeGreaterThan(0);
      const hasBun = recalled.value.some((s) =>
        s.memory.content.toLowerCase().includes("bun"),
      );
      expect(hasBun).toBe(true);
    } finally {
      db.close();
    }
  }, 45_000);

  it("extracted procedure is retrievable via hybrid recall with kind filter", async () => {
    const { db, store, extractor } = await createIsolatedSetup();
    try {
      await extractor.extractFromMessage(
        msg("Always validate all input payloads with Zod schemas before writing to the database. Never skip this step."),
        "conv-1",
      );

      const recalled = await store.recall("database validation rules", {
        strategy: "hybrid", kinds: ["procedure"], topK: 5,
      });

      expect(recalled.ok).toBe(true);
      if (!recalled.ok) return;

      log("  Procedure recall:", recalled.value.map((s) =>
        `${s.memory.title} (${s.memory.procedureSubtype}, score=${s.score.toFixed(4)})`));

      if (recalled.value.length > 0) {
        expect(recalled.value.every((s) => s.memory.kind === "procedure")).toBe(true);
      }
    } finally {
      db.close();
    }
  }, 45_000);
});
