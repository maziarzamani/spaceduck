// Error classification for OpenAI-compatible providers.
//
// Split into two categories:
//   Transport errors — connectivity problems (server not running, DNS, timeout)
//   Provider errors  — the server responded but rejected the request (auth, rate limit, etc.)

import type { ProviderErrorCode } from "@spaceduck/core";

/**
 * Map a caught error to a normalized ProviderErrorCode.
 * Handles both HTTP response errors (message contains status code) and
 * network-level errors (ECONNREFUSED, etc.).
 */
export function classifyError(err: unknown): ProviderErrorCode {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = err.name.toLowerCase();

    // Cancellation (check before network — AbortError is not a transport failure)
    if (name === "aborterror" || msg.includes("aborted") || msg.includes("cancelled")) {
      return "cancelled";
    }

    // Transport errors
    if (
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("enotfound") ||
      msg.includes("etimedout") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    ) {
      return "transient_network";
    }

    // Provider errors — auth
    if (
      msg.includes("api key") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden") ||
      msg.includes("401") ||
      msg.includes("403")
    ) {
      return "auth_failed";
    }

    // Provider errors — rate limiting
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota")) {
      return "throttled";
    }

    // Provider errors — context length
    if (msg.includes("context length") || msg.includes("too long")) {
      return "context_length_exceeded";
    }

    // Provider errors — bad request
    if (msg.includes("invalid") || msg.includes("400") || msg.includes("bad request")) {
      return "invalid_request";
    }
  }
  return "unknown";
}

/**
 * Build a human-readable error hint for local servers (where the user
 * needs to know if their server is actually running).
 */
export function buildErrorHint(
  code: ProviderErrorCode,
  providerName: string,
  baseUrl: string,
): string {
  if (code === "transient_network") {
    return ` — is ${providerName} running on ${baseUrl}?`;
  }
  return "";
}
