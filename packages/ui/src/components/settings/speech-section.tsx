import { useCallback, useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card";
import { Label } from "../../ui/label";
import { Switch } from "../../ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../ui/select";
import { Button } from "../../ui/button";
import { Loader2 } from "lucide-react";
import { DebouncedInput } from "../shared/debounced-input";
import type { SectionProps } from "./shared";
import { getPath } from "./shared";

type SttTestStatus = "idle" | "checking" | "ok" | "error";

function useSttTest(backend: string, model: string) {
  const [status, setStatus] = useState<SttTestStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [checkedFor, setCheckedFor] = useState("");

  const check = useCallback(() => {
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const token = localStorage.getItem("spaceduck.token");
    if (!gatewayUrl) return;

    setStatus("checking");
    setErrorMsg(null);
    const key = `${backend}:${model}`;
    fetch(`${gatewayUrl}/api/stt/test`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
      .then((data) => {
        setCheckedFor(key);
        if (data.ok) {
          setStatus("ok");
        } else {
          setStatus("error");
          setErrorMsg(data.error ?? "Test failed");
        }
      })
      .catch((err) => {
        setCheckedFor(key);
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Test failed");
      });
  }, [backend, model]);

  useEffect(() => {
    const key = `${backend}:${model}`;
    if (checkedFor && checkedFor !== key) {
      check();
    }
  }, [backend, model, checkedFor, check]);

  return { status, errorMsg, check };
}

export function SpeechSection({ cfg }: SectionProps) {
  const config = cfg.config;
  if (!config) return null;

  const stt = (getPath(config, "stt") ?? {}) as Record<string, unknown>;
  const enabled = (stt.enabled as boolean) ?? true;
  const backend = (stt.backend as string) ?? "whisper";
  const model = (stt.model as string) ?? "small";
  const languageHint = (stt.languageHint as string | null) ?? "";
  const awsTranscribe = (stt.awsTranscribe ?? {}) as Record<string, unknown>;
  const awsRegion = (awsTranscribe.region as string) ?? "us-east-1";
  const awsLanguageCode = (awsTranscribe.languageCode as string) ?? "en-US";
  const awsProfile = (awsTranscribe.profile as string | null) ?? "";
  const dictation = (stt.dictation ?? {}) as Record<string, unknown>;
  const dictationEnabled = (dictation.enabled as boolean) ?? false;
  const dictationHotkey = (dictation.hotkey as string) ?? "Fn";

  const sttCap = cfg.capabilities.stt;

  const patch = useCallback(
    (path: string, value: unknown) => {
      cfg.patchConfig([{ op: "replace", path, value }]);
    },
    [cfg],
  );

  const { status: sttTestStatus, errorMsg: sttTestError, check: checkStt } =
    useSttTest(backend, model);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Speech to Text</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure voice transcription for chat and global dictation.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Enable STT</CardTitle>
            <CardDescription>
              Allow voice messages to be transcribed.
              {sttCap && !sttCap.available && (
                <span className="block text-xs text-yellow-500 mt-1">
                  {sttCap.reason ?? "No STT backend available."}
                </span>
              )}
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => patch("/stt/enabled", v)}
          />
        </CardHeader>
      </Card>

      {enabled && (
        <>
          <Card>
            <CardContent className="pt-6 flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="stt-backend">Backend</Label>
                <Select
                  value={backend}
                  onValueChange={(v) => patch("/stt/backend", v)}
                >
                  <SelectTrigger id="stt-backend">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whisper">Whisper (local)</SelectItem>
                    <SelectItem value="aws-transcribe">AWS Transcribe (cloud)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {backend === "aws-transcribe"
                    ? "Fast cloud transcription via AWS. Requires AWS credentials."
                    : "Local transcription via OpenAI Whisper. No network required."}
                </p>
              </div>

              {backend === "whisper" && (
                <div className="grid gap-2">
                  <Label htmlFor="stt-model">Whisper Model</Label>
                  <Select
                    value={model}
                    onValueChange={(v) => patch("/stt/model", v)}
                  >
                    <SelectTrigger id="stt-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tiny">tiny</SelectItem>
                      <SelectItem value="base">base</SelectItem>
                      <SelectItem value="small">small</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="large">large</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Larger models are more accurate but slower. "small" is a good balance.
                  </p>
                </div>
              )}

              {backend === "aws-transcribe" && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="aws-profile">AWS Profile</Label>
                    <DebouncedInput
                      id="aws-profile"
                      value={awsProfile}
                      placeholder="default"
                      onCommit={async (v) => {
                        patch("/stt/awsTranscribe/profile", v || null);
                        return true;
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Named profile from ~/.aws/credentials. Leave empty to use the default credential chain.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="aws-region">AWS Region</Label>
                    <DebouncedInput
                      id="aws-region"
                      value={awsRegion}
                      placeholder="us-east-1"
                      onCommit={async (v) => {
                        patch("/stt/awsTranscribe/region", v || "us-east-1");
                        return true;
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="aws-lang">Language Code</Label>
                    <DebouncedInput
                      id="aws-lang"
                      value={awsLanguageCode}
                      placeholder="en-US"
                      onCommit={async (v) => {
                        patch("/stt/awsTranscribe/languageCode", v || "en-US");
                        return true;
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      AWS Transcribe language code (e.g. en-US, de-DE, ja-JP).
                    </p>
                  </div>
                </>
              )}

              {backend === "whisper" && (
                <div className="grid gap-2">
                  <Label htmlFor="stt-lang">Language Hint</Label>
                  <DebouncedInput
                  id="stt-lang"
                  value={languageHint}
                  placeholder="e.g. en, da, de (auto-detect if empty)"
                  onCommit={async (v) => {
                    patch("/stt/languageHint", v || null);
                    return true;
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  ISO 639-1 code. Leave empty for auto-detection.
                </p>
              </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-2">
                  {sttTestStatus === "checking" && (
                    <Loader2 size={10} className="animate-spin text-muted-foreground" />
                  )}
                  {sttTestStatus === "ok" && (
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                  )}
                  {sttTestStatus === "error" && (
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
                  )}
                  {sttTestStatus === "idle" && (
                    <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {sttTestStatus === "idle" && "Not tested"}
                    {sttTestStatus === "checking" && "Testing backend..."}
                    {sttTestStatus === "ok" && "Backend available"}
                    {sttTestStatus === "error" && (sttTestError ?? "Test failed")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkStt}
                  disabled={sttTestStatus === "checking"}
                >
                  {sttTestStatus === "checking" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="mt-2">
            <h2 className="text-lg font-semibold">Global Dictation</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Use a global hotkey to transcribe voice and paste text anywhere. Desktop app only.
            </p>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-base">Enable Dictation</CardTitle>
                <CardDescription>
                  Hold the hotkey to record, release to transcribe and paste.
                </CardDescription>
              </div>
              <Switch
                checked={dictationEnabled}
                onCheckedChange={(v) => patch("/stt/dictation/enabled", v)}
              />
            </CardHeader>
          </Card>

          {dictationEnabled && (
            <Card>
              <CardContent className="pt-6 flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label>In-App Hotkey</Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted text-muted-foreground">
                      🌐 Fn (Globe key)
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Hold the Fn key while the app is focused to record into the chat input. Requires Accessibility permission.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
