import type { ConfigPatchOp, SpaceduckProductConfig } from "./types";
import { decodePointer, PointerError } from "./pointer";
import { isSecretPath } from "./secrets";
import { SpaceduckConfigSchema } from "./schema";

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

/**
 * Known schema keys at each parent path, derived from the Zod schema shape.
 * Built once at module load from defaultConfig's structure.
 */
const KNOWN_KEYS = buildKnownKeys();

function buildKnownKeys(): Map<string, Set<string>> {
  const config = SpaceduckConfigSchema.parse({});
  const map = new Map<string, Set<string>>();
  collectKeys(config, "", map);
  return map;
}

function collectKeys(
  obj: unknown,
  parentPointer: string,
  map: Map<string, Set<string>>,
): void {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return;
  const keys = Object.keys(obj as Record<string, unknown>);
  map.set(parentPointer, new Set(keys));
  for (const key of keys) {
    collectKeys(
      (obj as Record<string, unknown>)[key],
      `${parentPointer}/${key}`,
      map,
    );
  }
}

/**
 * Apply JSON Patch operations to a config object.
 * Only `replace` and `add` ops are supported (no `remove` in v1).
 *
 * - `replace`: path must already exist in the current config
 * - `add`: parent must exist and be an object; key must be a known schema key
 * - Rejects ops on secret paths (use POST /api/config/secrets instead)
 *
 * Returns a new config object (does not mutate the original).
 * Throws PatchError on any validation failure.
 */
export function applyPatch(
  config: SpaceduckProductConfig,
  ops: ConfigPatchOp[],
): SpaceduckProductConfig {
  if (ops.length === 0) {
    throw new PatchError("Patch ops array must not be empty");
  }

  let result = structuredClone(config) as Record<string, unknown>;

  for (const op of ops) {
    if (isSecretPath(op.path)) {
      throw new PatchError(
        `Cannot patch secret path "${op.path}" — use POST /api/config/secrets`,
      );
    }

    let segments: string[];
    try {
      segments = decodePointer(op.path);
    } catch (e) {
      if (e instanceof PointerError) {
        throw new PatchError(`Invalid path "${op.path}": ${e.message}`);
      }
      throw e;
    }

    switch (op.op) {
      case "replace":
        applyReplace(result, segments, op.path, op.value);
        break;
      case "add":
        applyAdd(result, segments, op.path, op.value);
        break;
      default:
        throw new PatchError(
          `Unsupported op "${(op as { op: string }).op}" — only "replace" and "add" are allowed`,
        );
    }
  }

  return result as SpaceduckProductConfig;
}

function applyReplace(
  root: Record<string, unknown>,
  segments: string[],
  fullPath: string,
  value: unknown,
): void {
  const { parent, key } = resolveParent(root, segments, fullPath);
  if (!(key in parent)) {
    throw new PatchError(
      `Cannot replace non-existent path "${fullPath}"`,
    );
  }
  parent[key] = value;
}

function applyAdd(
  root: Record<string, unknown>,
  segments: string[],
  fullPath: string,
  value: unknown,
): void {
  const { parent, key } = resolveParent(root, segments, fullPath);

  if (Array.isArray(parent)) {
    throw new PatchError(
      `Cannot add to array at "${fullPath}" — only object targets allowed`,
    );
  }

  const parentPointer =
    segments.length <= 1
      ? ""
      : "/" + segments.slice(0, -1).join("/");

  const allowedKeys = KNOWN_KEYS.get(parentPointer);
  if (!allowedKeys || !allowedKeys.has(key)) {
    throw new PatchError(
      `Cannot add unknown key "${key}" at "${fullPath}" — not a known schema property`,
    );
  }

  parent[key] = value;
}

function resolveParent(
  root: Record<string, unknown>,
  segments: string[],
  fullPath: string,
): { parent: Record<string, unknown>; key: string } {
  let current: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current == null || typeof current !== "object") {
      throw new PatchError(
        `Path "${fullPath}" has non-object at segment "${segments[i]}"`,
      );
    }
    current = (current as Record<string, unknown>)[segments[i]];
  }

  if (current == null || typeof current !== "object" || Array.isArray(current)) {
    throw new PatchError(
      `Parent of "${fullPath}" is not an object`,
    );
  }

  return {
    parent: current as Record<string, unknown>,
    key: segments[segments.length - 1],
  };
}
