import { join } from "node:path";
import { rename, mkdir } from "node:fs/promises";
import JSON5 from "json5";
import {
  SpaceduckConfigSchema,
  defaultConfig,
  redactConfig,
  canonicalize,
  applyPatch,
  PatchError,
  isSecretPath,
  getSecretStatus,
  classifyOps,
  decodePointer,
  PointerError,
} from "@spaceduck/config";
import type {
  SpaceduckProductConfig,
  ConfigPatchOp,
} from "@spaceduck/config";

export type PatchResult =
  | {
      ok: true;
      config: SpaceduckProductConfig;
      rev: string;
      needsRestart?: { fields: string[] };
    }
  | { ok: false; error: "CONFLICT"; rev: string }
  | { ok: false; error: "VALIDATION"; issues: Array<{ path: string; message: string }> }
  | { ok: false; error: "PATCH_ERROR"; message: string };

/**
 * Gateway-side config persistence.
 * Reads/writes spaceduck.config.json5, caches in memory, computes rev.
 * External file edits require gateway restart (no mtime check in v1).
 */
export class ConfigStore {
  private configPath: string;
  private cache: SpaceduckProductConfig | null = null;
  private cachedRev: string | null = null;

  constructor(configDir?: string) {
    const dir = configDir ?? Bun.env.SPACEDUCK_CONFIG_DIR ?? "data/config";
    this.configPath = join(dir, "spaceduck.config.json5");
  }

  /** Load config from disk, or create default if missing. */
  async load(): Promise<SpaceduckProductConfig> {
    const file = Bun.file(this.configPath);
    if (!(await file.exists())) {
      const config = defaultConfig();
      await this.atomicWrite(config);
      this.cache = config;
      this.cachedRev = null;
      return config;
    }

    const raw = await file.text();
    const parsed = JSON5.parse(raw);
    const config = SpaceduckConfigSchema.parse(parsed);
    this.cache = config;
    this.cachedRev = null;
    return config;
  }

  /** Get the current config (from cache). Must call load() first. */
  get current(): SpaceduckProductConfig {
    if (!this.cache) {
      throw new Error("ConfigStore not loaded — call load() first");
    }
    return this.cache;
  }

  /** SHA-256 of canonicalize(redactConfig(config)). */
  rev(): string {
    if (this.cachedRev) return this.cachedRev;
    const config = this.current;
    const redacted = redactConfig(config);
    const canonical = canonicalize(redacted);
    const hash = new Bun.CryptoHasher("sha256")
      .update(canonical)
      .digest("hex");
    this.cachedRev = hash;
    return hash;
  }

  /** Redacted config + rev + secret status. */
  getRedacted(): {
    config: SpaceduckProductConfig;
    rev: string;
    secrets: Array<{ path: string; isSet: boolean }>;
  } {
    const config = this.current;
    return {
      config: redactConfig(config),
      rev: this.rev(),
      secrets: getSecretStatus(config),
    };
  }

  /** Apply JSON Patch ops with optimistic concurrency. */
  async patch(
    ops: ConfigPatchOp[],
    expectedRev: string,
  ): Promise<PatchResult> {
    const currentRev = this.rev();
    if (expectedRev !== currentRev) {
      return { ok: false, error: "CONFLICT", rev: currentRev };
    }

    let patched: SpaceduckProductConfig;
    try {
      patched = applyPatch(this.current, ops);
    } catch (e) {
      if (e instanceof PatchError) {
        return { ok: false, error: "PATCH_ERROR", message: e.message };
      }
      throw e;
    }

    // Validate the full patched config through Zod
    const result = SpaceduckConfigSchema.safeParse(patched);
    if (!result.success) {
      return {
        ok: false,
        error: "VALIDATION",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      };
    }

    const validated = result.data;
    await this.atomicWrite(validated);
    this.cache = validated;
    this.cachedRev = null;

    const { needsRestart } = classifyOps(ops);
    const response: PatchResult = {
      ok: true,
      config: redactConfig(validated),
      rev: this.rev(),
    };
    if (needsRestart.length > 0) {
      response.needsRestart = { fields: needsRestart };
    }
    return response;
  }

  /** Set a secret value at a known secret path. */
  async setSecret(path: string, value: string): Promise<void> {
    if (!isSecretPath(path)) {
      throw new Error(`"${path}" is not a known secret path`);
    }
    const config = structuredClone(this.current) as Record<string, unknown>;
    setDeep(config, path, value);
    const validated = SpaceduckConfigSchema.parse(config);
    await this.atomicWrite(validated);
    this.cache = validated;
    this.cachedRev = null;
  }

  /** Unset a secret (set to null) at a known secret path. */
  async unsetSecret(path: string): Promise<void> {
    if (!isSecretPath(path)) {
      throw new Error(`"${path}" is not a known secret path`);
    }
    const config = structuredClone(this.current) as Record<string, unknown>;
    setDeep(config, path, null);
    const validated = SpaceduckConfigSchema.parse(config);
    await this.atomicWrite(validated);
    this.cache = validated;
    this.cachedRev = null;
  }

  /** Atomic write: write to tmp file in same dir, then rename. */
  private async atomicWrite(config: SpaceduckProductConfig): Promise<void> {
    const dir = join(this.configPath, "..");
    await mkdir(dir, { recursive: true });

    const rand = Math.random().toString(36).slice(2, 8);
    const tmp = `${this.configPath}.tmp-${Date.now()}-${rand}`;
    const json5 = JSON.stringify(config, null, 2);
    await Bun.write(tmp, json5);
    await rename(tmp, this.configPath);
  }
}

function setDeep(
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
  current[segments[segments.length - 1]] = value;
}
