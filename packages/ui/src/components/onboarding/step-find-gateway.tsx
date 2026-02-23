import { useState } from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

interface StepFindGatewayProps {
  onGatewayFound: (conn: {
    url: string;
    gatewayId: string;
    gatewayName: string;
    requiresAuth: boolean;
  }) => void;
}

type ValidationState = "idle" | "validating" | "valid" | "error";

export function StepFindGateway({ onGatewayFound }: StepFindGatewayProps) {
  const [url, setUrl] = useState("http://localhost:3000");
  const [state, setState] = useState<ValidationState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const validate = async (gatewayUrl: string) => {
    setState("validating");
    setErrorMsg("");

    try {
      const normalized = gatewayUrl.replace(/\/+$/, "");
      const res = await fetch(`${normalized}/api/gateway/public-info`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json() as {
        gatewayId: string;
        gatewayName: string;
        requiresAuth: boolean;
        wsPath: string;
      };
      setState("valid");

      onGatewayFound({
        url: normalized,
        gatewayId: data.gatewayId,
        gatewayName: data.gatewayName,
        requiresAuth: data.requiresAuth,
      });
    } catch (err) {
      setState("error");
      setErrorMsg(
        err instanceof TypeError
          ? "Could not connect. Is the gateway running?"
          : err instanceof Error
            ? err.message
            : "Unknown error",
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Find your gateway</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enter the URL of your Spaceduck gateway, or use one of the quick-connect options.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <Button
          variant="outline"
          className="w-full justify-start text-left"
          onClick={() => validate("http://localhost:3000")}
          disabled={state === "validating"}
        >
          <span className="flex-1">This machine (localhost:3000)</span>
          {state === "validating" && url === "http://localhost:3000" && (
            <Loader2 size={16} className="animate-spin" />
          )}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">or enter URL</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="gateway-url">Gateway URL</Label>
          <div className="flex gap-2">
            <Input
              id="gateway-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setState("idle");
              }}
              placeholder="http://192.168.1.100:3000"
              onKeyDown={(e) => {
                if (e.key === "Enter") validate(url);
              }}
            />
            <Button
              onClick={() => validate(url)}
              disabled={state === "validating" || !url.trim()}
            >
              {state === "validating" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          </div>
        </div>

        {state === "valid" && (
          <div className="flex items-center gap-2 text-sm text-green-500">
            <CheckCircle2 size={16} />
            <span>Gateway found! Connecting...</span>
          </div>
        )}

        {state === "error" && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Automatic discovery is coming soon. For now, enter the URL manually.
      </p>
    </div>
  );
}
