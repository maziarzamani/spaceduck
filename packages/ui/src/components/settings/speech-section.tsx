import { useState, useCallback, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card";
import { Label } from "../../ui/label";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import type { SectionProps } from "./shared";
import { getPath } from "./shared";

function DebouncedInput({
  value: externalValue,
  onCommit,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [local, setLocal] = useState(externalValue);
  useEffect(() => setLocal(externalValue), [externalValue]);

  return (
    <Input
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== externalValue) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function SpeechSection({ cfg }: SectionProps) {
  const config = cfg.config;
  if (!config) return null;

  const stt = (getPath(config, "stt") ?? {}) as Record<string, unknown>;
  const enabled = (stt.enabled as boolean) ?? true;
  const model = (stt.model as string) ?? "small";
  const languageHint = (stt.languageHint as string | null) ?? "";

  const sttCap = cfg.capabilities.stt;

  const patch = useCallback(
    (path: string, value: unknown) => {
      cfg.patchConfig([{ op: "replace", path, value }]);
    },
    [cfg],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Speech to Text</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure voice transcription powered by Whisper.
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
                  {sttCap.reason ?? "Whisper not found on server."}
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
        <Card>
          <CardContent className="pt-6 flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="stt-model">Whisper Model</Label>
              <DebouncedInput
                id="stt-model"
                value={model}
                placeholder="tiny, base, small, medium, large"
                onCommit={(v) => patch("/stt/model", v || "small")}
              />
              <p className="text-xs text-muted-foreground">
                Larger models are more accurate but slower. "small" is a good balance.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="stt-lang">Language Hint</Label>
              <DebouncedInput
                id="stt-lang"
                value={languageHint}
                placeholder="e.g. en, da, de (auto-detect if empty)"
                onCommit={(v) => patch("/stt/languageHint", v || null)}
              />
              <p className="text-xs text-muted-foreground">
                ISO 639-1 code. Leave empty for auto-detection.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
