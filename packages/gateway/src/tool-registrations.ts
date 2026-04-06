// Tool registrations: loads tool plugins and registers gateway-internal tools

import type { Logger } from "@spaceduck/core";
import { ToolRegistry } from "@spaceduck/core";
import { discoverPlugins, loadPlugins, type LoadResult } from "@spaceduck/tool-loader";
import { resolve } from "node:path";
import type { AttachmentStore } from "./attachment-store";
import type { ConfigStore } from "./config";
import type { BrowserSessionPool } from "./browser-session-pool";
import { isSecretPath, decodePointer } from "@spaceduck/config";

/**
 * Build a ToolRegistry by discovering and loading tool plugins,
 * then registering gateway-internal tools (config, render_chart).
 */
export async function buildToolRegistry(
  logger: Logger,
  attachmentStore?: AttachmentStore,
  configStore?: ConfigStore,
  _onBrowserFrame?: unknown,
  browserPool?: BrowserSessionPool,
  getConversationId?: () => string,
): Promise<LoadResult> {
  const log = logger.child({ component: "ToolRegistry" });

  let cfg: import("@spaceduck/config").SpaceduckProductConfig | undefined;
  try { cfg = configStore?.current; } catch { /* not loaded yet */ }

  // ── Discover and load plugins ─────────────────────────────────────
  const toolsDir = resolve(import.meta.dir, "../../tools");
  const discResult = await discoverPlugins(toolsDir);

  let loadResult: LoadResult;

  if (discResult.ok) {
    loadResult = await loadPlugins(discResult.value, {
      logger,
      config: (cfg ?? {}) as Record<string, unknown>,
      env: Bun.env as Record<string, string | undefined>,
      services: {
        attachmentStore: attachmentStore
          ? { resolve: (id: string) => attachmentStore.resolve(id) }
          : undefined,
        browserPool: browserPool
          ? { acquire: (cid: string) => browserPool.acquire(cid) }
          : undefined,
        getConversationId,
      },
    });
  } else {
    log.error("Plugin discovery failed", { error: discResult.error.message });
    loadResult = {
      registry: new ToolRegistry(),
      plugins: [],
      rebuildConfigPaths: new Set(),
      rebuildSecretPaths: new Set(),
    };
  }

  const registry = loadResult.registry;

  // ── Gateway-internal tools ────────────────────────────────────────

  // config_get / config_set
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
          "Replace a single non-secret GATEWAY config value using a JSON Pointer path. " +
          "This is ONLY for Spaceduck system settings like /ai/model, /ai/temperature, /ai/provider, /stt/language, etc. " +
          "Do NOT use this tool to store user preferences, facts, or personal information — those are stored automatically in memory. " +
          "Path must already exist. Secret paths (API keys) cannot be set via this tool.",
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

  // render_chart
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

  log.info("Tool registry initialized", { tools: registry.size });
  return loadResult;
}

/** @deprecated Use buildToolRegistry — kept for one release cycle */
export const createToolRegistry = buildToolRegistry;
