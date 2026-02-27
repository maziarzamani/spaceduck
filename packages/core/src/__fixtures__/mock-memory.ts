// Test fixture: in-memory implementations of ConversationStore and LongTermMemory

import type {
  ConversationStore,
  LongTermMemory,
  MemoryStore,
  MemoryRecord,
  MemoryInput,
  MemoryPatch,
  MemoryFilter,
  MemoryRecallOptions,
  ScoredMemory,
  Conversation,
  Message,
  Fact,
  FactInput,
  SlotFactInput,
  Result,
} from "../types";
import { ok } from "../types";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export class MockConversationStore implements ConversationStore {
  private conversations = new Map<string, Conversation>();

  async create(id: string, title?: string): Promise<Result<Conversation>> {
    const conversation: Conversation = {
      id,
      title,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: [],
    };
    this.conversations.set(id, conversation);
    return ok(conversation);
  }

  async load(id: string): Promise<Result<Conversation | null>> {
    return ok(this.conversations.get(id) ?? null);
  }

  async list(): Promise<Result<Conversation[]>> {
    return ok(Array.from(this.conversations.values()));
  }

  async appendMessage(conversationId: string, message: Message): Promise<Result<void>> {
    let conv = this.conversations.get(conversationId);
    if (!conv) {
      // Auto-create conversation
      conv = {
        id: conversationId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messages: [],
      };
      this.conversations.set(conversationId, conv);
    }

    const updated: Conversation = {
      ...conv,
      lastActiveAt: Date.now(),
      messages: [...conv.messages, message],
    };
    this.conversations.set(conversationId, updated);
    return ok(undefined);
  }

  async updateTitle(conversationId: string, title: string): Promise<Result<void>> {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      this.conversations.set(conversationId, { ...conv, title });
    }
    return ok(undefined);
  }

  async delete(conversationId: string): Promise<Result<void>> {
    this.conversations.delete(conversationId);
    return ok(undefined);
  }

  async loadMessages(conversationId: string, limit?: number): Promise<Result<Message[]>> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return ok([]);
    const messages = limit ? conv.messages.slice(-limit) : conv.messages;
    return ok(messages);
  }
}

// ---------------------------------------------------------------------------
// MockMemoryStore — in-memory MemoryStore for v2 tests
// ---------------------------------------------------------------------------

export class MockMemoryStore implements MemoryStore {
  private memories = new Map<string, MemoryRecord>();

  async store(input: MemoryInput): Promise<Result<MemoryRecord>> {
    const now = Date.now();
    const id = generateId();
    const record: MemoryRecord = {
      id,
      kind: input.kind,
      title: input.title,
      content: input.content,
      summary: input.summary || input.content.slice(0, 200),
      scope: input.scope,
      entityRefs: input.entityRefs ?? [],
      source: input.source,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.7,
      status: input.status ?? "active",
      tags: input.tags ?? [],
      occurredAt: input.kind === "episode" ? input.occurredAt : undefined,
      procedureSubtype: input.kind === "procedure" ? input.procedureSubtype : undefined,
    };
    this.memories.set(id, record);
    return ok(record);
  }

  async get(id: string): Promise<Result<MemoryRecord | null>> {
    return ok(this.memories.get(id) ?? null);
  }

  async list(filter?: MemoryFilter): Promise<Result<MemoryRecord[]>> {
    let results = Array.from(this.memories.values());
    if (filter?.kinds?.length) results = results.filter((m) => filter.kinds!.includes(m.kind));
    if (filter?.status?.length) results = results.filter((m) => filter.status!.includes(m.status));
    return ok(results.slice(0, filter?.limit ?? 100));
  }

  async update(id: string, patch: MemoryPatch): Promise<Result<MemoryRecord>> {
    const existing = this.memories.get(id);
    if (!existing) return ok(existing as unknown as MemoryRecord);
    const updated: MemoryRecord = {
      ...existing,
      ...(patch.title != null && { title: patch.title }),
      ...(patch.content != null && { content: patch.content }),
      ...(patch.summary != null && { summary: patch.summary }),
      ...(patch.status != null && { status: patch.status }),
      updatedAt: Date.now(),
      tags: patch.tags ?? existing.tags,
      entityRefs: patch.entityRefs ?? existing.entityRefs,
      expiresAt: patch.expiresAt === null ? undefined : (patch.expiresAt ?? existing.expiresAt),
    };
    this.memories.set(id, updated);
    return ok(updated);
  }

  async supersede(oldId: string, newInput: MemoryInput): Promise<Result<MemoryRecord>> {
    return this.store(newInput);
  }

  async recall(query: string, options?: MemoryRecallOptions): Promise<Result<ScoredMemory[]>> {
    let all = Array.from(this.memories.values());
    const allowedStatus = options?.status ?? ["active"];
    all = all.filter((m) => allowedStatus.includes(m.status));
    if (options?.kinds?.length) all = all.filter((m) => options.kinds!.includes(m.kind));

    const queryWords = query.toLowerCase().split(/\s+/);
    const scored: ScoredMemory[] = all
      .map((memory) => {
        const hits = queryWords.filter((w) =>
          memory.content.toLowerCase().includes(w),
        ).length;
        return { memory, score: hits / Math.max(queryWords.length, 1), matchSource: "hybrid" as const };
      })
      .filter((sm) => sm.score > 0)
      .sort((a, b) => b.score - a.score);
    return ok(scored.slice(0, options?.topK ?? 16));
  }

  async archive(id: string): Promise<Result<void>> {
    const m = this.memories.get(id);
    if (m) this.memories.set(id, { ...m, status: "archived" });
    return ok(undefined);
  }

  async delete(id: string): Promise<Result<void>> {
    this.memories.delete(id);
    return ok(undefined);
  }

  /** Test helper: get all stored memories */
  getAll(): MemoryRecord[] {
    return Array.from(this.memories.values());
  }

  clear(): void {
    this.memories.clear();
  }
}

export class MockLongTermMemory implements LongTermMemory {
  private facts = new Map<string, Fact>();

  async remember(input: FactInput): Promise<Result<Fact>> {
    const now = Date.now();
    const full: Fact = {
      id: generateId(),
      conversationId: input.conversationId,
      content: input.content,
      category: input.category,
      source: input.source ?? "auto-extracted",
      confidence: input.confidence ?? 1.0,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
      slot: input.slot,
      slotValue: input.slotValue,
      lang: input.lang ?? "und",
      isActive: true,
    };
    this.facts.set(full.id, full);
    return ok(full);
  }

  async upsertSlotFact(input: SlotFactInput): Promise<Result<Fact | null>> {
    const now = Date.now();
    // Deactivate existing facts in the same slot
    for (const f of this.facts.values()) {
      if (f.slot === input.slot && f.isActive) {
        this.facts.set(f.id, { ...f, isActive: false, updatedAt: now });
      }
    }
    const full: Fact = {
      id: generateId(),
      conversationId: input.conversationId,
      content: input.content,
      source: input.source as Fact["source"],
      confidence: input.confidence,
      createdAt: now,
      updatedAt: now,
      slot: input.slot,
      slotValue: input.slotValue,
      lang: input.lang,
      isActive: true,
    };
    this.facts.set(full.id, full);
    return ok(full);
  }

  async recall(query: string, limit?: number): Promise<Result<Fact[]>> {
    const all = Array.from(this.facts.values());
    // Simple: return facts whose content includes any word from the query
    const queryWords = query.toLowerCase().split(/\s+/);
    const matches = all.filter((f) =>
      queryWords.some((w) => f.content.toLowerCase().includes(w)),
    );
    return ok(matches.slice(0, limit ?? 10));
  }

  async forget(factId: string): Promise<Result<void>> {
    this.facts.delete(factId);
    return ok(undefined);
  }

  async listAll(conversationId?: string): Promise<Result<Fact[]>> {
    const all = Array.from(this.facts.values());
    if (conversationId) {
      return ok(all.filter((f) => f.conversationId === conversationId));
    }
    return ok(all);
  }
}
