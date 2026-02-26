import type { DictationState } from "../hooks/use-dictation";
import { Mic, Loader2 } from "lucide-react";

interface DictationOverlayProps {
  state: DictationState;
  durationMs: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DictationOverlay({ state, durationMs }: DictationOverlayProps) {
  if (state === "idle") return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-background/95 backdrop-blur-sm border border-border shadow-lg px-4 py-2.5">
        {state === "recording" && (
          <>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <Mic className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium text-foreground">
              Listening...
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(durationMs)}
            </span>
          </>
        )}
        {state === "processing" && (
          <>
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
            <span className="text-sm font-medium text-foreground">
              Transcribing...
            </span>
          </>
        )}
      </div>
    </div>
  );
}
