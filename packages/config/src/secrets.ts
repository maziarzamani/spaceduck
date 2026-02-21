import type { SpaceduckProductConfig } from "./types";

export const SECRET_PATHS: readonly string[] = [];

export function isSecretPath(_path: string): boolean {
  throw new Error("Not implemented");
}

export function getSecretStatus(
  _config: SpaceduckProductConfig,
): Array<{ path: string; isSet: boolean }> {
  throw new Error("Not implemented");
}
