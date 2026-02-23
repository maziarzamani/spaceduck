import { useState, useCallback } from "react";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../../ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { openExternal } from "../../lib/open-external";

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

  const handleOpenPairUrl = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      openExternal(`${gatewayUrl}/pair`);
    },
    [gatewayUrl],
  );

  const startPairing = async () => {
    setStarting(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${gatewayUrl}/api/pair/start`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { pairingId: string };
      setPairingId(data.pairingId);
      setStarting(false);
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
        const errorCode = body.error ?? `HTTP ${res.status}`;
        const friendly: Record<string, string> = {
          wrong_code: "Incorrect code. Please check and try again.",
          not_found: "Pairing session not found. Please start over.",
          expired: "Code expired. Please get a new code.",
          already_used: "This code has already been used. Please get a new code.",
          rate_limited: "Too many attempts. Please get a new code.",
        };
        throw new Error(friendly[errorCode] ?? errorCode);
      }
      const data = await res.json() as { token: string };
      onPaired(data.token);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Pairing failed");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pair with {gatewayName}</h1>
          <p className="text-sm text-muted-foreground">
            Open{" "}
            <a
              href={`${gatewayUrl}/pair`}
              onClick={handleOpenPairUrl}
              className="inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:text-primary/80 cursor-pointer"
            >
              {gatewayUrl}/pair
              <ExternalLink size={12} />
            </a>{" "}
            on the gateway machine to see the pairing code.
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        {!pairingId ? (
          <>
            <Button onClick={startPairing} disabled={starting} className="self-center">
              {starting ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Starting...
                </>
              ) : (
                "Start Pairing"
              )}
            </Button>
            {errorMsg && (
              <p className="text-sm text-destructive text-center">{errorMsg}</p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <Label>Enter the 6-digit code</Label>
              <InputOTP
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                value={code}
                onChange={(value) => {
                  setCode(value);
                  if (state === "error") {
                    setState("input");
                    setErrorMsg("");
                  }
                }}
                onComplete={confirm}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
              {errorMsg && (
                <p className="text-sm text-destructive text-center">{errorMsg}</p>
              )}
            </div>
            <Button
              onClick={confirm}
              disabled={code.length !== 6 || state === "submitting"}
              className="self-center"
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

        {state === "error" && (errorMsg.includes("new code") || errorMsg.includes("start over")) && (
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
      </div>
    </div>
  );
}
