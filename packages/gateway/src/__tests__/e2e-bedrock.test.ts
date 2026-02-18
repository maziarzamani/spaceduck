/**
 * Live E2E tests — hits real Bedrock APIs (Nova 2 Lite + Titan V2).
 *
 * Skipped unless RUN_LIVE_TESTS=1 is set.
 * Requires: AWS_BEARER_TOKEN_BEDROCK and AWS_REGION in env.
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 bun test packages/gateway/src/__tests__/e2e-bedrock.test.ts
 *
 * Tests:
 *   1. Direct chat — Nova 2 Lite responds
 *   2. Direct embeddings — Titan V2 returns 1024-dim vector
 *   3. Full gateway — multi-turn conversation with memory
 *   4. Cross-conversation memory — fact told in conv A recalled in conv B
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createGateway, type Gateway } from "../gateway";
import { BedrockProvider, BedrockEmbeddingProvider } from "@spaceduck/provider-bedrock";
import type { WsServerEnvelope } from "@spaceduck/core";

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

// ── 2. Direct Embedding Tests ─────────────────────────────────────────────────

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
    // All values should be finite numbers (normalized output)
    expect(vec.every((v) => isFinite(v))).toBe(true);
    console.log("  Titan V2 vector[0..4]:", [...vec.slice(0, 5)].map((v) => v.toFixed(6)).join(", "));
  }, 30_000);

  it("should return semantically similar vectors for related texts", async () => {
    const [a, b, c] = await embedding.embedBatch([
      "User's name is Alice",            // topic: name
      "The person's name is Alice",      // same topic, different wording
      "User enjoys hiking in mountains", // completely different topic
    ]);

    // Cosine similarity helper
    function cosine(x: Float32Array, y: Float32Array): number {
      let dot = 0, nx = 0, ny = 0;
      for (let i = 0; i < x.length; i++) {
        dot += x[i] * y[i];
        nx += x[i] * x[i];
        ny += y[i] * y[i];
      }
      return dot / (Math.sqrt(nx) * Math.sqrt(ny));
    }

    const simAB = cosine(a, b); // should be high — same concept
    const simAC = cosine(a, c); // should be lower — different concepts

    console.log(`  sim(name-A, name-B) = ${simAB.toFixed(4)}`);
    console.log(`  sim(name-A, hiking) = ${simAC.toFixed(4)}`);

    expect(simAB).toBeGreaterThan(simAC);
    expect(simAB).toBeGreaterThan(0.8); // same concept should be very similar
  }, 60_000);

  it("should embed Danish text correctly", async () => {
    const [da, en] = await embedding.embedBatch([
      "Brugeren hedder Alice",  // Danish: "The user's name is Alice"
      "User's name is Alice",   // English equivalent
    ]);

    function cosine(x: Float32Array, y: Float32Array): number {
      let dot = 0, nx = 0, ny = 0;
      for (let i = 0; i < x.length; i++) {
        dot += x[i] * y[i];
        nx += x[i] * x[i];
        ny += y[i] * y[i];
      }
      return dot / (Math.sqrt(nx) * Math.sqrt(ny));
    }

    const sim = cosine(da, en);
    console.log(`  sim(Danish "name is Alice", English "name is Alice") = ${sim.toFixed(4)}`);

    // Titan V2 supports multilingual — cross-language similarity should be significant
    expect(sim).toBeGreaterThan(0.5);
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
      model: "amazon.titan-embed-text-v2:0",
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
      // Turn 1: tell it a color
      const t1 = collectUntil(ws, isTerminal);
      ws.send(JSON.stringify({
        v: 1, type: "message.send", requestId: "ctx-1",
        content: "Min yndlingsfarve er lilla. Bekræft kort.",
      }));
      const t1Msgs = await t1;
      expect(t1Msgs.some((m) => m.type === "stream.done")).toBe(true);

      const convId = (t1Msgs.find((m) => m.type === "message.accepted") as any)?.conversationId;
      expect(convId).toBeTruthy();

      // Turn 2: ask about it
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

  it("cross-conversation memory: fact told in conv A recalled in conv B", async () => {
    const { longTermMemory } = gateway.deps;

    // Seed a fact directly into LTM (simulates prior conversation extraction)
    const stored = await longTermMemory.remember({
      conversationId: "conv-a",
      content: "User's name is Alice and they live in Copenhagen",
      source: "auto-extracted",
      confidence: 0.9,
    });
    expect(stored.ok).toBe(true);
    console.log("  Seeded fact:", stored.ok ? stored.value.content : "FAILED");

    // Brief pause so embedding is indexed
    await Bun.sleep(500);

    // Recall via vector search (simulates what happens when conv B starts)
    const recalled = await longTermMemory.recall("What is the user's name?", 5, {
      strategy: "vector",
    });

    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;

    console.log("  Recalled facts:", recalled.value.map((f) => f.content));
    expect(recalled.value.length).toBeGreaterThan(0);
    expect(recalled.value[0].content.toLowerCase()).toContain("alice");
  }, 60_000);

  /**
   * Full end-to-end test of the afterTurn() eager flush:
   *
   * Leg A — "Web UI": user tells bot "Jeg er 42 år gammel."
   *   → afterTurn() extracts the fact and writes it to LTM in the background
   *
   * Leg B — "WhatsApp": completely new sender / conversation asks "Hvor gammel er jeg?"
   *   → context builder recalls the fact via vector search and injects it as context
   *   → bot answers with "38"
   *
   * This is the exact real-world failure that was fixed: short conversations never
   * reached the 10-message compaction threshold, so facts were never persisted.
   */
  it("afterTurn flush: fact told in web UI is recalled in a fresh WhatsApp conversation", async () => {
    const { longTermMemory } = gateway.deps;

    // ── Leg A: "Web UI" conversation ─────────────────────────────────────────
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

    // ── Wait for afterTurn() to finish ───────────────────────────────────────
    // It runs in the background after the WS response is sent, making its own
    // LLM call to extract facts. Poll LTM directly instead of a fixed sleep.
    // Poll LTM directly — avoids a fixed sleep, resolves as soon as the background
    // LLM extraction call finishes (typically < 5s).
    console.log("  Waiting for afterTurn() to persist fact…");
    let factPersisted = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await Bun.sleep(1000);
      const check = await longTermMemory.recall("How old is the user?", 5);
      if (check.ok && check.value.some((f) => /42/.test(f.content))) {
        factPersisted = true;
        console.log(
          `  Fact persisted after ${attempt + 1}s:`,
          check.value.find((f) => /42/.test(f.content))?.content,
        );
        break;
      }
    }
    expect(factPersisted).toBe(true);

    // ── Leg B: "WhatsApp" — brand-new sender, no shared history ─────────────
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
