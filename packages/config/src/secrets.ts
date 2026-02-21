import type { SpaceduckProductConfig } from "./types";

export const SECRET_PATHS: readonly string[] = [
  "/ai/secrets/geminiApiKey",
  "/ai/secrets/bedrockApiKey",
  "/ai/secrets/openrouterApiKey",
  "/ai/secrets/lmstudioApiKey",
  "/tools/webSearch/secrets/braveApiKey",
  "/tools/webAnswer/secrets/perplexityApiKey",
] as const;

const secretPathSet = new Set<string>(SECRET_PATHS);

export function isSecretPath(path: string): boolean {
  return secretPathSet.has(path);
}

export function getSecretStatus(
  config: SpaceduckProductConfig,
): Array<{ path: string; isSet: boolean }> {
  return SECRET_PATHS.map((path) => ({
    path,
    isSet: resolveValue(config, path) != null,
  }));
}

function resolveValue(obj: unknown, pointer: string): unknown {
  const segments = pointer.slice(1).split("/");
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}
