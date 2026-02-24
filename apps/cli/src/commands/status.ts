import type { GlobalOpts } from "../index";
import { apiFetch } from "../lib/api";

interface HealthResponse {
  status: string;
  uptime: number;
  provider: string;
  model: string;
}

interface ProviderStatusResponse {
  ok: boolean;
  error?: string;
}

export async function status(opts: GlobalOpts) {
  // Gateway health
  let health: HealthResponse;
  try {
    const result = await apiFetch<HealthResponse>(opts, "/api/health");
    health = result.data;
  } catch {
    if (opts.json) {
      console.log(JSON.stringify({ gateway: "unreachable", provider: null }));
    } else {
      console.log(`Gateway  ● unreachable  (${opts.gateway})`);
    }
    process.exit(1);
  }

  // Provider status
  let providerOk = false;
  let providerError: string | null = null;
  try {
    const { data } = await apiFetch<ProviderStatusResponse>(opts, "/api/config/provider-status");
    providerOk = data.ok;
    providerError = data.error ?? null;
  } catch (err) {
    providerError = err instanceof Error ? err.message : "check failed";
  }

  if (opts.json) {
    console.log(JSON.stringify({
      gateway: "connected",
      url: opts.gateway,
      uptime: health.uptime,
      provider: health.provider,
      model: health.model,
      providerStatus: providerOk ? "ok" : "error",
      providerError,
    }, null, 2));
    return;
  }

  const uptime = formatUptime(health.uptime);
  const providerDot = providerOk ? "●" : "○";
  const providerLabel = providerOk ? "responding" : (providerError ?? "error");

  console.log(`Gateway  ● connected  (${opts.gateway})`);
  console.log(`Uptime   ${uptime}`);
  console.log(`Chat     ${health.provider} / ${health.model}`);
  console.log(`Provider ${providerDot} ${providerLabel}`);
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
