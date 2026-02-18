// Browser tool tests -- requires network access and Playwright Chromium
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { BrowserTool } from "..";

describe("BrowserTool", () => {
  let browser: BrowserTool;

  beforeAll(async () => {
    browser = new BrowserTool({ headless: true });
    await browser.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  describe("navigate", () => {
    it("should navigate and return status", async () => {
      const result = await browser.navigate("https://example.com");
      expect(result).toContain("Navigated to");
      expect(result).toContain("status: 200");
    });
  });

  describe("snapshot", () => {
    it("should return numbered interactive elements", async () => {
      await browser.navigate("https://example.com");
      const snap = await browser.snapshot();

      expect(snap).toContain("Page: https://example.com");
      expect(snap).toContain("Title:");
      // example.com has a "More information..." link
      expect(snap).toMatch(/\[\d+\] Link/);
    });

    it("should include structural context", async () => {
      const snap = await browser.snapshot();
      expect(snap).toMatch(/Heading/);
    });
  });

  describe("click", () => {
    it("should click an element by ref", async () => {
      await browser.navigate("https://news.ycombinator.com");
      await browser.snapshot();
      // Ref [1] is typically the "Hacker News" link
      const result = await browser.click(1);
      expect(result).toBe("Clicked [1]");
    });

    it("should throw on invalid ref", async () => {
      expect(browser.click(9999)).rejects.toThrow("Invalid ref");
    });
  });

  describe("type", () => {
    it("should type into an input with clear", async () => {
      await browser.navigate("https://duckduckgo.com");
      const snap = await browser.snapshot();

      // Find the search combobox ref
      const match = snap.match(/\[(\d+)\] Combobox/);
      expect(match).toBeTruthy();
      const ref = parseInt(match![1], 10);

      const result = await browser.type(ref, "test query", { clear: true });
      expect(result).toContain("Typed");
      expect(result).toContain("test query");
    });
  });

  describe("scroll", () => {
    it("should scroll down", async () => {
      const result = await browser.scroll("down", 300);
      expect(result).toBe("Scrolled down by 300px");
    });
  });

  describe("wait", () => {
    it("should wait for load state", async () => {
      const result = await browser.wait({ state: "domcontentloaded" });
      expect(result).toContain("domcontentloaded");
    });

    it("should wait for a fixed time", async () => {
      const result = await browser.wait({ timeMs: 100 });
      expect(result).toBe("Waited 100ms");
    });
  });

  describe("screenshot", () => {
    it("should save a screenshot", async () => {
      await browser.navigate("https://example.com");
      const path = `/tmp/spaceduck-browser-test-${Date.now()}.png`;
      const result = await browser.screenshot(path);
      expect(result).toContain("Screenshot saved to");

      const file = Bun.file(path);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);
      // Clean up
      await Bun.write(path, "");
    });
  });

  describe("evaluate", () => {
    it("should run JS and return result", async () => {
      await browser.navigate("https://example.com");
      const result = await browser.evaluate("document.title");
      expect(result).toBe("Example Domain");
    });

    it("should handle object results as JSON", async () => {
      const result = await browser.evaluate("({ a: 1, b: 'hello' })");
      const parsed = JSON.parse(result);
      expect(parsed.a).toBe(1);
      expect(parsed.b).toBe("hello");
    });
  });
});
