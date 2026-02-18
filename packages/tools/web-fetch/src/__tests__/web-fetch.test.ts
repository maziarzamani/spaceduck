// Web fetch tool tests -- requires network access
import { describe, it, expect } from "bun:test";
import { WebFetchTool } from "..";

describe("WebFetchTool", () => {
  const fetcher = new WebFetchTool();

  describe("HTML pages", () => {
    it("should fetch and convert HTML to readable text", async () => {
      const result = await fetcher.fetch("https://example.com");

      expect(result).toContain("URL: https://example.com");
      expect(result).toContain("Title: Example Domain");
      expect(result).toContain("EXAMPLE DOMAIN");
      expect(result).toContain("Learn more");
    });

    it("should include link URLs in output", async () => {
      const result = await fetcher.fetch("https://example.com");
      expect(result).toContain("iana.org");
    });
  });

  describe("JSON endpoints", () => {
    it("should pretty-print JSON responses", async () => {
      const result = await fetcher.fetch("https://jsonplaceholder.typicode.com/todos/1");

      expect(result).toContain("Content-Type: application/json");
      expect(result).toContain('"userId": 1');
      expect(result).toContain('"completed": false');
    });
  });

  describe("error handling", () => {
    it("should return error string for 404", async () => {
      const result = await fetcher.fetch("https://httpstat.us/404");
      expect(result).toContain("Error:");
      expect(result).toContain("404");
    });

    it("should return error string for invalid URL", async () => {
      const result = await fetcher.fetch("https://this-domain-does-not-exist-spaceduck.example");
      expect(result).toContain("Error:");
    });

    it("should handle timeout", async () => {
      const shortTimeout = new WebFetchTool({ timeoutMs: 1 });
      const result = await shortTimeout.fetch("https://example.com");
      expect(result).toContain("Error:");
    });
  });

  describe("truncation", () => {
    it("should truncate output at maxChars", async () => {
      const tiny = new WebFetchTool({ maxChars: 50 });
      const result = await tiny.fetch("https://example.com");

      expect(result.length).toBeLessThanOrEqual(65); // 50 + [truncated] marker
      expect(result).toContain("[truncated]");
    });
  });
});
