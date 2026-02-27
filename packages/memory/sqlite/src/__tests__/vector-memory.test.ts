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

// ── Slot superseding ────────────────────────────────────────────────────────

describe("Slot superseding (name change)", () => {
  let db: Database;
  let embedding: MockEmbeddingProvider;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = createTestDb();
    await setupSchema(db);
    embedding = new MockEmbeddingProvider(1024);
    ltm = new SqliteLongTermMemory(db, logger, embedding);
  });

  it("should deactivate old name when new name is stored", async () => {
    const r1 = await ltm.remember({
      conversationId: "conv-1",
      content: "User's name is Maziar",
      slot: "name",
      slotValue: "Maziar",
      lang: "da",
      source: "regex",
    });
    expect(r1.ok).toBe(true);

    const r2 = await ltm.remember({
      conversationId: "conv-1",
      content: "User's name is Jens",
      slot: "name",
      slotValue: "Jens",
      lang: "da",
      source: "regex",
    });
    expect(r2.ok).toBe(true);

    // Recall should only return Jens (Maziar deactivated)
    const recalled = await ltm.recall("name", 10, { strategy: "fts" });
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;

    const nameContents = recalled.value.map((f) => f.content);
    expect(nameContents).toContain("User's name is Jens");
    expect(nameContents).not.toContain("User's name is Maziar");
  });

  it("should keep both facts when slots are different", async () => {
    await ltm.remember({
      conversationId: "conv-1",
      content: "User's name is Maziar",
      slot: "name",
      slotValue: "Maziar",
      lang: "en",
      source: "regex",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User lives in Copenhagen",
      slot: "location",
      slotValue: "Copenhagen",
      lang: "en",
      source: "regex",
    });

    const all = await ltm.listAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    const active = all.value.filter((f) => f.isActive);
    expect(active).toHaveLength(2);
  });

  it("should handle three successive name changes", async () => {
    await ltm.remember({
      conversationId: "conv-1",
      content: "User's name is Alice",
      slot: "name", slotValue: "Alice", lang: "en", source: "regex",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User's name is Bob",
      slot: "name", slotValue: "Bob", lang: "en", source: "regex",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User's name is Charlie",
      slot: "name", slotValue: "Charlie", lang: "en", source: "regex",
    });

    const recalled = await ltm.recall("name", 10, { strategy: "fts" });
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;

    expect(recalled.value).toHaveLength(1);
    expect(recalled.value[0].content).toContain("Charlie");
    expect(recalled.value[0].isActive).toBe(true);

    // Verify the old ones are in DB but deactivated
    const allRows = db.query("SELECT content, is_active FROM facts ORDER BY created_at").all() as
      { content: string; is_active: number }[];
    expect(allRows).toHaveLength(3);
    expect(allRows[0].is_active).toBe(0); // Alice
    expect(allRows[1].is_active).toBe(0); // Bob
    expect(allRows[2].is_active).toBe(1); // Charlie
  });

  it("should not deactivate 'preference' or 'other' slots", async () => {
    await ltm.remember({
      conversationId: "conv-1",
      content: "User prefers dark mode",
      slot: "preference", slotValue: "dark mode", lang: "en", source: "regex",
    });
    await ltm.remember({
      conversationId: "conv-1",
      content: "User prefers TypeScript",
      slot: "preference", slotValue: "TypeScript", lang: "en", source: "regex",
    });

    const all = await ltm.listAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    const active = all.value.filter((f) => f.isActive);
    expect(active).toHaveLength(2);
  });
});

// ── Full integration: FactExtractor → SqliteLongTermMemory ──────────────────

describe("FactExtractor + SqliteLongTermMemory integration", () => {
  let db: Database;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = createTestDb();
    await setupSchema(db);
    ltm = new SqliteLongTermMemory(db, logger);
  });

  it("should extract name via regex and supersede on change", async () => {
    const { FactExtractor } = await import("@spaceduck/core/src/fact-extractor");
    const { SimpleEventBus } = await import("@spaceduck/core");
    const bus = new SimpleEventBus(logger);
    const extractor = new FactExtractor(ltm, logger);
    extractor.register(bus);

    // User says their name is Maziar
    await bus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: { id: "m1", role: "user", content: "Jeg hedder Maziar", timestamp: Date.now() },
      durationMs: 10,
    });

    // Verify name=Maziar was stored
    let facts = await ltm.listAll();
    expect(facts.ok).toBe(true);
    const maziarFact = facts.ok ? facts.value.find((f) => f.slot === "name") : undefined;
    expect(maziarFact).toBeTruthy();
    expect(maziarFact!.slotValue).toBe("Maziar");
    expect(maziarFact!.isActive).toBe(true);

    // User changes their name to Jens
    await bus.emitAsync("message:response", {
      conversationId: "conv-2",
      message: { id: "m2", role: "user", content: "Jeg hedder Jens", timestamp: Date.now() },
      durationMs: 10,
    });

    // Verify Jens is active, Maziar is deactivated
    facts = await ltm.listAll();
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const allNames = facts.value.filter((f) => f.slot === "name");
    expect(allNames).toHaveLength(2);

    const active = allNames.filter((f) => f.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].slotValue).toBe("Jens");

    const deactivated = allNames.filter((f) => !f.isActive);
    expect(deactivated).toHaveLength(1);
    expect(deactivated[0].slotValue).toBe("Maziar");
  });
});

// ── upsertSlotFact: write guards and time-ordering ────────────────────────

describe("upsertSlotFact write guards", () => {
  let db: Database;
  let ltm: SqliteLongTermMemory;

  beforeEach(async () => {
    db = createTestDb();
    await setupSchema(db);
    ltm = new SqliteLongTermMemory(db, logger);
  });

  it("pre_regex wins over post_llm for the same messageId", async () => {
    // pre_regex writes first
    const r1 = await ltm.upsertSlotFact({
      slot: "name", slotValue: "Maziar",
      content: "User's name is Maziar", conversationId: "c1",
      lang: "da", source: "pre_regex", derivedFromMessageId: "msg-1", confidence: 0.8,
    });
    expect(r1.ok).toBe(true);
    expect(r1.ok && r1.value).toBeTruthy();

    // post_llm tries same slot + same messageId => should be skipped
    const r2 = await ltm.upsertSlotFact({
      slot: "name", slotValue: "Maz",
      content: "User's name is Maz", conversationId: "c1",
      lang: "da", source: "post_llm", derivedFromMessageId: "msg-1", confidence: 0.7,
    });
    expect(r2.ok).toBe(true);
    expect(r2.ok && r2.value).toBeNull();

    // Only Maziar should be active
    const facts = await ltm.listAll();
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    const active = facts.value.filter(f => f.isActive && f.slot === "name");
    expect(active).toHaveLength(1);
    expect(active[0].slotValue).toBe("Maziar");
  });

  it("post_llm with different messageId DOES supersede pre_regex", async () => {
    // Message 1: pre_regex
    await ltm.upsertSlotFact({
      slot: "name", slotValue: "Jens",
      content: "User's name is Jens", conversationId: "c1",
      lang: "da", source: "pre_regex", derivedFromMessageId: "msg-1", confidence: 0.8,
    });

    // Message 2: post_llm (different messageId, so it's a newer message)
    const r2 = await ltm.upsertSlotFact({
      slot: "name", slotValue: "Karina",
      content: "User's name is Karina", conversationId: "c1",
      lang: "da", source: "post_llm", derivedFromMessageId: "msg-2", confidence: 0.7,
    });
    expect(r2.ok).toBe(true);
    expect(r2.ok && r2.value).toBeTruthy();

    const facts = await ltm.listAll();
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    const active = facts.value.filter(f => f.isActive && f.slot === "name");
    expect(active).toHaveLength(1);
    expect(active[0].slotValue).toBe("Karina");
  });

  it("slot superseding preserves different slots independently", async () => {
    await ltm.upsertSlotFact({
      slot: "name", slotValue: "Maziar",
      content: "User's name is Maziar", conversationId: "c1",
      lang: "da", source: "pre_regex", derivedFromMessageId: "msg-1", confidence: 0.8,
    });
    await ltm.upsertSlotFact({
      slot: "location", slotValue: "Copenhagen",
      content: "User lives in Copenhagen", conversationId: "c1",
      lang: "da", source: "pre_regex", derivedFromMessageId: "msg-1", confidence: 0.8,
    });

    // Change name only
    await ltm.upsertSlotFact({
      slot: "name", slotValue: "Jens",
      content: "User's name is Jens", conversationId: "c1",
      lang: "da", source: "pre_regex", derivedFromMessageId: "msg-2", confidence: 0.8,
    });

    const facts = await ltm.listAll();
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    const active = facts.value.filter(f => f.isActive);
    expect(active).toHaveLength(2);
    expect(active.find(f => f.slot === "name")!.slotValue).toBe("Jens");
    expect(active.find(f => f.slot === "location")!.slotValue).toBe("Copenhagen");
  });

  it("exact duplicate content is skipped", async () => {
    await ltm.upsertSlotFact({
      slot: "name", slotValue: "Maziar",
      content: "User's name is Maziar", conversationId: "c1",
      lang: "da", source: "pre_regex", derivedFromMessageId: "msg-1", confidence: 0.8,
    });

    // Same content again
    const r2 = await ltm.upsertSlotFact({
      slot: "name", slotValue: "Maziar",
      content: "User's name is Maziar", conversationId: "c1",
      lang: "da", source: "pre_regex", derivedFromMessageId: "msg-2", confidence: 0.8,
    });
    expect(r2.ok).toBe(true);
    expect(r2.ok && r2.value).toBeNull();
  });

  it("triple name change keeps only the latest active", async () => {
    for (const [i, name] of ["Maziar", "Jens", "Karina"].entries()) {
      await ltm.upsertSlotFact({
        slot: "name", slotValue: name,
        content: `User's name is ${name}`, conversationId: "c1",
        lang: "da", source: "pre_regex", derivedFromMessageId: `msg-${i + 1}`, confidence: 0.8,
      });
    }

    const facts = await ltm.listAll();
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    const active = facts.value.filter(f => f.isActive && f.slot === "name");
    expect(active).toHaveLength(1);
    expect(active[0].slotValue).toBe("Karina");
  });
});
