import type { SpaceduckProductConfig } from "@spaceduck/config";
import { getSecretStatus } from "@spaceduck/config";

// ── Unauthenticated: binary/environment availability only ────────

export interface EnvCapabilities {
  stt: { available: boolean; reason?: string };
  marker: { available: boolean; reason?: string };
  embedding: { available: boolean; reason?: string };
}

/**
 * Detect binary/environment availability (safe for unauthenticated access).
 * Does NOT reveal whether API keys are configured.
 *
 * Results are cached for the lifetime of the process since binary
 * availability doesn't change without a restart.
 */
let cachedCapabilities: EnvCapabilities | null = null;
let capabilitiesPromise: Promise<EnvCapabilities> | null = null;

export function getCapabilities(): Promise<EnvCapabilities> {
  if (cachedCapabilities) return Promise.resolve(cachedCapabilities);
  if (capabilitiesPromise) return capabilitiesPromise;

  capabilitiesPromise = (async () => {
    const [stt, marker] = await Promise.all([
      detectStt(),
      detectMarker(),
    ]);
    cachedCapabilities = { stt, marker, embedding: { available: true } };
    capabilitiesPromise = null;
    return cachedCapabilities;
  })();

  return capabilitiesPromise;
}

async function detectStt(): Promise<{ available: boolean; reason?: string }> {
  try {
    const { WhisperStt } = await import("@spaceduck/stt-whisper");
    const result = await WhisperStt.isAvailable();
    return result.ok
      ? { available: true }
      : { available: false, reason: result.reason };
  } catch {
    return { available: false, reason: "whisper module not loadable" };
  }
}

async function detectMarker(): Promise<{ available: boolean; reason?: string }> {
  try {
    const { MarkerTool } = await import("@spaceduck/tool-marker");
    const available = await MarkerTool.isAvailable();
    return available
      ? { available: true }
      : { available: false, reason: "marker_single not found on PATH" };
  } catch {
    return { available: false, reason: "marker module not loadable" };
  }
}

// ── Authenticated: configured readiness signals ──────────────────

export interface ConfiguredStatus {
  aiProviderReady: boolean;
  webSearchReady: boolean;
  webAnswerReady: boolean;
}

/**
 * Compute readiness signals from config + secret status.
 * Only exposed through authenticated endpoints.
 */
export function getConfiguredStatus(
  config: SpaceduckProductConfig,
): ConfiguredStatus {
  const secrets = getSecretStatus(config);
  const secretIsSet = (path: string) =>
    secrets.find((s) => s.path === path)?.isSet ?? false;

  const provider = config.ai.provider;

  // lmstudio doesn't need an API key; others do
  const aiProviderReady =
    provider === "lmstudio" ||
    (provider === "gemini" && secretIsSet("/ai/secrets/geminiApiKey")) ||
    (provider === "bedrock" && secretIsSet("/ai/secrets/bedrockApiKey")) ||
    (provider === "openrouter" && secretIsSet("/ai/secrets/openrouterApiKey"));

  const webSearchReady =
    secretIsSet("/tools/webSearch/secrets/braveApiKey") ||
    (config.tools.webSearch.searxngUrl != null &&
      config.tools.webSearch.searxngUrl !== "");

  const webAnswerReady =
    secretIsSet("/tools/webAnswer/secrets/perplexityApiKey") ||
    secretIsSet("/ai/secrets/openrouterApiKey");

  return { aiProviderReady, webSearchReady, webAnswerReady };
}
