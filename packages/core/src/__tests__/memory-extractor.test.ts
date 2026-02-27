import { describe, it, expect, beforeEach } from "bun:test";
import { MemoryExtractor, guardMemory, type ClassifiedMemory } from "../memory-extractor";
import { FactExtractor } from "../fact-extractor";
import { SimpleEventBus } from "../events";
import { MockMemoryStore, MockLongTermMemory } from "../__fixtures__/mock-memory";
import { MockProvider } from "../__fixtures__/mock-provider";
import { ConsoleLogger } from "../types/logger";
import type { Message } from "../types";

const logger = new ConsoleLogger("error");

function msg(content: string, role: "user" | "assistant" = "user"): Message {
  return { id: `msg-${Date.now()}`, role, content, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// guardMemory
// ---------------------------------------------------------------------------

describe("guardMemory", () => {
  it("rejects questions for all kinds", () => {
    expect(guardMemory("What is the user's name?", "fact").pass).toBe(false);
    expect(guardMemory("What was deployed?", "episode").pass).toBe(false);
  });

  it("rejects short content", () => {
    expect(guardMemory("Hi", "fact").pass).toBe(false);
  });

  it("accepts valid facts", () => {
    expect(guardMemory("User prefers Bun over Node.js", "fact").pass).toBe(true);
  });

  it("requires an action verb for episodes", () => {
    expect(guardMemory("The weather was nice today", "episode").pass).toBe(false);
    expect(guardMemory("Successfully deployed auth service to production", "episode").pass).toBe(true);
  });

  it("requires imperative language for procedures", () => {
    expect(guardMemory("The sky is blue and beautiful", "procedure").pass).toBe(false);
    expect(guardMemory("Always validate schemas before saving to the database", "procedure").pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MemoryExtractor — no LLM (regex only)
// ---------------------------------------------------------------------------

describe("MemoryExtractor (regex only, no provider)", () => {
  let store: MockMemoryStore;
  let extractor: MemoryExtractor;
  let ltm: MockLongTermMemory;
  let factExtractor: FactExtractor;

  beforeEach(() => {
    store = new MockMemoryStore();
    ltm = new MockLongTermMemory();
    factExtractor = new FactExtractor(ltm, logger);
    extractor = new MemoryExtractor(store, logger, undefined, factExtractor);
  });

  it("extracts name from user message via regex and stores as fact", async () => {
    const results = await extractor.extractFromMessage(
      msg("My name is Maziar and I live in Copenhagen"),
      "conv-1",
    );

    expect(results.length).toBeGreaterThanOrEqual(1);

    const all = store.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);

    const nameFact = all.find((m) => m.content.includes("name") && m.content.includes("Maziar"));
    expect(nameFact).toBeDefined();
    expect(nameFact!.kind).toBe("fact");
    expect(nameFact!.status).toBe("active");
    expect(nameFact!.source.type).toBe("user_message");
  });

  it("extracts location from user message", async () => {
    await extractor.extractFromMessage(
      msg("I live in Copenhagen"),
      "conv-1",
    );

    const all = store.getAll();
    const location = all.find((m) => m.content.includes("Copenhagen"));
    expect(location).toBeDefined();
    expect(location!.kind).toBe("fact");
  });

  it("does not extract from short messages", async () => {
    const results = await extractor.extractFromMessage(msg("ok"), "conv-1");
    expect(results.length).toBe(0);
    expect(store.getAll().length).toBe(0);
  });

  it("does not extract from non-user non-assistant roles", async () => {
    const results = await extractor.extractFromMessage(
      { id: "sys", role: "system", content: "My name is System and I live in the cloud", timestamp: Date.now() },
      "conv-1",
    );
    expect(results.length).toBe(0);
  });

  it("skips regex for assistant messages (avoids identity contamination)", async () => {
    const results = await extractor.extractFromMessage(
      msg("I'm glad to help you. My name is Assistant.", "assistant"),
      "conv-1",
    );
    // Without an LLM provider, no extraction from assistant messages
    expect(results.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MemoryExtractor — with mock LLM
// ---------------------------------------------------------------------------

describe("MemoryExtractor (with mock LLM)", () => {
  let store: MockMemoryStore;
  let provider: MockProvider;
  let extractor: MemoryExtractor;

  beforeEach(() => {
    store = new MockMemoryStore();
    provider = new MockProvider();
    extractor = new MemoryExtractor(store, logger, provider);
  });

  it("classifies a fact from LLM output", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "fact",
      title: "User prefers Bun",
      content: "User strongly prefers Bun over Node.js for backend projects",
      summary: "Prefers Bun over Node.js",
      importance: "significant",
      confidence: "stated",
      tags: ["preference", "runtime"],
      should_store: true,
    }])]);

    const results = await extractor.extractFromMessage(
      msg("I strongly prefer Bun over Node.js for all my backend projects", "user"),
      "conv-1",
    );

    expect(results.length).toBe(1);
    expect(results[0].input.kind).toBe("fact");
    expect(results[0].retention.shouldStore).toBe(true);
    expect(results[0].retention.reason).toBe("durable_fact");

    const all = store.getAll();
    expect(all.length).toBe(1);
    expect(all[0].importance).toBe(0.7); // "significant" maps to 0.7
    expect(all[0].confidence).toBe(0.8); // "stated" maps to 0.8
    expect(all[0].tags).toEqual(["preference", "runtime"]);
  });

  it("classifies a procedure with subtype", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "procedure",
      procedure_subtype: "constraint",
      title: "Always validate schemas",
      content: "Always validate input schemas before any database write operation",
      summary: "Validate schemas before writes",
      importance: "core",
      confidence: "stated",
      tags: ["validation"],
      should_store: true,
    }])]);

    const results = await extractor.extractFromMessage(
      msg("Remember: always validate input schemas before any database write operation", "user"),
      "conv-1",
    );

    expect(results.length).toBe(1);
    expect(results[0].input.kind).toBe("procedure");
    if (results[0].input.kind === "procedure") {
      expect(results[0].input.procedureSubtype).toBe("constraint");
    }
    expect(results[0].retention.reason).toBe("constraint_procedure");

    const stored = store.getAll()[0];
    expect(stored.importance).toBe(0.85); // "core" maps to 0.85
    expect(stored.procedureSubtype).toBe("constraint");
  });

  it("classifies an episode with occurred_at", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "episode",
      title: "Deployed auth service",
      content: "Successfully deployed the authentication service to production on AWS ECS",
      summary: "Deployed auth service to prod",
      importance: "significant",
      confidence: "certain",
      tags: ["deployment", "auth"],
      should_store: true,
      occurred_at_hint: "now",
    }])]);

    const results = await extractor.extractFromMessage(
      msg("I just successfully deployed the authentication service to production on AWS ECS", "user"),
      "conv-1",
    );

    expect(results.length).toBe(1);
    expect(results[0].input.kind).toBe("episode");
    if (results[0].input.kind === "episode") {
      expect(results[0].input.occurredAt).toBeGreaterThan(0);
    }

    const stored = store.getAll()[0];
    expect(stored.kind).toBe("episode");
    expect(stored.occurredAt).toBeDefined();
    expect(stored.confidence).toBe(0.95); // "certain" maps to 0.95
  });

  it("respects retention gate: should_store false skips storage", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "episode",
      title: "Read file config.ts",
      content: "Read the configuration file to check settings",
      should_store: false,
      rejection_reason: "ephemeral_noise",
    }])]);

    const results = await extractor.extractFromMessage(
      msg("I just read the configuration file to check the current settings and everything looks fine", "assistant"),
      "conv-1",
    );

    expect(results.length).toBe(0);
    expect(store.getAll().length).toBe(0);
  });

  it("maps discrete importance/confidence buckets correctly", async () => {
    const testCases: Array<{ imp: string; conf: string; expImp: number; expConf: number }> = [
      { imp: "trivial", conf: "speculative", expImp: 0.3, expConf: 0.4 },
      { imp: "standard", conf: "likely", expImp: 0.5, expConf: 0.6 },
      { imp: "significant", conf: "stated", expImp: 0.7, expConf: 0.8 },
      { imp: "core", conf: "certain", expImp: 0.85, expConf: 0.95 },
      { imp: "critical", conf: "certain", expImp: 1.0, expConf: 0.95 },
    ];

    for (const tc of testCases) {
      store.clear();
      provider.setResponses([JSON.stringify([{
        kind: "fact",
        title: "Test fact",
        content: "User has a strong preference for testing all the things properly",
        summary: "Test fact summary",
        importance: tc.imp,
        confidence: tc.conf,
        tags: [],
        should_store: true,
      }])]);

      await extractor.extractFromMessage(
        msg("I have a strong preference for testing all the things properly", "user"),
        "conv-1",
      );

      const all = store.getAll();
      expect(all.length).toBe(1);
      expect(all[0].importance).toBe(tc.expImp);
      expect(all[0].confidence).toBe(tc.expConf);
    }
  });

  it("defaults importance/confidence for unknown buckets", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "fact",
      title: "Test fact",
      content: "User prefers deterministic testing over random approaches",
      summary: "Prefers deterministic testing",
      importance: "unknown_bucket",
      confidence: "garbage",
      tags: [],
      should_store: true,
    }])]);

    await extractor.extractFromMessage(
      msg("I prefer deterministic testing over random approaches in my projects", "user"),
      "conv-1",
    );

    const all = store.getAll();
    expect(all.length).toBe(1);
    expect(all[0].importance).toBe(0.5); // default
    expect(all[0].confidence).toBe(0.7); // default
  });

  it("handles multiple memories in one response", async () => {
    provider.setResponses([JSON.stringify([
      {
        kind: "fact",
        title: "Name is Maziar",
        content: "The user's name is Maziar and he is a developer",
        summary: "User's name is Maziar",
        importance: "significant",
        confidence: "certain",
        tags: ["identity"],
        should_store: true,
      },
      {
        kind: "procedure",
        procedure_subtype: "behavioral",
        title: "Use Danish for UI",
        content: "Always render user-facing text in Danish language",
        summary: "Use Danish for UI",
        importance: "standard",
        confidence: "stated",
        tags: ["language", "ui"],
        should_store: true,
      },
    ])]);

    const results = await extractor.extractFromMessage(
      msg("My name is Maziar. Please always render user-facing text in Danish language for me.", "user"),
      "conv-1",
    );

    expect(results.length).toBe(2);
    expect(store.getAll().length).toBe(2);

    const kinds = store.getAll().map((m) => m.kind).sort();
    expect(kinds).toEqual(["fact", "procedure"]);
  });

  it("handles empty LLM response gracefully", async () => {
    provider.setResponses(["[]"]);
    const results = await extractor.extractFromMessage(
      msg("Hello, how are you doing today?", "user"),
      "conv-1",
    );
    expect(results.length).toBe(0);
    expect(store.getAll().length).toBe(0);
  });

  it("handles malformed LLM response gracefully", async () => {
    provider.setResponses(["this is not json at all"]);
    const results = await extractor.extractFromMessage(
      msg("Tell me about the weather in Copenhagen today please", "user"),
      "conv-1",
    );
    expect(results.length).toBe(0);
  });

  it("handles LLM response with markdown fences", async () => {
    provider.setResponses(["```json\n" + JSON.stringify([{
      kind: "fact",
      title: "Prefers TypeScript",
      content: "User prefers TypeScript over plain JavaScript for all projects",
      summary: "Prefers TypeScript",
      importance: "significant",
      confidence: "stated",
      tags: ["preference"],
      should_store: true,
    }]) + "\n```"]);

    const results = await extractor.extractFromMessage(
      msg("I definitely prefer TypeScript over plain JavaScript for all projects", "user"),
      "conv-1",
    );

    expect(results.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Steel gate: deterministic post-LLM validation
// ---------------------------------------------------------------------------

describe("MemoryExtractor steel gate", () => {
  let store: MockMemoryStore;
  let provider: MockProvider;
  let extractor: MemoryExtractor;

  beforeEach(() => {
    store = new MockMemoryStore();
    provider = new MockProvider();
    extractor = new MemoryExtractor(store, logger, provider);
  });

  it("rejects procedure without valid subtype", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "procedure",
      title: "Do something",
      content: "Always do something important when the user asks",
      summary: "Do something",
      importance: "standard",
      confidence: "stated",
      tags: [],
      should_store: true,
      // missing procedure_subtype
    }])]);

    const results = await extractor.extractFromMessage(
      msg("Always do something important when the user asks you a question", "user"),
      "conv-1",
    );

    expect(results.length).toBe(0);
    expect(store.getAll().length).toBe(0);
  });

  it("rejects episode without action verb", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "episode",
      title: "Nice weather",
      content: "The weather was beautiful and sunny in Copenhagen today",
      summary: "Nice weather today",
      importance: "trivial",
      confidence: "stated",
      tags: [],
      should_store: true,
      occurred_at_hint: "now",
    }])]);

    const results = await extractor.extractFromMessage(
      msg("The weather was beautiful and sunny in Copenhagen today, really lovely", "user"),
      "conv-1",
    );

    expect(results.length).toBe(0);
  });

  it("rejects invalid kind", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "imagination",
      title: "Fantasy memory",
      content: "This is some fantasy content that should not be stored anywhere",
      summary: "Fantasy",
      should_store: true,
    }])]);

    const results = await extractor.extractFromMessage(
      msg("This is some fantasy content that should not be stored anywhere in my memory", "user"),
      "conv-1",
    );

    expect(results.length).toBe(0);
  });

  it("rejects content that fails guardMemory (question)", async () => {
    provider.setResponses([JSON.stringify([{
      kind: "fact",
      title: "User question",
      content: "What is the best runtime for backend development?",
      summary: "Question about runtime",
      importance: "standard",
      confidence: "stated",
      tags: [],
      should_store: true,
    }])]);

    const results = await extractor.extractFromMessage(
      msg("What is the best runtime for backend development in your opinion?", "user"),
      "conv-1",
    );

    expect(results.length).toBe(0);
  });

  it("assigns active status for high confidence, candidate for low", async () => {
    provider.setResponses([JSON.stringify([
      {
        kind: "fact",
        title: "High confidence fact",
        content: "User explicitly stated they prefer local-first solutions always",
        summary: "Prefers local-first",
        importance: "significant",
        confidence: "stated",
        tags: [],
        should_store: true,
      },
      {
        kind: "fact",
        title: "Low confidence fact",
        content: "User might possibly prefer dark mode in some editors maybe",
        summary: "Might prefer dark mode",
        importance: "trivial",
        confidence: "speculative",
        tags: [],
        should_store: true,
      },
    ])]);

    await extractor.extractFromMessage(
      msg("I explicitly prefer local-first solutions always. Also I might possibly prefer dark mode in some editors maybe.", "user"),
      "conv-1",
    );

    const all = store.getAll();
    expect(all.length).toBe(2);

    const highConf = all.find((m) => m.content.includes("local-first"));
    const lowConf = all.find((m) => m.content.includes("dark mode"));
    expect(highConf!.status).toBe("active");
    expect(lowConf!.status).toBe("candidate");
  });
});

// ---------------------------------------------------------------------------
// EventBus integration
// ---------------------------------------------------------------------------

describe("MemoryExtractor event bus", () => {
  it("registers and extracts on message:response events", async () => {
    const store = new MockMemoryStore();
    const provider = new MockProvider();
    provider.setResponses([JSON.stringify([{
      kind: "fact",
      title: "Event bus fact",
      content: "User prefers event-driven architecture for all systems",
      summary: "Prefers event-driven",
      importance: "standard",
      confidence: "stated",
      tags: [],
      should_store: true,
    }])]);

    const extractor = new MemoryExtractor(store, logger, provider);
    const eventBus = new SimpleEventBus(logger);
    extractor.register(eventBus);

    eventBus.emit("message:response", {
      conversationId: "conv-1",
      message: msg("I prefer event-driven architecture for all systems that I build", "user"),
      durationMs: 100,
    });

    // Give async handler time to complete
    await new Promise((r) => setTimeout(r, 200));

    expect(store.getAll().length).toBe(1);

    extractor.unregister(eventBus);
  });

  it("unregister stops listening", async () => {
    const store = new MockMemoryStore();
    const provider = new MockProvider();
    provider.setResponses([JSON.stringify([{
      kind: "fact",
      title: "Should not store",
      content: "This fact should not be stored because extractor is unregistered",
      summary: "Should not store",
      importance: "standard",
      confidence: "stated",
      tags: [],
      should_store: true,
    }])]);

    const extractor = new MemoryExtractor(store, logger, provider);
    const eventBus = new SimpleEventBus(logger);
    extractor.register(eventBus);
    extractor.unregister(eventBus);

    eventBus.emit("message:response", {
      conversationId: "conv-1",
      message: msg("This fact should not be stored because extractor is unregistered now", "user"),
      durationMs: 100,
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(store.getAll().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regex + LLM merge
// ---------------------------------------------------------------------------

describe("MemoryExtractor regex + LLM merge", () => {
  it("regex candidates are stored when LLM returns empty", async () => {
    const store = new MockMemoryStore();
    const ltm = new MockLongTermMemory();
    const factExtractor = new FactExtractor(ltm, logger);
    const provider = new MockProvider();
    provider.setResponses(["[]"]);

    const extractor = new MemoryExtractor(store, logger, provider, factExtractor);

    await extractor.extractFromMessage(
      msg("My name is Maziar"),
      "conv-1",
    );

    const all = store.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some((m) => m.content.includes("Maziar"))).toBe(true);
  });

  it("does not duplicate when LLM returns same content as regex", async () => {
    const store = new MockMemoryStore();
    const ltm = new MockLongTermMemory();
    const factExtractor = new FactExtractor(ltm, logger);
    const provider = new MockProvider();
    provider.setResponses([JSON.stringify([{
      kind: "fact",
      title: "User name is Maziar",
      content: "User's name is Maziar",
      summary: "Name is Maziar",
      importance: "significant",
      confidence: "certain",
      tags: ["identity"],
      should_store: true,
    }])]);

    const extractor = new MemoryExtractor(store, logger, provider, factExtractor);

    await extractor.extractFromMessage(
      msg("My name is Maziar"),
      "conv-1",
    );

    const all = store.getAll();
    const nameMemories = all.filter((m) =>
      m.content.toLowerCase().includes("maziar") && m.content.toLowerCase().includes("name"),
    );
    expect(nameMemories.length).toBe(1);
  });
});
