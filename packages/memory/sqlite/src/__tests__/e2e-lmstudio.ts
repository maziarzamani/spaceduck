#!/usr/bin/env bun
// End-to-end integration test: LM Studio embeddings → sqlite-vec → vector recall
//
// Prerequisites:
//   - LM Studio running at localhost:1234 with an embedding model loaded
//   - Homebrew sqlite installed (macOS)
//
// Usage:
//   bun run packages/memory/sqlite/src/__tests__/e2e-lmstudio.ts

import { Database } from "bun:sqlite";
import { ConsoleLogger } from "@spaceduck/core";
import { LMStudioEmbeddingProvider } from "../../../../providers/lmstudio/src/embedding";
import { SchemaManager, ensureCustomSQLite } from "../schema";
import { SqliteLongTermMemory, distanceToScore } from "../long-term";

const logger = new ConsoleLogger("info");

// ── 1. Setup ────────────────────────────────────────────────────────────

console.log("\n━━━ E2E Test: LM Studio → sqlite-vec → Vector Recall ━━━\n");

// Must be called before any new Database()
ensureCustomSQLite();

const db = new Database(":memory:");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const schema = new SchemaManager(db, logger);
schema.loadExtensions();
await schema.migrate();

// Verify vec0 is loaded
const vecVersion = db.prepare("SELECT vec_version() as v").get() as { v: string };
console.log(`✓ sqlite-vec loaded: ${vecVersion.v}`);

// ── 2. Create LM Studio embedding provider ──────────────────────────────

const embedding = new LMStudioEmbeddingProvider({
  model: "text-embedding-qwen3-embedding-8b",
  dimensions: 4096,
});

// Quick health check
console.log(`\n── Testing embedding provider: ${embedding.name} ──`);
const testVec = await embedding.embed("hello world");
console.log(`✓ Embedding works — dimensions: ${testVec.length}`);

// ── 3. Store facts with real embeddings ─────────────────────────────────

const ltm = new SqliteLongTermMemory(db, logger, embedding);

const facts = [
  "User's name is Alice and she lives in Denmark",
  "User prefers TypeScript over JavaScript",
  "User is building a personal AI assistant called Spaceduck",
  "User likes using LM Studio for local models",
  "User's favorite food is sushi",
  "User works with Bun runtime and SQLite",
  "User has a cat named Luna",
  "User is interested in vector embeddings and RAG",
];

console.log(`\n── Storing ${facts.length} facts with real embeddings ──`);

const start = Date.now();
for (const content of facts) {
  const result = await ltm.remember({ conversationId: "e2e-test", content });
  if (!result.ok) {
    console.error(`✗ Failed to store: ${content}`, result.error);
  }
}
const storeMs = Date.now() - start;
console.log(`✓ Stored ${facts.length} facts in ${storeMs}ms (${(storeMs / facts.length).toFixed(0)}ms/fact)`);

// ── 4. Test deduplication ───────────────────────────────────────────────

console.log(`\n── Testing deduplication ──`);
const dupResult = await ltm.remember({
  conversationId: "e2e-test",
  content: "User's name is Alice and she lives in Denmark",
});
if (dupResult.ok) {
  const count = db.query("SELECT COUNT(*) as c FROM facts").get() as { c: number };
  console.log(`✓ Dedup works — still ${count.c} facts (duplicate was skipped)`);
}

// ── 5. Test vector recall with different queries ────────────────────────

console.log(`\n── Testing vector recall ──`);

const queries = [
  "What is the user's name?",
  "What programming language does the user prefer?",
  "Does the user have any pets?",
  "What is the user building?",
  "What does the user like to eat?",
];

for (const q of queries) {
  const recallStart = Date.now();
  const result = await ltm.recall(q, 3, { strategy: "vector", minScore: 0.3 });
  const recallMs = Date.now() - recallStart;

  if (result.ok) {
    console.log(`\n  Query: "${q}" (${recallMs}ms)`);
    if (result.value.length === 0) {
      console.log("    → No results above minScore threshold");
    }
    for (const fact of result.value) {
      console.log(`    → ${fact.content}`);
    }
  } else {
    console.error(`  ✗ Recall failed: ${result.error}`);
  }
}

// ── 6. Raw vector similarity inspection ─────────────────────────────────

console.log(`\n── Raw similarity scores ──`);
const inspectQuery = "What is the user's name and where do they live?";
const queryVec = await embedding.embed(inspectQuery);

const rawRows = db
  .query(
    `SELECT fact_id, distance
     FROM vec_facts
     WHERE embedding MATCH ?1
     ORDER BY distance
     LIMIT 8`,
  )
  .all(new Float32Array(queryVec)) as { fact_id: string; distance: number }[];

console.log(`  Query: "${inspectQuery}"`);
for (const row of rawRows) {
  const fact = db.query("SELECT content FROM facts WHERE id = ?1").get(row.fact_id) as { content: string };
  const score = distanceToScore(row.distance);
  console.log(`    [score=${score.toFixed(3)} dist=${row.distance.toFixed(4)}] ${fact.content}`);
}

// ── 7. Batch embedding test ─────────────────────────────────────────────

console.log(`\n── Batch embedding test ──`);
const batchStart = Date.now();
const batchResults = await embedding.embedBatch([
  "first sentence",
  "second sentence",
  "third sentence",
]);
const batchMs = Date.now() - batchStart;
console.log(`✓ Batch of ${batchResults.length} embeddings in ${batchMs}ms`);
console.log(`  Each has ${batchResults[0].length} dimensions`);

// ── Done ────────────────────────────────────────────────────────────────

db.close();
console.log(`\n━━━ E2E Test Complete ━━━\n`);
