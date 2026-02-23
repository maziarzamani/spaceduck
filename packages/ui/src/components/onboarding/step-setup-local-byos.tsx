import { useState, useEffect, useRef } from "react";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../ui/select";
import { DebouncedInput } from "../shared/debounced-input";
import { ConnectionStatusRow } from "../shared/connection-status-row";
import { Loader2, ArrowLeft, Cpu, HardDrive } from "lucide-react";
import { useSystemProfile } from "../../hooks/use-system-profile";
import { useProviderTest } from "../../hooks/use-provider-test";
import {
  LOCAL_PROVIDERS,
  LOCAL_PRESET_URLS,
  validateLocalSetup,
} from "@spaceduck/config/setup";

interface StepSetupLocalByosProps {
  onContinue: (provider: string, baseUrl: string) => void;
  onBack: () => void;
  onSkip: () => void;
}

export function StepSetupLocalByos({ onContinue, onBack, onSkip }: StepSetupLocalByosProps) {
  const { profile, loading: profileLoading } = useSystemProfile();
  const [provider, setProvider] = useState("llamacpp");
  const [baseUrl, setBaseUrl] = useState(LOCAL_PRESET_URLS["llamacpp"] ?? "");
  const connTest = useProviderTest();
  const prevProvider = useRef(provider);
  const prevBaseUrl = useRef(baseUrl);

  useEffect(() => {
    const preset = LOCAL_PRESET_URLS[provider];
    if (preset) setBaseUrl(preset);
  }, [provider]);

  useEffect(() => {
    if (provider !== prevProvider.current || baseUrl !== prevBaseUrl.current) {
      connTest.markStale();
      prevProvider.current = provider;
      prevBaseUrl.current = baseUrl;
    }
  }, [provider, baseUrl]);

  const validation = validateLocalSetup(provider, baseUrl);

  const handleTest = () => {
    connTest.testProvider({ provider, baseUrl });
  };

  const handleContinue = () => {
    if (validation.ok && connTest.status === "ok") {
      onContinue(provider, connTest.normalizedBaseUrl ?? baseUrl);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Local setup</h1>
          <p className="text-sm text-muted-foreground">
            Connect to a local AI server running on your machine.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {profileLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Detecting system...
          </div>
        ) : profile && profile.confidence !== "unknown" ? (
          <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <Cpu size={12} />
                {profile.os} / {profile.arch}
                {profile.appleSilicon && " (Apple Silicon)"}
              </span>
              <span className="flex items-center gap-1.5">
                <HardDrive size={12} />
                {profile.totalMemoryGB} GB RAM
              </span>
            </div>
            {profile.confidence === "high" && (
              <p>
                Recommended model size:{" "}
                <strong>{profile.recommendations[profile.recommendedTier].name}</strong>
                {" "}({profile.recommendations[profile.recommendedTier].params})
              </p>
            )}
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label>Runtime</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCAL_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                  {p.hint && (
                    <span className="ml-2 text-xs text-muted-foreground">({p.hint})</span>
                  )}
                  {p.recommended && (
                    <span className="ml-2 text-xs text-green-500">recommended</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Server URL</Label>
          <DebouncedInput
            value={baseUrl}
            placeholder={LOCAL_PRESET_URLS[provider] ?? "http://localhost/v1"}
            onCommit={async (v) => {
              setBaseUrl(v);
              return true;
            }}
          />
          {!validation.ok && validation.error && (
            <p className="text-xs text-destructive">{validation.error}</p>
          )}
        </div>

        {provider === "llamacpp" && (
          <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
            <p>Start llama-server first:</p>
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all">
              llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080
            </pre>
          </div>
        )}

        {provider === "lmstudio" && (
          <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <p>
              Open LM Studio, load a model, and start the local server.
              The default URL is <span className="font-mono">http://localhost:1234/v1</span>.
            </p>
          </div>
        )}

        {validation.ok && (
          <ConnectionStatusRow
            status={connTest.status}
            error={connTest.error}
            hint={connTest.hint}
            retryable={connTest.retryable}
            onTest={handleTest}
          />
        )}
      </div>

      <div className="flex justify-between items-center pt-2">
        <Button variant="link" size="sm" className="text-muted-foreground" onClick={onSkip}>
          Skip for now
        </Button>
        <Button onClick={handleContinue} disabled={!validation.ok || connTest.status !== "ok"}>
          Continue
        </Button>
      </div>
    </div>
  );
}
