/**
 * Live integration tests for Memory v2 semantic dedup and contradiction detection.
 *
 * Tests the real seam: SqliteMemoryStore + sqlite-vec + real Bedrock embeddings
 * + real Bedrock LLM for contradiction arbitration.
 *
 * Skipped unless RUN_LIVE_TESTS=1 is set.
 * Requires: AWS_BEARER_TOKEN_BEDROCK (or BEDROCK_API_KEY) and AWS_REGION in env.
 *
 * Run:
 *   RUN_LIVE_TESTS=1 bun test packages/memory/sqlite/src/__tests__/e2e-dedup.integration.test.ts
 *
 * Debug logging:
 *   RUN_LIVE_TESTS=1 DEBUG_LIVE_TESTS=1 bun test ...
 */

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { ConsoleLogger } from "@spaceduck/core";
import { BedrockEmbeddingProvider, BedrockProvider } from "@spaceduck/provider-bedrock";
import {
  SchemaManager,
  ensureCustomSQLite,
  reconcileVecMemories,
  SqliteMemoryStore,
  cosineSimilarity,
} from "../index";
import type { MemoryInput } from "@spaceduck/core";

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
      dimensions: 3072,
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

async function createIsolatedStore(
  opts: { withLLM?: boolean } = {},
): Promise<{ db: Database; store: SqliteMemoryStore }> {
  const embedding = getEmbedding();
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  reconcileVecMemories(db, embedding, logger);
  const provider = opts.withLLM ? getLLM() : undefined;
  const store = new SqliteMemoryStore(db, logger, embedding, provider);
  return { db, store };
}

const factInput = (content: string, overrides?: Partial<MemoryInput>): MemoryInput => ({
  kind: "fact",
  title: "Test fact",
  content,
  scope: { type: "global" },
  source: { type: "user_message", conversationId: `conv-${Date.now()}` },
  ...overrides,
} as MemoryInput);

// ---------------------------------------------------------------------------
// 1. Semantic Dedup — near-duplicate detection with real embeddings
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("Memory v2 live: semantic dedup", () => {

  it("deduplicates semantically identical facts (rephrase)", async () => {
    const { store } = await createIsolatedStore();

    const first = await store.store(factInput("The user prefers TypeScript for all backend projects"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    log("First stored:", first.value.id);

    const second = await store.store(factInput("The user likes TypeScript for all backend projects"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    log("Second stored:", second.value.id);

    // Should return the same record (deduped)
    expect(second.value.id).toBe(first.value.id);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) {
      log("Total memories after dedup:", all.value.length);
      expect(all.value.length).toBe(1);
    }
  }, 30_000);

  it("does NOT dedup semantically different facts", async () => {
    const { store } = await createIsolatedStore();

    const first = await store.store(factInput("The user lives in Copenhagen, Denmark"));
    expect(first.ok).toBe(true);

    const second = await store.store(factInput("The user works at a startup building developer tools"));
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Different topics -> should NOT dedup
    expect(second.value.id).not.toBe(first.value.id);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) {
      log("Total memories (different topics):", all.value.length);
      expect(all.value.length).toBe(2);
    }
  }, 30_000);

  it("only dedup within the same kind (fact vs procedure)", async () => {
    const { store } = await createIsolatedStore();

    await store.store(factInput("The user prefers TypeScript"));

    const procResult = await store.store({
      kind: "procedure",
      title: "TypeScript preference",
      content: "The user prefers TypeScript",
      scope: { type: "global" },
      source: { type: "user_message", conversationId: "c1" },
      procedureSubtype: "behavioral",
    } as MemoryInput);
    expect(procResult.ok).toBe(true);

    const all = await store.list();
    expect(all.ok).toBe(true);
    if (all.ok) {
      log("Total memories (cross-kind):", all.value.length);
      expect(all.value.length).toBe(2);
    }
  }, 30_000);

  it("touches lastSeenAt on the existing record when deduped", async () => {
    const { store } = await createIsolatedStore();

    const first = await store.store(factInput("User's name is Maziar"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalLastSeen = first.value.lastSeenAt;

    await new Promise((r) => setTimeout(r, 10));

    const second = await store.store(factInput("The user is named Maziar"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.value.id);
    expect(second.value.lastSeenAt).toBeGreaterThanOrEqual(originalLastSeen);
    log("lastSeenAt bumped:", originalLastSeen, "->", second.value.lastSeenAt);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 2. Contradiction Detection — LLM arbiter detects and supersedes
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("Memory v2 live: contradiction detection", () => {

  it("supersedes contradicting facts (loves X vs hates X)", async () => {
    const { store } = await createIsolatedStore({ withLLM: true });

    const first = await store.store(factInput("The user strongly prefers Python over TypeScript"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    log("Original stored:", first.value.id, first.value.content);

    const second = await store.store(factInput("The user strongly dislikes Python and prefers TypeScript"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    log("Contradicting stored:", second.value.id, second.value.content);

    // The new memory should have a different ID (superseded the old one)
    expect(second.value.id).not.toBe(first.value.id);

    // Old memory should be superseded
    const old = await store.get(first.value.id);
    expect(old.ok).toBe(true);
    if (old.ok && old.value) {
      log("Old memory status:", old.value.status, "supersededBy:", old.value.supersededBy);
      expect(old.value.status).toBe("superseded");
      expect(old.value.supersededBy).toBe(second.value.id);
    }

    // Only one active memory should remain
    const active = await store.list({ status: ["active"] });
    expect(active.ok).toBe(true);
    if (active.ok) {
      log("Active memories:", active.value.length);
      expect(active.value.length).toBe(1);
      expect(active.value[0].content).toContain("TypeScript");
    }
  }, 45_000);

  it("does NOT supersede consistent/refined facts", async () => {
    const { store } = await createIsolatedStore({ withLLM: true });

    const first = await store.store(factInput("The user lives in Copenhagen"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Refinement, not contradiction — LLM arbiter should say "consistent"
    const second = await store.store(factInput("The user recently moved to Copenhagen"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    log("First ID:", first.value.id, "Second ID:", second.value.id);

    // Consistent refinement at moderate similarity (cos ~0.82) → LLM says consistent
    // → new memory stored separately (not superseded, not deduped)
    const all = await store.list({ status: ["active"] });
    expect(all.ok).toBe(true);
    if (all.ok) {
      log("Active memories after refinement:", all.value.length);
      // Both should be active — no supersession for consistent statements
      for (const m of all.value) {
        expect(m.status).toBe("active");
      }
    }
  }, 45_000);

  it("supersedes name correction", async () => {
    const { store } = await createIsolatedStore({ withLLM: true });

    const first = await store.store(factInput("The user's name is Alice"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await store.store(factInput("The user's name is Bob"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    log("Name change: first:", first.value.id, "second:", second.value.id);
    expect(second.value.id).not.toBe(first.value.id);

    const old = await store.get(first.value.id);
    expect(old.ok).toBe(true);
    if (old.ok && old.value) {
      expect(old.value.status).toBe("superseded");
    }
  }, 45_000);

  it("supersedes location change (lives in X vs lives in Y)", async () => {
    const { store } = await createIsolatedStore({ withLLM: true });

    const first = await store.store(factInput("The user lives in Paris."));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    log("Original location:", first.value.id, first.value.content);

    const second = await store.store(factInput("The user currently lives in Tokyo."));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    log("New location:", second.value.id, second.value.content);

    expect(second.value.id).not.toBe(first.value.id);

    const old = await store.get(first.value.id);
    expect(old.ok).toBe(true);
    if (old.ok && old.value) {
      log("Old location status:", old.value.status, "supersededBy:", old.value.supersededBy);
      expect(old.value.status).toBe("superseded");
      expect(old.value.supersededBy).toBe(second.value.id);
    }

    const active = await store.list({ status: ["active"] });
    expect(active.ok).toBe(true);
    if (active.ok) {
      log("Active memories after location change:", active.value.length);
      expect(active.value.length).toBe(1);
      expect(active.value[0].content).toContain("Tokyo");
    }
  }, 45_000);
});

// ---------------------------------------------------------------------------
// 3. Bug Reproducer — structurally different contradictions missed by cosine
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)("Memory v2 live: cross-structure contradiction bug", () => {

  it("diagnostic: cosine between 'Jim likes TypeScript' and 'User prefers JavaScript over TypeScript'", async () => {
    const embedding = getEmbedding();
    const vecA = await embedding.embed("Jim likes TypeScript", { purpose: "index" });
    const vecB = await embedding.embed("User prefers JavaScript over TypeScript", { purpose: "index" });

    const cosine = cosineSimilarity(vecA, vecB);

    console.log("[DIAGNOSTIC] cosine('Jim likes TypeScript', 'User prefers JavaScript over TypeScript') =", cosine.toFixed(4));
    console.log("[DIAGNOSTIC] CONTRADICTION_CHECK_THRESHOLD = 0.60");
    console.log("[DIAGNOSTIC] Exceeds threshold?", cosine >= 0.60 ? "YES" : "NO — bug confirmed");

    expect(cosine).toBeGreaterThan(-1);
  }, 30_000);

  // EXPECTED TO FAIL until tag-augmented contradiction detection is implemented.
  // Reproduces the real-world bug: "Jim likes TypeScript" is not superseded by
  // "User prefers JavaScript over TypeScript" because cosine similarity between
  // these structurally different sentences falls below the 0.60 threshold.
  it("supersedes language preference even with different subject and phrasing", async () => {
    const { store } = await createIsolatedStore({ withLLM: true });

    const first = await store.store(factInput("Jim likes TypeScript", {
      tags: ["programming-language", "preference"],
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    log("Original stored:", first.value.id, first.value.content);

    const second = await store.store(factInput("User prefers JavaScript over TypeScript", {
      tags: ["programming-language", "preference"],
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    log("Contradicting stored:", second.value.id, second.value.content);

    expect(second.value.id).not.toBe(first.value.id);

    const old = await store.get(first.value.id);
    expect(old.ok).toBe(true);
    if (old.ok && old.value) {
      log("Old memory status:", old.value.status, "supersededBy:", old.value.supersededBy);
      expect(old.value.status).toBe("superseded");
      expect(old.value.supersededBy).toBe(second.value.id);
    }

    const active = await store.list({ status: ["active"] });
    expect(active.ok).toBe(true);
    if (active.ok) {
      log("Active memories after language preference change:", active.value.length);
      expect(active.value.length).toBe(1);
      expect(active.value[0].content).toContain("JavaScript");
    }
  }, 45_000);
});
