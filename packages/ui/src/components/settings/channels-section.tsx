import { useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "../../ui/card";
import { Switch } from "../../ui/switch";
import type { SectionProps } from "./shared";
import { getPath } from "./shared";

export function ChannelsSection({ cfg }: SectionProps) {
  const config = cfg.config;
  if (!config) return null;

  const whatsapp = (getPath(config, "channels/whatsapp") ?? {}) as Record<string, unknown>;
  const whatsappEnabled = (whatsapp.enabled as boolean) ?? false;

  const patch = useCallback(
    (path: string, value: unknown) => {
      cfg.patchConfig([{ op: "replace", path, value }]);
    },
    [cfg],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enable or disable messaging channels.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">WhatsApp</CardTitle>
            <CardDescription>
              Bridge messages from WhatsApp to Spaceduck.
              Requires a gateway restart to take effect.
            </CardDescription>
          </div>
          <Switch
            checked={whatsappEnabled}
            onCheckedChange={(v) => patch("/channels/whatsapp/enabled", v)}
          />
        </CardHeader>
      </Card>
    </div>
  );
}
