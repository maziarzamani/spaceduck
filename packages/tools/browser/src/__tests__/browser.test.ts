// Browser tool tests -- requires network access and Playwright Chromium
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { BrowserTool } from "..";
import type { ScreencastFrame } from "../types";

describe("BrowserTool.isAvailable", () => {
  it("returns available: true when Chromium is installed", () => {
    const result = BrowserTool.isAvailable();
    expect(result.available).toBe(true);
  });
});

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

  describe("screenshotBase64", () => {
    it("should return a base64 string", async () => {
      await browser.navigate("https://example.com");
      const b64 = await browser.screenshotBase64();
      expect(b64).toBeTruthy();
      expect(typeof b64).toBe("string");
      expect(b64!.length).toBeGreaterThan(100);
    });

    it("should return null when no page is open", async () => {
      const fresh = new BrowserTool({ headless: true });
      const result = await fresh.screenshotBase64();
      expect(result).toBeNull();
    });
  });

  describe("currentUrl", () => {
    it("should return the current page URL", async () => {
      await browser.navigate("https://example.com");
      const url = browser.currentUrl();
      expect(url).toContain("example.com");
    });

    it("should return null when no page is open", () => {
      const fresh = new BrowserTool({ headless: true });
      expect(fresh.currentUrl()).toBeNull();
    });
  });

  describe("screencast", () => {
    it("should deliver frames via callback", async () => {
      const frames: ScreencastFrame[] = [];
      await browser.navigate("https://example.com");
      await browser.startScreencast((frame) => frames.push(frame));

      // Trigger a visual change to produce at least one frame
      await browser.navigate("https://example.com/");
      await browser.wait({ timeMs: 1500 });

      await browser.stopScreencast();

      expect(frames.length).toBeGreaterThanOrEqual(1);
      const frame = frames[0];
      expect(frame.base64).toBeTruthy();
      expect(frame.format).toBe("jpeg");
      expect(frame.url).toContain("example.com");
    });

    it("stopScreencast should be idempotent", async () => {
      await browser.stopScreencast();
      await browser.stopScreencast();
    });
  });
});
