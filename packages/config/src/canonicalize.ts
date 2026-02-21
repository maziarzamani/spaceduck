/**
 * Produce a stable JSON string from a value.
 * Objects have their keys deep-sorted. Arrays preserve order.
 * No undefined values (they become null). No trailing whitespace.
 *
 * Usage for rev hashing: canonicalize(redactConfig(config))
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(deepSortKeys(value));
}

function deepSortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = deepSortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
