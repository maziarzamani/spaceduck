import type { useConfig } from "../../hooks/use-config";

export type ConfigHook = ReturnType<typeof useConfig>;

export interface SectionProps {
  cfg: ConfigHook;
}

/** Safely drill into nested config objects. */
export function getPath(obj: Record<string, unknown>, path: string): unknown {
  const segs = path.replace(/^\//, "").split("/");
  let current: unknown = obj;
  for (const seg of segs) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Check if a secret is set by its JSON Pointer path. */
export function isSecretSet(
  secrets: Array<{ path: string; isSet: boolean }>,
  path: string,
): boolean {
  return secrets.find((s) => s.path === path)?.isSet ?? false;
}
