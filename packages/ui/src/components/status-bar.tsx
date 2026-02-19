import type { ConnectionStatus } from "../hooks/use-spaceduck-ws";
import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { Badge } from "../ui/badge";

interface StatusBarProps {
  status: ConnectionStatus;
}

const statusConfig = {
  connected: {
    label: "Connected",
    icon: Wifi,
    variant: "default" as const,
  },
  connecting: {
    label: "Connecting...",
    icon: Loader2,
    variant: "secondary" as const,
  },
  disconnected: {
    label: "Disconnected",
    icon: WifiOff,
    variant: "destructive" as const,
  },
} satisfies Record<ConnectionStatus, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; variant: "default" | "secondary" | "destructive" }>;

export function StatusBar({ status }: StatusBarProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1.5 font-normal">
      <Icon size={12} className={status === "connecting" ? "animate-spin" : ""} />
      {config.label}
    </Badge>
  );
}
