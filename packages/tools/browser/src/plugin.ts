import type { ToolPlugin, ToolContribution } from "@spaceduck/core";
import { BrowserTool } from "./browser-tool";

export const plugin: ToolPlugin = {
  id: "browser",
  displayName: "Browser",
  configKey: "browser",
  rebuildOnConfigPaths: ["/tools/browser/enabled"],

  async activate(ctx): Promise<readonly ToolContribution[]> {
    const { browserPool, getConversationId } = ctx.services;
    const log = ctx.logger;
    let singletonBrowser: BrowserTool | null = null;

    async function ensureBrowser(): Promise<BrowserTool> {
      if (browserPool && getConversationId) {
        return browserPool.acquire(getConversationId()) as Promise<BrowserTool>;
      }
      if (!singletonBrowser) singletonBrowser = new BrowserTool();
      return singletonBrowser;
    }

    return [
      {
        definition: {
          name: "browser_navigate",
          description:
            "Navigate the headless browser to a URL and make it the current page. Use for pages that require JavaScript rendering. After navigation, usually call browser_snapshot to inspect interactive elements.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to navigate to" },
            },
            required: ["url"],
          },
        },
        handler: async (args) => {
          const b = await ensureBrowser();
          return b.navigate(args.url as string);
        },
      },
      {
        definition: {
          name: "browser_snapshot",
          description:
            "Take an accessibility snapshot of the current page. Returns numbered element refs that can be used with browser_click, browser_type, etc.",
          parameters: { type: "object", properties: {} },
        },
        handler: async () => {
          const b = await ensureBrowser();
          return b.snapshot();
        },
      },
      {
        definition: {
          name: "browser_click",
          description:
            "Click an element by ref from the most recent browser_snapshot. If refs are stale after navigation or page updates, take a new snapshot first.",
          parameters: {
            type: "object",
            properties: {
              ref: { type: "number", description: "Element ref number from snapshot" },
            },
            required: ["ref"],
          },
        },
        handler: async (args) => {
          const b = await ensureBrowser();
          return b.click(args.ref as number);
        },
      },
      {
        definition: {
          name: "browser_type",
          description:
            "Type text into an input by ref from the most recent browser_snapshot. Use clear=true to replace existing content. If the page changed since the snapshot, take a new snapshot first.",
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
        handler: async (args) => {
          const b = await ensureBrowser();
          return b.type(args.ref as number, args.text as string, {
            clear: args.clear as boolean | undefined,
          });
        },
      },
      {
        definition: {
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
        handler: async (args) => {
          const b = await ensureBrowser();
          return b.scroll(
            args.direction as "up" | "down" | "left" | "right",
            args.amount as number | undefined,
          );
        },
      },
      {
        definition: {
          name: "browser_wait",
          description:
            "Wait for a condition on the current page. Use timeMs for a simple delay (best for SPAs/JS-heavy sites), " +
            "selector for a CSS element to appear, or jsCondition for custom checks. " +
            "Avoid state: 'networkidle' on SPAs — they never stop making requests and it will timeout.",
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
        handler: async (args) => {
          const b = await ensureBrowser();
          return b.wait(args as Record<string, unknown>);
        },
      },
      {
        definition: {
          name: "browser_evaluate",
          description:
            "Execute JavaScript in the browser page context and return the result as a string. " +
            "Prefer this for extracting structured data from JS-heavy pages (e.g. product listings, search results, tables) — " +
            "a single evaluate call with document.querySelectorAll is far faster than multiple snapshot/scroll cycles.",
          parameters: {
            type: "object",
            properties: {
              script: { type: "string", description: "JavaScript code to evaluate" },
            },
            required: ["script"],
          },
        },
        handler: async (args) => {
          const b = await ensureBrowser();
          return b.evaluate(args.script as string);
        },
      },
    ];
  },
};
