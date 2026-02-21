import type { GlobalOpts } from "../index";
import { apiFetch } from "../lib/api";
import { SECRET_PATHS } from "@spaceduck/config";

interface ConfigResponse {
  config: Record<string, unknown>;
  rev: string;
  secrets: { path: string; isSet: boolean }[];
}

export async function configPaths(opts: GlobalOpts) {
  const { data } = await apiFetch<ConfigResponse>(opts, "/api/config");
  const lines = flatten("", data.config);

  if (opts.json) {
    const obj: Record<string, unknown> = {};
    for (const { path, value } of lines) obj[path] = value;
    console.log(JSON.stringify(obj, null, 2));
    return;
  }

  const secretSet = new Set(SECRET_PATHS);
  const maxPath = Math.max(...lines.map((l) => l.path.length));

  for (const { path, value } of lines) {
    const isSecret = secretSet.has(path);
    const display = isSecret ? "(secret)" : JSON.stringify(value);
    console.log(`${path.padEnd(maxPath + 2)}${display}`);
  }
}

function flatten(prefix: string, obj: unknown): { path: string; value: unknown }[] {
  if (obj === null || obj === undefined || typeof obj !== "object" || Array.isArray(obj)) {
    return [{ path: prefix, value: obj }];
  }

  const results: { path: string; value: unknown }[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    results.push(...flatten(`${prefix}/${key}`, val));
  }
  return results;
}
