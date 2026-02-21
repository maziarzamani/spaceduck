// Tool registrations: bridges tool classes to ToolRegistry
// Each tool class is wrapped with a ToolDefinition + ToolHandler pair.

import type { Logger } from "@spaceduck/core";
import { ToolRegistry } from "@spaceduck/core";
import { BrowserTool } from "@spaceduck/tool-browser";
import { WebFetchTool } from "@spaceduck/tool-web-fetch";
import { WebSearchTool, WebAnswerTool, type SearchProvider } from "@spaceduck/tool-web-search";
import { MarkerTool } from "@spaceduck/tool-marker";
import type { AttachmentStore } from "./attachment-store";
import type { ConfigStore } from "./config";
import { isSecretPath, decodePointer } from "@spaceduck/config";

/**
 * Build a ToolRegistry pre-loaded with all built-in tools.
 * Lazily launches the browser only on first use.
 */
export function createToolRegistry(
  logger: Logger,
  attachmentStore?: AttachmentStore,
  configStore?: ConfigStore,
): ToolRegistry {
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

  // ── web_search (Brave / SearXNG) ──────────────────────────────────
  const braveApiKey = Bun.env.BRAVE_API_KEY;
  const searxngUrl = Bun.env.SEARXNG_URL;
  const searchProvider = (Bun.env.SEARCH_PROVIDER ?? "brave") as SearchProvider;

  if (braveApiKey || searxngUrl) {
    const webSearch = new WebSearchTool({
      provider: searxngUrl && !braveApiKey ? "searxng" : searchProvider,
      braveApiKey,
      searxngUrl,
      searxngUserAgent: Bun.env.SEARXNG_USER_AGENT,
    });

    registry.register(
      {
        name: "web_search",
        description:
          "Find web pages about a query and return a ranked list of results (title, URL, snippet, optional published date). " +
          "Use this when you need sources, links, or to compare multiple pages. " +
          "Do NOT use this tool to write a final answer; it returns search results, not a synthesized response. " +
          "If the user asks for a direct answer with citations, prefer the web_answer tool.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query." },
            count: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Number of results to return (1–10, default 5).",
            },
            freshness: {
              type: "string",
              enum: ["pd", "pw", "pm", "py"],
              description: "Freshness filter: pd=past day, pw=past week, pm=past month, py=past year.",
            },
            country: {
              type: "string",
              description: 'Country code for region-specific results (e.g. "DK", "US").',
            },
            searchLang: {
              type: "string",
              description: 'Language code for results (e.g. "da", "en", "da-DK").',
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      async (args) => {
        log.debug("web_search", { query: args.query, provider: searchProvider });
        return webSearch.search(args.query as string, {
          count: args.count as number | undefined,
          freshness: args.freshness as "pd" | "pw" | "pm" | "py" | undefined,
          country: args.country as string | undefined,
          searchLang: args.searchLang as string | undefined,
        });
      },
    );

    log.info("web_search registered", { provider: webSearch["provider"] });
  } else {
    log.debug("web_search not registered (no BRAVE_API_KEY or SEARXNG_URL)");
  }

  // ── web_answer (Perplexity Sonar) ───────────────────────────────────
  const perplexityApiKey = Bun.env.PERPLEXITY_API_KEY;
  const openrouterApiKey = Bun.env.OPENROUTER_API_KEY;

  if (perplexityApiKey || openrouterApiKey) {
    const webAnswer = new WebAnswerTool({
      perplexityApiKey,
      openrouterApiKey,
    });

    registry.register(
      {
        name: "web_answer",
        description:
          "Answer a factual question using real-time web search and return a concise answer with sources. " +
          "Use this when the user wants a direct answer with citations. " +
          "If sources/citations are missing (provider limitation), say so explicitly and suggest using web_search to verify.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Question to answer." },
            searchLang: {
              type: "string",
              description: 'Language code (e.g. "da", "en", "da-DK").',
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      async (args) => {
        log.debug("web_answer", { query: args.query, provider: webAnswer["provider"] });
        return webAnswer.answer(args.query as string, {
          searchLang: args.searchLang as string | undefined,
        });
      },
    );

    log.info("web_answer registered", {
      provider: perplexityApiKey ? "perplexity-direct" : "openrouter",
    });
  } else {
    log.debug("web_answer not registered (no PERPLEXITY_API_KEY or OPENROUTER_API_KEY)");
  }

  // ── marker_scan (conditional — only if marker_single is on PATH) ────
  if (attachmentStore) {
    MarkerTool.isAvailable().then((available) => {
      if (!available) {
        log.debug("marker_scan not registered (marker_single not on PATH)");
        return;
      }

      const marker = new MarkerTool();

      registry.register(
        {
          name: "marker_scan",
          description:
            "Convert a PDF document to markdown. Use when the user uploads a PDF or asks to read/summarize a document. Requires an attachmentId from a file the user uploaded.",
          parameters: {
            type: "object",
            properties: {
              attachmentId: { type: "string", description: "The attachment ID from the uploaded file." },
              pageRange: { type: "string", description: "Optional page range, e.g. '0-5' for first 6 pages." },
              forceOcr: { type: "boolean", description: "Force OCR even for text-based PDFs." },
            },
            required: ["attachmentId"],
          },
        },
        async (args) => {
          const path = attachmentStore.resolve(args.attachmentId as string);
          if (!path) return "Error: attachment not found or expired.";
          log.debug("marker_scan", { attachmentId: args.attachmentId });
          return marker.convert(path, {
            pageRange: args.pageRange as string | undefined,
            forceOcr: args.forceOcr as boolean | undefined,
          });
        },
      );

      log.info("marker_scan registered");
    });
  }

  // ── config_get / config_set (conditional — only if configStore available) ─

  if (configStore) {
    registry.register(
      {
        name: "config_get",
        description:
          "Read the current Spaceduck configuration. Optionally pass a JSON Pointer path to get a specific value. " +
          "Secret values (API keys) are redacted — use Settings > Secrets to manage them.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                'Optional JSON Pointer (e.g. "/ai/model", "/ai/temperature"). Omit to get the full config.',
            },
          },
        },
      },
      async (args) => {
        const { config, rev } = configStore.getRedacted();
        const path = args.path as string | undefined;
        if (!path) {
          return JSON.stringify({ config, rev }, null, 2);
        }
        try {
          const segments = decodePointer(path);
          let value: unknown = config;
          for (const seg of segments) {
            if (value == null || typeof value !== "object") {
              return `Error: path "${path}" does not exist in config`;
            }
            value = (value as Record<string, unknown>)[seg];
          }
          return JSON.stringify({ path, value, rev }, null, 2);
        } catch (e) {
          return `Error: invalid path "${path}" — ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    );

    registry.register(
      {
        name: "config_set",
        description:
          "Change a single Spaceduck configuration value. Uses a JSON Pointer path and the new value. " +
          "Cannot set secret paths (API keys) — tell the user to use Settings > Secrets instead.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: 'JSON Pointer to the field to change (e.g. "/ai/model", "/ai/temperature").',
            },
            value: {
              description: "The new value to set at the given path.",
            },
          },
          required: ["path", "value"],
        },
      },
      async (args) => {
        const path = args.path as string;
        const value = args.value;

        if (isSecretPath(path)) {
          return "Error: Secret paths cannot be set via chat tools. Use Settings > Secrets to manage API keys.";
        }

        const rev = configStore.rev();
        const result = await configStore.patch(
          [{ op: "replace", path, value }],
          rev,
        );

        if (!result.ok) {
          if (result.error === "CONFLICT") {
            return "Error: config was modified concurrently. Please try again.";
          }
          if (result.error === "VALIDATION") {
            return `Error: invalid value — ${result.issues.map((i) => `${i.path}: ${i.message}`).join(", ")}`;
          }
          return `Error: ${result.message}`;
        }

        const response: Record<string, unknown> = {
          ok: true,
          path,
          value,
        };
        if (result.needsRestart) {
          response.needsRestart = result.needsRestart.fields;
        }
        return JSON.stringify(response, null, 2);
      },
    );

    log.info("config_get + config_set registered");
  }

  log.info("Tool registry initialized", { tools: registry.size });
  return registry;
}
