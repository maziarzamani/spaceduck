import type { ConfigPatchOp } from "./types";

/**
 * Paths that can be hot-applied without a gateway restart.
 * Any patched path NOT in this set triggers needsRestart.
 */
export const HOT_APPLY_PATHS: ReadonlySet<string> = new Set([
  "/ai/temperature",
  "/ai/systemPrompt",
  "/gateway/name",
  "/stt/languageHint",
  "/stt/model",
  "/tools/marker/enabled",
  "/tools/webSearch/provider",
  "/tools/webSearch/searxngUrl",
  "/tools/webAnswer/enabled",
  "/channels/whatsapp/enabled",
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
