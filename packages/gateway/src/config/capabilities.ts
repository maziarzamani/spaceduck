import type { SpaceduckProductConfig } from "@spaceduck/config";
import { getSecretStatus, recommendTier } from "@spaceduck/config";
import type { ModelTier, ModelRecommendation } from "@spaceduck/config";
import { LOCAL_MODEL_RECOMMENDATIONS } from "@spaceduck/config";
import { arch, platform, cpus, totalmem } from "node:os";

// ── Unauthenticated: binary/environment availability only ────────

export interface EnvCapabilities {
  stt: { available: boolean; reason?: string };
  marker: { available: boolean; reason?: string };
  embedding: { available: boolean; reason?: string };
  browser: { available: boolean; reason?: string };
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
    const [stt, marker, browser] = await Promise.all([
      detectStt(),
      detectMarker(),
      detectBrowser(),
    ]);
    cachedCapabilities = { stt, marker, embedding: { available: true }, browser };
    capabilitiesPromise = null;
    return cachedCapabilities;
  })();

  return capabilitiesPromise;
}

async function detectStt(): Promise<{ available: boolean; reason?: string }> {
  try {
    const { WhisperStt } = await import("@spaceduck/stt-whisper");
    const whisperResult = await WhisperStt.isAvailable();
    if (whisperResult.ok) return { available: true };
  } catch { /* whisper not loadable */ }

  try {
    const { AwsTranscribeStt } = await import("@spaceduck/stt-aws-transcribe");
    const awsResult = await AwsTranscribeStt.isAvailable();
    if (awsResult.ok) return { available: true };
  } catch { /* aws transcribe not loadable */ }

  return { available: false, reason: "No STT backend available (whisper not found, AWS credentials not configured)" };
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

async function detectBrowser(): Promise<{ available: boolean; reason?: string }> {
  try {
    const { BrowserTool } = await import("@spaceduck/tool-browser");
    const result = BrowserTool.isAvailable();
    return result.available
      ? { available: true }
      : { available: false, reason: result.reason };
  } catch {
    return { available: false, reason: "browser tool module not loadable" };
  }
}

// ── Authenticated: configured readiness signals ──────────────────

export interface ConfiguredStatus {
  aiProviderReady: boolean;
  webSearchReady: boolean;
  webAnswerReady: boolean;
  browserReady: boolean;
  webFetchReady: boolean;
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

  // lmstudio and llamacpp don't need an API key; others do
  const aiProviderReady =
    provider === "lmstudio" ||
    provider === "llamacpp" ||
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

  return { aiProviderReady, webSearchReady, webAnswerReady, browserReady: true, webFetchReady: true };
}

// ── System profile (unauthenticated -- safe fields only) ─────────

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

let cachedProfile: SystemProfile | null = null;

export function getSystemProfile(): SystemProfile {
  if (cachedProfile) return cachedProfile;

  let os: string | null = null;
  let archStr: string | null = null;
  let totalMemoryGB: number | null = null;
  let cpuCores: number | null = null;
  let appleSilicon = false;

  try {
    os = platform();
  } catch { /* safe default */ }

  try {
    archStr = arch();
  } catch { /* safe default */ }

  try {
    const bytes = totalmem();
    totalMemoryGB = Math.round((bytes / (1024 ** 3)) * 10) / 10;
  } catch { /* safe default */ }

  try {
    cpuCores = cpus().length || null;
  } catch { /* safe default */ }

  if (os === "darwin" && archStr === "arm64") {
    appleSilicon = true;
  }

  const knownFields = [os, archStr, totalMemoryGB, cpuCores].filter((v) => v != null).length;
  const confidence: SystemProfile["confidence"] =
    knownFields >= 4 ? "high" : knownFields >= 2 ? "partial" : "unknown";

  const tier = recommendTier(totalMemoryGB);

  cachedProfile = {
    os,
    arch: archStr,
    appleSilicon,
    totalMemoryGB,
    cpuCores,
    confidence,
    recommendedTier: tier,
    recommendations: LOCAL_MODEL_RECOMMENDATIONS,
  };

  return cachedProfile;
}

/** Reset cached profile (for tests). */
export function _resetSystemProfileCache(): void {
  cachedProfile = null;
}
