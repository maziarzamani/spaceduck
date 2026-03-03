import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { BrowserTool } from "../browser-tool";
import type { ScreencastFrame } from "../types";

const TEST_HTML = `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <h1>Welcome</h1>
  <nav>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
  </nav>
  <main>
    <form>
      <input type="search" aria-label="Search" placeholder="Search..." />
      <button type="submit">Submit</button>
    </form>
    <div style="height:3000px"></div>
  </main>
</body>
</html>`;

const ABOUT_HTML = `<!DOCTYPE html>
<html><head><title>About</title></head>
<body><h1>About Page</h1><a href="/">Back</a></body>
</html>`;

let server: Server;
let BASE: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/about") {
      res.end(ABOUT_HTML);
    } else {
      res.end(TEST_HTML);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  BASE = `http://localhost:${port}`;
});

afterAll(() => {
  server?.close();
});

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
      const result = await browser.navigate(BASE);
      expect(result).toContain("Navigated to");
      expect(result).toContain("status: 200");
    });
  });

  describe("snapshot", () => {
    it("should return numbered interactive elements", async () => {
      await browser.navigate(BASE);
      const snap = await browser.snapshot();

      expect(snap).toContain(`Page: ${BASE}/`);
      expect(snap).toContain("Title:");
      expect(snap).toMatch(/\[\d+\] Link/);
    });

    it("should include structural context", async () => {
      const snap = await browser.snapshot();
      expect(snap).toMatch(/Heading/);
    });
  });

  describe("click", () => {
    it("should click an element by ref", async () => {
      await browser.navigate(BASE);
      const snap = await browser.snapshot();
      const match = snap.match(/\[(\d+)\] Link "About"/);
      expect(match).toBeTruthy();
      const ref = parseInt(match![1], 10);
      const result = await browser.click(ref);
      expect(result).toBe(`Clicked [${ref}]`);
    });

    it("should throw on invalid ref", async () => {
      await expect(browser.click(9999)).rejects.toThrow("Invalid ref");
    });
  });

  describe("type", () => {
    it("should type into an input with clear", async () => {
      await browser.navigate(BASE);
      const snap = await browser.snapshot();

      const match = snap.match(/\[(\d+)\] Searchbox/);
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
      await browser.navigate(BASE);
      const filepath = `/tmp/spaceduck-browser-test-${Date.now()}.png`;
      const result = await browser.screenshot(filepath);
      expect(result).toContain("Screenshot saved to");

      expect(existsSync(filepath)).toBe(true);
      expect(statSync(filepath).size).toBeGreaterThan(0);
      unlinkSync(filepath);
    });
  });

  describe("evaluate", () => {
    it("should run JS and return result", async () => {
      await browser.navigate(BASE);
      const result = await browser.evaluate("document.title");
      expect(result).toBe("Test Page");
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
      await browser.navigate(BASE);
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
      await browser.navigate(BASE);
      const url = browser.currentUrl();
      expect(url).toContain("localhost");
    });

    it("should return null when no page is open", () => {
      const fresh = new BrowserTool({ headless: true });
      expect(fresh.currentUrl()).toBeNull();
    });
  });

  describe("screencast", () => {
    it("should deliver frames via callback", async () => {
      const frames: ScreencastFrame[] = [];
      await browser.navigate(BASE);
      await browser.startScreencast((frame) => frames.push(frame));

      await browser.navigate(`${BASE}/about`);
      await browser.wait({ timeMs: 1500 });

      await browser.stopScreencast();

      expect(frames.length).toBeGreaterThanOrEqual(1);
      const frame = frames[0];
      expect(frame.base64).toBeTruthy();
      expect(frame.format).toBe("jpeg");
      expect(frame.url).toContain("localhost");
    });

    it("stopScreencast should be idempotent", async () => {
      await browser.stopScreencast();
      await browser.stopScreencast();
    });
  });
});
