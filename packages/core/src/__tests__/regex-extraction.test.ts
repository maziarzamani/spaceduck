import { describe, it, expect, beforeEach } from "bun:test";
import { FactExtractor } from "../fact-extractor";
import { SimpleEventBus } from "../events";
import { MockLongTermMemory } from "../__fixtures__/mock-memory";
import { ConsoleLogger } from "../types/logger";

describe("Regex-only fact extraction (deterministic)", () => {
  let ltm: MockLongTermMemory;
  let bus: SimpleEventBus;
  let extractor: FactExtractor;
  const logger = new ConsoleLogger("error");

  beforeEach(() => {
    ltm = new MockLongTermMemory();
    bus = new SimpleEventBus(logger);
    extractor = new FactExtractor(ltm, logger);
    extractor.register(bus);
  });

  it("should extract name from Danish input", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-1",
      message: {
        id: "m1",
        role: "user",
        content: "Jeg hedder Maziar",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-1");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    expect(facts.value.length).toBeGreaterThanOrEqual(1);

    const nameFact = facts.value.find((f) => f.slot === "name");
    expect(nameFact).toBeTruthy();
    expect(nameFact!.content).toContain("Maziar");
    expect(nameFact!.slotValue).toBe("Maziar");
    expect(nameFact!.lang).toBe("da");
    expect(nameFact!.source === "regex" || nameFact!.source === "pre_regex" || nameFact!.source === "post_llm").toBe(true);
  });

  it("should extract name from English input", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-2",
      message: {
        id: "m1",
        role: "user",
        content: "My name is Alice Johnson",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-2");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const nameFact = facts.value.find((f) => f.slot === "name");
    expect(nameFact).toBeTruthy();
    expect(nameFact!.content).toContain("Alice Johnson");
    expect(nameFact!.lang).toBe("en");
  });

  it("should NOT extract when negation is present (Danish)", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-neg",
      message: {
        id: "m1",
        role: "user",
        content: "Jeg hedder ikke Maziar",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-neg");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    expect(facts.value).toHaveLength(0);
  });

  it("should NOT extract when negation is present (English post)", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-neg-en",
      message: {
        id: "m1",
        role: "user",
        content: "My name is not Alice",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-neg-en");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    expect(facts.value).toHaveLength(0);
  });

  it("should extract location from Danish input", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-loc",
      message: {
        id: "m1",
        role: "user",
        content: "Jeg bor i København",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-loc");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const locFact = facts.value.find((f) => f.slot === "location");
    expect(locFact).toBeTruthy();
    expect(locFact!.content).toContain("København");
    expect(locFact!.lang).toBe("da");
  });

  it("should extract location from English input", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-loc-en",
      message: {
        id: "m1",
        role: "user",
        content: "I live in Copenhagen",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-loc-en");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const locFact = facts.value.find((f) => f.slot === "location");
    expect(locFact).toBeTruthy();
    expect(locFact!.content).toContain("Copenhagen");
    expect(locFact!.lang).toBe("en");
  });

  it("should extract age from Danish input", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-age",
      message: {
        id: "m1",
        role: "user",
        content: "Jeg er 42 år gammel",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-age");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const ageFact = facts.value.find((f) => f.slot === "age");
    expect(ageFact).toBeTruthy();
    expect(ageFact!.content).toContain("42");
    expect(ageFact!.slotValue).toBe("42");
    expect(ageFact!.lang).toBe("da");
  });

  it("should produce canonical English sentences regardless of input language", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-canon",
      message: {
        id: "m1",
        role: "user",
        content: "Jeg hedder Maziar og jeg bor i Odense",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-canon");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    for (const fact of facts.value) {
      expect(fact.content).toMatch(/^User/);
    }
  });

  it("should handle multi-token names with hyphens", async () => {
    await bus.emitAsync("message:response", {
      conversationId: "regex-hyphen",
      message: {
        id: "m1",
        role: "user",
        content: "My name is Anne-Marie Johnson",
        timestamp: Date.now(),
      },
      durationMs: 10,
    });

    const facts = await ltm.listAll("regex-hyphen");
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;

    const nameFact = facts.value.find((f) => f.slot === "name");
    expect(nameFact).toBeTruthy();
    expect(nameFact!.content).toContain("Anne-Marie");
  });

  // ── Danish V2 inversion patterns ──────────────────────────────────

  it("should extract name from V2 inversion: 'Nu hedder jeg X'", () => {
    const candidates = extractor.extractRegexFromText("Nu hedder jeg Karina");
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeTruthy();
    expect(name!.slotValue).toBe("Karina");
    expect(name!.lang).toBe("da");
    expect(name!.content).toBe("User's name is Karina");
  });

  it("should extract name from V2 inversion: 'Fremover hedder jeg X'", () => {
    const candidates = extractor.extractRegexFromText("Fremover hedder jeg Anders");
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeTruthy();
    expect(name!.slotValue).toBe("Anders");
  });

  it("should extract name from 'kald mig X'", () => {
    const candidates = extractor.extractRegexFromText("Kald mig Sofie");
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeTruthy();
    expect(name!.slotValue).toBe("Sofie");
    expect(name!.lang).toBe("da");
  });

  it("should extract name from 'du kan kalde mig X'", () => {
    const candidates = extractor.extractRegexFromText("Du kan kalde mig Magnus");
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeTruthy();
    expect(name!.slotValue).toBe("Magnus");
  });

  it("should extract name from 'mit nye navn er X'", () => {
    const candidates = extractor.extractRegexFromText("Mit nye navn er Jens");
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeTruthy();
    expect(name!.slotValue).toBe("Jens");
  });

  it("should extract name from 'call me X' (English)", () => {
    const candidates = extractor.extractRegexFromText("Please call me Robert");
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeTruthy();
    expect(name!.slotValue).toBe("Robert");
    expect(name!.lang).toBe("en");
  });

  it("should extract name from 'jeg har skiftet navn til X'", () => {
    const candidates = extractor.extractRegexFromText("Jeg har skiftet navn til Maria");
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeTruthy();
    expect(name!.slotValue).toBe("Maria");
  });

  // ── extractRegexFromText pure function ────────────────────────────

  it("extractRegexFromText returns candidates without DB writes", () => {
    const candidates = extractor.extractRegexFromText("Jeg hedder Anna og jeg bor i Aarhus");
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    const name = candidates.find(c => c.slot === "name");
    const loc = candidates.find(c => c.slot === "location");
    expect(name).toBeTruthy();
    expect(loc).toBeTruthy();
    expect(name!.slotValue).toBe("Anna");
    expect(loc!.content).toContain("Aarhus");
  });

  it("extractRegexFromText handles negation", () => {
    const candidates = extractor.extractRegexFromText("Jeg hedder ikke Per");
    const name = candidates.find(c => c.slot === "name");
    expect(name).toBeUndefined();
  });
});
