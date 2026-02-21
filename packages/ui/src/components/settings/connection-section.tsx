import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card";
import { Button } from "../../ui/button";
import { Separator } from "../../ui/separator";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface ConnectionSectionProps {
  onDisconnect: () => void;
}

type ConnectionStatus = "checking" | "connected" | "unreachable";

export function ConnectionSection({ onDisconnect }: ConnectionSectionProps) {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
  const gatewayName = localStorage.getItem("spaceduck.gatewayName") ?? "Unknown";
  const token = localStorage.getItem("spaceduck.token");
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [gatewayInfo, setGatewayInfo] = useState<{ uptime?: number; provider?: string; model?: string }>({});
  const [providerOk, setProviderOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!gatewayUrl) {
      setStatus("unreachable");
      return;
    }
    setStatus("checking");
    fetch(`${gatewayUrl}/api/health`, { signal: AbortSignal.timeout(5000) })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json() as Promise<{ status: string; uptime: number; provider: string; model: string }>;
      })
      .then((data) => {
        setGatewayInfo({ uptime: data.uptime, provider: data.provider, model: data.model });
        setStatus("connected");
      })
      .catch(() => setStatus("unreachable"));
  }, [gatewayUrl]);

  useEffect(() => {
    if (status !== "connected" || !gatewayUrl) return;
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    fetch(`${gatewayUrl}/api/config/provider-status`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json() as Promise<{ ok: boolean }>)
      .then((data) => setProviderOk(data.ok))
      .catch(() => setProviderOk(false));
  }, [status, token, gatewayUrl]);

  const statusIcon = {
    checking: <Loader2 size={14} className="animate-spin text-muted-foreground" />,
    connected: <CheckCircle2 size={14} className="text-green-500" />,
    unreachable: <XCircle size={14} className="text-destructive" />,
  }[status];

  const statusLabel = {
    checking: "Checking...",
    connected: "Connected",
    unreachable: "Unreachable",
  }[status];

  const uptimeStr = gatewayInfo.uptime != null
    ? formatUptime(gatewayInfo.uptime)
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Connection</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Gateway connection details for this device.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gateway</CardTitle>
          <CardDescription>
            {status === "connected"
              ? `Connected to ${gatewayName}`
              : status === "unreachable"
                ? `Unable to reach ${gatewayName}`
                : `Connecting to ${gatewayName}...`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className="flex items-center gap-1.5">
              {statusIcon}
              {statusLabel}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">URL</span>
            <span className="font-mono text-xs">{gatewayUrl || "Not set"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Auth</span>
            <span>{token ? "Token paired" : "No auth"}</span>
          </div>
          {uptimeStr && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Uptime</span>
              <span>{uptimeStr}</span>
            </div>
          )}
          {gatewayInfo.provider && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Chat model</span>
              <span className="flex items-center gap-1.5">
                {providerOk === true && <span className="inline-block h-2 w-2 rounded-full bg-green-500" />}
                {providerOk === false && <span className="inline-block h-2 w-2 rounded-full bg-destructive" />}
                {gatewayInfo.provider} / {gatewayInfo.model}
              </span>
            </div>
          )}
          <Separator />
          <Button
            variant="outline"
            onClick={() => {
              localStorage.removeItem("spaceduck.gatewayUrl");
              localStorage.removeItem("spaceduck.token");
              localStorage.removeItem("spaceduck.gatewayName");
              onDisconnect();
            }}
          >
            Switch Gateway
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
