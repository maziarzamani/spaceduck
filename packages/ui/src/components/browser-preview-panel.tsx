import type { BrowserPreview } from "../hooks/use-spaceduck-ws";
import { Globe, Monitor } from "lucide-react";

interface BrowserPreviewPanelProps {
  preview: BrowserPreview;
}

function truncateUrl(url: string, maxLen = 40): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    return display.length > maxLen ? display.slice(0, maxLen) + "…" : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "…" : url;
  }
}

export function BrowserPreviewPanel({ preview }: BrowserPreviewPanelProps) {
  return (
    <div className="flex flex-col h-full border-l border-border bg-background">
      {/* Address bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <Globe size={14} className="text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate font-mono">
          {truncateUrl(preview.url, 50)}
        </span>
      </div>

      {/* Frame */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-2 bg-black/20">
        <img
          src={preview.dataUrl}
          alt="Live browser view"
          className="max-w-full max-h-full object-contain rounded-sm"
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
        </span>
        <Monitor size={12} className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground font-medium">Live Browser</span>
      </div>
    </div>
  );
}
