// Tool registrations: bridges tool classes to ToolRegistry
// Each tool class is wrapped with a ToolDefinition + ToolHandler pair.

import type { Logger } from "@spaceduck/core";
import { ToolRegistry } from "@spaceduck/core";
import { BrowserTool } from "@spaceduck/tool-browser";
import { WebFetchTool } from "@spaceduck/tool-web-fetch";

/**
 * Build a ToolRegistry pre-loaded with all built-in tools.
 * Lazily launches the browser only on first use.
 */
export function createToolRegistry(logger: Logger): ToolRegistry {
  const registry = new ToolRegistry();
  const log = logger.child({ component: "ToolRegistry" });

  // ── web_fetch ──────────────────────────────────────────────────────
  const webFetch = new WebFetchTool();

  registry.register(
    {
      name: "web_fetch",
      description:
        "Fetch a URL and return its content as readable text. Works for HTML pages, JSON APIs, and plain text. Use this for server-rendered content that does not require JavaScript.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
        },
        required: ["url"],
      },
    },
    async (args) => {
      const url = args.url as string;
      log.debug("web_fetch", { url });
      return webFetch.fetch(url);
    },
  );

  // ── browser_navigate ───────────────────────────────────────────────
  let browser: BrowserTool | null = null;

  async function ensureBrowser(): Promise<BrowserTool> {
    if (!browser) {
      browser = new BrowserTool({ headless: true });
      await browser.launch();
      log.info("Browser launched");
    }
    return browser;
  }

  registry.register(
    {
      name: "browser_navigate",
      description:
        "Navigate the headless browser to a URL. Use for pages that require JavaScript rendering. Returns navigation status.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to navigate to" },
        },
        required: ["url"],
      },
    },
    async (args) => {
      const b = await ensureBrowser();
      return b.navigate(args.url as string);
    },
  );

  // ── browser_snapshot ───────────────────────────────────────────────
  registry.register(
    {
      name: "browser_snapshot",
      description:
        "Take an accessibility snapshot of the current page. Returns numbered element refs that can be used with browser_click, browser_type, etc.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    async () => {
      const b = await ensureBrowser();
      return b.snapshot();
    },
  );

  // ── browser_click ──────────────────────────────────────────────────
  registry.register(
    {
      name: "browser_click",
      description:
        "Click an element by its ref number from the most recent snapshot.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "number", description: "Element ref number from snapshot" },
        },
        required: ["ref"],
      },
    },
    async (args) => {
      const b = await ensureBrowser();
      return b.click(args.ref as number);
    },
  );

  // ── browser_type ───────────────────────────────────────────────────
  registry.register(
    {
      name: "browser_type",
      description:
        "Type text into an input element by its ref number. Set clear=true to replace existing content.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "number", description: "Element ref number from snapshot" },
          text: { type: "string", description: "Text to type" },
          clear: { type: "boolean", description: "If true, clear the field before typing" },
        },
        required: ["ref", "text"],
      },
    },
    async (args) => {
      const b = await ensureBrowser();
      return b.type(args.ref as number, args.text as string, {
        clear: args.clear as boolean | undefined,
      });
    },
  );

  // ── browser_scroll ─────────────────────────────────────────────────
  registry.register(
    {
      name: "browser_scroll",
      description: "Scroll the page in a direction (up, down, left, right).",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down", "left", "right"],
            description: "Scroll direction",
          },
          amount: { type: "number", description: "Pixels to scroll (default: 500)" },
        },
        required: ["direction"],
      },
    },
    async (args) => {
      const b = await ensureBrowser();
      return b.scroll(
        args.direction as "up" | "down" | "left" | "right",
        args.amount as number | undefined,
      );
    },
  );

  // ── browser_wait ───────────────────────────────────────────────────
  registry.register(
    {
      name: "browser_wait",
      description:
        "Wait for a condition: a time delay, a CSS selector to appear, a URL match, a load state, or a JS expression to become truthy.",
      parameters: {
        type: "object",
        properties: {
          timeMs: { type: "number", description: "Milliseconds to wait" },
          selector: { type: "string", description: "CSS selector to wait for" },
          url: { type: "string", description: "URL pattern to wait for" },
          state: {
            type: "string",
            enum: ["load", "domcontentloaded", "networkidle"],
            description: "Page load state to wait for",
          },
          jsCondition: { type: "string", description: "JavaScript expression that should evaluate to truthy" },
        },
      },
    },
    async (args) => {
      const b = await ensureBrowser();
      return b.wait(args as any);
    },
  );

  // ── browser_evaluate ───────────────────────────────────────────────
  registry.register(
    {
      name: "browser_evaluate",
      description:
        "Execute JavaScript in the browser page context and return the result as a string.",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "JavaScript code to evaluate" },
        },
        required: ["script"],
      },
    },
    async (args) => {
      const b = await ensureBrowser();
      return b.evaluate(args.script as string);
    },
  );

  log.info("Tool registry initialized", { tools: registry.size });
  return registry;
}
