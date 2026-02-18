import type { ConnectionStatus } from "../hooks/use-spaceduck-ws";
import { cn } from "../lib/utils";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

interface StatusBarProps {
  status: ConnectionStatus;
}

export function StatusBar({ status }: StatusBarProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1">
      {status === "connected" && (
        <>
          <Wifi size={12} className="text-emerald-400" />
          <span className="text-xs text-emerald-400">Connected</span>
        </>
      )}
      {status === "connecting" && (
        <>
          <Loader2 size={12} className="text-amber-400 animate-spin" />
          <span className="text-xs text-amber-400">Connecting...</span>
        </>
      )}
      {status === "disconnected" && (
        <>
          <WifiOff size={12} className="text-destructive" />
          <span className="text-xs text-destructive">Disconnected</span>
        </>
      )}
    </div>
  );
}
