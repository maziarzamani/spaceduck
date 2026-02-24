import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card";
import { Label } from "../../ui/label";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { Separator } from "../../ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../ui/select";
import { AlertTriangle, Loader2 } from "lucide-react";
import { DebouncedInput } from "../shared/debounced-input";
import { validateHttpUrl } from "./shared";
import type { SectionProps } from "./shared";

// ── Embedding status hook ────────────────────────────────────────────

type EmbeddingStatus = "idle" | "checking" | "ok" | "error";

function useEmbeddingStatus() {
  const [status, setStatus] = useState<EmbeddingStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const check = useCallback(() => {
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const token = localStorage.getItem("spaceduck.token");
    if (!gatewayUrl) return;

    setStatus("checking");
    setErrorMsg(null);
    fetch(`${gatewayUrl}/api/config/embedding-status`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; error?: string; provider?: string; dimensions?: number }>)
      .then((data) => {
        if (data.ok) {
          setStatus("ok");
          setErrorMsg(null);
        } else {
          setStatus("error");
          setErrorMsg(data.error ?? "Unknown error");
        }
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Connection failed");
      });
  }, []);

  return { status, errorMsg, check };
}

// ── Memory section ──────────────────────────────────────────────────

export function MemorySection({ cfg }: SectionProps) {
  const embedding = (cfg.config?.embedding ?? {}) as Record<string, unknown>;
  const embeddingEnabled = (embedding.enabled as boolean) ?? true;
  const embeddingProvider = (embedding.provider as string | null) ?? null;
  const embeddingModel = (embedding.model as string | null) ?? "";
  const embeddingBaseUrl = (embedding.baseUrl as string | null) ?? "";
  const embeddingDimensions = (embedding.dimensions as number | null) ?? null;

  const provider = (cfg.config?.ai as Record<string, unknown> | undefined)?.provider as
    | string
    | undefined ?? "bedrock";

  const patch = (path: string, value: unknown) =>
    cfg.patchConfig([{ op: "replace", path, value }]);

  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const { status: embeddingStatus, errorMsg: embeddingError, check: checkEmbedding } =
    useEmbeddingStatus();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Memory</h2>
        <p className="text-sm text-muted-foreground mt-1">
          How Spaceduck recalls past conversations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Semantic recall</CardTitle>
              <CardDescription>
                Uses embeddings for smarter cross-conversation recall. If off,
                memory still exists but recall uses keyword search.
              </CardDescription>
            </div>
            <Switch
              checked={embeddingEnabled}
              onCheckedChange={(v) => patch("/embedding/enabled", v)}
            />
          </div>
        </CardHeader>

        {embeddingEnabled && (
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-2">
              <Label>Provider</Label>
              <Select
                value={embeddingProvider ?? "auto"}
                onValueChange={(v) =>
                  patch("/embedding/provider", v === "auto" ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Same as chat provider ({provider})
                  </SelectItem>
                  <SelectItem value="bedrock">Amazon Bedrock</SelectItem>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="lmstudio">LM Studio</SelectItem>
                  <SelectItem value="llamacpp">llama.cpp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {["lmstudio", "llamacpp"].includes(embeddingProvider ?? provider ?? "") && (
              <div className="grid gap-2">
                <Label>Server URL</Label>
                <DebouncedInput
                  value={embeddingBaseUrl}
                  placeholder="http://localhost:1234/v1"
                  error={baseUrlError}
                  onLocalChange={() => setBaseUrlError(null)}
                  onCommit={async (v) => {
                    const result = validateHttpUrl(v);
                    if (!result.ok) {
                      setBaseUrlError(result.message);
                      return false;
                    }
                    setBaseUrlError(null);
                    return cfg.patchConfig([
                      { op: "replace", path: "/embedding/baseUrl", value: result.normalized || null },
                    ]);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Set this to use a different server for embeddings than for chat.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label>Model</Label>
              <DebouncedInput
                value={embeddingModel ?? ""}
                placeholder={
                  (embeddingProvider ?? provider) === "bedrock"
                    ? "amazon.nova-2-multimodal-embeddings-v1:0"
                    : (embeddingProvider ?? provider) === "gemini"
                      ? "text-embedding-004"
                      : "text-embedding-qwen3-embedding-8b"
                }
                onCommit={async (v) =>
                  cfg.patchConfig([
                    { op: "replace", path: "/embedding/model", value: v || null },
                  ])
                }
              />
            </div>

            <div className="grid gap-2">
              <Label>Dimensions</Label>
              <DebouncedInput
                value={embeddingDimensions?.toString() ?? ""}
                placeholder="e.g. 1024"
                onCommit={async (v) => {
                  const num = v ? parseInt(v, 10) : null;
                  if (v && (isNaN(num!) || num! < 1)) return false;
                  return cfg.patchConfig([
                    { op: "replace", path: "/embedding/dimensions", value: num },
                  ]);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Must match the model. Leave empty for the provider default.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
              <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Changing provider, model, or dimensions requires a gateway
                restart and may invalidate existing vector memory.
              </p>
            </div>

            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {embeddingStatus === "checking" && (
                  <Loader2 size={14} className="animate-spin text-muted-foreground" />
                )}
                {embeddingStatus === "ok" && (
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                )}
                {embeddingStatus === "error" && (
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
                )}
                {embeddingStatus === "idle" && (
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                )}
                <span className="text-muted-foreground">
                  {embeddingStatus === "idle" && "Not tested"}
                  {embeddingStatus === "checking" && "Testing embedding..."}
                  {embeddingStatus === "ok" && "Embedding provider connected"}
                  {embeddingStatus === "error" && (embeddingError ?? "Connection failed")}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={checkEmbedding}
                disabled={embeddingStatus === "checking"}
              >
                {embeddingStatus === "checking" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  "Test"
                )}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
