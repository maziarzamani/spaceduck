import { useState, useCallback, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card";
import { Label } from "../../ui/label";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../ui/select";
import { Loader2 } from "lucide-react";
import { DebouncedInput } from "../shared/debounced-input";
import type { SectionProps } from "./shared";
import { getPath, isSecretSet, validateHttpUrl } from "./shared";
import type { ToolName, ToolStatusEntry, ToolTestResponse } from "../../lib/tool-types";

function getApiBase(): string {
  const stored = localStorage.getItem("spaceduck.gatewayUrl");
  if (stored) return stored;
  if (typeof window !== "undefined" && "__TAURI__" in window) return "http://localhost:3000";
  return window.location.origin;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("spaceduck.token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function useToolStatus() {
  const [entries, setEntries] = useState<ToolStatusEntry[]>([]);
  const [testing, setTesting] = useState<ToolName | null>(null);
  const [testResult, setTestResult] = useState<Record<string, ToolTestResponse>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/tools/status`, {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { tools: ToolStatusEntry[] };
        setEntries(data.tools);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const test = useCallback(async (tool: ToolName) => {
    setTesting(tool);
    setTestResult((prev) => { const n = { ...prev }; delete n[tool]; return n; });
    try {
      const res = await fetch(`${getApiBase()}/api/tools/test`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tool }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json() as ToolTestResponse;
      setTestResult((prev) => ({ ...prev, [tool]: data }));
      refresh();
    } catch {
      setTestResult((prev) => ({ ...prev, [tool]: { tool, ok: false, message: "Request failed" } }));
    } finally {
      setTesting(null);
    }
  }, [refresh]);

  return { entries, testing, testResult, test, refresh };
}

function StatusBadge({ entry, testResult }: { entry?: ToolStatusEntry; testResult?: ToolTestResponse }) {
  if (testResult) {
    return (
      <span className={`text-xs font-medium ${testResult.ok ? "text-green-500" : "text-destructive"}`}>
        {testResult.ok ? "OK" : testResult.message ? `Error: ${testResult.message.slice(0, 60)}` : "Error"}
        {testResult.durationMs != null && ` (${testResult.durationMs}ms)`}
      </span>
    );
  }
  if (!entry) return null;
  const colors: Record<string, string> = {
    ok: "text-green-500",
    error: "text-destructive",
    not_configured: "text-muted-foreground",
    disabled: "text-muted-foreground",
    unavailable: "text-yellow-500",
  };
  const labels: Record<string, string> = {
    ok: "Ready",
    error: "Error",
    not_configured: "Not configured",
    disabled: "Disabled",
    unavailable: "Unavailable",
  };
  return (
    <span className={`text-xs font-medium ${colors[entry.status] ?? "text-muted-foreground"}`}>
      {labels[entry.status] ?? entry.status}
      {entry.message && ` — ${entry.message.slice(0, 60)}`}
    </span>
  );
}

export function ToolsSection({ cfg }: SectionProps) {
  const config = cfg.config;
  if (!config) return null;

  const webSearch = (getPath(config, "tools/webSearch") ?? {}) as Record<string, unknown>;
  const webAnswer = (getPath(config, "tools/webAnswer") ?? {}) as Record<string, unknown>;
  const browserCfg = (getPath(config, "tools/browser") ?? {}) as Record<string, unknown>;
  const webFetchCfg = (getPath(config, "tools/webFetch") ?? {}) as Record<string, unknown>;
  const marker = (getPath(config, "tools/marker") ?? {}) as Record<string, unknown>;

  const searchProvider = (webSearch.provider as string | null) ?? null;
  const searxngUrl = (webSearch.searxngUrl as string | null) ?? "";
  const webAnswerEnabled = (webAnswer.enabled as boolean) ?? true;
  const browserEnabled = (browserCfg.enabled as boolean) ?? true;
  const webFetchEnabled = (webFetchCfg.enabled as boolean) ?? true;
  const markerEnabled = (marker.enabled as boolean) ?? true;

  const hasBraveKey = isSecretSet(cfg.secrets, "/tools/webSearch/secrets/braveApiKey");
  const hasPerplexityKey = isSecretSet(cfg.secrets, "/tools/webAnswer/secrets/perplexityApiKey");

  const [urlError, setUrlError] = useState<string | null>(null);

  const { entries: toolStatus, testing, testResult, test: testTool } = useToolStatus();
  const wsStatus = toolStatus.find((e) => e.tool === "web_search");
  const waStatus = toolStatus.find((e) => e.tool === "web_answer");
  const brStatus = toolStatus.find((e) => e.tool === "browser_navigate");
  const wfStatus = toolStatus.find((e) => e.tool === "web_fetch");
  const mkStatus = toolStatus.find((e) => e.tool === "marker_scan");

  const patch = useCallback(
    (path: string, value: unknown) => {
      cfg.patchConfig([{ op: "replace", path, value }]);
    },
    [cfg],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Tools</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure external tools available to the AI.
        </p>
      </div>

      {/* Web Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Web Search</CardTitle>
          <CardDescription>
            Allow the AI to search the web for real-time information.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Search Provider</Label>
            <Select
              value={searchProvider ?? "none"}
              onValueChange={(v) => patch("/tools/webSearch/provider", v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Disabled" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Disabled</SelectItem>
                <SelectItem value="searxng">SearXNG (self-hosted)</SelectItem>
                <SelectItem value="brave">Brave Search</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {searchProvider === "searxng" && (
            <div className="grid gap-2">
              <Label htmlFor="searxng-url">SearXNG URL</Label>
              <DebouncedInput
                id="searxng-url"
                value={searxngUrl}
                placeholder="http://localhost:8080"
                error={urlError}
                onLocalChange={() => setUrlError(null)}
                onCommit={async (v) => {
                  const result = validateHttpUrl(v);
                  if (!result.ok) {
                    setUrlError(result.message);
                    return false;
                  }
                  setUrlError(null);
                  return cfg.patchConfig([
                    { op: "replace", path: "/tools/webSearch/searxngUrl", value: result.normalized || null },
                  ]);
                }}
              />
            </div>
          )}

          {searchProvider === "brave" && (
            <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
              <span className="text-sm">Brave API Key</span>
              <span className={`text-xs ${hasBraveKey ? "text-green-500" : "text-muted-foreground"}`}>
                {hasBraveKey ? "Configured" : "Not set"}
              </span>
            </div>
          )}

          {searchProvider && (
            <div className="flex items-center justify-between pt-2 border-t">
              <StatusBadge entry={wsStatus} testResult={testResult["web_search"]} />
              <Button
                variant="outline"
                size="sm"
                disabled={testing === "web_search"}
                onClick={() => testTool("web_search")}
              >
                {testing === "web_search" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Test
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Web Answer */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Web Answer</CardTitle>
            <CardDescription>
              AI-powered web answers via Perplexity.
            </CardDescription>
          </div>
          <Switch
            checked={webAnswerEnabled}
            onCheckedChange={(v) => patch("/tools/webAnswer/enabled", v)}
          />
        </CardHeader>
        {webAnswerEnabled && (
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
              <span className="text-sm">Perplexity API Key</span>
              <span
                className={`text-xs ${hasPerplexityKey ? "text-green-500" : "text-muted-foreground"}`}
              >
                {hasPerplexityKey ? "Configured" : "Not set"}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <StatusBadge entry={waStatus} testResult={testResult["web_answer"]} />
              <Button
                variant="outline"
                size="sm"
                disabled={testing === "web_answer"}
                onClick={() => testTool("web_answer")}
              >
                {testing === "web_answer" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Test
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Browser */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Browser</CardTitle>
            <CardDescription>
              Headless browser for JavaScript-rendered pages.
              {cfg.capabilities.browser && !cfg.capabilities.browser.available && (
                <span className="block text-xs text-yellow-500 mt-1">
                  {cfg.capabilities.browser.reason ?? "Chromium not installed."}
                </span>
              )}
            </CardDescription>
          </div>
          <Switch
            checked={browserEnabled}
            onCheckedChange={(v) => patch("/tools/browser/enabled", v)}
          />
        </CardHeader>
        {browserEnabled && (
          <CardContent>
            <div className="flex items-center justify-between pt-2 border-t">
              <StatusBadge entry={brStatus} testResult={testResult["browser_navigate"]} />
              <Button
                variant="outline"
                size="sm"
                disabled={testing === "browser_navigate"}
                onClick={() => testTool("browser_navigate")}
              >
                {testing === "browser_navigate" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Test
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Web Fetch */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Web Fetch</CardTitle>
            <CardDescription>
              Fetch and read web pages as plain text (no JavaScript).
            </CardDescription>
          </div>
          <Switch
            checked={webFetchEnabled}
            onCheckedChange={(v) => patch("/tools/webFetch/enabled", v)}
          />
        </CardHeader>
        {webFetchEnabled && (
          <CardContent>
            <div className="flex items-center justify-between pt-2 border-t">
              <StatusBadge entry={wfStatus} testResult={testResult["web_fetch"]} />
              <Button
                variant="outline"
                size="sm"
                disabled={testing === "web_fetch"}
                onClick={() => testTool("web_fetch")}
              >
                {testing === "web_fetch" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Test
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Marker */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Marker (PDF/Document)</CardTitle>
            <CardDescription>
              Extract text from PDFs and documents.
              {cfg.capabilities.marker && !cfg.capabilities.marker.available && (
                <span className="block text-xs text-yellow-500 mt-1">
                  {cfg.capabilities.marker.reason ?? "Binary not found on server."}
                </span>
              )}
            </CardDescription>
          </div>
          <Switch
            checked={markerEnabled}
            onCheckedChange={(v) => patch("/tools/marker/enabled", v)}
          />
        </CardHeader>
        {markerEnabled && (
          <CardContent>
            <div className="flex items-center justify-between pt-2 border-t">
              <StatusBadge entry={mkStatus} testResult={testResult["marker_scan"]} />
              <Button
                variant="outline"
                size="sm"
                disabled={testing === "marker_scan"}
                onClick={() => testTool("marker_scan")}
              >
                {testing === "marker_scan" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Test
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
