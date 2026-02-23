import type { ConfigPatchOp } from "./types";

// ── Version ──────────────────────────────────────────────────────────

export const ONBOARDING_VERSION = 1;

// ── Setup modes ──────────────────────────────────────────────────────

export type SetupMode = "local" | "cloud" | "advanced";

// ── Provider definitions ─────────────────────────────────────────────

export const CLOUD_PROVIDERS = [
  { id: "gemini", label: "Google Gemini", recommended: true },
  { id: "openrouter", label: "OpenRouter", recommended: false },
  { id: "bedrock", label: "Amazon Bedrock", recommended: false },
] as const;

export const LOCAL_PROVIDERS = [
  { id: "llamacpp", label: "llama.cpp server", hint: "easiest", recommended: true },
  { id: "lmstudio", label: "LM Studio", hint: "GUI app", recommended: false },
  { id: "custom", label: "Custom local server", hint: "OpenAI-compatible", recommended: false },
] as const;

export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number]["id"];
export type LocalProviderId = (typeof LOCAL_PROVIDERS)[number]["id"];

// ── Preset URLs ──────────────────────────────────────────────────────

export const LOCAL_PRESET_URLS: Record<string, string> = {
  lmstudio: "http://localhost:1234/v1",
  llamacpp: "http://127.0.0.1:8080/v1",
};

// ── Default models ───────────────────────────────────────────────────

export const CLOUD_DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-2.5-flash",
  openrouter: "google/gemini-2.5-flash",
  bedrock: "us.amazon.nova-2-pro-v1:0",
};

// ── Secret labels (for UI) ───────────────────────────────────────────

export const SECRET_LABELS: Record<string, { path: string; label: string; placeholder: string }> = {
  gemini: {
    path: "/ai/secrets/geminiApiKey",
    label: "API Key",
    placeholder: "AIza...",
  },
  openrouter: {
    path: "/ai/secrets/openrouterApiKey",
    label: "API Key",
    placeholder: "sk-or-...",
  },
  bedrock: {
    path: "/ai/secrets/bedrockApiKey",
    label: "API Key",
    placeholder: "ABSK...",
  },
  lmstudio: {
    path: "/ai/secrets/lmstudioApiKey",
    label: "API Key (optional)",
    placeholder: "Optional",
  },
  llamacpp: {
    path: "/ai/secrets/llamacppApiKey",
    label: "API Key (optional)",
    placeholder: "Optional",
  },
};

// ── Model recommendations (for Local / system profile) ───────────────

export type ModelTier = "small" | "medium" | "large";

export interface ModelRecommendation {
  name: string;
  params: string;
  quant: string;
  sizeGB: number;
}

export const LOCAL_MODEL_RECOMMENDATIONS: Record<ModelTier, ModelRecommendation> = {
  small: { name: "Qwen 2.5 3B", params: "3B", quant: "Q4_K_M", sizeGB: 2 },
  medium: { name: "Llama 3.1 8B", params: "8B", quant: "Q4_K_M", sizeGB: 5 },
  large: { name: "Llama 3.1 70B", params: "70B", quant: "Q4_K_M", sizeGB: 40 },
};

// ── Tier recommendation ──────────────────────────────────────────────

export function recommendTier(memoryGB: number | null): ModelTier {
  if (memoryGB == null || memoryGB < 8) return "small";
  if (memoryGB < 32) return "medium";
  return "large";
}

// ── Patch builders ───────────────────────────────────────────────────

export function buildLocalPatch(
  provider: string,
  baseUrl: string,
): ConfigPatchOp[] {
  return [
    { op: "replace", path: "/ai/provider", value: provider === "custom" ? "llamacpp" : provider },
    { op: "replace", path: "/ai/baseUrl", value: baseUrl || null },
    { op: "replace", path: "/ai/model", value: null },
  ];
}

export function buildCloudPatch(
  provider: string,
  model: string,
  region?: string,
): ConfigPatchOp[] {
  const ops: ConfigPatchOp[] = [
    { op: "replace", path: "/ai/provider", value: provider },
    { op: "replace", path: "/ai/model", value: model || null },
    { op: "replace", path: "/ai/baseUrl", value: null },
  ];
  if (provider === "bedrock" && region) {
    ops.push({ op: "replace", path: "/ai/region", value: region });
  }
  return ops;
}

export function buildAdvancedPatch(opts: {
  provider: string;
  model?: string;
  baseUrl?: string;
  region?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
}): ConfigPatchOp[] {
  const ops: ConfigPatchOp[] = [
    { op: "replace", path: "/ai/provider", value: opts.provider },
    { op: "replace", path: "/ai/model", value: opts.model || null },
    { op: "replace", path: "/ai/baseUrl", value: opts.baseUrl || null },
  ];
  if (opts.region) {
    ops.push({ op: "replace", path: "/ai/region", value: opts.region });
  }
  if (opts.embeddingProvider) {
    ops.push(
      { op: "replace", path: "/embedding/provider", value: opts.embeddingProvider },
      { op: "replace", path: "/embedding/model", value: opts.embeddingModel || null },
      { op: "replace", path: "/embedding/baseUrl", value: opts.embeddingBaseUrl || null },
    );
  }
  return ops;
}

export function buildOnboardingCompletePatch(
  mode: SetupMode,
  version: number,
): ConfigPatchOp[] {
  return [
    { op: "replace", path: "/onboarding/completed", value: true },
    { op: "replace", path: "/onboarding/mode", value: mode },
    { op: "replace", path: "/onboarding/completedAt", value: new Date().toISOString() },
    { op: "replace", path: "/onboarding/versionCompleted", value: version },
  ];
}

export function buildOnboardingSkipPatch(): ConfigPatchOp[] {
  return [
    { op: "replace", path: "/onboarding/skippedAt", value: new Date().toISOString() },
  ];
}

export function buildOnboardingLastStepPatch(step: string): ConfigPatchOp[] {
  return [
    { op: "replace", path: "/onboarding/lastStep", value: step },
  ];
}

// ── Validators ───────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateLocalSetup(provider: string, url: string): ValidationResult {
  if (!provider) return { ok: false, error: "Select a local runtime" };
  if (provider !== "custom" && !url) {
    return { ok: true };
  }
  try {
    new URL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}

export function validateCloudSetup(provider: string, model: string): ValidationResult {
  if (!provider) return { ok: false, error: "Select a provider" };
  if (!model) return { ok: false, error: "Enter a model" };
  return { ok: true };
}
