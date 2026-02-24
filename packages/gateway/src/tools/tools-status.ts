import type { ToolRegistry } from "@spaceduck/core";
import type { ConfigStore } from "../config/config-store";
import { MarkerTool } from "@spaceduck/tool-marker";

export type ToolName = "web_search" | "web_answer" | "marker_scan";
export type ToolStatus = "ok" | "error" | "not_configured" | "disabled" | "unavailable";

export interface ToolErrorEvent {
  tool: ToolName;
  message: string;
  timestamp: number;
}

export interface ToolStatusEntry {
  tool: ToolName;
  status: ToolStatus;
  message?: string;
  lastError?: { message: string; timestamp: number };
}

const MAX_ERRORS = 20;
const ERROR_TTL_MS = 30 * 60 * 1000;

export class ToolStatusService {
  private errors: ToolErrorEvent[] = [];

  constructor(
    private readonly getToolRegistry: () => ToolRegistry | undefined,
    private readonly configStore?: ConfigStore,
  ) {}

  recordError(tool: ToolName, message: string): void {
    this.errors.push({ tool, message, timestamp: Date.now() });
    if (this.errors.length > MAX_ERRORS) {
      this.errors = this.errors.slice(-MAX_ERRORS);
    }
  }

  private pruneStale(): void {
    const cutoff = Date.now() - ERROR_TTL_MS;
    this.errors = this.errors.filter((e) => e.timestamp > cutoff);
  }

  private lastErrorFor(tool: ToolName): ToolErrorEvent | undefined {
    for (let i = this.errors.length - 1; i >= 0; i--) {
      if (this.errors[i].tool === tool) return this.errors[i];
    }
    return undefined;
  }

  getStatus(): ToolStatusEntry[] {
    this.pruneStale();
    const cfg = this.configStore?.current;

    const entries: ToolStatusEntry[] = [];

    entries.push(this.getWebSearchStatus(cfg));
    entries.push(this.getWebAnswerStatus(cfg));
    entries.push(this.getMarkerStatus(cfg));

    return entries;
  }

  private getWebSearchStatus(cfg?: Record<string, unknown>): ToolStatusEntry {
    const toolsCfg = cfg?.tools as Record<string, unknown> | undefined;
    const ws = toolsCfg?.webSearch as Record<string, unknown> | undefined;
    const provider = ws?.provider as string | null;

    if (!provider) {
      return { tool: "web_search", status: "not_configured", message: "No search provider selected" };
    }

    const registry = this.getToolRegistry();
    const registered = registry?.has("web_search") ?? false;
    if (!registered) {
      if (provider === "brave") {
        return { tool: "web_search", status: "not_configured", message: "Brave API key not set (env: BRAVE_API_KEY)" };
      }
      if (provider === "searxng") {
        const url = ws?.searxngUrl as string | null;
        if (!url) {
          return { tool: "web_search", status: "not_configured", message: "SearXNG URL not configured" };
        }
        return { tool: "web_search", status: "unavailable", message: "SearXNG URL set but tool not registered (check env: SEARXNG_URL)" };
      }
      return { tool: "web_search", status: "unavailable", message: "Tool not registered" };
    }

    const lastErr = this.lastErrorFor("web_search");
    return {
      tool: "web_search",
      status: lastErr ? "error" : "ok",
      lastError: lastErr ? { message: lastErr.message, timestamp: lastErr.timestamp } : undefined,
    };
  }

  private getWebAnswerStatus(cfg?: Record<string, unknown>): ToolStatusEntry {
    const toolsCfg = cfg?.tools as Record<string, unknown> | undefined;
    const wa = toolsCfg?.webAnswer as Record<string, unknown> | undefined;
    const enabled = (wa?.enabled as boolean) ?? true;

    if (!enabled) {
      return { tool: "web_answer", status: "disabled" };
    }

    const registered = this.getToolRegistry()?.has("web_answer") ?? false;
    if (!registered) {
      return { tool: "web_answer", status: "not_configured", message: "API key not set (env: PERPLEXITY_API_KEY or OPENROUTER_API_KEY)" };
    }

    const lastErr = this.lastErrorFor("web_answer");
    return {
      tool: "web_answer",
      status: lastErr ? "error" : "ok",
      lastError: lastErr ? { message: lastErr.message, timestamp: lastErr.timestamp } : undefined,
    };
  }

  private getMarkerStatus(cfg?: Record<string, unknown>): ToolStatusEntry {
    const toolsCfg = cfg?.tools as Record<string, unknown> | undefined;
    const marker = toolsCfg?.marker as Record<string, unknown> | undefined;
    const enabled = (marker?.enabled as boolean) ?? true;

    if (!enabled) {
      return { tool: "marker_scan", status: "disabled" };
    }

    const registered = this.getToolRegistry()?.has("marker_scan") ?? false;
    if (!registered) {
      return { tool: "marker_scan", status: "unavailable", message: "marker_single binary not found on PATH" };
    }

    const lastErr = this.lastErrorFor("marker_scan");
    return {
      tool: "marker_scan",
      status: lastErr ? "error" : "ok",
      lastError: lastErr ? { message: lastErr.message, timestamp: lastErr.timestamp } : undefined,
    };
  }

  async probe(tool: ToolName): Promise<{ ok: boolean; message?: string; durationMs: number }> {
    const start = Date.now();
    const registry = this.getToolRegistry();

    switch (tool) {
      case "web_search": {
        if (!registry?.has("web_search")) {
          return { ok: false, message: "Tool not registered", durationMs: Date.now() - start };
        }
        try {
          const result = await registry.execute({
            id: `probe-${Date.now()}`,
            name: "web_search",
            args: { query: "test", count: 1 },
          });
          if (result.isError) {
            this.recordError("web_search", result.content);
            return { ok: false, message: result.content, durationMs: Date.now() - start };
          }
          return { ok: true, durationMs: Date.now() - start };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.recordError("web_search", msg);
          return { ok: false, message: msg, durationMs: Date.now() - start };
        }
      }

      case "web_answer": {
        if (!registry?.has("web_answer")) {
          return { ok: false, message: "Tool not registered", durationMs: Date.now() - start };
        }
        try {
          const result = await registry.execute({
            id: `probe-${Date.now()}`,
            name: "web_answer",
            args: { query: "ping" },
          });
          if (result.isError) {
            this.recordError("web_answer", result.content);
            return { ok: false, message: result.content, durationMs: Date.now() - start };
          }
          return { ok: true, durationMs: Date.now() - start };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.recordError("web_answer", msg);
          return { ok: false, message: msg, durationMs: Date.now() - start };
        }
      }

      case "marker_scan": {
        const available = await MarkerTool.isAvailable();
        if (!available) {
          return { ok: false, message: "marker_single binary not found", durationMs: Date.now() - start };
        }
        return { ok: true, durationMs: Date.now() - start };
      }

      default:
        return { ok: false, message: `Unknown tool: ${tool}`, durationMs: Date.now() - start };
    }
  }
}
