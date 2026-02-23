import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
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
import { SecretInput } from "../shared/secret-input";
import { ConnectionStatusRow } from "../shared/connection-status-row";
import { ArrowLeft } from "lucide-react";
import { useProviderTest } from "../../hooks/use-provider-test";
import {
  CLOUD_PROVIDERS,
  LOCAL_PROVIDERS,
  LOCAL_PRESET_URLS,
  CLOUD_DEFAULT_MODELS,
  SECRET_LABELS,
} from "@spaceduck/config/setup";

const ALL_PROVIDERS = [
  ...CLOUD_PROVIDERS.map((p) => ({ ...p, group: "cloud" as const })),
  ...LOCAL_PROVIDERS.filter((p) => p.id !== "custom").map((p) => ({ ...p, group: "local" as const })),
];

const EMBEDDING_PROVIDERS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "lmstudio", label: "LM Studio" },
  { id: "llamacpp", label: "llama.cpp" },
  { id: "bedrock", label: "Amazon Bedrock" },
];

interface StepSetupAdvancedProps {
  onContinue: (opts: {
    provider: string;
    model: string;
    baseUrl: string;
    region: string;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingBaseUrl: string;
  }) => void;
  onBack: () => void;
  onSkip: () => void;
}

export function StepSetupAdvanced({ onContinue, onBack, onSkip }: StepSetupAdvancedProps) {
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState(CLOUD_DEFAULT_MODELS["gemini"] ?? "");
  const [baseUrl, setBaseUrl] = useState("");
  const [region, setRegion] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [saving, setSaving] = useState(false);

  const [embProvider, setEmbProvider] = useState("");
  const [embModel, setEmbModel] = useState("");
  const [embBaseUrl, setEmbBaseUrl] = useState("");

  const chatTest = useProviderTest();
  const embTest = useProviderTest();
  const prevChatFingerprint = useRef("");

  const isLocal = LOCAL_PROVIDERS.some((p) => p.id === provider);

  useEffect(() => {
    if (isLocal) {
      setBaseUrl(LOCAL_PRESET_URLS[provider] ?? "");
      setModel("");
    } else {
      setBaseUrl("");
      setModel(CLOUD_DEFAULT_MODELS[provider] ?? "");
    }
    setKeySet(false);
    chatTest.reset();
  }, [provider, isLocal]);

  const chatFingerprint = `${provider}|${model}|${baseUrl}|${region}|${keySet}`;
  useEffect(() => {
    if (chatFingerprint !== prevChatFingerprint.current) {
      if (prevChatFingerprint.current) chatTest.markStale();
      prevChatFingerprint.current = chatFingerprint;
    }
  }, [chatFingerprint]);

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
        chatTest.markStale();
        return true;
      }
      return false;
    } catch { return false; }
    finally { setSaving(false); }
  }, [secretInfo, chatTest]);

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
        chatTest.reset();
        return true;
      }
      return false;
    } catch { return false; }
    finally { setSaving(false); }
  }, [secretInfo, chatTest]);

  const handleChatTest = () => {
    chatTest.testProvider({
      provider,
      baseUrl: isLocal ? baseUrl : undefined,
      model: model || undefined,
      region: region || undefined,
      secretSlot: secretInfo?.path,
    });
  };

  const handleEmbTest = () => {
    const ep = embProvider === "none" ? "" : embProvider;
    if (!ep) return;
    const embIsLocal = ep === "lmstudio" || ep === "llamacpp";
    embTest.testProvider({
      provider: ep,
      baseUrl: embIsLocal ? (embBaseUrl || LOCAL_PRESET_URLS[ep]) : undefined,
      secretSlot: SECRET_LABELS[ep]?.path,
    });
  };

  const canContinue = provider && (isLocal || keySet) && chatTest.status === "ok";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Advanced setup</h1>
          <p className="text-sm text-muted-foreground">
            Full control over chat and memory providers.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid gap-2">
          <Label>Chat provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Cloud</SelectLabel>
                {ALL_PROVIDERS.filter((p) => p.group === "cloud").map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Local</SelectLabel>
                {ALL_PROVIDERS.filter((p) => p.group === "local").map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectGroup>
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

        {isLocal && (
          <div className="grid gap-2">
            <Label>Server URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost/v1" />
          </div>
        )}

        <div className="grid gap-2">
          <Label>Model</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Enter model identifier" />
        </div>

        {provider === "bedrock" && (
          <div className="grid gap-2">
            <Label>AWS Region</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. us-east-1" />
          </div>
        )}

        {(isLocal || keySet) && (
          <ConnectionStatusRow
            status={chatTest.status}
            error={chatTest.error}
            hint={chatTest.hint}
            retryable={chatTest.retryable}
            onTest={handleChatTest}
          />
        )}

        <Separator />

        <div>
          <h3 className="text-sm font-medium mb-1">Memory model</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Used for long-term memory and semantic search. Optional.
          </p>
        </div>

        <div className="grid gap-2">
          <Label>Embedding provider</Label>
          <Select value={embProvider} onValueChange={setEmbProvider}>
            <SelectTrigger>
              <SelectValue placeholder="None (skip)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (skip)</SelectItem>
              {EMBEDDING_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {embProvider && embProvider !== "none" && (
          <>
            <div className="grid gap-2">
              <Label>Embedding model</Label>
              <Input value={embModel} onChange={(e) => setEmbModel(e.target.value)} placeholder="e.g. text-embedding-004" />
            </div>
            {(embProvider === "lmstudio" || embProvider === "llamacpp") && (
              <div className="grid gap-2">
                <Label>Embedding server URL</Label>
                <Input value={embBaseUrl} onChange={(e) => setEmbBaseUrl(e.target.value)} placeholder={LOCAL_PRESET_URLS[embProvider] ?? "http://localhost/v1"} />
              </div>
            )}
            <ConnectionStatusRow
              status={embTest.status}
              error={embTest.error}
              hint={embTest.hint}
              retryable={embTest.retryable}
              onTest={handleEmbTest}
            />
          </>
        )}
      </div>

      <div className="flex justify-between items-center pt-2">
        <Button variant="link" size="sm" className="text-muted-foreground" onClick={onSkip}>
          Skip for now
        </Button>
        <Button
          onClick={() => onContinue({
            provider,
            model,
            baseUrl: chatTest.normalizedBaseUrl ?? baseUrl,
            region,
            embeddingProvider: embProvider === "none" ? "" : embProvider,
            embeddingModel: embModel,
            embeddingBaseUrl: embBaseUrl,
          })}
          disabled={!canContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
