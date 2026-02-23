import { useState, useEffect } from "react";
import type { ModelTier, ModelRecommendation } from "@spaceduck/config/setup";

export interface SystemProfile {
  os: string | null;
  arch: string | null;
  appleSilicon: boolean;
  totalMemoryGB: number | null;
  cpuCores: number | null;
  confidence: "high" | "partial" | "unknown";
  recommendedTier: ModelTier;
  recommendations: Record<ModelTier, ModelRecommendation>;
}

interface UseSystemProfileReturn {
  profile: SystemProfile | null;
  loading: boolean;
  error: string | null;
}

export function useSystemProfile(): UseSystemProfileReturn {
  const [profile, setProfile] = useState<SystemProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
    if (!gatewayUrl) {
      setLoading(false);
      setError("No gateway URL configured");
      return;
    }

    fetch(`${gatewayUrl}/api/system/profile`, {
      signal: AbortSignal.timeout(10_000),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SystemProfile>;
      })
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to detect system");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { profile, loading, error };
}
