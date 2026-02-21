import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EmbeddingProvider, Logger } from "@spaceduck/core";
import { reconcileVecFacts, ensureCustomSQLite } from "../schema";

ensureCustomSQLite();

// ── Helpers ──────────────────────────────────────────────────────────

function makeProvider(
  name: string,
  model: string,
  dimensions: number,
): EmbeddingProvider {
  return {
    name,
    model,
    dimensions,
    async embed(): Promise<Float32Array> {
      return new Float32Array(dimensions);
    },
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      return texts.map(() => new Float32Array(dimensions));
    },
  };
}

const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() { return silentLogger; },
} as Logger;

function setupDb(db: Database): void {
  // Load sqlite-vec extension
  const sqliteVec = require("sqlite-vec");
  db.loadExtension(sqliteVec.getLoadablePath());

  // Minimal schema: schema_version + vec_meta + vec_facts at 4 dims
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS vec_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(
      fact_id TEXT PRIMARY KEY,
      embedding float[4]
    );
  `);
}

function getVecMeta(db: Database): Record<string, string> {
  const rows = db
    .query("SELECT key, value FROM vec_meta")
    .all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function canInsertVector(db: Database, dims: number): boolean {
  try {
    const vec = new Float32Array(dims).fill(0.1);
    db.query("INSERT INTO vec_facts (fact_id, embedding) VALUES (?1, vec_f32(?2))")
      .run("__test__", vec);
    db.query("DELETE FROM vec_facts WHERE fact_id = '__test__'").run();
    return true;
  } catch {
    return false;
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("reconcileVecFacts", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    setupDb(db);
  });

  afterEach(() => {
    db.close();
  });

  it("no-op when embedding is undefined (disabled)", () => {
    reconcileVecFacts(db, undefined, silentLogger);
    // vec_meta should remain empty, vec_facts untouched
    expect(getVecMeta(db)).toEqual({});
    expect(canInsertVector(db, 4)).toBe(true);
  });

  it("writes fingerprint and rebuilds when vec_meta is empty (first run)", () => {
    const provider = makeProvider("llamacpp", "nomic-embed", 768);
    reconcileVecFacts(db, provider, silentLogger);

    const meta = getVecMeta(db);
    expect(meta.provider).toBe("llamacpp");
    expect(meta.model).toBe("nomic-embed");
    expect(meta.dimensions).toBe("768");

    // vec_facts should now accept 768-dim vectors
    expect(canInsertVector(db, 768)).toBe(true);
  });

  it("no-op when fingerprint matches", () => {
    const provider = makeProvider("llamacpp", "nomic-embed", 4);

    // Seed vec_meta with matching fingerprint
    db.query("INSERT OR REPLACE INTO vec_meta (key, value) VALUES (?1, ?2)")
      .run("provider", "llamacpp");
    db.query("INSERT OR REPLACE INTO vec_meta (key, value) VALUES (?1, ?2)")
      .run("model", "nomic-embed");
    db.query("INSERT OR REPLACE INTO vec_meta (key, value) VALUES (?1, ?2)")
      .run("dimensions", "4");

    // Insert a test vector to verify it survives
    const vec = new Float32Array(4).fill(0.5);
    db.query("INSERT INTO vec_facts (fact_id, embedding) VALUES (?1, vec_f32(?2))")
      .run("keep-me", vec);

    reconcileVecFacts(db, provider, silentLogger);

    // The vector should still be there
    const row = db.query("SELECT fact_id FROM vec_facts WHERE fact_id = 'keep-me'").get();
    expect(row).not.toBeNull();
  });

  it("rebuilds when dimensions change", () => {
    const oldProvider = makeProvider("llamacpp", "nomic-embed", 4);
    reconcileVecFacts(db, oldProvider, silentLogger);
    expect(canInsertVector(db, 4)).toBe(true);

    // Switch to different dimensions
    const newProvider = makeProvider("llamacpp", "nomic-embed", 768);
    reconcileVecFacts(db, newProvider, silentLogger);

    expect(canInsertVector(db, 768)).toBe(true);
    const meta = getVecMeta(db);
    expect(meta.dimensions).toBe("768");
  });

  it("rebuilds when model changes (same dimensions)", () => {
    const oldProvider = makeProvider("llamacpp", "model-a", 768);
    reconcileVecFacts(db, oldProvider, silentLogger);

    const newProvider = makeProvider("llamacpp", "model-b", 768);
    reconcileVecFacts(db, newProvider, silentLogger);

    const meta = getVecMeta(db);
    expect(meta.model).toBe("model-b");
    expect(canInsertVector(db, 768)).toBe(true);
  });

  it("rebuilds when provider changes (same dimensions)", () => {
    const oldProvider = makeProvider("bedrock", "titan-v2", 1024);
    reconcileVecFacts(db, oldProvider, silentLogger);

    const newProvider = makeProvider("llamacpp", "some-1024-model", 1024);
    reconcileVecFacts(db, newProvider, silentLogger);

    const meta = getVecMeta(db);
    expect(meta.provider).toBe("llamacpp");
    expect(meta.model).toBe("some-1024-model");
    expect(canInsertVector(db, 1024)).toBe(true);
  });

  it("discards old vectors on rebuild", () => {
    const oldProvider = makeProvider("llamacpp", "nomic-embed", 4);
    reconcileVecFacts(db, oldProvider, silentLogger);

    // Insert a vector
    const vec = new Float32Array(4).fill(0.5);
    db.query("INSERT INTO vec_facts (fact_id, embedding) VALUES (?1, vec_f32(?2))")
      .run("old-fact", vec);

    // Rebuild with different dimensions
    const newProvider = makeProvider("llamacpp", "new-model", 768);
    reconcileVecFacts(db, newProvider, silentLogger);

    // Old vector should be gone
    const count = db.query("SELECT COUNT(*) as c FROM vec_facts").get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe("reconcileVecFacts DB backup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "spaceduck-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a backup file before rebuild", () => {
    const dbPath = join(tmpDir, "test.db");
    const db = new Database(dbPath);
    setupDb(db);

    const provider = makeProvider("llamacpp", "nomic-embed", 768);
    reconcileVecFacts(db, provider, silentLogger, dbPath);

    db.close();

    const files = readdirSync(tmpDir);
    const backups = files.filter((f) => f.startsWith("test.db.bak-"));
    expect(backups.length).toBe(1);
  });

  it("prunes old backups beyond 3", () => {
    const dbPath = join(tmpDir, "test.db");
    const db = new Database(dbPath);
    setupDb(db);

    // Create 4 rebuilds → should have at most 3 backups after the last one
    for (let i = 0; i < 4; i++) {
      const provider = makeProvider("p", `model-${i}`, 4);
      reconcileVecFacts(db, provider, silentLogger, dbPath);
    }

    db.close();

    const files = readdirSync(tmpDir);
    const backups = files.filter((f) => f.startsWith("test.db.bak-"));
    expect(backups.length).toBeLessThanOrEqual(3);
  });
});
