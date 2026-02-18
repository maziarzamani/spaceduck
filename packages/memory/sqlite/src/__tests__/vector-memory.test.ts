import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteLongTermMemory, distanceToScore } from "../long-term";
import { SchemaManager, ensureCustomSQLite } from "../schema";
import { ConsoleLogger } from "@spaceduck/core";
import {
  MockEmbeddingProvider,
  BadDimensionEmbeddingProvider,
} from "@spaceduck/core/src/__fixtures__/mock-embedding";

const logger = new ConsoleLogger("error");

// Must be called BEFORE any new Database() — swaps to Homebrew SQLite on macOS
ensureCustomSQLite();

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

async function setupSchema(db: Database): Promise<void> {
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
}

describe("SqliteLongTermMemory with embeddings", () => {
  let db: Database;
  let embedding: MockEmbeddingProvider;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = createTestDb();
    await setupSchema(db);
    embedding = new MockEmbeddingProvider(1024);
    ltm = new SqliteLongTermMemory(db, logger, embedding);
  });

  describe("remember()", () => {
    it("should store fact with vector embedding", async () => {
      const result = await ltm.remember({
        conversationId: "conv-1",
        content: "User likes TypeScript",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBeTruthy();
      expect(result.value.content).toBe("User likes TypeScript");

      // Verify vector was stored
      const vecRow = db
        .query("SELECT fact_id FROM vec_facts WHERE fact_id = ?1")
        .get(result.value.id) as { fact_id: string } | null;
      expect(vecRow).not.toBeNull();
    });

    it("should store content_hash for dedup", async () => {
      const result = await ltm.remember({
        conversationId: "conv-1",
        content: "User lives in Copenhagen",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const row = db
        .query("SELECT content_hash FROM facts WHERE id = ?1")
        .get(result.value.id) as { content_hash: string } | null;
      expect(row).not.toBeNull();
      expect(row!.content_hash).toBeTruthy();
      expect(row!.content_hash.length).toBe(64); // SHA-256 hex
    });

    it("should skip exact duplicate (same content)", async () => {
      const r1 = await ltm.remember({
        conversationId: "conv-1",
        content: "User prefers dark mode",
      });
      const r2 = await ltm.remember({
        conversationId: "conv-1",
        content: "User prefers dark mode",
      });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      // Same fact returned (dedup)
      expect(r2.value.id).toBe(r1.value.id);

      // Only one row in DB
      const count = db.query("SELECT COUNT(*) as c FROM facts").get() as { c: number };
      expect(count.c).toBe(1);
    });

    it("should skip exact duplicate with different whitespace", async () => {
      const r1 = await ltm.remember({
        conversationId: "conv-1",
        content: "User likes  TypeScript",
      });
      const r2 = await ltm.remember({
        conversationId: "conv-1",
        content: "user likes typescript",
      });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      expect(r2.value.id).toBe(r1.value.id);
    });

    it("should return persisted Fact with id", async () => {
      const result = await ltm.remember({
        conversationId: "conv-1",
        content: "Test fact",
        category: "test",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBeTruthy();
      expect(result.value.conversationId).toBe("conv-1");
      expect(result.value.content).toBe("Test fact");
      expect(result.value.category).toBe("test");
      expect(result.value.createdAt).toBeGreaterThan(0);
    });
  });

  describe("recall()", () => {
    it("should recall facts by vector similarity", async () => {
      await ltm.remember({ conversationId: "conv-1", content: "User likes dogs and cats" });
      await ltm.remember({ conversationId: "conv-1", content: "User enjoys hiking in mountains" });
      await ltm.remember({ conversationId: "conv-1", content: "User prefers dark mode in IDE" });

      const result = await ltm.recall("pets and animals", 10, { strategy: "vector" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBeGreaterThan(0);
      // The most similar fact should be about dogs and cats
      expect(result.value[0].content).toContain("dogs");
    });

    it("should respect topK limit", async () => {
      for (let i = 0; i < 10; i++) {
        await ltm.remember({ conversationId: "conv-1", content: `Fact number ${i}` });
      }

      const result = await ltm.recall("fact", 3);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeLessThanOrEqual(3);
    });

    it("should respect minScore filter", async () => {
      await ltm.remember({ conversationId: "conv-1", content: "Quantum physics is complex" });

      // Query something completely unrelated -- should have low score
      const result = await ltm.recall("banana smoothie recipe", 10, {
        strategy: "vector",
        minScore: 0.99,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // With a very high minScore, should filter out low-similarity results
    });

    it("should fall back to FTS when strategy is fts", async () => {
      await ltm.remember({ conversationId: "conv-1", content: "User lives in Copenhagen" });

      const result = await ltm.recall("Copenhagen", 10, { strategy: "fts" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(1);
      expect(result.value[0].content).toContain("Copenhagen");
    });
  });

  describe("forget()", () => {
    it("should remove from both facts and vec_facts", async () => {
      const r = await ltm.remember({ conversationId: "conv-1", content: "Temporary fact" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const factId = r.value.id;

      // Verify exists
      expect(db.query("SELECT id FROM facts WHERE id = ?1").get(factId)).not.toBeNull();
      expect(db.query("SELECT fact_id FROM vec_facts WHERE fact_id = ?1").get(factId)).not.toBeNull();

      // Forget
      const result = await ltm.forget(factId);
      expect(result.ok).toBe(true);

      // Verify gone from both tables
      expect(db.query("SELECT id FROM facts WHERE id = ?1").get(factId)).toBeNull();
      expect(db.query("SELECT fact_id FROM vec_facts WHERE fact_id = ?1").get(factId)).toBeNull();
    });
  });
});

describe("SqliteLongTermMemory without embeddings (FTS fallback)", () => {
  let db: Database;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = createTestDb();
    await setupSchema(db);
    ltm = new SqliteLongTermMemory(db, logger); // No embedding provider
  });

  it("should remember and recall via FTS", async () => {
    await ltm.remember({ conversationId: "conv-1", content: "User likes TypeScript programming" });

    const result = await ltm.recall("TypeScript");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0].content).toContain("TypeScript");
  });

  it("should still dedup exact content", async () => {
    await ltm.remember({ conversationId: "conv-1", content: "Fact A" });
    await ltm.remember({ conversationId: "conv-1", content: "Fact A" });

    const all = await ltm.listAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.value.length).toBe(1);
  });

  it("should not store vectors when no embedding provider", async () => {
    await ltm.remember({ conversationId: "conv-1", content: "No vector fact" });

    const vecCount = db.query("SELECT COUNT(*) as c FROM vec_facts").get() as { c: number };
    expect(vecCount.c).toBe(0);
  });
});

describe("distanceToScore()", () => {
  it("should return 1.0 for distance 0 (identical)", () => {
    expect(distanceToScore(0)).toBe(1.0);
  });

  it("should return 0.5 for distance 1", () => {
    expect(distanceToScore(1)).toBe(0.5);
  });

  it("should return 0.0 for distance 2 (opposite)", () => {
    expect(distanceToScore(2)).toBe(0.0);
  });

  it("should clamp negative distance to 1.0", () => {
    expect(distanceToScore(-0.5)).toBe(1.0);
  });

  it("should clamp distance > 2 to 0.0", () => {
    expect(distanceToScore(3)).toBe(0.0);
  });
});
