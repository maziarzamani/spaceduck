// Skill system types: manifests, scan results, registry entries

import type { TaskBudget, TaskResultRoute } from "@spaceduck/core";

/**
 * Parsed representation of a SKILL.md file.
 * OpenClaw-compatible: only `id` and `description` are required.
 * Unknown frontmatter fields are preserved via passthrough parsing.
 */
export interface SkillManifest {
  readonly id: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;

  readonly toolAllow?: string[];
  readonly toolDeny?: string[];
  readonly budget?: Partial<TaskBudget>;
  readonly resultRoute?: TaskResultRoute;

  readonly instructions: string;
  readonly filePath: string;

  /** Extra frontmatter fields from OpenClaw or other sources (silently preserved). */
  readonly extra: Record<string, unknown>;
}

export type ScanSeverity = "none" | "warning" | "critical";

export interface ScanFinding {
  readonly rule: string;
  readonly severity: "warning" | "critical";
  readonly message: string;
  readonly matchedText?: string;
}

export interface ScanResult {
  readonly passed: boolean;
  readonly severity: ScanSeverity;
  readonly findings: ScanFinding[];
}
