import { describe, it, expect, beforeEach } from "bun:test";
import { FactExtractor } from "../fact-extractor";
import { SimpleEventBus } from "../events";
import { MockLongTermMemory } from "../__fixtures__/mock-memory";
import { ConsoleLogger } from "../types/logger";

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

  it("should extract facts from assistant messages matching patterns", async () => {
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
      expect(facts.value.length).toBeGreaterThanOrEqual(1);
      expect(facts.value.every((f) => f.source === "auto-extracted")).toBe(true);
      expect(facts.value.every((f) => typeof f.confidence === "number")).toBe(true);
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
