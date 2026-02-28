// Memory interfaces: ConversationStore (L1) and LongTermMemory (L3)
// Memory v2: MemoryStore with typed memories, discriminated inputs, constrained patches

import type { Message, Conversation } from "./message";
import type { Result } from "./errors";

// ---------------------------------------------------------------------------
// Legacy types (kept for backward compat during migration)
// ---------------------------------------------------------------------------

/** Identity slots for conflict resolution — only one active fact per slot. */
export type FactSlot = "name" | "age" | "location" | "preference" | "other";

export interface Fact {
  readonly id: string;
  readonly conversationId: string;
  readonly content: string;
  readonly category?: string;
  /** Where the fact came from. */
  readonly source: "auto-extracted" | "regex" | "llm" | "manual" | "compaction-flush" | "turn-flush" | "pre_regex" | "post_llm";
  /** Confidence score 0-1 set by the firewall heuristic. */
  readonly confidence: number;
  /** Optional expiry timestamp (ms). NULL means never expires. */
  readonly expiresAt?: number;
  readonly createdAt: number;
  /** Set to createdAt on first write; updated when fact is rewritten/merged. */
  readonly updatedAt: number;
  /** Identity slot for conflict resolution (e.g., "name", "age"). */
  readonly slot?: FactSlot;
  /** Raw extracted value (e.g., "Maziar", "42", "Copenhagen"). */
  readonly slotValue?: string;
  /** Source language ISO 639-1 code. Always set: "en", "da", or "und" (unknown). */
  readonly lang: string;
  /** Whether this fact is active (not superseded by a newer fact in the same slot). */
  readonly isActive: boolean;
}

/** Input type for remember(). System-generated fields (id, createdAt, updatedAt, isActive) are omitted.
 *  source, confidence, lang, slot, slotValue are optional — defaults applied by the implementation. */
export type FactInput = Omit<Fact, "id" | "createdAt" | "updatedAt" | "source" | "confidence" | "isActive" | "lang" | "slot" | "slotValue"> & {
  source?: Fact["source"];
  confidence?: number;
  lang?: string;
  slot?: FactSlot;
  slotValue?: string;
};

export interface RecallOptions {
  /** Maximum number of results (default: 10). Takes precedence over `limit` parameter. */
  readonly topK?: number;
  /** Minimum similarity score 0-1 to include (default: 0.0). Only applies to vector strategy. */
  readonly minScore?: number;
  /** Minimum confidence score 0-1 to include (default: 0.0). */
  readonly minConfidence?: number;
  /** Recall strategy. Default: auto (vector if available, else fts). */
  readonly strategy?: "vector" | "fts" | "hybrid";
  /** Recency decay half-life in days (default: 90). Used in hybrid/vector recall. */
  readonly halfLifeDays?: number;
}

export interface ConversationStore {
  create(id: string, title?: string): Promise<Result<Conversation>>;
  load(id: string): Promise<Result<Conversation | null>>;
  list(): Promise<Result<Conversation[]>>;
  appendMessage(conversationId: string, message: Message): Promise<Result<void>>;
  updateTitle(conversationId: string, title: string): Promise<Result<void>>;
  delete(conversationId: string): Promise<Result<void>>;
  loadMessages(conversationId: string, limit?: number, before?: number): Promise<Result<Message[]>>;
}

/** Input for upsertSlotFact(): identity slot writes with source tracking and write guards. */
export interface SlotFactInput {
  readonly slot: FactSlot;
  readonly slotValue: string;
  readonly content: string;
  readonly conversationId: string;
  readonly lang: string;
  readonly source: "pre_regex" | "post_llm";
  readonly derivedFromMessageId: string;
  readonly confidence: number;
}

export interface LongTermMemory {
  remember(fact: FactInput): Promise<Result<Fact>>;
  /**
   * Upsert an identity slot fact with write guards:
   * - pre_regex wins over post_llm for the same messageId
   * - newer messages always win over older ones (time-ordering)
   * - deactivate + insert in a single transaction
   */
  upsertSlotFact(input: SlotFactInput): Promise<Result<Fact | null>>;
  /** @deprecated Use options.topK instead of limit. limit is kept for backward compat. */
  recall(query: string, limit?: number, options?: RecallOptions): Promise<Result<Fact[]>>;
  forget(factId: string): Promise<Result<void>>;
  listAll(conversationId?: string): Promise<Result<Fact[]>>;
}

// ---------------------------------------------------------------------------
// Memory v2 types
// ---------------------------------------------------------------------------

export type MemoryKind = "fact" | "episode" | "procedure";

export type MemoryStatus = "candidate" | "active" | "stale" | "superseded" | "archived";

/**
 * Procedure subtype: distinguishes behavioral instructions, reusable workflows,
 * and hard constraints. Required for procedures, unused for facts/episodes.
 * Costs nothing at ingestion, prevents the model from treating "use friendly tone"
 * the same as "always validate schemas before saving".
 */
export type ProcedureSubtype = "behavioral" | "workflow" | "constraint";

/**
 * Primary scope for a memory. v1 uses a single primary scope plus entityRefs/tags
 * as secondary dimensions. Multi-scope relationships (e.g., a scope_refs join table)
 * can come later if needed.
 *
 * Scope also hints at durability: thread-scoped memories decay faster (30d half-life
 * vs 90d for global) to prevent local clutter from outranking durable global truths.
 */
export type MemoryScope =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId: string }
  | { readonly type: "thread"; readonly conversationId: string }
  | { readonly type: "entity"; readonly entityId: string };

/** Structured source provenance for trust, debugging, and conflict resolution. */
export interface MemorySource {
  readonly type: "user_message" | "assistant_message" | "tool_result" | "system" | "migration";
  readonly id?: string;
  readonly conversationId?: string;
  readonly runId?: string;
  readonly toolName?: string;
  /** Which scheduled task wrote this memory (null for interactive conversations). */
  readonly taskId?: string;
  /** Which skill wrote this memory (Phase 2, null until skill system ships). */
  readonly skillId?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly content: string;
  readonly summary: string;
  readonly scope: MemoryScope;
  readonly entityRefs: string[];
  readonly source: MemorySource;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastSeenAt: number;
  /** 0-1, how much this memory matters for future recall. */
  readonly importance: number;
  /** 0-1, epistemic certainty about the memory's truth. */
  readonly confidence: number;
  readonly status: MemoryStatus;
  readonly supersededBy?: string;
  readonly embeddingVersion?: string;
  readonly tags: string[];
  /** Only set for episodes. When the event occurred (ms epoch). */
  readonly occurredAt?: number;
  /** Optional expiry timestamp (ms). NULL means never expires. */
  readonly expiresAt?: number;
  /** Only set for procedures. */
  readonly procedureSubtype?: ProcedureSubtype;
}

// ---------------------------------------------------------------------------
// MemoryInput -- discriminated union for store()
// ---------------------------------------------------------------------------

interface BaseMemoryInput {
  readonly title: string;
  readonly content: string;
  /** Derived from content if omitted. Used for embeddings. */
  readonly summary?: string;
  readonly scope: MemoryScope;
  readonly entityRefs?: string[];
  readonly source: MemorySource;
  readonly tags?: string[];
  /** Usually system-assigned by retention gate. Callers may override. */
  readonly importance?: number;
  /** Usually system-assigned by retention gate. Callers may override. */
  readonly confidence?: number;
  /** Usually assigned by retention gate (candidate vs active). Defaults to "active". */
  readonly status?: MemoryStatus;
  readonly expiresAt?: number;
}

export interface FactMemoryInput extends BaseMemoryInput {
  readonly kind: "fact";
}

export interface EpisodeMemoryInput extends BaseMemoryInput {
  readonly kind: "episode";
  /** Required for new episodes. When the event occurred (ms epoch). */
  readonly occurredAt: number;
}

export interface ProcedureMemoryInput extends BaseMemoryInput {
  readonly kind: "procedure";
  readonly procedureSubtype: ProcedureSubtype;
}

export type MemoryInput = FactMemoryInput | EpisodeMemoryInput | ProcedureMemoryInput;

// ---------------------------------------------------------------------------
// MemoryPatch -- constrained mutation for update()
// ---------------------------------------------------------------------------

/**
 * Constrained patch type for update(). Prevents callers from mutating ontology,
 * provenance, or retrieval semantics.
 *
 * Immutable after creation (not patchable):
 *   kind, source, createdAt, procedureSubtype, occurredAt
 *
 * Triggers recomputation if changed:
 *   content or summary -> re-embed, update embeddingVersion + content_hash.
 *   If content changes and summary is not in the patch, summary is regenerated
 *   from new content before re-embedding.
 *
 * System-managed only (updated by retrieval/lifecycle, not callers):
 *   confidence, importance, lastSeenAt, updatedAt, supersededBy
 */
export interface MemoryPatch {
  readonly title?: string;
  readonly content?: string;
  readonly summary?: string;
  readonly tags?: string[];
  readonly entityRefs?: string[];
  readonly status?: MemoryStatus;
  readonly expiresAt?: number | null;
}

// ---------------------------------------------------------------------------
// RetentionDecision -- formal output of the classification + retention gate
// ---------------------------------------------------------------------------

export type RetentionReason =
  | "durable_fact"
  | "relevant_episode"
  | "behavioral_instruction"
  | "workflow_procedure"
  | "constraint_procedure"
  | "ephemeral_noise"
  | "duplicate_candidate"
  | "low_confidence"
  | "ambiguous";

export interface RetentionDecision {
  readonly shouldStore: boolean;
  readonly reason: RetentionReason;
  readonly initialStatus?: "candidate" | "active";
  readonly expiresAt?: number;
}

// ---------------------------------------------------------------------------
// MemoryStore -- the v2 memory interface
// ---------------------------------------------------------------------------

export interface MemoryRecallOptions {
  readonly kinds?: MemoryKind[];
  readonly scope?: MemoryScope;
  readonly status?: MemoryStatus[];
  readonly topK?: number;
  readonly minImportance?: number;
  readonly minConfidence?: number;
  readonly strategy?: "vector" | "fts" | "hybrid";
  readonly halfLifeDays?: number;
  /** Max tokens from memory to include in context (uses pre-computed estimated_tokens). */
  readonly maxMemoryTokens?: number;
  /** Max discrete memory entries to retrieve. */
  readonly maxEntries?: number;
}

export interface ScoredMemory {
  readonly memory: MemoryRecord;
  readonly score: number;
  readonly matchSource: "vector" | "fts" | "structured" | "hybrid";
}

export interface MemoryFilter {
  readonly kinds?: MemoryKind[];
  readonly status?: MemoryStatus[];
  readonly scope?: MemoryScope;
  readonly tags?: string[];
  readonly minImportance?: number;
  readonly minConfidence?: number;
  readonly limit?: number;
}

export interface MemoryStore {
  store(input: MemoryInput): Promise<Result<MemoryRecord>>;
  update(id: string, patch: MemoryPatch): Promise<Result<MemoryRecord>>;
  supersede(oldId: string, newInput: MemoryInput): Promise<Result<MemoryRecord>>;
  recall(query: string, options?: MemoryRecallOptions): Promise<Result<ScoredMemory[]>>;
  get(id: string): Promise<Result<MemoryRecord | null>>;
  list(filter?: MemoryFilter): Promise<Result<MemoryRecord[]>>;
  archive(id: string): Promise<Result<void>>;
  delete(id: string): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
// Discrete rubric mappings for LLM classification prompt
// ---------------------------------------------------------------------------

export type ImportanceBucket = "trivial" | "standard" | "significant" | "core" | "critical";
export type ConfidenceBucket = "speculative" | "likely" | "stated" | "certain";

export const IMPORTANCE_MAP: Record<ImportanceBucket, number> = {
  trivial: 0.3,
  standard: 0.5,
  significant: 0.7,
  core: 0.85,
  critical: 1.0,
};

export const CONFIDENCE_MAP: Record<ConfidenceBucket, number> = {
  speculative: 0.4,
  likely: 0.6,
  stated: 0.8,
  certain: 0.95,
};
