// SKILL.md parser: YAML frontmatter + markdown body -> SkillManifest
//
// OpenClaw-compatible: `name` and `description` are required frontmatter fields.
// Unknown fields are silently preserved (z.passthrough) for forward compatibility.

import { resolve } from "node:path";
import type { SkillManifest } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Minimal YAML parser for flat key-value frontmatter.
 * Handles strings, numbers, booleans, and arrays (flow syntax `[a, b]`).
 * Not a full YAML spec implementation -- covers SKILL.md conventions.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: string | unknown = trimmed.slice(colonIdx + 1).trim();

    if (typeof value === "string") {
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Flow-style arrays: [a, b, c]
      else if (value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1).split(",").map((s) => parseScalar(s.trim())).filter((s) => s !== "");
      }
      // Booleans and numbers
      else {
        value = parseScalar(value as string);
      }
    }

    result[key] = value;
  }

  return result;
}

function parseScalar(s: string): unknown {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~" || s === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Strip quotes
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export interface ParseError {
  readonly code: "NO_FRONTMATTER" | "MISSING_NAME" | "MISSING_DESCRIPTION" | "EMPTY_BODY";
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly manifest: SkillManifest }
  | { readonly ok: false; readonly error: ParseError };

/**
 * Parse a SKILL.md file's raw content into a SkillManifest.
 *
 * @param content  Raw file content (UTF-8 text)
 * @param filePath Path to the SKILL.md file (used for error messages and stored on manifest)
 */
export function parseSkillMd(content: string, filePath: string): ParseResult {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return {
      ok: false,
      error: { code: "NO_FRONTMATTER", message: `No YAML frontmatter found in ${filePath}` },
    };
  }

  const frontmatter = parseFrontmatter(match[1]);
  const body = match[2].trim();

  const name = frontmatter.name;
  if (typeof name !== "string" || !name) {
    return {
      ok: false,
      error: { code: "MISSING_NAME", message: `Missing required field 'name' in ${filePath}` },
    };
  }

  const description = frontmatter.description;
  if (typeof description !== "string" || !description) {
    return {
      ok: false,
      error: { code: "MISSING_DESCRIPTION", message: `Missing required field 'description' in ${filePath}` },
    };
  }

  if (!body) {
    return {
      ok: false,
      error: { code: "EMPTY_BODY", message: `Empty instructions body in ${filePath}` },
    };
  }

  // Extract known spaceduck extensions
  const toolAllow = Array.isArray(frontmatter.toolAllow)
    ? (frontmatter.toolAllow as string[])
    : undefined;
  const toolDeny = Array.isArray(frontmatter.toolDeny)
    ? (frontmatter.toolDeny as string[])
    : undefined;

  // Build budget from frontmatter fields if present
  const budget = extractBudget(frontmatter);

  // Collect extra fields (everything except known keys)
  const KNOWN_KEYS = new Set([
    "name", "description", "version", "author",
    "toolAllow", "toolDeny", "resultRoute",
    "maxTokens", "maxCostUsd", "maxWallClockMs", "maxToolCalls", "maxMemoryWrites",
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = v;
  }

  const manifest: SkillManifest = {
    id: name,
    description,
    version: typeof frontmatter.version === "string" ? frontmatter.version : undefined,
    author: typeof frontmatter.author === "string" ? frontmatter.author : undefined,
    toolAllow,
    toolDeny,
    budget: budget ?? undefined,
    instructions: body,
    filePath: resolve(filePath),
    extra,
  };

  return { ok: true, manifest };
}

function extractBudget(fm: Record<string, unknown>): Partial<import("@spaceduck/core").TaskBudget> | null {
  const b: Record<string, number> = {};
  let hasAny = false;

  for (const key of ["maxTokens", "maxCostUsd", "maxWallClockMs", "maxToolCalls", "maxMemoryWrites"] as const) {
    if (typeof fm[key] === "number") {
      b[key] = fm[key] as number;
      hasAny = true;
    }
  }

  return hasAny ? b : null;
}
