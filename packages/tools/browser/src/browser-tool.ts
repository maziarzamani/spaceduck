// BrowserTool: Playwright-based headless browser for AI agent use.
// Provides numbered element refs via accessibility snapshots so the LLM
// can reference elements by number instead of fragile CSS selectors.

import { chromium, type Browser, type BrowserContext, type Page, type Locator } from "playwright";
import type { BrowserToolOptions, WaitOptions, RefEntry } from "./types";
import { parseAriaSnapshot } from "./snapshot";

const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_TIMEOUT = 30_000;

export class BrowserTool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private refMap = new Map<number, RefEntry>();
  private readonly headless: boolean;
  private readonly maxChars: number;
  private readonly defaultTimeout: number;

  constructor(options: BrowserToolOptions = {}) {
    this.headless = options.headless ?? true;
    this.maxChars = options.maxResultChars ?? DEFAULT_MAX_CHARS;
    this.defaultTimeout = options.defaultTimeout ?? DEFAULT_TIMEOUT;
  }

  async launch(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.defaultTimeout);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.page = null;
    this.refMap.clear();
  }

  private ensurePage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  // ─── Actions ───────────────────────────────────────────────────────

  async navigate(url: string): Promise<string> {
    const page = this.ensurePage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? "unknown";
    return `Navigated to ${url} (status: ${status})`;
  }

  async snapshot(): Promise<string> {
    const page = this.ensurePage();

    const ariaYaml = await page.locator("body").ariaSnapshot();
    if (!ariaYaml) return "Empty page — no accessible elements found.";

    const result = parseAriaSnapshot(ariaYaml, page.url(), await page.title(), this.maxChars);
    this.refMap = result.refs;
    return result.text;
  }

  async click(ref: number): Promise<string> {
    const locator = await this.resolveRef(ref);
    await locator.click();
    return `Clicked [${ref}]`;
  }

  async type(ref: number, text: string, options?: { clear?: boolean }): Promise<string> {
    const locator = await this.resolveRef(ref);
    if (options?.clear) {
      await locator.fill(text);
    } else {
      await locator.pressSequentially(text, { delay: 30 });
    }
    return `Typed "${text}" into [${ref}]`;
  }

  async selectOption(ref: number, values: string[]): Promise<string> {
    const locator = await this.resolveRef(ref);
    await locator.selectOption(values);
    return `Selected [${values.join(", ")}] in [${ref}]`;
  }

  async hover(ref: number): Promise<string> {
    const locator = await this.resolveRef(ref);
    await locator.hover();
    return `Hovered over [${ref}]`;
  }

  async scroll(direction: "up" | "down" | "left" | "right", amount = 500): Promise<string> {
    const page = this.ensurePage();
    const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0;
    const deltaY = direction === "up" ? -amount : direction === "down" ? amount : 0;
    await page.mouse.wheel(deltaX, deltaY);
    return `Scrolled ${direction} by ${amount}px`;
  }

  async wait(options: WaitOptions): Promise<string> {
    const page = this.ensurePage();
    const timeout = options.timeout ?? this.defaultTimeout;

    if (options.timeMs) {
      await page.waitForTimeout(options.timeMs);
      return `Waited ${options.timeMs}ms`;
    }
    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout });
      return `Element "${options.selector}" appeared`;
    }
    if (options.url) {
      await page.waitForURL(options.url, { timeout });
      return `URL matched "${options.url}"`;
    }
    if (options.state) {
      await page.waitForLoadState(options.state);
      return `Page reached "${options.state}" state`;
    }
    if (options.jsCondition) {
      await page.waitForFunction(options.jsCondition, undefined, { timeout });
      return `JS condition met: ${options.jsCondition}`;
    }
    return "No wait condition specified";
  }

  async screenshot(path?: string): Promise<string> {
    const page = this.ensurePage();
    const filePath = path ?? `screenshot-${Date.now()}.png`;
    await page.screenshot({ path: filePath, fullPage: true });
    return `Screenshot saved to ${filePath}`;
  }

  async evaluate(script: string): Promise<string> {
    const page = this.ensurePage();
    const result = await page.evaluate(script);
    const str = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    if (str && str.length > this.maxChars) {
      return str.slice(0, this.maxChars) + "\n[truncated]";
    }
    return str ?? "undefined";
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  private async resolveRef(ref: number): Promise<Locator> {
    const entry = this.refMap.get(ref);
    if (!entry) {
      throw new Error(`Invalid ref [${ref}]. Take a new snapshot to get current refs.`);
    }

    const page = this.ensurePage();
    const locator = page.getByRole(entry.role as any, { name: entry.name });

    const count = await locator.count();
    if (count === 0) {
      throw new Error(
        `Ref [${ref}] (${entry.role} "${entry.name}") not found on page. Page may have changed — take a new snapshot.`,
      );
    }
    return count > 1 ? locator.first() : locator;
  }
}
