import { describe, it, expect } from "bun:test";
import { guardFact } from "../fact-extractor";

const D = 86_400_000; // 1 day in ms
const TOLERANCE_MS = 5_000; // 5s tolerance for timestamp comparisons

describe("guardFact() — memory firewall", () => {
  describe("hard rejects", () => {
    it("rejects questions (trailing ?)", () => {
      const result = guardFact("What is the user's name?");
      expect(result.pass).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it("rejects content with fewer than 3 words or fewer than 8 chars", () => {
      expect(guardFact("TypeScript").pass).toBe(false);     // 1 word, 10 chars — passes char but fails word count? No: 1 word < 3
      expect(guardFact("Hi").pass).toBe(false);             // too short (< 8 chars)
      expect(guardFact("Go").pass).toBe(false);             // too short
    });

    it("passes with 3+ words and 8+ chars", () => {
      expect(guardFact("User likes cats").pass).toBe(true); // 3 words, 15 chars
    });

    it("rejects an empty string", () => {
      expect(guardFact("").pass).toBe(false);
    });
  });

  describe("transient tiers — stored with expiry, not rejected", () => {
    it("tier 1 — 'today': 24h expiry", () => {
      const result = guardFact("User is working on a deadline today");
      expect(result.pass).toBe(true);
      expect(result.confidence).toBe(0.3);
      expect(result.expiresAt).toBeDefined();
      const expectedExpiry = Date.now() + 1 * D;
      expect(result.expiresAt!).toBeGreaterThan(expectedExpiry - TOLERANCE_MS);
      expect(result.expiresAt!).toBeLessThan(expectedExpiry + TOLERANCE_MS);
    });

    it("tier 1 — 'right now': 24h expiry", () => {
      const result = guardFact("User is right now debugging a Bun issue");
      expect(result.pass).toBe(true);
      expect(result.expiresAt).toBeDefined();
      const expectedExpiry = Date.now() + 1 * D;
      expect(result.expiresAt!).toBeGreaterThan(expectedExpiry - TOLERANCE_MS);
      expect(result.expiresAt!).toBeLessThan(expectedExpiry + TOLERANCE_MS);
    });

    it("tier 2 — 'currently': 3d expiry", () => {
      const result = guardFact("User is currently using Bun as their runtime");
      expect(result.pass).toBe(true);
      expect(result.confidence).toBe(0.3);
      expect(result.expiresAt).toBeDefined();
      const expectedExpiry = Date.now() + 3 * D;
      expect(result.expiresAt!).toBeGreaterThan(expectedExpiry - TOLERANCE_MS);
      expect(result.expiresAt!).toBeLessThan(expectedExpiry + TOLERANCE_MS);
    });

    it("tier 2 — 'asked about': 3d expiry", () => {
      const result = guardFact("User asked about vector embeddings for memory");
      expect(result.pass).toBe(true);
      expect(result.expiresAt).toBeDefined();
      const expectedExpiry = Date.now() + 3 * D;
      expect(result.expiresAt!).toBeGreaterThan(expectedExpiry - TOLERANCE_MS);
      expect(result.expiresAt!).toBeLessThan(expectedExpiry + TOLERANCE_MS);
    });

    it("tier 3 — 'this week': 7d expiry", () => {
      const result = guardFact("User is redesigning memory layer this week");
      expect(result.pass).toBe(true);
      expect(result.confidence).toBe(0.3);
      expect(result.expiresAt).toBeDefined();
      const expectedExpiry = Date.now() + 7 * D;
      expect(result.expiresAt!).toBeGreaterThan(expectedExpiry - TOLERANCE_MS);
      expect(result.expiresAt!).toBeLessThan(expectedExpiry + TOLERANCE_MS);
    });

    it("tier 3 — 'working on': 7d expiry", () => {
      const result = guardFact("User is working on a new TypeScript project");
      expect(result.pass).toBe(true);
      expect(result.expiresAt).toBeDefined();
      const expectedExpiry = Date.now() + 7 * D;
      expect(result.expiresAt!).toBeGreaterThan(expectedExpiry - TOLERANCE_MS);
      expect(result.expiresAt!).toBeLessThan(expectedExpiry + TOLERANCE_MS);
    });
  });

  describe("durable facts", () => {
    it("passes a long specific durable fact", () => {
      const content = "User prefers TypeScript over JavaScript for large production codebases";
      const result = guardFact(content);
      expect(result.pass).toBe(true);
      expect(result.expiresAt).toBeUndefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it("confidence is higher for longer more specific facts", () => {
      const short = "User likes dark mode in the IDE and prefers it";
      const long = "User prefers dark mode across all editors, uses VS Code and Cursor as their primary tools, and has configured custom key bindings for productivity";
      const shortResult = guardFact(short);
      const longResult = guardFact(long);
      expect(longResult.confidence).toBeGreaterThan(shortResult.confidence);
    });

    it("confidence is capped at 1.0", () => {
      const veryLong = "x".repeat(500);
      // needs to be at least 4 words
      const fact = `User has very long preference description: ${veryLong}`;
      const result = guardFact(fact);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it("passes without expiresAt for non-transient content", () => {
      const result = guardFact("User is building a personal AI called Spaceduck");
      expect(result.expiresAt).toBeUndefined();
    });
  });
});
