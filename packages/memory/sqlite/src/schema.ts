// Schema manager: reads and applies SQL migrations in order
//
// IMPORTANT: On macOS, Database.setCustomSQLite() must be called BEFORE
// creating any Database instance. Call ensureCustomSQLite() once at app
// startup, before `new Database()`.
//
// Reference: https://bun.com/docs/runtime/sqlite#loadextension
// Reference: https://github.com/asg017/sqlite-vec/blob/main/examples/simple-bun/demo.ts

import { Database } from "bun:sqlite";
import type { Logger, EmbeddingProvider } from "@spaceduck/core";
import { platform } from "node:process";
import { copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const MIGRATIONS_DIR = new URL("./migrations", import.meta.url).pathname;

interface SchemaVersion {
  version: number;
  applied_at: number;
}

let _customSqliteApplied = false;

/**
 * Swap bun:sqlite's bundled SQLite for Homebrew's build on macOS.
 * Homebrew's SQLite supports loadExtension(); Apple's does not.
 *
 * MUST be called once BEFORE any `new Database()` is created.
 * No-op on Linux/Windows (extensions work out of the box).
 */
export function ensureCustomSQLite(): void {
  if (_customSqliteApplied) return;
  _customSqliteApplied = true;

  if (platform === "darwin") {
    // Apple Silicon (M1+) → /opt/homebrew, Intel Mac → /usr/local
    const candidates = [
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
    ];
    for (const p of candidates) {
      try {
        Database.setCustomSQLite(p);
        return;
      } catch {
        // try next candidate
      }
    }
  }
}

export class SchemaManager {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Load sqlite-vec extension into this database connection.
   * Must be called after ensureCustomSQLite() and before migrate().
   *
   * Uses sqlite-vec's getLoadablePath() to find the vec0 shared library,
   * then calls db.loadExtension() directly (matching the official demo).
   */
  loadExtensions(): void {
    try {
      const sqliteVec = require("sqlite-vec");
      const extensionPath: string = sqliteVec.getLoadablePath();
      this.db.loadExtension(extensionPath);

      const row = this.db
        .prepare("SELECT vec_version() as v")
        .get() as { v: string } | null;
      this.logger.info("sqlite-vec extension loaded", { version: row?.v });
    } catch (err) {
      this.logger.warn("sqlite-vec extension not available (vector search disabled)", {
        error: String(err),
      });
    }
  }

  /**
   * Apply all pending migrations from the migrations directory.
   * Migrations are numbered SQL files (e.g., 001_initial.sql).
   */
  async migrate(): Promise<void> {
    const currentVersion = this.getCurrentVersion();
    this.logger.info("Current schema version", { version: currentVersion });

    const migrations = await this.loadMigrations();
    const pending = migrations.filter((m) => m.version > currentVersion);

    if (pending.length === 0) {
      this.logger.info("Schema is up to date");
      return;
    }

    this.logger.info("Applying migrations", { count: pending.length });

    for (const migration of pending) {
      this.logger.info("Applying migration", {
        version: migration.version,
        name: migration.name,
      });

      // Virtual table DDL (vec0) cannot run inside a transaction in SQLite.
      // Migration 004+ may contain virtual table creation, so we run those
      // without wrapping in a transaction.
      const usesVirtualTable = migration.sql.includes("VIRTUAL TABLE");

      if (usesVirtualTable) {
        try {
          const sql = this.guardAlterTable(migration.sql);
          this.db.exec(sql);
          this.logger.info("Migration applied (no-txn, virtual table)", { version: migration.version });
        } catch (err) {
          this.logger.error("Migration failed", {
            version: migration.version,
            error: String(err),
          });
          throw err;
        }
      } else {
        const sql = this.guardAlterTable(migration.sql);
        this.db.exec("BEGIN TRANSACTION");
        try {
          this.db.exec(sql);
          this.db.exec("COMMIT");
          this.logger.info("Migration applied", { version: migration.version });
        } catch (err) {
          this.db.exec("ROLLBACK");
          this.logger.error("Migration failed", {
            version: migration.version,
            error: String(err),
          });
          throw err;
        }
      }
    }
  }

  private getCurrentVersion(): number {
    try {
      const row = this.db
        .query("SELECT MAX(version) as version FROM schema_version")
        .get() as SchemaVersion | null;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Guard ALTER TABLE ADD COLUMN statements by checking if the column
   * already exists. Replaces the ALTER statement with a comment if present.
   */
  private guardAlterTable(sql: string): string {
    return sql.replace(
      /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+([^;]+);/gi,
      (_match, table, column, _rest) => {
        const columns = this.db
          .query(`PRAGMA table_info(${table})`)
          .all() as { name: string }[];
        const exists = columns.some((c) => c.name === column);
        if (exists) {
          return `-- SKIPPED: column ${column} already exists on ${table}`;
        }
        return _match;
      },
    );
  }

  private async loadMigrations(): Promise<{ version: number; name: string; sql: string }[]> {
    const { readdir } = await import("node:fs/promises");

    let files: string[];
    try {
      files = await readdir(MIGRATIONS_DIR);
    } catch {
      this.logger.warn("No migrations directory found", { path: MIGRATIONS_DIR });
      return [];
    }

    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();
    const migrations: { version: number; name: string; sql: string }[] = [];

    for (const file of sqlFiles) {
      const match = file.match(/^(\d+)_/);
      if (!match) continue;

      const version = parseInt(match[1], 10);
      const filePath = `${MIGRATIONS_DIR}/${file}`;
      const sql = await Bun.file(filePath).text();

      migrations.push({ version, name: file, sql });
    }

    return migrations;
  }
}

// ── Embedding fingerprint reconciliation ──────────────────────────────

interface VecFingerprint {
  provider: string;
  model: string;
  dimensions: string;
}

const MAX_BACKUPS = 3;

function readVecMeta(db: Database): VecFingerprint | null {
  try {
    const rows = db
      .query("SELECT key, value FROM vec_meta WHERE key IN ('provider', 'model', 'dimensions')")
      .all() as Array<{ key: string; value: string }>;

    if (rows.length === 0) return null;

    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!map.provider || !map.model || !map.dimensions) return null;
    return { provider: map.provider, model: map.model, dimensions: map.dimensions };
  } catch {
    return null;
  }
}

function writeVecMeta(db: Database, fp: VecFingerprint): void {
  const stmt = db.query(
    "INSERT OR REPLACE INTO vec_meta (key, value) VALUES (?1, ?2)",
  );
  stmt.run("provider", fp.provider);
  stmt.run("model", fp.model);
  stmt.run("dimensions", fp.dimensions);
}

function backupDb(dbPath: string, logger: Logger): string | null {
  if (dbPath === ":memory:") return null;

  try {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${base}.bak-${ts}`;
    const backupPath = join(dir, backupName);

    copyFileSync(dbPath, backupPath);
    logger.info("Database backed up", { path: backupPath });

    pruneBackups(dir, base, logger);
    return backupPath;
  } catch (err) {
    logger.warn("Failed to back up database before vec_facts rebuild", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function pruneBackups(dir: string, dbBase: string, logger: Logger): void {
  try {
    const prefix = `${dbBase}.bak-`;
    const backups = readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .sort()
      .reverse();

    for (const old of backups.slice(MAX_BACKUPS)) {
      unlinkSync(join(dir, old));
      logger.info("Pruned old database backup", { file: old });
    }
  } catch {
    // best-effort cleanup
  }
}

/**
 * Ensure the vec_facts virtual table matches the active embedding provider.
 *
 * Compares the provider's identity (name, model, dimensions) against the
 * stored fingerprint in vec_meta. If anything differs — or vec_meta is
 * empty — drops and recreates vec_facts with the correct dimensions.
 *
 * Before dropping, backs up the DB file (keeps 3 most recent).
 *
 * @param dbPath - filesystem path to the SQLite file (for backup); ":memory:" skips backup
 */
export function reconcileVecFacts(
  db: Database,
  embedding: EmbeddingProvider | undefined,
  logger: Logger,
  dbPath: string = ":memory:",
): void {
  if (!embedding) {
    logger.info("Embeddings disabled — skipping vec_facts reconciliation");
    return;
  }

  const current: VecFingerprint = {
    provider: embedding.name,
    model: embedding.model,
    dimensions: String(embedding.dimensions),
  };

  const stored = readVecMeta(db);

  if (
    stored &&
    stored.provider === current.provider &&
    stored.model === current.model &&
    stored.dimensions === current.dimensions
  ) {
    logger.info("vec_facts fingerprint matches — no rebuild needed");
    return;
  }

  const reason = stored
    ? `changed from ${stored.provider}/${stored.model}/${stored.dimensions} to ${current.provider}/${current.model}/${current.dimensions}`
    : "no previous fingerprint recorded";

  logger.warn("Embedding identity mismatch — rebuilding vec_facts", { reason });

  const backupPath = backupDb(dbPath, logger);

  db.exec("DROP TABLE IF EXISTS vec_facts");
  db.exec(
    `CREATE VIRTUAL TABLE vec_facts USING vec0(
      fact_id TEXT PRIMARY KEY,
      embedding float[${embedding.dimensions}]
    )`,
  );

  writeVecMeta(db, current);

  logger.warn("vec_facts rebuilt", {
    provider: current.provider,
    model: current.model,
    dimensions: current.dimensions,
    backup: backupPath ?? "none (in-memory DB)",
  });
}
