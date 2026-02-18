// Memory interfaces: ConversationStore (L1) and LongTermMemory (L3)

import type { Message, Conversation } from "./message";
import type { Result } from "./errors";

export interface Fact {
  readonly id: string;
  readonly conversationId: string;
  readonly content: string;
  readonly category?: string;
  /** Where the fact came from. */
  readonly source: "auto-extracted" | "manual" | "compaction-flush";
  /** Confidence score 0-1 set by the firewall heuristic. */
  readonly confidence: number;
  /** Optional expiry timestamp (ms). NULL means never expires. */
  readonly expiresAt?: number;
  readonly createdAt: number;
  /** Set to createdAt on first write; updated when fact is rewritten/merged. */
  readonly updatedAt: number;
}

/** Input type for remember(). System-generated fields (id, createdAt, updatedAt) are omitted.
 *  source and confidence are optional — defaults applied by the implementation. */
export type FactInput = Omit<Fact, "id" | "createdAt" | "updatedAt" | "source" | "confidence"> & {
  source?: Fact["source"];
  confidence?: number;
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

export interface LongTermMemory {
  remember(fact: FactInput): Promise<Result<Fact>>;
  /** @deprecated Use options.topK instead of limit. limit is kept for backward compat. */
  recall(query: string, limit?: number, options?: RecallOptions): Promise<Result<Fact[]>>;
  forget(factId: string): Promise<Result<void>>;
  listAll(conversationId?: string): Promise<Result<Fact[]>>;
}
