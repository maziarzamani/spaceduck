import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { ArrowLeft, Loader2, Trash2, Monitor, Smartphone, Globe } from "lucide-react";

interface SettingsViewProps {
  onBack: () => void;
  onDisconnect: () => void;
}

interface TokenInfo {
  id: string;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  isCurrent: boolean;
}

function formatDate(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeviceIcon({ name }: { name: string | null }) {
  const lower = (name ?? "").toLowerCase();
  if (lower.includes("mobile") || lower.includes("iphone") || lower.includes("android")) {
    return <Smartphone size={16} className="text-muted-foreground" />;
  }
  if (lower.includes("browser") || lower.includes("chrome") || lower.includes("safari") || lower.includes("firefox")) {
    return <Globe size={16} className="text-muted-foreground" />;
  }
  return <Monitor size={16} className="text-muted-foreground" />;
}

export function SettingsView({ onBack, onDisconnect }: SettingsViewProps) {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
  const gatewayName = localStorage.getItem("spaceduck.gatewayName") ?? "Unknown";
  const token = localStorage.getItem("spaceduck.token");

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gatewayUrl || !token) {
      setLoading(false);
      return;
    }

    fetch(`${gatewayUrl}/api/tokens`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ tokens: TokenInfo[] }>;
      })
      .then((data) => setTokens(data.tokens))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load devices"))
      .finally(() => setLoading(false));
  }, [gatewayUrl, token]);

  const revokeDevice = async (tokenId: string, isSelf: boolean) => {
    if (!gatewayUrl || !token) return;
    setRevoking(tokenId);
    try {
      const res = await fetch(`${gatewayUrl}/api/tokens/revoke`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tokenId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (isSelf) {
        onDisconnect();
      } else {
        setTokens((prev) => prev.filter((t) => t.id !== tokenId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revocation failed");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-lg flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={16} className="mr-1" />
            Back to Chat
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Gateway Connection</CardTitle>
            <CardDescription>Currently connected to {gatewayName}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">URL</span>
              <span className="font-mono text-xs">{gatewayUrl}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Auth</span>
              <span>{token ? "Token paired" : "No auth"}</span>
            </div>
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

        {token && (
          <Card>
            <CardHeader>
              <CardTitle>Paired Devices</CardTitle>
              <CardDescription>
                Devices that have paired with this gateway. Revoke access for any device you don't recognize.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={20} className="animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : tokens.length === 0 ? (
                <p className="text-sm text-muted-foreground">No paired devices found.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {tokens.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <DeviceIcon name={t.deviceName} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {t.deviceName ?? "Unknown device"}
                          {t.isCurrent && (
                            <span className="ml-2 text-xs text-primary font-normal">(this device)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last used: {formatDate(t.lastUsedAt)} &middot; Created: {formatDate(t.createdAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={revoking === t.id}
                        onClick={() => revokeDevice(t.id, t.isCurrent)}
                      >
                        {revoking === t.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Spaceduck v0.1.0
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
