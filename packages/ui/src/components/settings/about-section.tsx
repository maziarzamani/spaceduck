import { useState, useEffect } from "react";
import { Card, CardContent } from "../../ui/card";
import { Loader2 } from "lucide-react";
import uiPkg from "../../../package.json";

interface GatewayInfo {
  version?: string;
  commit?: string;
}

export function AboutSection() {
  const [gateway, setGateway] = useState<GatewayInfo>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    if (!gatewayUrl) { setLoading(false); return; }

    fetch(`${gatewayUrl}/api/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<{ version: string; commit: string }>)
      .then((data) => setGateway({ version: data.version, commit: data.commit }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">About</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Spaceduck version information.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">App version</span>
              <span>{uiPkg.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gateway version</span>
              {loading ? (
                <Loader2 size={14} className="animate-spin text-muted-foreground" />
              ) : (
                <span>{gateway.version ?? "Unavailable"}</span>
              )}
            </div>
            {gateway.commit && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Build</span>
                <span className="font-mono text-xs">{gateway.commit}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
