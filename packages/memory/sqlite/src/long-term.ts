// SQLite-backed LongTermMemory with optional vector embeddings via sqlite-vec
//
// When an EmbeddingProvider is available:
//   - remember() embeds facts and stores vectors in vec_facts
//   - recall() supports "vector", "fts", and "hybrid" strategies
//   - "hybrid" uses Reciprocal Rank Fusion (RRF, k=60) to merge vector and FTS
//     ranked lists, then applies exponential recency decay by updated_at.
//
// When no EmbeddingProvider:
//   - Falls back to FTS5 keyword search (or LIKE as last resort)
//
// Vector insert/query follows the official sqlite-vec Bun demo:
//   https://github.com/asg017/sqlite-vec/blob/main/examples/simple-bun/demo.ts
//   - INSERT uses vec_f32(?) with new Float32Array(...)
//   - SELECT uses WHERE embedding MATCH ? with new Float32Array(...)

import { Database } from "bun:sqlite";
import type {
  LongTermMemory,
  Fact,
  FactInput,
  RecallOptions,
  Result,
  Logger,
  EmbeddingProvider,
} from "@spaceduck/core";
import { ok, err, MemoryError } from "@spaceduck/core";

const LN2 = Math.LN2;
const DEFAULT_HALF_LIFE_DAYS = 90;
const RRF_K = 60;

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Normalize text for content hashing: lowercase, collapse whitespace, trim.
 */
function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * SHA-256 hash of normalized content for exact dedup.
 */
async function contentHash(text: string): Promise<string> {
  const normalized = normalizeForHash(text);
  const data = new TextEncoder().encode(normalized);
  const hash = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  return hash;
}

/**
 * Convert sqlite-vec cosine distance to a similarity score [0, 1].
 * sqlite-vec cosine distance: 0 = identical, 2 = opposite.
 */
export function distanceToScore(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 2));
}

/**
 * Clamp a number to [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Row shape returned by the facts table SELECT (all v2 columns). */
interface FactRow {
  id: string;
  conversation_id: string;
  content: string;
  category: string | null;
  source: string;
  confidence: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number | null;
}

function rowToFact(row: FactRow): Fact {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    content: row.content,
    category: row.category ?? undefined,
    source: (row.source ?? "auto-extracted") as Fact["source"],
    confidence: row.confidence ?? 1.0,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/**
 * SQLite-based long-term memory with optional vector embedding support.
 */
export class SqliteLongTermMemory implements LongTermMemory {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly embedding?: EmbeddingProvider,
  ) {}

  async remember(input: FactInput): Promise<Result<Fact>> {
    try {
      const id = generateId();
      const now = Date.now();
      const hash = await contentHash(input.content);

      const source: Fact["source"] = input.source ?? "auto-extracted";
      const confidence: number = input.confidence ?? 1.0;
      const expiresAt: number | null = input.expiresAt ?? null;

      // Exact dedup: check content_hash UNIQUE constraint
      const existing = this.db
        .query(
          `SELECT id, conversation_id, content, category, source, confidence,
                  expires_at, created_at, updated_at
           FROM facts WHERE content_hash = ?1`,
        )
        .get(hash) as FactRow | null;

      if (existing) {
        this.logger.debug("Exact duplicate fact skipped", {
          existingId: existing.id,
          content: input.content.slice(0, 50),
        });
        return ok(rowToFact(existing));
      }

      this.db
        .query(
          `INSERT INTO facts
             (id, conversation_id, content, category, source, confidence,
              expires_at, created_at, updated_at, content_hash)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)`,
        )
        .run(
          id,
          input.conversationId,
          input.content,
          input.category ?? null,
          source,
          confidence,
          expiresAt,
          now,
          hash,
        );

      // Embed and store vector if provider available
      if (this.embedding) {
        try {
          const vector = await this.embedding.embed(input.content);
          this.validateDimensions(vector);
          this.db
            .query("INSERT INTO vec_facts (fact_id, embedding) VALUES (?1, vec_f32(?2))")
            .run(id, new Float32Array(vector));
        } catch (embErr) {
          this.logger.warn("Failed to embed fact (stored without vector)", {
            factId: id,
            error: String(embErr),
          });
        }
      }

      return ok({
        id,
        conversationId: input.conversationId,
        content: input.content,
        category: input.category,
        source,
        confidence,
        expiresAt: expiresAt ?? undefined,
        createdAt: now,
        updatedAt: now,
      });
    } catch (cause) {
      return err(new MemoryError(`Failed to remember fact: ${cause}`, cause));
    }
  }

  async recall(query: string, limit?: number, options?: RecallOptions): Promise<Result<Fact[]>> {
    const topK = options?.topK ?? limit ?? 10;
    const strategy = options?.strategy ?? (this.embedding ? "vector" : "fts");
    const minScore = options?.minScore ?? 0.0;

    try {
      if (strategy === "hybrid") {
        return await this.recallHybrid(query, topK, options);
      }
      if (strategy === "vector" && this.embedding) {
        return await this.recallByVector(query, topK, minScore);
      }
      return this.recallByFts(query, topK);
    } catch (cause) {
      if (strategy === "vector") {
        this.logger.warn("Vector recall failed, falling back to FTS", {
          error: String(cause),
        });
        try {
          return this.recallByFts(query, topK);
        } catch (ftsCause) {
          return err(new MemoryError(`Failed to recall facts: ${ftsCause}`, ftsCause));
        }
      }
      return err(new MemoryError(`Failed to recall facts: ${cause}`, cause));
    }
  }

  async forget(factId: string): Promise<Result<void>> {
    try {
      this.db.query("DELETE FROM facts WHERE id = ?1").run(factId);

      try {
        this.db.query("DELETE FROM vec_facts WHERE fact_id = ?1").run(factId);
      } catch {
        // vec_facts might not exist — ignore
      }

      return ok(undefined);
    } catch (cause) {
      return err(new MemoryError(`Failed to forget fact: ${cause}`, cause));
    }
  }

  async listAll(conversationId?: string): Promise<Result<Fact[]>> {
    try {
      let sql = `SELECT id, conversation_id, content, category, source, confidence,
                        expires_at, created_at, updated_at
                 FROM facts`;
      const params: (string | number)[] = [];

      if (conversationId) {
        sql += " WHERE conversation_id = ?1";
        params.push(conversationId);
      }

      sql += " ORDER BY created_at DESC";

      const rows = this.db.query(sql).all(...params) as FactRow[];
      return ok(rows.map(rowToFact));
    } catch (cause) {
      return err(new MemoryError(`Failed to list facts: ${cause}`, cause));
    }
  }

  // ── Hybrid recall (RRF + recency decay) ──────────────────────────────

  private async recallHybrid(
    query: string,
    topK: number,
    options?: RecallOptions,
  ): Promise<Result<Fact[]>> {
    const halfLifeDays = options?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
    const minConfidence = options?.minConfidence ?? 0.0;
    const now = Date.now();

    // fetchN: wide pool for RRF merge, clamped to avoid accidental benchmarks
    const fetchN = clamp(topK * 3, 30, 200);

    // --- Vector candidates (IDs + rank) ---
    const vectorRanks = new Map<string, number>();
    if (this.embedding) {
      try {
        const queryVec = await this.embedding.embed(query);
        this.validateDimensions(queryVec);
        const vecRows = this.db
          .query(
            `SELECT fact_id, distance
             FROM vec_facts
             WHERE embedding MATCH ?1
             ORDER BY distance
             LIMIT ?2`,
          )
          .all(new Float32Array(queryVec), fetchN) as { fact_id: string; distance: number }[];

        vecRows.forEach((row, i) => vectorRanks.set(row.fact_id, i + 1));
      } catch (vecErr) {
        this.logger.warn("Vector search failed in hybrid mode (FTS-only fallback)", {
          error: String(vecErr),
        });
      }
    }

    // --- FTS candidates (IDs + rank) ---
    // ORDER BY bm25() DESC: SQLite's bm25() includes an internal -1 factor;
    // better matches score higher (less negative), so DESC = best first.
    const ftsRanks = new Map<string, number>();
    try {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      if (words.length > 0) {
        const ftsQuery = words.join(" OR ");
        // fetchN for FTS-only is smaller (no RRF merge overhead)
        const ftsFetchN = clamp(topK * 2, 20, 100);
        const ftsRows = this.db
          .query(
            `SELECT f.id
             FROM facts f
             JOIN facts_fts ON facts_fts.rowid = f.rowid
             WHERE facts_fts MATCH ?1
             ORDER BY bm25(facts_fts) ASC
             LIMIT ?2`,
          )
          .all(ftsQuery, ftsFetchN) as { id: string }[];

        ftsRows.forEach((row, i) => ftsRanks.set(row.id, i + 1));
      }
    } catch (ftsErr) {
      this.logger.warn("FTS search failed in hybrid mode", { error: String(ftsErr) });
    }

    // --- Build union of all candidate IDs ---
    const allIds = new Set([...vectorRanks.keys(), ...ftsRanks.keys()]);
    if (allIds.size === 0) return ok([]);

    // --- Load full fact rows, filtering expired ones in SQL ---
    const idList = [...allIds];
    const placeholders = idList.map((_, i) => `?${i + 2}`).join(",");
    const rows = this.db
      .query(
        `SELECT id, conversation_id, content, category, source, confidence,
                expires_at, created_at, updated_at
         FROM facts
         WHERE id IN (${placeholders})
           AND (expires_at IS NULL OR expires_at > ?1)`,
      )
      .all(now, ...idList) as FactRow[];

    // --- RRF + decay scoring ---
    const λ = LN2 / halfLifeDays;

    const scored = rows
      .map((row) => {
        const vectorRank = vectorRanks.get(row.id);
        const ftsRank = ftsRanks.get(row.id);

        // Missing rank contributes 0 (not a penalty)
        const rrf =
          (vectorRank ? 1 / (RRF_K + vectorRank) : 0) +
          (ftsRank ? 1 / (RRF_K + ftsRank) : 0);

        const updatedAt = row.updated_at ?? row.created_at;
        const ageDays = (now - updatedAt) / 86_400_000;
        const decay = Math.exp(-λ * ageDays);

        return { fact: rowToFact(row), score: rrf * decay };
      })
      .filter(({ fact }) => fact.confidence >= minConfidence)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ fact }) => fact);

    this.logger.debug("Hybrid recall", {
      query: query.slice(0, 80),
      topK,
      vectorCandidates: vectorRanks.size,
      ftsCandidates: ftsRanks.size,
      afterExpiry: rows.length,
      returned: scored.length,
    });

    return ok(scored);
  }

  // ── Vector recall ────────────────────────────────────────────────────

  private async recallByVector(
    query: string,
    topK: number,
    minScore: number,
  ): Promise<Result<Fact[]>> {
    if (!this.embedding) {
      return err(new MemoryError("Vector recall requires an EmbeddingProvider"));
    }

    const startMs = Date.now();
    const queryVec = await this.embedding.embed(query);
    this.validateDimensions(queryVec);

    const fetchN = clamp(topK * 3, 30, 200);
    const results = this.searchByEmbedding(queryVec, fetchN, minScore);
    const elapsedMs = Date.now() - startMs;

    this.logger.debug("Vector recall", {
      query: query.slice(0, 80),
      topK,
      minScore,
      results: results.length,
      elapsedMs,
    });

    if (results.length === 0) return ok([]);

    const now = Date.now();
    const placeholders = results.map((_, i) => `?${i + 2}`).join(",");
    const factIds = results.map((r) => r.factId);

    const rows = this.db
      .query(
        `SELECT id, conversation_id, content, category, source, confidence,
                expires_at, created_at, updated_at
         FROM facts
         WHERE id IN (${placeholders})
           AND (expires_at IS NULL OR expires_at > ?1)`,
      )
      .all(now, ...factIds) as FactRow[];

    // Preserve distance-based ordering from vector search
    const rowMap = new Map(rows.map((r) => [r.id, r]));
    const facts: Fact[] = [];
    for (const result of results) {
      const row = rowMap.get(result.factId);
      if (row) {
        facts.push(rowToFact(row));
        if (facts.length >= topK) break;
      }
    }

    return ok(facts);
  }

  /**
   * Core vector search: query vec_facts with cosine similarity.
   */
  private searchByEmbedding(
    queryVec: Float32Array,
    fetchN: number,
    minScore: number = 0.0,
  ): Array<{ factId: string; distance: number; score: number }> {
    const rows = this.db
      .query(
        `SELECT fact_id, distance
         FROM vec_facts
         WHERE embedding MATCH ?1
         ORDER BY distance
         LIMIT ?2`,
      )
      .all(new Float32Array(queryVec), fetchN) as { fact_id: string; distance: number }[];

    const results: Array<{ factId: string; distance: number; score: number }> = [];
    for (const row of rows) {
      const score = distanceToScore(row.distance);
      if (score >= minScore) {
        results.push({ factId: row.fact_id, distance: row.distance, score });
      }
    }
    return results;
  }

  // ── FTS recall (fallback) ────────────────────────────────────────────

  private recallByFts(query: string, topK: number): Result<Fact[]> {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) return ok([]);

    const now = Date.now();

    try {
      const ftsQuery = words.join(" OR ");
      // ORDER BY bm25() ASC: SQLite FTS5 bm25() returns negative floats where
      // smaller (more negative) = better match. ASC puts best matches first.
      const sql = `SELECT f.id, f.conversation_id, f.content, f.category,
                          f.source, f.confidence, f.expires_at, f.created_at, f.updated_at
                   FROM facts f
                   JOIN facts_fts ON facts_fts.rowid = f.rowid
                   WHERE facts_fts MATCH ?1
                     AND (f.expires_at IS NULL OR f.expires_at > ?2)
                   ORDER BY bm25(facts_fts) ASC
                   LIMIT ?3`;

      const rows = this.db.query(sql).all(ftsQuery, now, topK) as FactRow[];
      return ok(rows.map(rowToFact));
    } catch {
      // FTS table doesn't exist yet — fall back to LIKE
    }

    const conditions = words.map((_, i) => `LOWER(content) LIKE ?${i + 2}`).join(" OR ");
    const params: (string | number)[] = [now, ...words.map((w) => `%${w}%`)];

    const sql = `SELECT id, conversation_id, content, category,
                        source, confidence, expires_at, created_at, updated_at
                 FROM facts
                 WHERE (${conditions})
                   AND (expires_at IS NULL OR expires_at > ?1)
                 ORDER BY created_at DESC
                 LIMIT ?${params.length + 1}`;

    const rows = this.db.query(sql).all(...params, topK) as FactRow[];
    return ok(rows.map(rowToFact));
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private validateDimensions(vector: Float32Array): void {
    if (this.embedding && vector.length !== this.embedding.dimensions) {
      throw new MemoryError(
        `Embedding dimension mismatch: expected ${this.embedding.dimensions}, got ${vector.length}`,
      );
    }
  }
}
