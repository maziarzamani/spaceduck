import { useState, useEffect, useCallback, useRef } from "react";

interface SecretStatus {
  path: string;
  isSet: boolean;
}

interface ConfigCapabilities {
  stt?: { available: boolean; reason?: string };
  marker?: { available: boolean; reason?: string };
  embedding?: { available: boolean; reason?: string };
  browser?: { available: boolean; reason?: string };
  aiProviderReady?: boolean;
  webSearchReady?: boolean;
  webAnswerReady?: boolean;
  browserReady?: boolean;
  webFetchReady?: boolean;
}

interface ConfigResponse {
  config: Record<string, unknown>;
  rev: string;
  secrets: SecretStatus[];
  capabilities: ConfigCapabilities;
}

interface PatchOp {
  op: "replace" | "add";
  path: string;
  value: unknown;
}

interface PatchResponse {
  config: Record<string, unknown>;
  rev: string;
  needsRestart?: { fields: string[] };
}

interface UseConfigReturn {
  config: Record<string, unknown> | null;
  rev: string | null;
  secrets: SecretStatus[];
  capabilities: ConfigCapabilities;
  loading: boolean;
  error: string | null;
  saving: boolean;
  needsRestart: string[] | null;
  reload: () => Promise<void>;
  patchConfig: (ops: PatchOp[]) => Promise<boolean>;
  setSecret: (path: string, value: string) => Promise<boolean>;
  clearSecret: (path: string) => Promise<boolean>;
  dismissRestart: () => void;
}

function getAuth() {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
  const token = localStorage.getItem("spaceduck.token");
  return { gatewayUrl, token };
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { gatewayUrl, token } = getAuth();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (init?.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${gatewayUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function useConfig(): UseConfigReturn {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [capabilities, setCapabilities] = useState<ConfigCapabilities>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [needsRestart, setNeedsRestart] = useState<string[] | null>(null);
  const revRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<ConfigResponse>("/api/config");
      setConfig(data.config);
      setRev(data.rev);
      revRef.current = data.rev;
      setSecrets(data.secrets);
      setCapabilities(data.capabilities);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchConfig = useCallback(async (ops: PatchOp[]): Promise<boolean> => {
    if (!revRef.current) return false;
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<PatchResponse>("/api/config", {
        method: "PATCH",
        headers: { "if-match": revRef.current },
        body: JSON.stringify(ops),
      });
      setConfig(data.config);
      setRev(data.rev);
      revRef.current = data.rev;
      if (data.needsRestart) {
        setNeedsRestart(data.needsRestart.fields);
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await load();
        setError("Config was modified elsewhere. Your changes were refreshed — please try again.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const setSecret = useCallback(async (path: string, value: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>("/api/config/secrets", {
        method: "POST",
        body: JSON.stringify({ op: "set", path, value }),
      });
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set secret");
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const clearSecret = useCallback(async (path: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>("/api/config/secrets", {
        method: "POST",
        body: JSON.stringify({ op: "unset", path }),
      });
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear secret");
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const dismissRestart = useCallback(() => {
    setNeedsRestart(null);
  }, []);

  return {
    config,
    rev,
    secrets,
    capabilities,
    loading,
    error,
    saving,
    needsRestart,
    reload: load,
    patchConfig,
    setSecret,
    clearSecret,
    dismissRestart,
  };
}
