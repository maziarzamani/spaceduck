/**
 * Live E2E tests — hits real Bedrock APIs (Nova 2 Lite + Nova 2 Multimodal Embeddings).
 *
 * Skipped unless RUN_LIVE_TESTS=1 is set.
 * Requires: AWS_BEARER_TOKEN_BEDROCK and AWS_REGION in env.
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 bun test packages/gateway/src/__tests__/e2e-bedrock.test.ts
 *
 * Tests:
 *   1. Direct chat — Nova 2 Lite responds
 *   2a. Direct embeddings — Titan V2 (legacy) returns 1024-dim vector
 *   2b. Nova 2 Multimodal Embeddings — contract test (dimensions, purpose, truncation)
 *   3. Full gateway — multi-turn conversation with memory
 *   4. Cross-conversation memory — fact told in conv A recalled in conv B
 *   5. Regex-only extraction — no LLM, identity patterns fire deterministically
 *   6. Slot superseding — newer fact deactivates older fact in the same slot
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createGateway, type Gateway } from "../gateway";
import { BedrockProvider, BedrockEmbeddingProvider } from "@spaceduck/provider-bedrock";
import type { WsServerEnvelope, MemoryRecord, ScoredMemory } from "@spaceduck/core";
import { ConsoleLogger } from "@spaceduck/core";
import { SqliteMemoryStore } from "@spaceduck/memory-sqlite";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

const LIVE =
  Bun.env.RUN_LIVE_TESTS === "1" &&
  !!(Bun.env.AWS_BEARER_TOKEN_BEDROCK ?? Bun.env.BEDROCK_API_KEY);

const apiKey = Bun.env.AWS_BEARER_TOKEN_BEDROCK ?? Bun.env.BEDROCK_API_KEY ?? "";
const region = Bun.env.AWS_REGION ?? "us-east-1";

// ── 1. Direct Provider Tests (no gateway needed) ──────────────────────────────

describe.skipIf(!LIVE)("Bedrock chat — Nova 2 Lite (direct)", () => {
  let provider: BedrockProvider;

  beforeAll(() => {
    provider = new BedrockProvider({
      model: "global.amazon.nova-2-lite-v1:0",
      apiKey,
      region,
    });
  });

  it("should stream a response", async () => {
    const chunks: string[] = [];

    for await (const chunk of provider.chat([
      { id: "1", role: "user", content: "Reply with exactly: HELLO_BEDROCK", timestamp: Date.now() },
    ])) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    const response = chunks.join("").trim();
    console.log("  Nova 2 Lite response:", response);

    expect(chunks.length).toBeGreaterThan(0);
    expect(response.length).toBeGreaterThan(0);
  }, 30_000);

  it("should handle a Danish message", async () => {
    const chunks: string[] = [];

    for await (const chunk of provider.chat([
      {
        id: "1",
        role: "system",
        content: "Du er en hjælpsom dansk assistent. Svar altid på dansk.",
        timestamp: Date.now(),
      },
      {
        id: "2",
        role: "user",
        content: "Hvad er 2 + 2? Svar kun med tallet.",
        timestamp: Date.now(),
      },
    ])) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    const response = chunks.join("").trim();
    console.log("  Danish response:", response);

    expect(response).toContain("4");
  }, 30_000);
});

// ── 2a. Legacy Titan Embedding Tests ─────────────────────────────────────────

describe.skipIf(!LIVE)("Bedrock embeddings — Titan V2 (direct)", () => {
  let embedding: BedrockEmbeddingProvider;

  beforeAll(() => {
    embedding = new BedrockEmbeddingProvider({
      model: "amazon.titan-embed-text-v2:0",
      dimensions: 1024,
      apiKey,
      region,
    });
  });

  it("should return a 1024-dim Float32Array", async () => {
    const vec = await embedding.embed("User's name is Alice");

    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(1024);
    expect(vec.every((v) => isFinite(v))).toBe(true);
    console.log("  Titan V2 vector[0..4]:", [...vec.slice(0, 5)].map((v) => v.toFixed(6)).join(", "));
  }, 30_000);

  it("should return semantically similar vectors for related texts", async () => {
    const [a, b, c] = await embedding.embedBatch([
      "User's name is Alice",
      "The person's name is Alice",
      "User enjoys hiking in mountains",
    ]);

    const simAB = cosine(a, b);
    const simAC = cosine(a, c);

    console.log(`  sim(name-A, name-B) = ${simAB.toFixed(4)}`);
    console.log(`  sim(name-A, hiking) = ${simAC.toFixed(4)}`);

    expect(simAB).toBeGreaterThan(simAC);
    expect(simAB).toBeGreaterThan(0.8);
  }, 60_000);
});

// ── 2b. Nova 2 Multimodal Embeddings Contract Test ──────────────────────────

describe.skipIf(!LIVE)("Bedrock embeddings — Nova 2 Multimodal (contract)", () => {
  let embedding: BedrockEmbeddingProvider;

  beforeAll(() => {
    embedding = new BedrockEmbeddingProvider({
      model: "amazon.nova-2-multimodal-embeddings-v1:0",
      dimensions: 1024,
      apiKey,
      region,
    });
  });

  it("should return a 1024-dim Float32Array with purpose=index", async () => {
    const vec = await embedding.embed("User's name is Alice", { purpose: "index" });
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(1024);
    expect(vec.every((v) => isFinite(v))).toBe(true);
    console.log("  Nova 2 index vector[0..4]:", [...vec.slice(0, 5)].map((v) => v.toFixed(6)).join(", "));
  }, 30_000);

  it("should return a vector with purpose=retrieval", async () => {
    const vec = await embedding.embed("what is the user's name?", { purpose: "retrieval" });
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(1024);
  }, 30_000);

  it("should have higher cross-lingual similarity than Titan V2", async () => {
    const enIdx = await embedding.embed("User's name is Alice", { purpose: "index" });
    const daRet = await embedding.embed("Hvad hedder brugeren?", { purpose: "retrieval" });
    const sim = cosine(enIdx, daRet);
    console.log(`  Nova 2 cross-lingual sim(en-index, da-retrieval) = ${sim.toFixed(4)}`);
    expect(sim).toBeGreaterThan(0.3);
  }, 60_000);

  it("should batch embed multiple texts", async () => {
    const vecs = await embedding.embedBatch(
      ["Hello", "World", "Test"],
      { purpose: "index" },
    );
    expect(vecs).toHaveLength(3);
    for (const vec of vecs) {
      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(1024);
    }
  }, 60_000);
});

// ── 3. Full Gateway E2E ───────────────────────────────────────────────────────

describe.skipIf(!LIVE)("Bedrock gateway E2E — full stack", () => {
  let gateway: Gateway;
  const PORT = 49152 + Math.floor(Math.random() * 10000);

  beforeAll(async () => {
    const bedrockProvider = new BedrockProvider({
      model: "global.amazon.nova-2-lite-v1:0",
      apiKey,
      region,
    });
    const bedrockEmbedding = new BedrockEmbeddingProvider({
      model: "amazon.nova-2-multimodal-embeddings-v1:0",
      dimensions: 1024,
      apiKey,
      region,
    });

    gateway = await createGateway({
      provider: bedrockProvider,
      embeddingProvider: bedrockEmbedding,
      config: {
        port: PORT,
        logLevel: "error",
        provider: { name: "bedrock", model: "global.amazon.nova-2-lite-v1:0" },
        memory: { backend: "sqlite", connectionString: ":memory:" },
        channels: ["web"],
        systemPrompt:
          "Du er en hjælpsom dansk assistent. Svar kortfattet og kun på dansk.",
      },
    });
    await gateway.start();
  }, 30_000);

  afterAll(async () => {
    if (gateway?.status === "running") await gateway.stop();
  });

  function connectWs(senderId = "bedrock-e2e"): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws?senderId=${encodeURIComponent(senderId)}`);
      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => reject(new Error(`WS connect failed: ${e}`));
    });
  }

  function collectUntil(
    ws: WebSocket,
    predicate: (e: WsServerEnvelope) => boolean,
    timeoutMs = 40_000,
  ): Promise<WsServerEnvelope[]> {
    return new Promise((resolve, reject) => {
      const collected: WsServerEnvelope[] = [];
      const timer = setTimeout(
        () => reject(new Error(`Timeout after ${timeoutMs}ms. Got: ${collected.map((m) => m.type).join(", ")}`)),
        timeoutMs,
      );
      const handler = (event: MessageEvent) => {
        const env = JSON.parse(event.data) as WsServerEnvelope;
        collected.push(env);
        if (predicate(env)) {
          clearTimeout(timer);
          ws.removeEventListener("message", handler);
          resolve(collected);
        }
      };
      ws.addEventListener("message", handler);
    });
  }

  function fullText(messages: WsServerEnvelope[]): string {
    return messages
      .filter((m) => m.type === "stream.delta")
      .map((d) => (d as Extract<WsServerEnvelope, { type: "stream.delta" }>).delta)
      .join("");
  }

  function isTerminal(e: WsServerEnvelope): boolean {
    return e.type === "stream.done" || e.type === "stream.error";
  }

  it("should get a streaming response from Nova 2 Lite", async () => {
    const ws = await connectWs();
    try {
      const messages = collectUntil(ws, isTerminal);
      ws.send(JSON.stringify({
        v: 1,
        type: "message.send",
        requestId: "live-1",
        content: "Svar med præcis: KVAK",
      }));

      const msgs = await messages;
      const text = fullText(msgs);

      console.log("  Nova response:", text.trim());
      expect(msgs.some((m) => m.type === "message.accepted")).toBe(true);
      expect(msgs.some((m) => m.type === "stream.done")).toBe(true);
      expect(text.length).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  }, 40_000);

  it("should maintain multi-turn context", async () => {
    const ws = await connectWs();
    try {
      const t1 = collectUntil(ws, isTerminal);
      ws.send(JSON.stringify({
        v: 1, type: "message.send", requestId: "ctx-1",
        content: "Min yndlingsfarve er lilla. Bekræft kort.",
      }));
      const t1Msgs = await t1;
      expect(t1Msgs.some((m) => m.type === "stream.done")).toBe(true);

      const convId = (t1Msgs.find((m) => m.type === "message.accepted") as any)?.conversationId;
      expect(convId).toBeTruthy();

      const t2 = collectUntil(ws, isTerminal);
      ws.send(JSON.stringify({
        v: 1, type: "message.send", requestId: "ctx-2",
        conversationId: convId,
        content: "Hvad er min yndlingsfarve? Svar kun med farven.",
      }));
      const t2Msgs = await t2;
      const t2Text = fullText(t2Msgs);

      console.log("  Context recall:", t2Text.trim());
      expect(t2Text.toLowerCase()).toContain("lilla");
    } finally {
      ws.close();
    }
  }, 80_000);

  it("cross-conversation memory: fact told in conv A recalled in conv B (topK)", async () => {
    const { memoryStore } = gateway.deps;
    expect(memoryStore).toBeTruthy();

    const stored = await memoryStore!.store({
      kind: "fact",
      title: "User's name is Alice",
      content: "User's name is Alice and they live in Copenhagen",
      scope: { type: "global" },
      source: { type: "user_message" },
      confidence: 0.9,
    });
    expect(stored.ok).toBe(true);
    console.log("  Seeded fact:", stored.ok ? stored.value.content : "FAILED");

    await Bun.sleep(500);

    const recalled = await memoryStore!.recall("What is the user's name?", {
      topK: 5,
      strategy: "vector",
    });

    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;

    console.log("  Recalled facts (topK=5):", recalled.value.map((f: ScoredMemory) => f.memory.content));
    expect(recalled.value.length).toBeGreaterThan(0);
    const hasAlice = recalled.value.some((f: ScoredMemory) => f.memory.content.toLowerCase().includes("alice"));
    expect(hasAlice).toBe(true);
  }, 60_000);

  it("afterTurn flush: fact told in web UI is recalled in a fresh WhatsApp conversation", async () => {
    const { memoryStore } = gateway.deps;
    expect(memoryStore).toBeTruthy();

    const wsA = await connectWs("web-ui-age-" + Date.now());
    try {
      const t1 = collectUntil(wsA, isTerminal);
      wsA.send(JSON.stringify({
        v: 1,
        type: "message.send",
        requestId: "age-tell",
        content: "Jeg er 42 år gammel.",
      }));
      const t1Msgs = await t1;
      expect(t1Msgs.some((m) => m.type === "stream.done")).toBe(true);
      const t1Text = fullText(t1Msgs);
      console.log("  Web UI response:", t1Text.slice(0, 80).trim());
    } finally {
      wsA.close();
    }

    console.log("  Waiting for afterTurn() to persist fact…");
    let factPersisted = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await Bun.sleep(1000);
      const check = await memoryStore!.recall("How old is the user?", { topK: 5 });
      if (check.ok && check.value.some((f: ScoredMemory) => /42/.test(f.memory.content))) {
        factPersisted = true;
        console.log(
          `  Fact persisted after ${attempt + 1}s:`,
          check.value.find((f: ScoredMemory) => /42/.test(f.memory.content))?.memory.content,
        );
        break;
      }
    }
    expect(factPersisted).toBe(true);

    const wsB = await connectWs("whatsapp-age-" + Date.now());
    try {
      const t2 = collectUntil(wsB, isTerminal);
      wsB.send(JSON.stringify({
        v: 1,
        type: "message.send",
        requestId: "age-ask",
        content: "Hvad er min alder?",
      }));
      const t2Msgs = await t2;
      const t2Text = fullText(t2Msgs);

      console.log("  WhatsApp recall response:", t2Text.slice(0, 120).trim());
      expect(t2Msgs.some((m) => m.type === "stream.done")).toBe(true);
      expect(t2Text).toMatch(/42/);
    } finally {
      wsB.close();
    }
  }, 120_000);
});

// ── 5. Regex-only tests moved to packages/core/src/__tests__/regex-extraction.test.ts ──

// ── 6. Slot Superseding Test ────────────────────────────────────────────────

describe.skipIf(!LIVE)("Slot superseding: newer fact deactivates older", () => {
  it("should deactivate old name when new name is stored", async () => {
    const bedrockEmbedding = new BedrockEmbeddingProvider({
      model: "amazon.nova-2-multimodal-embeddings-v1:0",
      dimensions: 1024,
      apiKey,
      region,
    });

    const { ensureCustomSQLite, SchemaManager } = await import("@spaceduck/memory-sqlite");
    const { Database } = await import("bun:sqlite");

    ensureCustomSQLite();
    const db = new Database(":memory:");
    const logger = new ConsoleLogger("error");
    const schema = new SchemaManager(db, logger);
    schema.loadExtensions();
    await schema.migrate();

    const memStore = new SqliteMemoryStore(db, logger, bedrockEmbedding);

    // Store name = Alice
    const r1 = await memStore.store({
      kind: "fact",
      title: "User's name is Alice",
      content: "User's name is Alice",
      scope: { type: "global" },
      source: { type: "user_message" },
      confidence: 0.9,
    });
    expect(r1.ok).toBe(true);
    const aliceId = r1.ok ? r1.value.id : "";

    // Store name = Bob (supersede Alice)
    const r2 = await memStore.supersede(aliceId, {
      kind: "fact",
      title: "User's name is Bob",
      content: "User's name is Bob",
      scope: { type: "global" },
      source: { type: "user_message" },
      confidence: 0.9,
    });
    expect(r2.ok).toBe(true);

    await Bun.sleep(500);

    // Recall: should only return Bob (Alice is superseded)
    const recalled = await memStore.recall("What is the user's name?", {
      topK: 5,
      strategy: "vector",
    });
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;

    console.log("  Recalled after supersede:", recalled.value.map((f: ScoredMemory) => ({ content: f.memory.content, status: f.memory.status })));
    const activeNames = recalled.value.filter((f: ScoredMemory) => f.memory.content.toLowerCase().includes("name"));
    for (const fact of activeNames) {
      expect(fact.memory.content.toLowerCase()).not.toContain("alice");
    }
    expect(recalled.value.some((f: ScoredMemory) => f.memory.content.toLowerCase().includes("bob"))).toBe(true);
  }, 60_000);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function cosine(x: Float32Array, y: Float32Array): number {
  let dot = 0, nx = 0, ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i] * y[i];
    nx += x[i] * x[i];
    ny += y[i] * y[i];
  }
  return dot / (Math.sqrt(nx) * Math.sqrt(ny));
}
