export { SpaceduckConfigSchema } from "./schema";
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
