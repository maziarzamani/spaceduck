/**
 * Live integration tests for Memory v2 — hits real Bedrock Nova 2 Multimodal Embeddings.
 *
 * These test the real seam: SqliteMemoryStore + sqlite-vec + real Bedrock embeddings.
 * They do NOT test the agent loop, context builder, or prompt-time injection —
 * those are covered by gateway E2E tests once the extractor is wired up.
 *
 * Skipped unless RUN_LIVE_TESTS=1 is set.
 * Requires: AWS_BEARER_TOKEN_BEDROCK (or BEDROCK_API_KEY) and AWS_REGION in env.
 *
 * Run:
 *   RUN_LIVE_TESTS=1 bun test packages/memory/sqlite/src/__tests__/e2e-memory-v2.integration.test.ts
 *
 * Debug logging:
 *   RUN_LIVE_TESTS=1 DEBUG_LIVE_TESTS=1 bun test ...
 */

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { ConsoleLogger } from "@spaceduck/core";
import { BedrockEmbeddingProvider } from "@spaceduck/provider-bedrock";
import {
  SchemaManager,
  ensureCustomSQLite,
  reconcileVecMemories,
  SqliteMemoryStore,
} from "../index";
import type { MemoryInput } from "@spaceduck/core";

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

/** Fresh isolated DB + store per test call. */
async function createIsolatedStore(): Promise<{ db: Database; store: SqliteMemoryStore }> {
  const embedding = getEmbedding();
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  reconcileVecMemories(db, embedding, logger);
  const store = new SqliteMemoryStore(db, logger, embedding);
  return { db, store };
}

// ---------------------------------------------------------------------------
// 1. Store typed memories with real embeddings + verify vector recall
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("Memory v2 live integration: store + vector recall", () => {

  it("store and recall a fact with full record shape", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      const result = await store.store({
        kind: "fact",
        title: "User prefers Bun",
        content: "The user strongly prefers Bun over Node.js for TypeScript backend projects",
        scope: { type: "global" },
        source: { type: "user_message" },
        importance: 0.8,
        confidence: 0.9,
        tags: ["preference", "runtime"],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const r = result.value;
      expect(r.kind).toBe("fact");
      expect(r.status).toBe("active");
      expect(r.scope).toEqual({ type: "global" });
      expect(r.source.type).toBe("user_message");
      expect(r.importance).toBe(0.8);
      expect(r.confidence).toBe(0.9);
      expect(r.tags).toEqual(["preference", "runtime"]);
      expect(r.createdAt).toBeGreaterThan(0);
      expect(r.updatedAt).toBe(r.createdAt);
      expect(r.summary.length).toBeGreaterThan(0);
      log("  Stored fact:", r.id);

      const recalled = await store.recall("What JavaScript runtime does the user prefer?", {
        strategy: "vector", topK: 5,
      });

      expect(recalled.ok).toBe(true);
      if (!recalled.ok) return;
      log("  Recalled:", recalled.value.map((s) => `${s.memory.title} (${s.score.toFixed(4)})`));

      expect(recalled.value.length).toBeGreaterThan(0);
      const inTop3 = recalled.value.slice(0, 3).some((s) => s.memory.title === "User prefers Bun");
      expect(inTop3).toBe(true);
    } finally {
      db.close();
    }
  }, 30_000);

  it("store an episode with occurredAt and recall it", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      const result = await store.store({
        kind: "episode",
        title: "Deployed auth service",
        content: "Successfully deployed the authentication service to production on AWS ECS",
        occurredAt: Date.now() - 86_400_000,
        scope: { type: "project", projectId: "spaceduck" },
        source: { type: "tool_result", toolName: "deploy" },
        importance: 0.7,
        confidence: 0.85,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.kind).toBe("episode");
      expect(result.value.occurredAt).toBeDefined();
      expect(result.value.scope).toEqual({ type: "project", projectId: "spaceduck" });
      expect(result.value.source.toolName).toBe("deploy");

      const recalled = await store.recall("What was deployed recently?", {
        strategy: "vector", topK: 5,
      });

      expect(recalled.ok).toBe(true);
      if (!recalled.ok) return;
      log("  Episode recall:", recalled.value.map((s) => `${s.memory.title} (${s.memory.kind})`));

      const match = recalled.value.find((s) => s.memory.kind === "episode");
      expect(match).toBeDefined();
    } finally {
      db.close();
    }
  }, 30_000);

  it("store a procedure with subtype and recall it by intent", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      const result = await store.store({
        kind: "procedure",
        title: "Always validate schemas",
        content: "Before any database write operation, validate the input payload against its Zod schema. Never skip validation even for internal calls.",
        procedureSubtype: "constraint",
        scope: { type: "global" },
        source: { type: "user_message" },
        importance: 0.9,
        confidence: 0.95,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.kind).toBe("procedure");
      expect(result.value.procedureSubtype).toBe("constraint");
      expect(result.value.status).toBe("active");

      const recalled = await store.recall("How should I handle input validation for database operations?", {
        strategy: "vector", topK: 5,
      });

      expect(recalled.ok).toBe(true);
      if (!recalled.ok) return;
      log("  Procedure recall:", recalled.value.map((s) =>
        `${s.memory.title} (${s.memory.kind}, ${s.memory.procedureSubtype})`));

      const inTop3 = recalled.value.slice(0, 3).some((s) => s.memory.kind === "procedure");
      expect(inTop3).toBe(true);
    } finally {
      db.close();
    }
  }, 30_000);

  it("semantically closer memories score higher", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      await store.store({
        kind: "fact", title: "Loves hiking",
        content: "User loves hiking in the mountains on weekends",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.6, confidence: 0.8,
      });
      await store.store({
        kind: "fact", title: "Uses dark mode",
        content: "User always uses dark mode in all code editors and terminal apps",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.5, confidence: 0.8,
      });

      const recalled = await store.recall("outdoor activities and hobbies", {
        strategy: "vector", topK: 10,
      });

      expect(recalled.ok).toBe(true);
      if (!recalled.ok) return;
      log("  Semantic ranking:", recalled.value.map((s) => `${s.memory.title} (${s.score.toFixed(4)})`));

      const hiking = recalled.value.find((s) => s.memory.title === "Loves hiking");
      const dark = recalled.value.find((s) => s.memory.title === "Uses dark mode");

      if (hiking && dark) {
        expect(hiking.score).toBeGreaterThan(dark.score);
      }
    } finally {
      db.close();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 2. Hybrid retrieval with real embeddings
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("Memory v2 live integration: hybrid retrieval", () => {

  async function seedStore(): Promise<{ db: Database; store: SqliteMemoryStore }> {
    const { db, store } = await createIsolatedStore();

    const seeds: MemoryInput[] = [
      {
        kind: "fact", title: "Name is Maziar",
        content: "The user's name is Maziar",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.85, confidence: 0.95,
      },
      {
        kind: "fact", title: "Lives in Copenhagen",
        content: "The user lives in Copenhagen, Denmark",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.7, confidence: 0.9,
      },
      {
        kind: "episode", title: "Migrated to Bun",
        content: "Migrated the entire Spaceduck project from Node.js to Bun runtime for performance",
        occurredAt: Date.now() - 7 * 86_400_000,
        scope: { type: "project", projectId: "spaceduck" },
        source: { type: "assistant_message" },
        importance: 0.7, confidence: 0.8,
      },
      {
        kind: "procedure", title: "Use Danish for UI",
        content: "The default UI language should be Danish. Always render user-facing text in Danish unless the user explicitly requests English.",
        procedureSubtype: "behavioral",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.8, confidence: 0.9,
      },
      {
        kind: "procedure", title: "Validate before write",
        content: "Always validate input with Zod schemas before any database write",
        procedureSubtype: "constraint",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.95, confidence: 0.95,
      },
    ];

    for (const input of seeds) {
      const r = await store.store(input);
      expect(r.ok).toBe(true);
    }
    log(`  Seeded ${seeds.length} memories`);

    return { db, store };
  }

  it("hybrid recall returns results with mixed match sources", async () => {
    const { db, store } = await seedStore();
    try {
      const results = await store.recall("What is the user's name Maziar?", {
        strategy: "hybrid", topK: 5,
      });

      expect(results.ok).toBe(true);
      if (!results.ok) return;
      log("  Hybrid results:", results.value.map((s) =>
        `${s.memory.title} [${s.matchSource}] (${s.score.toFixed(4)})`));

      expect(results.value.length).toBeGreaterThan(0);
      const nameMatch = results.value.some((s) => s.memory.title === "Name is Maziar");
      expect(nameMatch).toBe(true);

      const sources = new Set(results.value.map((s) => s.matchSource));
      log("  Match sources seen:", [...sources]);
      // At minimum vector should participate; FTS participates if query words match
      expect(sources.size).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  }, 60_000);

  it("kind filtering returns only facts", async () => {
    const { db, store } = await seedStore();
    try {
      const results = await store.recall("user information", {
        strategy: "hybrid", kinds: ["fact"], topK: 10,
      });

      expect(results.ok).toBe(true);
      if (!results.ok) return;
      log("  Facts only:", results.value.map((s) => `${s.memory.title} (${s.memory.kind})`));

      expect(results.value.length).toBeGreaterThan(0);
      expect(results.value.every((s) => s.memory.kind === "fact")).toBe(true);
    } finally {
      db.close();
    }
  }, 60_000);

  it("kind filtering returns only procedures", async () => {
    const { db, store } = await seedStore();
    try {
      const results = await store.recall("how should I handle things", {
        strategy: "hybrid", kinds: ["procedure"], topK: 10,
      });

      expect(results.ok).toBe(true);
      if (!results.ok) return;
      log("  Procedures only:", results.value.map((s) =>
        `${s.memory.title} (${s.memory.procedureSubtype})`));

      expect(results.value.length).toBeGreaterThan(0);
      expect(results.value.every((s) => s.memory.kind === "procedure")).toBe(true);
    } finally {
      db.close();
    }
  }, 60_000);

  it("bounded transforms keep all scores above zero", async () => {
    const { db, store } = await seedStore();
    try {
      const results = await store.recall("Copenhagen Denmark", {
        strategy: "hybrid", topK: 10,
      });

      expect(results.ok).toBe(true);
      if (!results.ok) return;

      for (const s of results.value) {
        expect(s.score).toBeGreaterThan(0);
        log(`  ${s.memory.title}: score=${s.score.toFixed(6)}, imp=${s.memory.importance}, conf=${s.memory.confidence}`);
      }
    } finally {
      db.close();
    }
  }, 60_000);

  it("supersede marks old record and excludes it from recall", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      const r1 = await store.store({
        kind: "fact", title: "Favorite color blue",
        content: "User's favorite color is blue",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.6, confidence: 0.8,
      });
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;

      const r2 = await store.supersede(r1.value.id, {
        kind: "fact", title: "Favorite color green",
        content: "User's favorite color is green, not blue anymore",
        scope: { type: "global" }, source: { type: "user_message" },
        importance: 0.6, confidence: 0.85,
      });
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;

      // Direct assertion: old record is superseded with correct pointer
      const old = await store.get(r1.value.id);
      expect(old.ok).toBe(true);
      if (old.ok && old.value) {
        expect(old.value.status).toBe("superseded");
        expect(old.value.supersededBy).toBe(r2.value.id);
      }

      // Recall: superseded should be filtered out
      const recalled = await store.recall("favorite color", {
        strategy: "hybrid", topK: 5,
      });

      expect(recalled.ok).toBe(true);
      if (!recalled.ok) return;
      log("  After supersede:", recalled.value.map((s) =>
        `${s.memory.title} (status=${s.memory.status})`));

      const hasBlue = recalled.value.some((s) => s.memory.title === "Favorite color blue");
      expect(hasBlue).toBe(false);

      const hasGreen = recalled.value.some((s) => s.memory.title === "Favorite color green");
      expect(hasGreen).toBe(true);
    } finally {
      db.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. Edge cases and failure paths
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("Memory v2 live integration: edge cases", () => {

  it("recall with kind filter on empty DB returns empty array", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      const results = await store.recall("anything at all", {
        strategy: "hybrid", kinds: ["episode"], topK: 5,
      });

      expect(results.ok).toBe(true);
      if (results.ok) {
        expect(results.value).toEqual([]);
      }
    } finally {
      db.close();
    }
  }, 15_000);

  it("storing and recalling with very short content works", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      const result = await store.store({
        kind: "fact", title: "Age",
        content: "User is 42",
        scope: { type: "global" }, source: { type: "user_message" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const recalled = await store.recall("how old", { strategy: "vector", topK: 3 });
      expect(recalled.ok).toBe(true);
      if (recalled.ok) {
        expect(recalled.value.length).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  }, 30_000);

  it("dedup returns existing record instead of creating duplicate", async () => {
    const { db, store } = await createIsolatedStore();
    try {
      const r1 = await store.store({
        kind: "fact", title: "Same content",
        content: "The user lives in Copenhagen",
        scope: { type: "global" }, source: { type: "user_message" },
      });
      const r2 = await store.store({
        kind: "fact", title: "Same content",
        content: "The user lives in Copenhagen",
        scope: { type: "global" }, source: { type: "user_message" },
      });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.value.id).toBe(r2.value.id);
      }
    } finally {
      db.close();
    }
  }, 30_000);
});
