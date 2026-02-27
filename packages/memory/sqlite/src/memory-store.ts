import { Database } from "bun:sqlite";
import type {
  MemoryStore, MemoryRecord, MemoryInput, MemoryPatch,
  MemoryRecallOptions, ScoredMemory, MemoryFilter, MemoryScope,
  MemorySource, MemoryKind, MemoryStatus,
  Result, Logger, EmbeddingProvider, Provider, Message,
} from "@spaceduck/core";
import { ok, err, MemoryError } from "@spaceduck/core";

const LN2 = Math.LN2;
const DEFAULT_HALF_LIFE_DAYS = 90;
const RRF_K = 60;
const CONFIDENCE_FLOOR = 0.35;

/**
 * Cosine similarity threshold above which two memories are considered
 * semantically equivalent. 0.92 is strict enough to avoid false merges
 * but catches "User prefers TypeScript" vs "The user likes TypeScript".
 */
const SEMANTIC_DEDUP_THRESHOLD = 0.92;

/**
 * Lower cosine similarity threshold for contradiction checking.
 * Memories in the 0.60–0.92 range are "same topic, different claim" territory.
 * For unit-normalised embeddings, structurally similar sentences that differ
 * only in a named entity (e.g., "lives in Paris" vs "lives in Tokyo") can
 * have cosine as low as ~0.70, so 0.60 gives safe headroom while still
 * excluding truly unrelated facts (~0.50–0.55).
 * If an LLM provider is available, these are sent to the contradiction arbiter.
 */
const CONTRADICTION_CHECK_THRESHOLD = 0.60;

/**
 * How many vector neighbors to check for semantic dedup during store().
 * Kept small to minimize latency on the write path.
 */
const DEDUP_NEIGHBOR_K = 5;

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeForHash(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function contentHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeForHash(text));
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

/**
 * Strip FTS5 special characters from a word so it can be safely
 * used in a MATCH expression. FTS5 treats these as syntax:
 *   " * ( ) , + - : ^ ? { }
 */
function sanitizeFtsWord(word: string): string {
  return word.replace(/["*()+,\-.:;^?{}!@#$%&|~`\[\]\\/<>=']/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distanceToScore(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 2));
}

/**
 * Convert L2 distance to cosine similarity for unit-normalized vectors.
 * For unit vectors: L2² = 2 - 2·cos(θ), so cos(θ) = 1 - L2²/2
 */
function l2ToCosine(distance: number): number {
  return clamp(1 - (distance * distance) / 2, -1, 1);
}

/**
 * Cosine similarity between two Float32Array vectors.
 * Assumes unit-normalized inputs (returns raw dot product).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return clamp(dot, -1, 1);
}

// --- Row <-> Record conversion ---

interface MemoryRow {
  id: string;
  kind: string;
  title: string;
  content: string;
  summary: string;
  scope_type: string;
  scope_id: string | null;
  entity_refs: string;
  source_type: string;
  source_id: string | null;
  source_conversation_id: string | null;
  source_run_id: string | null;
  source_tool_name: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
  occurred_at: number | null;
  expires_at: number | null;
  procedure_subtype: string | null;
  importance: number;
  confidence: number;
  status: string;
  superseded_by: string | null;
  embedding_version: string | null;
  tags: string;
  content_hash: string | null;
}

function scopeFromRow(type: string, id: string | null): MemoryScope {
  switch (type) {
    case "project": return { type: "project", projectId: id! };
    case "thread": return { type: "thread", conversationId: id! };
    case "entity": return { type: "entity", entityId: id! };
    default: return { type: "global" };
  }
}

function scopeToColumns(scope: MemoryScope): { type: string; id: string | null } {
  switch (scope.type) {
    case "project": return { type: "project", id: scope.projectId };
    case "thread": return { type: "thread", id: scope.conversationId };
    case "entity": return { type: "entity", id: scope.entityId };
    default: return { type: "global", id: null };
  }
}

function sourceFromRow(row: MemoryRow): MemorySource {
  const src: MemorySource = { type: row.source_type as MemorySource["type"] };
  if (row.source_id) (src as any).id = row.source_id;
  if (row.source_conversation_id) (src as any).conversationId = row.source_conversation_id;
  if (row.source_run_id) (src as any).runId = row.source_run_id;
  if (row.source_tool_name) (src as any).toolName = row.source_tool_name;
  return src;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    title: row.title,
    content: row.content,
    summary: row.summary,
    scope: scopeFromRow(row.scope_type, row.scope_id),
    entityRefs: JSON.parse(row.entity_refs),
    source: sourceFromRow(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    importance: row.importance,
    confidence: row.confidence,
    status: row.status as MemoryStatus,
    supersededBy: row.superseded_by ?? undefined,
    embeddingVersion: row.embedding_version ?? undefined,
    tags: JSON.parse(row.tags),
    occurredAt: row.occurred_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    procedureSubtype: row.procedure_subtype as MemoryRecord["procedureSubtype"],
  };
}

const SELECT_COLS = `m.id, m.kind, m.title, m.content, m.summary, m.scope_type, m.scope_id,
  m.entity_refs, m.source_type, m.source_id, m.source_conversation_id, m.source_run_id,
  m.source_tool_name, m.created_at, m.updated_at, m.last_seen_at, m.occurred_at, m.expires_at,
  m.procedure_subtype, m.importance, m.confidence, m.status, m.superseded_by,
  m.embedding_version, m.tags, m.content_hash`;

export class SqliteMemoryStore implements MemoryStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly embedding?: EmbeddingProvider,
    private readonly provider?: Provider,
  ) {}

  async store(input: MemoryInput): Promise<Result<MemoryRecord>> {
    try {
      const id = generateId();
      const now = Date.now();
      const hash = await contentHash(input.content);
      const summary = input.summary || input.content.slice(0, 500);
      const scope = scopeToColumns(input.scope);

      // Logical dedup: same hash + same kind + same scope = skip
      const existing = this.db
        .query(
          `SELECT ${SELECT_COLS} FROM memories m
           WHERE content_hash = ?1 AND kind = ?2 AND scope_type = ?3
             AND (scope_id IS ?4)
           LIMIT 1`,
        )
        .get(hash, input.kind, scope.type, scope.id) as MemoryRow | null;

      if (existing) {
        this.logger.debug("Duplicate memory skipped", { existingId: existing.id });
        // Touch lastSeenAt
        this.db
          .query("UPDATE memories SET last_seen_at = ?1 WHERE id = ?2")
          .run(now, existing.id);
        return ok(rowToRecord({ ...existing, last_seen_at: now }));
      }

      // Semantic dedup: check vector neighbors for near-duplicates (same kind, active)
      // Also computes the embedding vector which we reuse for storage below.
      let precomputedVec: Float32Array | undefined;
      if (this.embedding) {
        const dupResult = await this.checkSemanticDedup(input, summary, scope);
        if (dupResult) {
          precomputedVec = dupResult.queryVec;
          if (dupResult.action === "skip" && dupResult.existing) {
            return ok(dupResult.existing);
          }
          if (dupResult.action === "supersede" && dupResult.existing) {
            return await this.supersede(dupResult.existing.id, input);
          }
        }
      }

      const importance = input.importance ?? 0.5;
      const confidence = input.confidence ?? 0.7;
      const status = input.status ?? "active";
      const entityRefs = JSON.stringify(input.entityRefs ?? []);
      const tags = JSON.stringify(input.tags ?? []);
      const occurredAt = input.kind === "episode" ? input.occurredAt : null;
      const procedureSubtype = input.kind === "procedure" ? input.procedureSubtype : null;
      const expiresAt = input.expiresAt ?? null;

      this.db
        .query(
          `INSERT INTO memories
             (id, kind, title, content, summary, scope_type, scope_id,
              entity_refs, source_type, source_id, source_conversation_id,
              source_run_id, source_tool_name, created_at, updated_at, last_seen_at,
              occurred_at, expires_at, procedure_subtype, importance, confidence,
              status, tags, content_hash)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14,?14,?15,?16,?17,?18,?19,?20,?21,?22)`,
        )
        .run(
          id, input.kind, input.title, input.content, summary,
          scope.type, scope.id, entityRefs,
          input.source.type, input.source.id ?? null,
          input.source.conversationId ?? null, input.source.runId ?? null,
          input.source.toolName ?? null, now,
          occurredAt, expiresAt, procedureSubtype,
          importance, confidence, status, tags, hash,
        );

      // Embed summary for vector search (reuse vector from dedup check if available)
      if (this.embedding) {
        try {
          const vector = precomputedVec ?? await this.embedding.embed(summary, { purpose: "index" });
          this.db
            .query("INSERT INTO vec_memories (memory_id, embedding) VALUES (?1, vec_f32(?2))")
            .run(id, new Float32Array(vector));
        } catch (embErr) {
          this.logger.warn("Failed to embed memory (stored without vector)", {
            memoryId: id, error: String(embErr),
          });
        }
      }

      const record: MemoryRecord = {
        id, kind: input.kind, title: input.title, content: input.content,
        summary, scope: input.scope, entityRefs: input.entityRefs ?? [],
        source: input.source, createdAt: now, updatedAt: now, lastSeenAt: now,
        importance, confidence, status, tags: input.tags ?? [],
        occurredAt: occurredAt ?? undefined,
        expiresAt: expiresAt ?? undefined,
        procedureSubtype: procedureSubtype as MemoryRecord["procedureSubtype"],
      };

      return ok(record);
    } catch (cause) {
      return err(new MemoryError(`Failed to store memory: ${cause}`, cause));
    }
  }

  async get(id: string): Promise<Result<MemoryRecord | null>> {
    try {
      const row = this.db
        .query(`SELECT ${SELECT_COLS} FROM memories m WHERE m.id = ?1`)
        .get(id) as MemoryRow | null;
      return ok(row ? rowToRecord(row) : null);
    } catch (cause) {
      return err(new MemoryError(`Failed to get memory: ${cause}`, cause));
    }
  }

  async list(filter?: MemoryFilter): Promise<Result<MemoryRecord[]>> {
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let idx = 1;

      if (filter?.kinds?.length) {
        const ph = filter.kinds.map(() => `?${idx++}`);
        conditions.push(`kind IN (${ph.join(",")})`);
        params.push(...filter.kinds);
      }
      if (filter?.status?.length) {
        const ph = filter.status.map(() => `?${idx++}`);
        conditions.push(`status IN (${ph.join(",")})`);
        params.push(...filter.status);
      }
      if (filter?.scope) {
        const sc = scopeToColumns(filter.scope);
        conditions.push(`scope_type = ?${idx++}`);
        params.push(sc.type);
        if (sc.id) { conditions.push(`scope_id = ?${idx++}`); params.push(sc.id); }
      }
      if (filter?.minImportance != null) {
        conditions.push(`importance >= ?${idx++}`);
        params.push(filter.minImportance);
      }
      if (filter?.minConfidence != null) {
        conditions.push(`confidence >= ?${idx++}`);
        params.push(filter.minConfidence);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = filter?.limit ? `LIMIT ?${idx++}` : "";
      if (filter?.limit) params.push(filter.limit);

      const rows = this.db
        .query(`SELECT ${SELECT_COLS} FROM memories m ${where} ORDER BY m.updated_at DESC ${limit}`)
        .all(...params) as MemoryRow[];

      return ok(rows.map(rowToRecord));
    } catch (cause) {
      return err(new MemoryError(`Failed to list memories: ${cause}`, cause));
    }
  }

  async update(id: string, patch: MemoryPatch): Promise<Result<MemoryRecord>> {
    try {
      const now = Date.now();
      const sets: string[] = ["updated_at = ?1"];
      const params: (string | number | null)[] = [now];
      let idx = 2;

      let contentChanged = false;
      let summaryChanged = false;

      if (patch.title != null) { sets.push(`title = ?${idx++}`); params.push(patch.title); }
      if (patch.content != null) { sets.push(`content = ?${idx++}`); params.push(patch.content); contentChanged = true; }
      if (patch.summary != null) { sets.push(`summary = ?${idx++}`); params.push(patch.summary); summaryChanged = true; }
      if (patch.tags != null) { sets.push(`tags = ?${idx++}`); params.push(JSON.stringify(patch.tags)); }
      if (patch.entityRefs != null) { sets.push(`entity_refs = ?${idx++}`); params.push(JSON.stringify(patch.entityRefs)); }
      if (patch.status != null) { sets.push(`status = ?${idx++}`); params.push(patch.status); }
      if (patch.expiresAt !== undefined) {
        sets.push(`expires_at = ?${idx++}`);
        params.push(patch.expiresAt ?? null);
      }

      // If content changed but summary wasn't explicitly provided, regenerate summary
      if (contentChanged && !summaryChanged) {
        const newSummary = patch.content!.slice(0, 500);
        sets.push(`summary = ?${idx++}`);
        params.push(newSummary);
        summaryChanged = true;
      }

      // Recompute content_hash if content changed
      if (contentChanged) {
        const hash = await contentHash(patch.content!);
        sets.push(`content_hash = ?${idx++}`);
        params.push(hash);
      }

      params.push(id);
      this.db
        .query(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?${idx}`)
        .run(...params);

      // Re-embed if content or summary changed
      if ((contentChanged || summaryChanged) && this.embedding) {
        const row = this.db
          .query(`SELECT summary FROM memories WHERE id = ?1`)
          .get(id) as { summary: string } | null;
        if (row) {
          try {
            const vector = await this.embedding.embed(row.summary, { purpose: "index" });
            this.db.query("DELETE FROM vec_memories WHERE memory_id = ?1").run(id);
            this.db
              .query("INSERT INTO vec_memories (memory_id, embedding) VALUES (?1, vec_f32(?2))")
              .run(id, new Float32Array(vector));
          } catch (embErr) {
            this.logger.warn("Failed to re-embed memory after update", {
              memoryId: id, error: String(embErr),
            });
          }
        }
      }

      return await this.get(id) as Result<MemoryRecord>;
    } catch (cause) {
      return err(new MemoryError(`Failed to update memory: ${cause}`, cause));
    }
  }

  async supersede(oldId: string, newInput: MemoryInput): Promise<Result<MemoryRecord>> {
    try {
      const now = Date.now();
      this.db
        .query("UPDATE memories SET status = 'superseded', superseded_by = ?1, updated_at = ?2 WHERE id = ?3")
        .run("pending", now, oldId);

      const result = await this.store(newInput);
      if (!result.ok) return result;

      this.db
        .query("UPDATE memories SET superseded_by = ?1 WHERE id = ?2")
        .run(result.value.id, oldId);

      return result;
    } catch (cause) {
      return err(new MemoryError(`Failed to supersede memory: ${cause}`, cause));
    }
  }

  async archive(id: string): Promise<Result<void>> {
    try {
      this.db
        .query("UPDATE memories SET status = 'archived', updated_at = ?1 WHERE id = ?2")
        .run(Date.now(), id);
      return ok(undefined);
    } catch (cause) {
      return err(new MemoryError(`Failed to archive memory: ${cause}`, cause));
    }
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      this.db.query("DELETE FROM memories WHERE id = ?1").run(id);
      try { this.db.query("DELETE FROM vec_memories WHERE memory_id = ?1").run(id); } catch { /* vec table may not exist */ }
      return ok(undefined);
    } catch (cause) {
      return err(new MemoryError(`Failed to delete memory: ${cause}`, cause));
    }
  }

  // --- Semantic Dedup ---

  /**
   * Check if a semantically similar memory already exists.
   *
   * Two tiers:
   *   cos >= 0.92  → near-duplicate rephrase. Skip (or supersede if LLM detects contradiction).
   *   cos >= 0.60  → same topic. Ask LLM arbiter if available; supersede on contradiction.
   *   cos <  0.60  → different topic. Proceed with normal insert.
   */
  private async checkSemanticDedup(
    input: MemoryInput,
    summary: string,
    scope: { type: string; id: string | null },
  ): Promise<{
    action: "skip" | "supersede" | "none";
    existing?: MemoryRecord;
    queryVec: Float32Array;
  } | null> {
    if (!this.embedding) return null;

    try {
      const queryVec = await this.embedding.embed(summary, { purpose: "index" });
      const now = Date.now();

      const vecRows = this.db
        .query(
          `SELECT memory_id, distance FROM vec_memories
           WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2`,
        )
        .all(new Float32Array(queryVec), DEDUP_NEIGHBOR_K) as { memory_id: string; distance: number }[];

      if (vecRows.length === 0) return { action: "none", queryVec };

      const ids = vecRows.map((r) => r.memory_id);
      const ph = ids.map((_, i) => `?${i + 4}`).join(",");

      const candidates = this.db
        .query(
          `SELECT ${SELECT_COLS} FROM memories m
           WHERE m.id IN (${ph})
             AND m.kind = ?1
             AND m.status IN ('active', 'candidate')
             AND m.scope_type = ?2
             AND (m.scope_id IS ?3)
             AND (m.expires_at IS NULL OR m.expires_at > ${now})`,
        )
        .all(input.kind, scope.type, scope.id, ...ids) as MemoryRow[];

      if (candidates.length === 0) return null;

      const distMap = new Map(vecRows.map((r) => [r.memory_id, r.distance]));

      for (const row of candidates) {
        const dist = distMap.get(row.id);
        if (dist == null) continue;
        const cosine = l2ToCosine(dist);
        const existingRecord = rowToRecord(row);

        this.logger.debug("Semantic dedup candidate", {
          newContent: input.content.slice(0, 80),
          existingContent: row.content.slice(0, 80),
          existingId: row.id,
          cosine: cosine.toFixed(4),
        });

        // Tier 1: near-duplicate rephrase
        if (cosine >= SEMANTIC_DEDUP_THRESHOLD) {
          if (this.provider) {
            const verdict = await this.checkContradiction(input.content, existingRecord.content);
            if (verdict === "contradiction") {
              this.logger.info("Contradiction detected in near-duplicate", {
                existingId: row.id, cosine: cosine.toFixed(3),
              });
              return { action: "supersede", existing: existingRecord, queryVec };
            }
          }

          this.logger.info("Semantic duplicate skipped", {
            existingId: row.id, cosine: cosine.toFixed(3),
          });
          this.db
            .query("UPDATE memories SET last_seen_at = ?1 WHERE id = ?2")
            .run(Date.now(), row.id);
          return { action: "skip", existing: rowToRecord({ ...row, last_seen_at: Date.now() }), queryVec };
        }

        // Tier 2: same-topic contradiction check (requires LLM)
        if (cosine >= CONTRADICTION_CHECK_THRESHOLD && this.provider) {
          const verdict = await this.checkContradiction(input.content, existingRecord.content);
          if (verdict === "contradiction") {
            this.logger.info("Contradiction detected in related memory", {
              existingId: row.id, cosine: cosine.toFixed(3),
            });
            return { action: "supersede", existing: existingRecord, queryVec };
          }
        }
      }

      return { action: "none", queryVec };
    } catch (e) {
      this.logger.warn("Semantic dedup check failed (proceeding with store)", { error: String(e) });
      return null;
    }
  }

  private static readonly CONTRADICTION_PROMPT = `You are a memory contradiction detector. Given two memory statements, determine if they CONTRADICT each other.

A contradiction means the two statements make incompatible factual claims about the same subject.
Examples of contradictions:
- "User prefers TypeScript" vs "User dislikes TypeScript"
- "User's name is Alice" vs "User's name is Bob"
- "Always use tabs for indentation" vs "Always use spaces for indentation"

NOT contradictions (just updates/refinements):
- "User prefers TypeScript" vs "User likes TypeScript for backend work" (refinement)
- "User lives in Copenhagen" vs "User recently moved to Copenhagen" (consistent)
- "Run tests before committing" vs "Run lint and tests before committing" (expansion)

Respond with EXACTLY one word: "contradiction" or "consistent"`;

  /**
   * Ask the LLM whether two memory contents contradict each other.
   * Returns "contradiction" or "consistent".
   */
  private async checkContradiction(
    newContent: string,
    existingContent: string,
  ): Promise<"contradiction" | "consistent"> {
    if (!this.provider) return "consistent";

    try {
      const messages: Message[] = [
        {
          id: `contra-sys-${Date.now()}`,
          role: "system",
          content: SqliteMemoryStore.CONTRADICTION_PROMPT,
          timestamp: Date.now(),
        },
        {
          id: `contra-input-${Date.now()}`,
          role: "user",
          content: `Statement A (new): ${newContent}\n\nStatement B (existing): ${existingContent}`,
          timestamp: Date.now(),
        },
      ];

      let response = "";
      for await (const chunk of this.provider.chat(messages)) {
        if (chunk.type === "text") response += chunk.text;
      }

      const trimmed = response.trim().toLowerCase();
      if (trimmed.includes("contradiction")) return "contradiction";
      return "consistent";
    } catch (e) {
      this.logger.warn("Contradiction check failed (assuming consistent)", { error: String(e) });
      return "consistent";
    }
  }

  // --- Hybrid Retrieval v2 ---

  async recall(query: string, options?: MemoryRecallOptions): Promise<Result<ScoredMemory[]>> {
    const topK = options?.topK ?? 10;
    const strategy = options?.strategy ?? (this.embedding ? "hybrid" : "fts");

    try {
      if (strategy === "hybrid") return await this.recallHybrid(query, topK, options);
      if (strategy === "vector" && this.embedding) return await this.recallByVector(query, topK);
      return this.recallByFts(query, topK, options);
    } catch (cause) {
      if (strategy === "vector") {
        this.logger.warn("Vector recall failed, falling back to FTS", { error: String(cause) });
        try { return this.recallByFts(query, topK, options); } catch (e) {
          return err(new MemoryError(`Failed to recall memories: ${e}`, e));
        }
      }
      return err(new MemoryError(`Failed to recall memories: ${cause}`, cause));
    }
  }

  private async recallHybrid(
    query: string,
    topK: number,
    options?: MemoryRecallOptions,
  ): Promise<Result<ScoredMemory[]>> {
    const halfLifeDays = options?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
    const minConfidence = options?.minConfidence ?? CONFIDENCE_FLOOR;
    const now = Date.now();
    const fetchN = clamp(topK * 3, 30, 200);

    // 1. Vector candidates
    const vectorRanks = new Map<string, number>();
    if (this.embedding) {
      try {
        const queryVec = await this.embedding.embed(query, { purpose: "retrieval" });
        const vecRows = this.db
          .query(
            `SELECT memory_id, distance FROM vec_memories
             WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2`,
          )
          .all(new Float32Array(queryVec), fetchN) as { memory_id: string; distance: number }[];
        vecRows.forEach((r, i) => vectorRanks.set(r.memory_id, i + 1));
      } catch (vecErr) {
        this.logger.warn("Vector search failed in hybrid mode", { error: String(vecErr) });
      }
    }

    // 2. FTS candidates
    const ftsRanks = new Map<string, number>();
    try {
      const words = query.toLowerCase().split(/\s+/)
        .map(sanitizeFtsWord)
        .filter((w) => w.length > 2);
      if (words.length > 0) {
        const ftsQuery = words.join(" OR ");
        const ftsFetchN = clamp(topK * 2, 20, 100);
        const ftsRows = this.db
          .query(
            `SELECT m.id FROM memories m
             JOIN memories_fts ON memories_fts.rowid = m.rowid
             WHERE memories_fts MATCH ?1 ORDER BY bm25(memories_fts) ASC LIMIT ?2`,
          )
          .all(ftsQuery, ftsFetchN) as { id: string }[];
        ftsRows.forEach((r, i) => ftsRanks.set(r.id, i + 1));
      }
    } catch (ftsErr) {
      this.logger.warn("FTS search failed in hybrid mode", { error: String(ftsErr) });
    }

    // 3. Build union, load rows
    const allIds = new Set([...vectorRanks.keys(), ...ftsRanks.keys()]);
    if (allIds.size === 0) return ok([]);

    const idList = [...allIds];
    const placeholders = idList.map((_, i) => `?${i + 2}`).join(",");

    // Build kind/status/scope filters
    let extraWhere = "";
    const extraParams: (string | number)[] = [];
    let pIdx = idList.length + 2;

    if (options?.kinds?.length) {
      const ph = options.kinds.map(() => `?${pIdx++}`);
      extraWhere += ` AND m.kind IN (${ph.join(",")})`;
      extraParams.push(...options.kinds);
    }
    if (options?.status?.length) {
      const ph = options.status.map(() => `?${pIdx++}`);
      extraWhere += ` AND m.status IN (${ph.join(",")})`;
      extraParams.push(...options.status);
    } else {
      extraWhere += ` AND m.status IN ('active','candidate')`;
    }
    if (options?.scope) {
      const sc = scopeToColumns(options.scope);
      extraWhere += ` AND m.scope_type = ?${pIdx++}`;
      extraParams.push(sc.type);
      if (sc.id) { extraWhere += ` AND m.scope_id = ?${pIdx++}`; extraParams.push(sc.id); }
    }

    const rows = this.db
      .query(
        `SELECT ${SELECT_COLS} FROM memories m
         WHERE m.id IN (${placeholders})
           AND (m.expires_at IS NULL OR m.expires_at > ?1)
           ${extraWhere}`,
      )
      .all(now, ...idList, ...extraParams) as MemoryRow[];

    // 4. RRF + bounded transforms
    const λ = LN2 / halfLifeDays;

    const scored: ScoredMemory[] = rows
      .map((row) => {
        const vRank = vectorRanks.get(row.id);
        const fRank = ftsRanks.get(row.id);

        const rrf = (vRank ? 1 / (RRF_K + vRank) : 0) + (fRank ? 1 / (RRF_K + fRank) : 0);

        const ageDays = (now - row.updated_at) / 86_400_000;
        const decay = Math.exp(-λ * ageDays);

        const importanceW = 0.7 + 0.3 * row.importance;
        const confidenceW = 0.6 + 0.4 * row.confidence;
        const decayW = Math.max(0.5, decay);

        const scopeBoost = row.scope_type === "thread" ? 1.5
          : row.scope_type === "project" ? 1.2
          : row.scope_type === "global" ? 1.0
          : 0.5;

        const score = rrf * importanceW * confidenceW * decayW * scopeBoost;

        const matchSource: ScoredMemory["matchSource"] =
          vRank && fRank ? "hybrid" : vRank ? "vector" : "fts";

        return { memory: rowToRecord(row), score, matchSource };
      })
      .filter((s) => s.memory.confidence >= minConfidence);

    // 5. Dedup: same source.id + content_hash -> keep higher score
    const seen = new Map<string, ScoredMemory>();
    for (const s of scored) {
      const srcId = s.memory.source.id;
      const row = rows.find((r) => r.id === s.memory.id);
      const hash = row?.content_hash;
      if (srcId && hash) {
        const key = `${srcId}:${hash}`;
        const existing = seen.get(key);
        if (!existing || s.score > existing.score) { seen.set(key, s); }
      } else {
        seen.set(s.memory.id, s);
      }
    }

    const results = [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    this.logger.debug("Hybrid recall v2", {
      query: query.slice(0, 80), topK,
      vectorCandidates: vectorRanks.size,
      ftsCandidates: ftsRanks.size,
      returned: results.length,
    });

    return ok(results);
  }

  private async recallByVector(query: string, topK: number): Promise<Result<ScoredMemory[]>> {
    if (!this.embedding) return err(new MemoryError("Vector recall requires an EmbeddingProvider"));

    const queryVec = await this.embedding.embed(query, { purpose: "retrieval" });
    const fetchN = clamp(topK * 3, 30, 200);
    const vecRows = this.db
      .query(
        `SELECT memory_id, distance FROM vec_memories
         WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2`,
      )
      .all(new Float32Array(queryVec), fetchN) as { memory_id: string; distance: number }[];

    if (vecRows.length === 0) return ok([]);

    const now = Date.now();
    const ids = vecRows.map((r) => r.memory_id);
    const ph = ids.map((_, i) => `?${i + 2}`).join(",");
    const rows = this.db
      .query(
        `SELECT ${SELECT_COLS} FROM memories m
         WHERE m.id IN (${ph}) AND m.status IN ('active','candidate')
           AND (m.expires_at IS NULL OR m.expires_at > ?1)`,
      )
      .all(now, ...ids) as MemoryRow[];

    const rowMap = new Map(rows.map((r) => [r.id, r]));
    const distMap = new Map(vecRows.map((r) => [r.memory_id, r.distance]));

    const results: ScoredMemory[] = [];
    for (const vr of vecRows) {
      const row = rowMap.get(vr.memory_id);
      if (row) {
        results.push({
          memory: rowToRecord(row),
          score: distanceToScore(vr.distance),
          matchSource: "vector",
        });
        if (results.length >= topK) break;
      }
    }

    return ok(results);
  }

  private recallByFts(query: string, topK: number, options?: MemoryRecallOptions): Result<ScoredMemory[]> {
    const words = query.toLowerCase().split(/\s+/)
      .map(sanitizeFtsWord)
      .filter((w) => w.length > 2);
    if (words.length === 0) return ok([]);

    const now = Date.now();
    const ftsQuery = words.join(" OR ");

    let extraWhere = "";
    const extraParams: (string | number)[] = [];
    let pIdx = 4;

    if (options?.kinds?.length) {
      const ph = options.kinds.map(() => `?${pIdx++}`);
      extraWhere += ` AND m.kind IN (${ph.join(",")})`;
      extraParams.push(...options.kinds);
    }
    if (options?.status?.length) {
      const ph = options.status.map(() => `?${pIdx++}`);
      extraWhere += ` AND m.status IN (${ph.join(",")})`;
      extraParams.push(...options.status);
    }

    try {
      const rows = this.db
        .query(
          `SELECT ${SELECT_COLS} FROM memories m
           JOIN memories_fts ON memories_fts.rowid = m.rowid
           WHERE memories_fts MATCH ?1
             AND m.status IN ('active','candidate')
             AND (m.expires_at IS NULL OR m.expires_at > ?2)
             ${extraWhere}
           ORDER BY bm25(memories_fts) ASC LIMIT ?3`,
        )
        .all(ftsQuery, now, topK, ...extraParams) as MemoryRow[];

      return ok(rows.map((row, i) => ({
        memory: rowToRecord(row),
        score: 1 / (i + 1),
        matchSource: "fts" as const,
      })));
    } catch {
      return ok([]);
    }
  }
}
