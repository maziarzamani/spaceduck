import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card";
import { Label } from "../../ui/label";
import { Switch } from "../../ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../ui/select";
import { DebouncedInput } from "../shared/debounced-input";
import type { SectionProps } from "./shared";
import { getPath, isSecretSet, validateHttpUrl } from "./shared";

export function ToolsSection({ cfg }: SectionProps) {
  const config = cfg.config;
  if (!config) return null;

  const webSearch = (getPath(config, "tools/webSearch") ?? {}) as Record<string, unknown>;
  const webAnswer = (getPath(config, "tools/webAnswer") ?? {}) as Record<string, unknown>;
  const marker = (getPath(config, "tools/marker") ?? {}) as Record<string, unknown>;

  const searchProvider = (webSearch.provider as string | null) ?? null;
  const searxngUrl = (webSearch.searxngUrl as string | null) ?? "";
  const webAnswerEnabled = (webAnswer.enabled as boolean) ?? true;
  const markerEnabled = (marker.enabled as boolean) ?? true;

  const hasBraveKey = isSecretSet(cfg.secrets, "/tools/webSearch/secrets/braveApiKey");
  const hasPerplexityKey = isSecretSet(cfg.secrets, "/tools/webAnswer/secrets/perplexityApiKey");

  const [urlError, setUrlError] = useState<string | null>(null);

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
          <CardContent>
            <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
              <span className="text-sm">Perplexity API Key</span>
              <span
                className={`text-xs ${hasPerplexityKey ? "text-green-500" : "text-muted-foreground"}`}
              >
                {hasPerplexityKey ? "Configured" : "Not set"}
              </span>
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
      </Card>
    </div>
  );
}
