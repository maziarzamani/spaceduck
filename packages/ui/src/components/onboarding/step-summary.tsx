import { Button } from "../../ui/button";
import { CheckCircle2, Monitor, Cloud, Settings2 } from "lucide-react";
import type { SetupMode } from "@spaceduck/config/setup";

interface StepSummaryProps {
  mode: SetupMode;
  provider: string;
  model: string;
  baseUrl?: string;
  onConfirm: () => void;
  onBack: () => void;
}

const MODE_META: Record<SetupMode, { icon: typeof Monitor; label: string }> = {
  local: { icon: Monitor, label: "Local" },
  cloud: { icon: Cloud, label: "Cloud" },
  advanced: { icon: Settings2, label: "Advanced" },
};

export function StepSummary({ mode, provider, model, baseUrl, onConfirm, onBack }: StepSummaryProps) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center text-center gap-3">
        <CheckCircle2 size={48} className="text-green-500" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ready to go</h1>
          <p className="text-muted-foreground mt-1">
            Here's what you've configured.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <Icon size={16} className="text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{meta.label} mode</div>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-muted-foreground">Provider</div>
          <div className="text-sm font-medium">{provider}</div>
        </div>
        {model && (
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground">Model</div>
            <div className="text-sm font-medium font-mono">{model}</div>
          </div>
        )}
        {baseUrl && (
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground">Server URL</div>
            <div className="text-sm font-medium font-mono truncate">{baseUrl}</div>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button size="lg" onClick={onConfirm}>
          Start using Spaceduck
        </Button>
      </div>
    </div>
  );
}
