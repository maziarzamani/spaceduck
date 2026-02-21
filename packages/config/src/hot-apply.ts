import type { ConfigPatchOp } from "./types";

export const HOT_APPLY_PATHS: ReadonlySet<string> = new Set<string>();

export function classifyOps(
  _ops: ConfigPatchOp[],
): { hotApply: string[]; needsRestart: string[] } {
  throw new Error("Not implemented");
}
