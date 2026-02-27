/**
 * Memory benchmark suite — measures performance of all memory operations.
 *
 * Run with: bun run bench
 *
 * Measures:
 *  - Message insertion throughput (1K, 10K messages)
 *  - Message loading latency (various limits)
 *  - Conversation listing at scale
 *  - Fact remember/recall throughput
 *  - Context building latency (with/without LTM)
 *  - Token estimation speed
 */

import { Database } from "bun:sqlite";
import {
  ConsoleLogger,
  DefaultContextBuilder,
  type Message,
} from "@spaceduck/core";
import {
  SchemaManager,
  SqliteConversationStore,
  SqliteMemoryStore,
} from "@spaceduck/memory-sqlite";

// --- Helpers ---

function generateMessage(i: number, role: "user" | "assistant" = "user"): Message {
  return {
    id: `msg-${i}`,
    role,
    content: `This is message number ${i}. ${role === "assistant" ? "Here is a detailed response with some interesting facts about the topic. ".repeat(3) : "Can you help me with this question about topic " + i + "?"}`,
    timestamp: Date.now() + i,
  };
}

function generateMemoryInput(i: number): import("@spaceduck/core").MemoryInput {
  return {
    kind: "fact",
    title: `Preference ${i}`,
    content: `User prefers ${["TypeScript", "Python", "Rust", "Go", "Java"][i % 5]} for ${["web", "backend", "systems", "data", "mobile"][i % 5]} development. Project ${i} uses this stack.`,
    scope: { type: "global" },
    source: { type: "user_message" },
  };
}

interface BenchResult {
  name: string;
  ops: number;
  totalMs: number;
  opsPerSec: number;
  avgMs: number;
  p50Ms?: number;
  p99Ms?: number;
}

function bench(name: string, fn: () => void, iterations: number): BenchResult {
  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) fn();

  const times: number[] = [];
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }

  const totalMs = performance.now() - start;
  times.sort((a, b) => a - b);

  return {
    name,
    ops: iterations,
    totalMs: Math.round(totalMs * 100) / 100,
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    avgMs: Math.round((totalMs / iterations) * 1000) / 1000,
    p50Ms: Math.round(times[Math.floor(iterations * 0.5)] * 1000) / 1000,
    p99Ms: Math.round(times[Math.floor(iterations * 0.99)] * 1000) / 1000,
  };
}

async function benchAsync(name: string, fn: () => Promise<void>, iterations: number): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) await fn();

  const times: number[] = [];
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }

  const totalMs = performance.now() - start;
  times.sort((a, b) => a - b);

  return {
    name,
    ops: iterations,
    totalMs: Math.round(totalMs * 100) / 100,
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    avgMs: Math.round((totalMs / iterations) * 1000) / 1000,
    p50Ms: Math.round(times[Math.floor(iterations * 0.5)] * 1000) / 1000,
    p99Ms: Math.round(times[Math.floor(iterations * 0.99)] * 1000) / 1000,
  };
}

function printResult(r: BenchResult) {
  console.log(
    `  ${r.name.padEnd(45)} ${String(r.opsPerSec).padStart(8)} ops/s  avg=${r.avgMs}ms  p50=${r.p50Ms}ms  p99=${r.p99Ms}ms  (${r.ops} ops in ${r.totalMs}ms)`,
  );
}

// --- Main ---

async function main() {
  console.log("\n🦆 spaceduck memory benchmarks\n");
  console.log("=".repeat(110));

  const logger = new ConsoleLogger("error");
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = new SchemaManager(db, logger);
  await schema.migrate();

  const store = new SqliteConversationStore(db, logger);
  const memStore = new SqliteMemoryStore(db, logger);
  const contextBuilder = new DefaultContextBuilder(store, logger, "You are a helpful assistant.", memStore);

  const convId = "bench-conv-1";
  await store.create(convId, "Benchmark conversation");

  // --- 1. Message insertion ---
  console.log("\n📝 Message Insertion\n");

  let msgCounter = 0;
  const insertResult = await benchAsync(
    "appendMessage (single)",
    async () => {
      const msg = generateMessage(msgCounter++, msgCounter % 2 === 0 ? "assistant" : "user");
      await store.appendMessage(convId, msg);
    },
    1000,
  );
  printResult(insertResult);

  // Batch insert for 10K
  const batchStart = performance.now();
  for (let i = 0; i < 9000; i++) {
    const msg = generateMessage(msgCounter++, i % 2 === 0 ? "user" : "assistant");
    await store.appendMessage(convId, msg);
  }
  const batchMs = performance.now() - batchStart;
  console.log(`  ${"appendMessage (10K total batch)".padEnd(45)} ${Math.round(9000 / (batchMs / 1000)).toString().padStart(8)} ops/s  total=${Math.round(batchMs)}ms`);

  // --- 2. Message loading ---
  console.log("\n📖 Message Loading (from 10K messages)\n");

  for (const limit of [10, 50, 100, 500, undefined]) {
    const label = limit ? `loadMessages (limit=${limit})` : "loadMessages (all 10K)";
    const loadResult = await benchAsync(
      label,
      async () => {
        await store.loadMessages(convId, limit);
      },
      200,
    );
    printResult(loadResult);
  }

  // --- 3. Conversation listing ---
  console.log("\n📋 Conversation Listing\n");

  // Create 100 conversations
  for (let i = 0; i < 100; i++) {
    await store.create(`bench-list-${i}`, `Conversation ${i}`);
  }

  const listResult = await benchAsync(
    "list() with 101 conversations",
    async () => {
      await store.list();
    },
    500,
  );
  printResult(listResult);

  // --- 4. Fact operations ---
  console.log("\n🧠 Memory Store\n");

  const rememberResult = await benchAsync(
    "store (insert memory)",
    async () => {
      await memStore.store(generateMemoryInput(Math.random() * 10000 | 0));
    },
    1000,
  );
  printResult(rememberResult);

  // Now we have ~1K memories
  const recallResult = await benchAsync(
    "recall (keyword search, 1K memories)",
    async () => {
      await memStore.recall("TypeScript web development project", { topK: 10 });
    },
    500,
  );
  printResult(recallResult);

  const recallMissResult = await benchAsync(
    "recall (no match, 1K memories)",
    async () => {
      await memStore.recall("xyznonexistent", { topK: 10 });
    },
    500,
  );
  printResult(recallMissResult);

  const listFactsResult = await benchAsync(
    "list (1K memories)",
    async () => {
      await memStore.list();
    },
    200,
  );
  printResult(listFactsResult);

  // --- 5. Context building ---
  console.log("\n🏗️  Context Building\n");

  const buildResult = await benchAsync(
    "buildContext (50 turns from 10K, with memoryStore)",
    async () => {
      await contextBuilder.buildContext(convId);
    },
    200,
  );
  printResult(buildResult);

  const buildNoLtm = new DefaultContextBuilder(store, logger);
  const buildNoLtmResult = await benchAsync(
    "buildContext (50 turns from 10K, no memoryStore)",
    async () => {
      await buildNoLtm.buildContext(convId);
    },
    200,
  );
  printResult(buildNoLtmResult);

  // --- 6. Token estimation ---
  console.log("\n📊 Token Estimation\n");

  const contextResult = await contextBuilder.buildContext(convId);
  const ctx = contextResult.ok ? contextResult.value : [];

  const tokenResult = bench(
    "estimateTokens (50 messages)",
    () => {
      contextBuilder.estimateTokens(ctx);
    },
    10000,
  );
  printResult(tokenResult);

  const needsResult = bench(
    "needsCompaction check",
    () => {
      contextBuilder.needsCompaction(ctx, {
        maxTokens: 200000,
        systemPromptReserve: 1000,
        maxTurns: 50,
        maxFacts: 10,
        maxProcedures: 3,
        maxEpisodes: 3,
        compactionThreshold: 0.85,
      });
    },
    10000,
  );
  printResult(needsResult);

  // --- Summary ---
  console.log("\n" + "=".repeat(110));
  console.log("\n✅ Benchmarks complete.\n");

  // Memory usage
  const mem = process.memoryUsage();
  console.log(`  RSS: ${Math.round(mem.rss / 1024 / 1024)}MB  Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB/${Math.round(mem.heapTotal / 1024 / 1024)}MB\n`);

  db.close();
}

main().catch(console.error);
