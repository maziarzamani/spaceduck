import type { SpaceduckProductConfig } from "./types";
import { SECRET_PATHS } from "./secrets";

export function redactConfig(
  config: SpaceduckProductConfig,
): SpaceduckProductConfig {
  const clone = structuredClone(config) as Record<string, unknown>;
  for (const path of SECRET_PATHS) {
    setNestedValue(clone, path, null);
  }
  return clone as SpaceduckProductConfig;
}

function setNestedValue(
  obj: Record<string, unknown>,
  pointer: string,
  value: unknown,
): void {
  const segments = pointer.slice(1).split("/");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = current[segments[i]];
    if (next == null || typeof next !== "object") return;
    current = next as Record<string, unknown>;
  }
  const lastKey = segments[segments.length - 1];
  if (lastKey in current) {
    current[lastKey] = value;
  }
}
