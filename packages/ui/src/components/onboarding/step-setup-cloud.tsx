import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../ui/select";
import { SecretInput } from "../shared/secret-input";
import { ConnectionStatusRow } from "../shared/connection-status-row";
import { ArrowLeft } from "lucide-react";
import { useProviderTest } from "../../hooks/use-provider-test";
import {
  CLOUD_PROVIDERS,
  CLOUD_DEFAULT_MODELS,
  SECRET_LABELS,
  validateCloudSetup,
} from "@spaceduck/config/setup";

interface StepSetupCloudProps {
  onContinue: (provider: string, model: string, region?: string) => void;
  onBack: () => void;
  onSkip: () => void;
}

export function StepSetupCloud({ onContinue, onBack, onSkip }: StepSetupCloudProps) {
  const [provider, setProvider] = useState<string>(
    CLOUD_PROVIDERS.find((p) => p.recommended)?.id ?? "gemini",
  );
  const [model, setModel] = useState(CLOUD_DEFAULT_MODELS[provider] ?? "");
  const [region, setRegion] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [saving, setSaving] = useState(false);
  const connTest = useProviderTest();
  const prevFingerprint = useRef("");

  useEffect(() => {
    setModel(CLOUD_DEFAULT_MODELS[provider] ?? "");
    setKeySet(false);
    connTest.reset();
  }, [provider]);

  const fingerprint = `${provider}|${model}|${region}|${keySet}`;
  useEffect(() => {
    if (fingerprint !== prevFingerprint.current) {
      if (prevFingerprint.current) connTest.markStale();
      prevFingerprint.current = fingerprint;
    }
  }, [fingerprint]);

  const secretInfo = SECRET_LABELS[provider];

  const handleSaveKey = useCallback(async (value: string): Promise<boolean> => {
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const token = localStorage.getItem("spaceduck.token");
    if (!gatewayUrl || !secretInfo) return false;
    setSaving(true);
    try {
      const res = await fetch(`${gatewayUrl}/api/config/secrets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ op: "set", path: secretInfo.path, value }),
      });
      if (res.ok) {
        setKeySet(true);
        connTest.markStale();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [secretInfo, connTest]);

  const handleClearKey = useCallback(async (): Promise<boolean> => {
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const token = localStorage.getItem("spaceduck.token");
    if (!gatewayUrl || !secretInfo) return false;
    setSaving(true);
    try {
      const res = await fetch(`${gatewayUrl}/api/config/secrets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ op: "unset", path: secretInfo.path }),
      });
      if (res.ok) {
        setKeySet(false);
        connTest.reset();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [secretInfo, connTest]);

  const handleTest = () => {
    connTest.testProvider({
      provider,
      model,
      region: region || undefined,
      secretSlot: secretInfo?.path,
    });
  };

  const validation = validateCloudSetup(provider, model);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cloud setup</h1>
          <p className="text-sm text-muted-foreground">
            Connect to a cloud AI provider with an API key.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid gap-2">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLOUD_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                  {p.recommended && (
                    <span className="ml-2 text-xs text-green-500">recommended</span>
                  )}
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
              isSet={keySet}
              onSave={handleSaveKey}
              onClear={handleClearKey}
              saving={saving}
            />
          </div>
        )}

        <div className="grid gap-2">
          <Label>Model</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Enter model identifier"
          />
          {CLOUD_DEFAULT_MODELS[provider] && model !== CLOUD_DEFAULT_MODELS[provider] && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground justify-start"
              onClick={() => setModel(CLOUD_DEFAULT_MODELS[provider])}
            >
              Reset to default ({CLOUD_DEFAULT_MODELS[provider]})
            </Button>
          )}
        </div>

        {provider === "bedrock" && (
          <div className="grid gap-2">
            <Label>AWS Region</Label>
            <Input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. us-east-1"
            />
          </div>
        )}

        {keySet && (
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
        <Button
          onClick={() => onContinue(provider, model, region || undefined)}
          disabled={!validation.ok || !keySet || connTest.status !== "ok"}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
