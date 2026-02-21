import type { ConfigPatchOp } from "./types";
import type { SpaceduckProductConfig } from "./types";

export function applyPatch(
  _config: SpaceduckProductConfig,
  _ops: ConfigPatchOp[],
): SpaceduckProductConfig {
  throw new Error("Not implemented");
}
