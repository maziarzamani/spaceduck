import type { ConfigPatchOp } from "./types";

/**
 * Paths that can be hot-applied without a gateway restart.
 * Any patched path NOT in this set triggers needsRestart.
 */
export const HOT_APPLY_PATHS: ReadonlySet<string> = new Set([
  "/ai/temperature",
  "/ai/systemPrompt",
  "/ai/provider",
  "/ai/model",
  "/ai/baseUrl",
  "/ai/region",
  "/embedding/baseUrl",
  "/gateway/name",
  "/stt/languageHint",
  "/stt/model",
  "/stt/backend",
  "/stt/awsTranscribe/region",
  "/stt/awsTranscribe/languageCode",
  "/stt/awsTranscribe/profile",
  "/stt/dictation/enabled",
  "/stt/dictation/hotkey",
  "/tools/browser/livePreview",
  "/tools/browser/sessionIdleTimeoutMs",
  "/tools/browser/maxSessions",
  "/tools/marker/enabled",
  "/tools/webSearch/provider",
  "/tools/webSearch/searxngUrl",
  "/tools/webAnswer/enabled",
  "/channels/whatsapp/enabled",
  "/onboarding/completed",
  "/onboarding/mode",
  "/onboarding/lastStep",
  "/onboarding/completedAt",
  "/onboarding/skippedAt",
  "/onboarding/versionCompleted",
  "/scheduler/enabled",
  "/scheduler/heartbeatIntervalMs",
  "/scheduler/maxConcurrentTasks",
  "/scheduler/defaultBudget/maxTokens",
  "/scheduler/defaultBudget/maxCostUsd",
  "/scheduler/defaultBudget/maxWallClockMs",
  "/scheduler/defaultBudget/maxToolCalls",
  "/scheduler/defaultBudget/maxMemoryWrites",
  "/scheduler/globalBudget/dailyLimitUsd",
  "/scheduler/globalBudget/monthlyLimitUsd",
  "/scheduler/globalBudget/alertThresholds",
  "/scheduler/globalBudget/onLimitReached",
  "/scheduler/retry/maxAttempts",
  "/scheduler/retry/backoffBaseMs",
  "/scheduler/retry/backoffMaxMs",
]);

/**
 * Classify patch ops into hot-appliable vs needs-restart.
 * Compares raw pointer strings (no decoding/re-encoding).
 */
export function classifyOps(
  ops: ConfigPatchOp[],
): { hotApply: string[]; needsRestart: string[] } {
  const hotApply: string[] = [];
  const needsRestart: string[] = [];

  for (const op of ops) {
    if (HOT_APPLY_PATHS.has(op.path)) {
      hotApply.push(op.path);
    } else {
      needsRestart.push(op.path);
    }
  }

  return { hotApply, needsRestart };
}
