// SkillRegistry: loads, validates, and manages skills at runtime

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Logger } from "@spaceduck/core";
import type { SkillManifest, ScanResult } from "./types";
import { parseSkillMd } from "./parser";
import { scanSkill } from "./scanner";

export interface SkillRegistryDeps {
  readonly logger: Logger;
  readonly autoScan?: boolean;
  /**
   * Callback to purge all memories written by a skill on uninstall.
   * Receives the skillId. Implementation is storage-specific (e.g. direct SQL).
   */
  readonly purgeMemoriesBySkillId?: (skillId: string) => Promise<number>;
}

interface SkillEntry {
  manifest: SkillManifest;
  scanResult: ScanResult;
  enabled: boolean;
}

export class SkillRegistry {
  private skills = new Map<string, SkillEntry>();
  private readonly logger: Logger;
  private readonly autoScan: boolean;
  private readonly purgeMemories?: (skillId: string) => Promise<number>;

  constructor(deps: SkillRegistryDeps) {
    this.logger = deps.logger.child({ component: "SkillRegistry" });
    this.autoScan = deps.autoScan ?? true;
    this.purgeMemories = deps.purgeMemoriesBySkillId;
  }

  /**
   * Load all SKILL.md files from the given directory paths.
   * Directories are scanned recursively for files named SKILL.md.
   */
  async loadFromPaths(paths: string[]): Promise<SkillManifest[]> {
    const loaded: SkillManifest[] = [];

    for (const basePath of paths) {
      const resolvedBase = resolve(basePath);
      const files = await findSkillFiles(resolvedBase);

      for (const filePath of files) {
        try {
          const result = await this.installFromFile(filePath);
          if (result) loaded.push(result);
        } catch (err) {
          this.logger.warn("Failed to load skill", {
            filePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    this.logger.info("Skills loaded", {
      paths,
      total: loaded.length,
      enabled: loaded.length,
    });

    return loaded;
  }

  /**
   * Install a single skill from a file path.
   * Parses, scans (if autoScan enabled), and registers.
   */
  async install(filePath: string): Promise<SkillManifest | null> {
    return this.installFromFile(filePath);
  }

  /**
   * Uninstall a skill by ID. Purges associated memories if a purge callback exists.
   */
  async uninstall(skillId: string): Promise<boolean> {
    const entry = this.skills.get(skillId);
    if (!entry) return false;

    if (this.purgeMemories) {
      const count = await this.purgeMemories(skillId);
      this.logger.info("Purged skill memories on uninstall", { skillId, memoriesPurged: count });
    }

    this.skills.delete(skillId);
    this.logger.info("Skill uninstalled", { skillId });
    return true;
  }

  get(skillId: string): SkillManifest | undefined {
    return this.skills.get(skillId)?.manifest;
  }

  list(): SkillManifest[] {
    return Array.from(this.skills.values()).map((e) => e.manifest);
  }

  listEnabled(): SkillManifest[] {
    return Array.from(this.skills.values())
      .filter((e) => e.enabled)
      .map((e) => e.manifest);
  }

  getScanResult(skillId: string): ScanResult | undefined {
    return this.skills.get(skillId)?.scanResult;
  }

  enable(skillId: string): boolean {
    const entry = this.skills.get(skillId);
    if (!entry) return false;
    entry.enabled = true;
    return true;
  }

  disable(skillId: string): boolean {
    const entry = this.skills.get(skillId);
    if (!entry) return false;
    entry.enabled = false;
    return true;
  }

  get size(): number {
    return this.skills.size;
  }

  private async installFromFile(filePath: string): Promise<SkillManifest | null> {
    const content = await readFile(filePath, "utf-8");
    const parseResult = parseSkillMd(content, filePath);

    if (!parseResult.ok) {
      this.logger.warn("Skill parse failed", {
        filePath,
        code: parseResult.error.code,
        message: parseResult.error.message,
      });
      return null;
    }

    const manifest = parseResult.manifest;

    if (this.skills.has(manifest.id)) {
      this.logger.warn("Duplicate skill ID, skipping", {
        skillId: manifest.id,
        filePath,
        existingPath: this.skills.get(manifest.id)!.manifest.filePath,
      });
      return null;
    }

    let scanResult: ScanResult = { passed: true, severity: "none", findings: [] };

    if (this.autoScan) {
      scanResult = scanSkill(manifest);

      if (!scanResult.passed) {
        this.logger.warn("Skill rejected by security scanner", {
          skillId: manifest.id,
          filePath,
          severity: scanResult.severity,
          findings: scanResult.findings.map((f) => f.message),
        });
        return null;
      }

      if (scanResult.findings.length > 0) {
        this.logger.warn("Skill loaded with warnings", {
          skillId: manifest.id,
          filePath,
          findings: scanResult.findings.map((f) => f.message),
        });
      }
    }

    this.skills.set(manifest.id, {
      manifest,
      scanResult,
      enabled: true,
    });

    this.logger.debug("Skill installed", {
      skillId: manifest.id,
      filePath,
      toolAllow: manifest.toolAllow,
    });

    return manifest;
  }
}

async function findSkillFiles(basePath: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(basePath, entry.name);
      if (entry.isDirectory()) {
        const nested = await findSkillFiles(fullPath);
        results.push(...nested);
      } else if (entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or is unreadable
  }

  return results;
}
