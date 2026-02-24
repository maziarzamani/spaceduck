import { API_VERSION } from "@spaceduck/core";
import { CliError, type GlobalOpts } from "../index";
import { apiFetch } from "./api";

interface HealthResponse {
  apiVersion?: number;
}

/**
 * Fetch the gateway's apiVersion and check it matches the CLI.
 * Throws CliError if versions are incompatible.
 */
export async function ensureCompatible(opts: GlobalOpts): Promise<void> {
  let health: HealthResponse;
  try {
    const result = await apiFetch<HealthResponse>(opts, "/api/health");
    health = result.data;
  } catch {
    return;
  }

  if (health.apiVersion !== undefined && health.apiVersion !== API_VERSION) {
    throw new CliError(
      `Gateway API version mismatch (gateway: ${health.apiVersion}, cli: ${API_VERSION}). ` +
      (health.apiVersion > API_VERSION
        ? "Please upgrade your CLI."
        : "Please upgrade your gateway."),
    );
  }
}
