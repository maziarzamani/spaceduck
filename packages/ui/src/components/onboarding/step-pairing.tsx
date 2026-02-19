import { useState, useRef } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../ui/card";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Loader2, ArrowLeft, AlertTriangle } from "lucide-react";

interface StepPairingProps {
  gatewayUrl: string;
  gatewayName: string;
  onPaired: (token: string) => void;
  onBack: () => void;
}

type PairingState = "input" | "submitting" | "error";

export function StepPairing({ gatewayUrl, gatewayName, onPaired, onBack }: StepPairingProps) {
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [state, setState] = useState<PairingState>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [starting, setStarting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startPairing = async () => {
    setStarting(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${gatewayUrl}/api/pair/start`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { pairingId: string };
      setPairingId(data.pairingId);
      setStarting(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      setStarting(false);
      setErrorMsg(err instanceof Error ? err.message : "Failed to start pairing");
    }
  };

  const confirm = async () => {
    if (!pairingId || code.length !== 6) return;
    setState("submitting");
    setErrorMsg("");
    try {
      const res = await fetch(`${gatewayUrl}/api/pair/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pairingId,
          code,
          deviceName: `${navigator.userAgent.split(" ").pop()?.split("/")[0] ?? "Browser"} (${new Date().toLocaleDateString()})`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        if (res.status === 429) throw new Error("Too many attempts. Please get a new code.");
        if (res.status === 410) throw new Error("Code expired. Please get a new code.");
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { token: string };
      onPaired(data.token);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Pairing failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pair with {gatewayName}</CardTitle>
        <CardDescription>
          Open <code className="text-xs bg-muted px-1 py-0.5 rounded">{gatewayUrl}/pair</code> on
          the gateway machine to see the pairing code.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!pairingId ? (
          <Button onClick={startPairing} disabled={starting} className="w-full">
            {starting ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Starting...
              </>
            ) : (
              "Start Pairing"
            )}
          </Button>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pairing-code">Enter the 6-digit code</Label>
              <Input
                ref={inputRef}
                id="pairing-code"
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  setState("input");
                }}
                placeholder="000000"
                maxLength={6}
                className="text-center text-2xl tracking-[0.5em] font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.length === 6) confirm();
                }}
                autoComplete="off"
              />
            </div>
            <Button
              onClick={confirm}
              disabled={code.length !== 6 || state === "submitting"}
              className="w-full"
            >
              {state === "submitting" ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Verifying...
                </>
              ) : (
                "Confirm"
              )}
            </Button>
          </>
        )}

        {errorMsg && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {state === "error" && (errorMsg.includes("new code") || errorMsg.includes("expired")) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPairingId(null);
              setCode("");
              setState("input");
              setErrorMsg("");
              startPairing();
            }}
          >
            Get New Code
          </Button>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} className="mr-1" />
          Back
        </Button>
      </CardFooter>
    </Card>
  );
}
