export { SpaceduckConfigSchema, HttpUrlSchema, SttModelEnum } from "./schema";
export { DEFAULT_SYSTEM_PROMPT } from "./constants";
export type { SpaceduckProductConfig } from "./types";
export type { ConfigPatchOp } from "./types";
export { defaultConfig } from "./defaults";
export { applyPatch, PatchError } from "./patch";
export { redactConfig } from "./redact";
export {
  SECRET_PATHS,
  isSecretPath,
  getSecretStatus,
} from "./secrets";
export { validatePointer, decodePointer, PointerError } from "./pointer";
export { canonicalize } from "./canonicalize";
export { HOT_APPLY_PATHS, classifyOps } from "./hot-apply";
export {
  ONBOARDING_VERSION,
  CLOUD_PROVIDERS,
  LOCAL_PROVIDERS,
  LOCAL_PRESET_URLS,
  CLOUD_DEFAULT_MODELS,
  SECRET_LABELS,
  LOCAL_MODEL_RECOMMENDATIONS,
  recommendTier,
  buildLocalPatch,
  buildCloudPatch,
  buildAdvancedPatch,
  buildOnboardingCompletePatch,
  buildOnboardingSkipPatch,
  buildOnboardingLastStepPatch,
  validateLocalSetup,
  validateCloudSetup,
} from "./setup";
export type {
  SetupMode,
  CloudProviderId,
  LocalProviderId,
  ModelTier,
  ModelRecommendation,
  ValidationResult,
} from "./setup";
