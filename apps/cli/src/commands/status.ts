import type { GlobalOpts } from "../index";
import { apiFetch } from "../lib/api";
import { API_VERSION } from "@spaceduck/core";

interface HealthResponse {
  status: string;
  version?: string;
  apiVersion?: number;
  commit?: string;
  uptime: number;
  provider: string;
  model: string;
}

interface ProviderStatusResponse {
  ok: boolean;
  error?: string;
}

export async function status(opts: GlobalOpts) {
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

  // Compatibility check
  const compatible = health.apiVersion === undefined || health.apiVersion === API_VERSION;

  if (opts.json) {
    console.log(JSON.stringify({
      gateway: "connected",
      url: opts.gateway,
      version: health.version ?? null,
      apiVersion: health.apiVersion ?? null,
      commit: health.commit ?? null,
      cliApiVersion: API_VERSION,
      compatible,
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
  if (health.version) {
    const commitStr = health.commit && health.commit !== "dev" ? ` [${health.commit.slice(0, 7)}]` : "";
    console.log(`         v${health.version} (api: ${health.apiVersion ?? "??"})${commitStr}`);
  }
  if (!compatible) {
    console.log(`         ○ incompatible (gateway api: ${health.apiVersion}, cli supports: ${API_VERSION})`);
  }
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
