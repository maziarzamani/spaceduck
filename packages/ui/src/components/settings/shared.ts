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

/** Validate and normalize an HTTP(S) URL. UI owns normalization (trim + strip trailing slash). */
export function validateHttpUrl(
  value: string,
): { ok: true; normalized: string } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, normalized: "" };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "URL must start with http:// or https://" };
    }
    return { ok: true, normalized: trimmed.replace(/\/+$/, "") };
  } catch {
    return { ok: false, message: "Enter a valid URL (e.g. http://localhost:8080)" };
  }
}
