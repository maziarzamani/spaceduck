import { describe, it, expect, beforeEach } from "bun:test";
import { FactExtractor, guardFact } from "../fact-extractor";
import { SimpleEventBus } from "../events";
import { MockLongTermMemory } from "../__fixtures__/mock-memory";
import { ConsoleLogger } from "../types/logger";

// ── guardFact firewall ──────────────────────────────────────────────────

describe("guardFact", () => {
  it("rejects questions", () => {
    expect(guardFact("What is the user's name?").pass).toBe(false);
  });

  it("rejects short content", () => {
    expect(guardFact("Hi").pass).toBe(false);
  });

  it("rejects ignorance assertions: 'is unknown'", () => {
    expect(guardFact("User's name is unknown").pass).toBe(false);
  });

  it("rejects ignorance assertions: 'is not provided'", () => {
    expect(guardFact("User's location is not provided").pass).toBe(false);
  });

  it("rejects ignorance assertions: 'is not set'", () => {
    expect(guardFact("User's age is not set").pass).toBe(false);
  });

  it("rejects ignorance assertions: 'is not specified'", () => {
    expect(guardFact("User's preference is not specified").pass).toBe(false);
  });

  it("accepts valid durable facts", () => {
    expect(guardFact("User's name is Alice").pass).toBe(true);
    expect(guardFact("User lives in Copenhagen").pass).toBe(true);
    expect(guardFact("User is 30 years old").pass).toBe(true);
  });
});

// ── FactExtractor ───────────────────────────────────────────────────────

describe("FactExtractor", () => {
  let ltm: MockLongTermMemory;
  let eventBus: SimpleEventBus;
  let extractor: FactExtractor;
  const logger = new ConsoleLogger("error");

  beforeEach(() => {
    ltm = new MockLongTermMemory();
    eventBus = new SimpleEventBus(logger);
    extractor = new FactExtractor(ltm, logger);
  });

  it("should register and unregister from event bus", () => {
    extractor.register(eventBus);
    extractor.unregister(eventBus);
    // Should not throw on double unregister
    extractor.unregister(eventBus);
  });

  it("should extract generic patterns from assistant messages but NOT identity slots", async () => {
    extractor.register(eventBus);

    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-1",
        role: "assistant",
        content:
          "Based on our conversation, you prefer TypeScript over JavaScript for large projects. " +
          "Your name is Alice and you like working with Bun runtime for server-side applications. " +
          "Remember that the deployment deadline is next Friday for the production release.",
        timestamp: Date.now(),
      },
      durationMs: 100,
    });

    const facts = await ltm.listAll("conv-1");
    expect(facts.ok).toBe(true);
    if (facts.ok) {
      // Generic patterns (prefer/remember) still work on assistant text
      // but identity regex (name/location/age) is blocked
      const identityFacts = facts.value.filter(
        (f) => f.slot === "name" || f.slot === "age" || f.slot === "location",
      );
      expect(identityFacts).toHaveLength(0);
    }
  });

  it("should skip non-assistant messages when extractFromUser is false", async () => {
    const noUserExtractor = new FactExtractor(ltm, logger, undefined, {
      extractFromUser: false,
    });
    noUserExtractor.register(eventBus);

    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-1",
        role: "user",
        content: "you prefer TypeScript over JavaScript for large projects and more text to be long enough.",
        timestamp: Date.now(),
      },
      durationMs: 50,
    });

    const facts = await ltm.listAll("conv-1");
    expect(facts.ok).toBe(true);
    if (facts.ok) {
      expect(facts.value).toHaveLength(0);
    }
  });

  it("should skip short assistant messages", async () => {
    extractor.register(eventBus);

    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-1",
        role: "assistant",
        content: "OK, done.",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("conv-1");
    expect(facts.ok).toBe(true);
    if (facts.ok) {
      expect(facts.value).toHaveLength(0);
    }
  });

  it("should not extract when unregistered", async () => {
    extractor.register(eventBus);
    extractor.unregister(eventBus);

    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-1",
        role: "assistant",
        content:
          "you prefer TypeScript over JavaScript for building large scale applications in production environments.",
        timestamp: Date.now(),
      },
      durationMs: 100,
    });

    const facts = await ltm.listAll("conv-1");
    expect(facts.ok).toBe(true);
    if (facts.ok) {
      expect(facts.value).toHaveLength(0);
    }
  });

  it("should handle extraction errors gracefully", async () => {
    // Create a broken LTM that always fails
    const brokenLtm = {
      ...ltm,
      remember: async () => ({ ok: false as const, error: new Error("DB down") as any }),
      upsertSlotFact: async () => ({ ok: false as const, error: new Error("DB down") as any }),
      recall: ltm.recall.bind(ltm),
      forget: ltm.forget.bind(ltm),
      listAll: ltm.listAll.bind(ltm),
    };

    const brokenExtractor = new FactExtractor(brokenLtm, logger);
    brokenExtractor.register(eventBus);

    // Should not throw even when LTM fails
    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-1",
        role: "assistant",
        content:
          "you prefer TypeScript over JavaScript for building large scale applications in production environments.",
        timestamp: Date.now(),
      },
      durationMs: 100,
    });
  });
});

// ── Assistant contamination guard ─────────────────────────────────────

describe("Assistant text must not corrupt identity slots", () => {
  let ltm: MockLongTermMemory;
  let eventBus: SimpleEventBus;
  const logger = new ConsoleLogger("error");

  beforeEach(() => {
    ltm = new MockLongTermMemory();
    eventBus = new SimpleEventBus(logger);
  });

  it("assistant saying 'call me curious' must NOT create a name fact", async () => {
    const extractor = new FactExtractor(ltm, logger);
    extractor.register(eventBus);

    // User sets name first
    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-1",
        role: "user",
        content: "My name is Peter",
        timestamp: Date.now(),
      },
      durationMs: 50,
    });

    const afterUser = await ltm.listAll("conv-1");
    expect(afterUser.ok).toBe(true);
    if (!afterUser.ok) return;
    const peterFact = afterUser.value.find((f) => f.content.includes("Peter"));
    expect(peterFact).toBeTruthy();

    // Assistant responds with "I'm curious" — must NOT overwrite Peter
    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-2",
        role: "assistant",
        content:
          "Nice to meet you, Peter! I'm curious about what kind of projects you work on. " +
          "Call me your assistant, and feel free to ask anything.",
        timestamp: Date.now(),
      },
      durationMs: 100,
    });

    const afterAssistant = await ltm.listAll("conv-1");
    expect(afterAssistant.ok).toBe(true);
    if (!afterAssistant.ok) return;

    // No identity slot fact should exist for "curious" or "assistant"
    const poisonFacts = afterAssistant.value.filter(
      (f) =>
        f.content.toLowerCase().includes("curious") ||
        (f.content.toLowerCase().includes("assistant") && f.slot === "name"),
    );
    expect(poisonFacts).toHaveLength(0);
  });

  it("extractRegexFromText (raw utility) DOES match on any text — caller must gate by role", () => {
    const extractor = new FactExtractor(ltm, logger);
    const candidates = extractor.extractRegexFromText("I'm curious about this");
    const nameCandidate = candidates.find((c) => c.slot === "name");
    // extractRegexFromText is a raw utility — it WILL match first-person patterns.
    // The guard is in extract() which skips regex for role !== "user".
    // This test documents that the caller (agent.ts) must only pass user text.
    expect(nameCandidate).toBeTruthy();
    expect(nameCandidate!.slotValue).toContain("curious");
  });

  it("assistant identity slot extraction is blocked even from LLM candidates", async () => {
    // Even if the LLM extractor returns a name fact from assistant text,
    // the belt+suspenders guard should block it from being stored as an identity slot.
    const extractor = new FactExtractor(ltm, logger);
    extractor.register(eventBus);

    await eventBus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: {
        id: "msg-1",
        role: "assistant",
        content:
          "My name is Alice and I live in Wonderland. I'm 150 years old. " +
          "You can call me whatever you like, just remember I'm here to help.",
        timestamp: Date.now(),
      },
      durationMs: 100,
    });

    const facts = await ltm.listAll("conv-1");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    // No identity slot facts (name, age, location) from assistant text
    const identityFacts = facts.value.filter(
      (f) => f.slot === "name" || f.slot === "age" || f.slot === "location",
    );
    expect(identityFacts).toHaveLength(0);
  });
});
