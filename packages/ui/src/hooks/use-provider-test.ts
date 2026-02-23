import { useState, useCallback, useRef } from "react";

export type ProviderTestStatus = "idle" | "checking" | "ok" | "error" | "stale";

export interface ProviderTestInput {
  provider: string;
  baseUrl?: string;
  model?: string;
  region?: string;
  secretSlot?: string;
}

interface ProviderTestError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface UseProviderTestReturn {
  status: ProviderTestStatus;
  error: string | null;
  hint: string | null;
  retryable: boolean;
  testedAt: number | null;
  normalizedBaseUrl: string | null;
  testProvider: (input: ProviderTestInput) => Promise<void>;
  reset: () => void;
  markStale: () => void;
}

export function useProviderTest(): UseProviderTestReturn {
  const [status, setStatus] = useState<ProviderTestStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [testedAt, setTestedAt] = useState<number | null>(null);
  const [normalizedBaseUrl, setNormalizedBaseUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const testProvider = useCallback(async (input: ProviderTestInput) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("checking");
    setError(null);
    setHint(null);
    setRetryable(false);

    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    const token = localStorage.getItem("spaceduck.token");
    if (!gatewayUrl) {
      setStatus("error");
      setError("No gateway connected.");
      return;
    }

    try {
      const res = await fetch(`${gatewayUrl}/api/config/provider-test`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          provider: input.provider,
          baseUrl: input.baseUrl || null,
          model: input.model || null,
          region: input.region || null,
          secretSlot: input.secretSlot || null,
        }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const data = await res.json() as {
        ok: boolean;
        normalizedBaseUrl?: string | null;
        error?: ProviderTestError;
        details?: { hint?: string };
      };

      if (controller.signal.aborted) return;

      if (data.ok) {
        setStatus("ok");
        setTestedAt(Date.now());
        setNormalizedBaseUrl(data.normalizedBaseUrl ?? null);
      } else {
        setStatus("error");
        setError(data.error?.message ?? "Connection test failed.");
        setRetryable(data.error?.retryable ?? true);
        setHint(data.details?.hint ?? null);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Connection test failed.");
      setRetryable(true);
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setError(null);
    setHint(null);
    setRetryable(false);
    setTestedAt(null);
    setNormalizedBaseUrl(null);
  }, []);

  const markStale = useCallback(() => {
    setStatus((prev) => {
      if (prev === "ok") return "stale";
      if (prev !== "checking") {
        setError(null);
        setHint(null);
        return "idle";
      }
      return prev;
    });
  }, []);

  return { status, error, hint, retryable, testedAt, normalizedBaseUrl, testProvider, reset, markStale };
}
