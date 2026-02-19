// Memory interfaces: ConversationStore (L1) and LongTermMemory (L3)

import type { Message, Conversation } from "./message";
import type { Result } from "./errors";

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
