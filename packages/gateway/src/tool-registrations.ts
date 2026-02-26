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
 * Reads config store first, falls back to env vars for backwards compat.
 * Pure function: only depends on configStore.current, Bun.env, and injected deps.
 */
export function buildToolRegistry(
  logger: Logger,
  attachmentStore?: AttachmentStore,
  configStore?: ConfigStore,
): ToolRegistry {
  const registry = new ToolRegistry();
  const log = logger.child({ component: "ToolRegistry" });

  let cfg: import("@spaceduck/config").SpaceduckProductConfig | undefined;
  try { cfg = configStore?.current; } catch { /* not loaded yet, fall back to env */ }

  // ── web_fetch ──────────────────────────────────────────────────────
  const webFetchEnabled = cfg?.tools?.webFetch?.enabled ?? true;

  if (webFetchEnabled) {
    const webFetch = new WebFetchTool();

    registry.register(
      {
        name: "web_fetch",
        description:
          "Fetch a URL and return readable text content (HTML, JSON, or plain text). Prefer this when the user gives a specific URL. Returns raw fetched content, not JavaScript-rendered DOM. If the page requires JavaScript, login, or heavy client-side rendering, use browser_navigate instead.",
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
  } else {
    log.debug("web_fetch not registered (disabled in config)");
  }

  // ── browser tools ─────────────────────────────────────────────────
  const browserEnabled = cfg?.tools?.browser?.enabled ?? true;
  let browser: BrowserTool | null = null;

  if (browserEnabled) {
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
          "Navigate the headless browser to a URL and make it the current page. Use for pages that require JavaScript rendering. After navigation, usually call browser_snapshot to inspect interactive elements.",
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
          "Click an element by ref from the most recent browser_snapshot. If refs are stale after navigation or page updates, take a new snapshot first.",
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
      async (args) => {
        const b = await ensureBrowser();
        return b.evaluate(args.script as string);
      },
    );

    log.info("browser tools registered (7 tools)");
  } else {
    log.debug("browser tools not registered (disabled in config)");
  }

  // ── web_search (Brave / SearXNG) ──────────────────────────────────
  const braveApiKey = cfg?.tools?.webSearch?.secrets?.braveApiKey ?? Bun.env.BRAVE_API_KEY;
  const searxngUrl = cfg?.tools?.webSearch?.searxngUrl ?? Bun.env.SEARXNG_URL;
  const envSearchProvider = Bun.env.SEARCH_PROVIDER;
  const searchProvider: SearchProvider | null =
    cfg?.tools?.webSearch?.provider ??
    (envSearchProvider === "brave" || envSearchProvider === "searxng" ? envSearchProvider : null);

  if ((braveApiKey || searxngUrl) && searchProvider) {
    const webSearch = new WebSearchTool({
      provider: searchProvider,
      braveApiKey,
      searxngUrl,
      searxngUserAgent: Bun.env.SEARXNG_USER_AGENT,
    });

    registry.register(
      {
        name: "web_search",
        description:
          "Search the web and return ranked results (title, URL, snippet, optional date). Use this to find sources, compare pages, or gather links. This tool does not synthesize a final answer. For a direct cited answer, use web_answer.",
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
    log.debug("web_search not registered", {
      hasKey: !!braveApiKey, hasSearxng: !!searxngUrl, provider: searchProvider,
    });
  }

  // ── web_answer (Perplexity Sonar) ───────────────────────────────────
  const webAnswerEnabled = cfg?.tools?.webAnswer?.enabled ?? true;
  const perplexityApiKey = cfg?.tools?.webAnswer?.secrets?.perplexityApiKey ?? Bun.env.PERPLEXITY_API_KEY;
  const openrouterApiKey = cfg?.ai?.secrets?.openrouterApiKey ?? Bun.env.OPENROUTER_API_KEY;

  if (webAnswerEnabled && (perplexityApiKey || openrouterApiKey)) {
    const webAnswer = new WebAnswerTool({
      perplexityApiKey,
      openrouterApiKey,
    });

    registry.register(
      {
        name: "web_answer",
        description:
          "Answer a factual question using live web search and return a concise response with sources when available. Use this when the user wants a direct answer. Prefer web_search when you need to inspect or compare sources manually.",
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
    log.debug("web_answer not registered", {
      enabled: webAnswerEnabled,
      hasPerplexity: !!perplexityApiKey,
      hasOpenrouter: !!openrouterApiKey,
    });
  }

  // ── marker_scan (conditional — only if enabled, marker_single on PATH, and attachmentStore) ────
  const markerEnabled = cfg?.tools?.marker?.enabled ?? true;

  if (markerEnabled && attachmentStore) {
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
          "Replace a single non-secret config value using a JSON Pointer path. Path must already exist. Secret paths (API keys) cannot be set via chat tools and must be managed in Settings > Secrets.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: 'JSON Pointer to the field to change (e.g. "/ai/model", "/ai/temperature").',
            },
            value: {
              type: ["string", "number", "boolean", "null", "array", "object"],
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

  // ── render_chart ──────────────────────────────────────────────────
  // Validates chart data and returns a formatted chart code block.
  // The UI renders ```chart blocks as interactive Recharts visualizations.

  registry.register(
    {
      name: "render_chart",
      description:
        "Render a visual chart in the conversation. Call this tool with the chart specification and include the returned code block verbatim in your response. " +
        "Supported types: bar, line, area, pie. Data values for series must be numbers. Max 50 rows, max 8 series.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["bar", "line", "area", "pie"],
            description: "Chart type.",
          },
          title: { type: "string", description: "Chart title (optional)." },
          description: { type: "string", description: "Short description below the title (optional)." },
          data: {
            type: "array",
            items: { type: "object" },
            description: "Array of data objects. Each object is a row with string keys and string/number values.",
          },
          xKey: {
            type: "string",
            description: "Key for the X axis / category axis (required for bar, line, area).",
          },
          series: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Data key for this series." },
                label: { type: "string", description: "Display label (optional)." },
              },
              required: ["key"],
            },
            description: "Series to plot (required for bar, line, area). Max 8.",
          },
          nameKey: { type: "string", description: "Key for slice names (required for pie)." },
          valueKey: { type: "string", description: "Key for slice values (required for pie)." },
          stacked: { type: "boolean", description: "Stack series (bar/area only, default false)." },
          donut: { type: "boolean", description: "Donut style (pie only, default false)." },
          height: { type: "number", description: "Chart height in pixels (100-400, default 240)." },
        },
        required: ["type", "data"],
      },
    },
    async (args) => {
      const type = args.type as string;
      const data = args.data as unknown[];

      if (!Array.isArray(data) || data.length === 0) {
        return "Error: data must be a non-empty array of objects.";
      }
      if (data.length > 50) {
        return `Error: too many data rows (${data.length}). Maximum is 50.`;
      }

      const spec: Record<string, unknown> = { version: 1, type, data };

      if (args.title) spec.title = args.title;
      if (args.description) spec.description = args.description;
      if (args.height) spec.height = args.height;

      if (type === "pie") {
        if (!args.nameKey || !args.valueKey) {
          return "Error: pie charts require nameKey and valueKey.";
        }
        spec.nameKey = args.nameKey;
        spec.valueKey = args.valueKey;
        if (args.donut) spec.donut = true;
      } else {
        if (!args.xKey) {
          return `Error: ${type} charts require xKey.`;
        }
        if (!args.series || !Array.isArray(args.series) || (args.series as unknown[]).length === 0) {
          return `Error: ${type} charts require at least one series.`;
        }
        if ((args.series as unknown[]).length > 8) {
          return `Error: too many series (${(args.series as unknown[]).length}). Maximum is 8.`;
        }
        spec.xKey = args.xKey;
        spec.series = args.series;
        if (args.stacked) spec.stacked = true;
      }

      const json = JSON.stringify(spec);
      log.debug("render_chart", { type, rows: data.length });

      return (
        "Chart rendered. Include this code block verbatim in your response:\n\n" +
        "```chart\n" + json + "\n```"
      );
    },
  );

  log.info("render_chart registered");

  log.info("Tool registry initialized", { tools: registry.size });
  return registry;
}

/** @deprecated Use buildToolRegistry — kept for one release cycle */
export const createToolRegistry = buildToolRegistry;
