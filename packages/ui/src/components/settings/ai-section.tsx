import { useState, useCallback, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card";
import { Label } from "../../ui/label";
import { Button } from "../../ui/button";
import { Slider } from "../../ui/slider";
import { Separator } from "../../ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "../../ui/select";
import { Loader2, RefreshCw } from "lucide-react";
import type { SectionProps } from "./shared";
import { isSecretSet } from "./shared";
import { SecretInput } from "../shared/secret-input";
import { DebouncedInput, DebouncedTextarea, SavedBadge, useSaveFlash } from "../shared/debounced-input";
import { DEFAULT_SYSTEM_PROMPT } from "@spaceduck/config/constants";

// ── Constants ───────────────────────────────────────────────────────

const PROVIDERS = [
  { value: "gemini", label: "Google Gemini" },
  { value: "bedrock", label: "Amazon Bedrock" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "llamacpp", label: "llama.cpp" },
] as const;

const SECRET_LABELS: Record<string, { path: string; label: string; placeholder: string }> = {
  gemini: {
    path: "/ai/secrets/geminiApiKey",
    label: "Gemini API Key",
    placeholder: "AIza...",
  },
  bedrock: {
    path: "/ai/secrets/bedrockApiKey",
    label: "Bedrock API Key",
    placeholder: "ABSK...",
  },
  openrouter: {
    path: "/ai/secrets/openrouterApiKey",
    label: "OpenRouter API Key",
    placeholder: "sk-or-...",
  },
  lmstudio: {
    path: "/ai/secrets/lmstudioApiKey",
    label: "LM Studio API Key",
    placeholder: "Optional",
  },
  llamacpp: {
    path: "/ai/secrets/llamacppApiKey",
    label: "llama-server API Key",
    placeholder: "Optional",
  },
};

const LOCAL_PROVIDERS = new Set(["lmstudio", "llamacpp"]);

const BASE_URL_PLACEHOLDER: Record<string, string> = {
  lmstudio: "http://localhost:1234/v1",
  llamacpp: "http://127.0.0.1:8080/v1",
};

// ── Model catalog hook ──────────────────────────────────────────────

interface ModelEntry {
  id: string;
  name: string;
  context?: string;
}

function useModelCatalog(provider: string, hasKey: boolean) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const token = localStorage.getItem("spaceduck.token");
    if (!gatewayUrl) return;

    setLoading(true);
    fetch(`${gatewayUrl}/api/config/models`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10000),
    })
      .then((r) => r.ok ? r.json() as Promise<{ models: ModelEntry[] }> : Promise.reject())
      .then((data) => setModels(data.models))
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [provider, hasKey]);

  return { models, loading };
}

// ── Provider status hook ─────────────────────────────────────────────

type ProviderStatus = "idle" | "checking" | "ok" | "error";

function useProviderStatus(provider: string, model: string, hasKey: boolean) {
  const [status, setStatus] = useState<ProviderStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [checkedFor, setCheckedFor] = useState("");

  const check = useCallback(() => {
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const token = localStorage.getItem("spaceduck.token");
    if (!gatewayUrl) return;

    setStatus("checking");
    setErrorMsg(null);
    const key = `${provider}:${model}:${hasKey}`;
    fetch(`${gatewayUrl}/api/config/provider-status`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
      .then((data) => {
        setCheckedFor(key);
        if (data.ok) {
          setStatus("ok");
          setErrorMsg(null);
        } else {
          setStatus("error");
          setErrorMsg(data.error ?? "Unknown error");
        }
      })
      .catch((err) => {
        setCheckedFor(key);
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Connection failed");
      });
  }, [provider, model, hasKey]);

  // Auto-check when provider/model/key changes (but only if we already checked once)
  useEffect(() => {
    const key = `${provider}:${model}:${hasKey}`;
    if (checkedFor && checkedFor !== key) {
      check();
    }
  }, [provider, model, hasKey, checkedFor, check]);

  return { status, errorMsg, check };
}

// ── Main section ────────────────────────────────────────────────────

export function AiSection({ cfg }: SectionProps) {
  const ai = (cfg.config?.ai ?? {}) as Record<string, unknown>;
  const provider = (ai.provider as string) ?? "gemini";
  const model = (ai.model as string | null) ?? "";
  const baseUrl = (ai.baseUrl as string | null) ?? "";
  const temperature = (ai.temperature as number) ?? 0.7;
  const systemPrompt = (ai.systemPrompt as string | null) ?? "";
  const region = (ai.region as string | null) ?? "";

  const secretInfo = SECRET_LABELS[provider];
  const hasKey = secretInfo ? isSecretSet(cfg.secrets, secretInfo.path) : false;

  const { models: catalog, loading: catalogLoading } = useModelCatalog(provider, hasKey);
  const [manualMode, setManualMode] = useState(false);
  const [localTemp, setLocalTemp] = useState(temperature);
  useEffect(() => setLocalTemp(temperature), [temperature]);

  useEffect(() => {
    if (catalog.length === 0) {
      setManualMode(true);
    } else if (!catalog.some((m) => m.id === model)) {
      setManualMode(true);
    }
  }, [catalog, model]);

  const patch = useCallback(
    (path: string, value: unknown) => cfg.patchConfig([{ op: "replace", path, value }]),
    [cfg],
  );

  const { saved: tempSaved, flash: tempFlash } = useSaveFlash();
  const { status: providerStatus, errorMsg: providerError, check: checkProvider } =
    useProviderStatus(provider, model, hasKey);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Chat</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your assistant's responses — provider, model, temperature, and system prompt.
        </p>
      </div>

      {/* Provider, Key, Model, Region */}
      <Card>
        <CardContent className="pt-6 flex flex-col gap-5">
          <div className="grid gap-2">
            <Label htmlFor="provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) =>
                cfg.patchConfig([
                  { op: "replace", path: "/ai/provider", value: v },
                  { op: "replace", path: "/ai/model", value: null },
                  { op: "replace", path: "/ai/baseUrl", value: null },
                ])
              }
            >
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {secretInfo && (
            <div className="grid gap-2">
              <Label>{secretInfo.label}</Label>
              <SecretInput
                secretPath={secretInfo.path}
                placeholder={secretInfo.placeholder}
                isSet={hasKey}
                onSave={(value) => cfg.setSecret(secretInfo.path, value)}
                onClear={() => cfg.clearSecret(secretInfo.path)}
                saving={cfg.saving}
              />
              {!hasKey && !LOCAL_PROVIDERS.has(provider) && (
                <p className="text-xs text-yellow-500">
                  Required to use this provider.
                </p>
              )}
            </div>
          )}

          {LOCAL_PROVIDERS.has(provider) && (
            <div className="grid gap-2">
              <Label htmlFor="base-url">Server URL</Label>
              <DebouncedInput
                id="base-url"
                value={baseUrl}
                placeholder={BASE_URL_PLACEHOLDER[provider] ?? "http://localhost/v1"}
                onCommit={async (v) =>
                  cfg.patchConfig([{ op: "replace", path: "/ai/baseUrl", value: v || null }])
                }
              />
            </div>
          )}

          {provider === "llamacpp" && (
            <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <p>
                Start llama-server first:
              </p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all">
                llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080
              </pre>
              <p>
                Endpoint: <span className="font-mono">http://localhost:8080/v1/chat/completions</span>
              </p>
              <p>
                If responses look wrong, add{" "}
                <span className="font-mono">--chat-template</span> to your command.
              </p>
              <p className="text-yellow-500/80">
                Tool calling support varies by model and server configuration.
              </p>
            </div>
          )}

          {provider !== "llamacpp" && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Model</Label>
                <div className="inline-flex rounded-md border border-input text-xs">
                  <button
                    type="button"
                    onClick={() => setManualMode(false)}
                    disabled={catalog.length === 0}
                    className={`px-2.5 py-1 rounded-l-md transition-colors ${
                      !manualMode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    } ${catalog.length === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {catalogLoading ? (
                      <span className="inline-flex items-center gap-1">
                        <RefreshCw size={10} className="animate-spin" /> Auto
                      </span>
                    ) : (
                      "Auto"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualMode(true)}
                    className={`px-2.5 py-1 rounded-r-md border-l border-input transition-colors ${
                      manualMode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Manual
                  </button>
                </div>
              </div>
              {!manualMode && catalog.length > 0 ? (
                <Select
                  value={model}
                  onValueChange={(v) => patch("/ai/model", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Available models</SelectLabel>
                      {catalog.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span>{m.name}</span>
                          {m.context && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {m.context}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <DebouncedInput
                  id="model"
                  value={model}
                  placeholder="Enter model identifier"
                  onCommit={async (v) =>
                    cfg.patchConfig([
                      { op: "replace", path: "/ai/model", value: v || null },
                    ])
                  }
                />
              )}
            </div>
          )}

          {provider === "bedrock" && (
            <div className="grid gap-2">
              <Label htmlFor="region">AWS Region</Label>
              <DebouncedInput
                id="region"
                value={region}
                placeholder="e.g. us-east-1"
                onCommit={async (v) =>
                  cfg.patchConfig([{ op: "replace", path: "/ai/region", value: v || null }])
                }
              />
            </div>
          )}

          {/* Provider status */}
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {providerStatus === "checking" && (
                <Loader2 size={14} className="animate-spin text-muted-foreground" />
              )}
              {providerStatus === "ok" && (
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              )}
              {providerStatus === "error" && (
                <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
              {providerStatus === "idle" && (
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
              )}
              <span className="text-muted-foreground">
                {providerStatus === "idle" && "Not tested"}
                {providerStatus === "checking" && "Testing connection..."}
                {providerStatus === "ok" && "Provider connected"}
                {providerStatus === "error" && (providerError ?? "Connection failed")}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={checkProvider}
              disabled={providerStatus === "checking"}
            >
              {providerStatus === "checking" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "Test"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Behavior */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Behavior</CardTitle>
          <CardDescription>Fine-tune how the AI responds.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="flex items-center gap-2">
                <SavedBadge visible={tempSaved} />
                <span className="text-xs font-mono text-muted-foreground">
                  {localTemp.toFixed(1)}
                </span>
              </span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[localTemp]}
              onValueChange={([v]) => setLocalTemp(v)}
              onValueCommit={async ([v]) => {
                const ok = await cfg.patchConfig([
                  { op: "replace", path: "/ai/temperature", value: Math.round(v * 10) / 10 },
                ]);
                if (ok) tempFlash();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Lower values are more focused, higher values more creative.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="system-prompt">System Prompt</Label>
            <DebouncedTextarea
              id="system-prompt"
              rows={4}
              value={systemPrompt}
              placeholder={DEFAULT_SYSTEM_PROMPT}
              className="resize-y"
              onCommit={async (v) =>
                cfg.patchConfig([{ op: "replace", path: "/ai/systemPrompt", value: v || null }])
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

