// Test fixture: in-memory implementations of ConversationStore and LongTermMemory

import type {
  ConversationStore,
  LongTermMemory,
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
