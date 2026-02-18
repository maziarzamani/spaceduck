// Context builder: assembles messages for LLM, manages token budget, handles compaction

import type { Message, ConversationStore, LongTermMemory, Provider, Logger } from "./types";
import type { Result } from "./types";
import { ok } from "./types";

export interface TokenBudget {
  readonly maxTokens: number;
  readonly systemPromptReserve: number;
  readonly maxTurns: number;
  readonly maxFacts: number;
  readonly compactionThreshold: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  maxTokens: 200_000,
  systemPromptReserve: 1000,
  maxTurns: 50,
  maxFacts: 10,
  compactionThreshold: 0.85,
};

export interface ContextWindowManager {
  buildContext(conversationId: string, budget?: Partial<TokenBudget>): Promise<Result<Message[]>>;
  compact(conversationId: string, provider: Provider): Promise<Result<void>>;
  estimateTokens(messages: Message[]): number;
  needsCompaction(messages: Message[], budget: TokenBudget): boolean;
  /**
   * Called after every agent response. Eagerly extracts and persists facts from the
   * latest exchange so they reach LTM even in short conversations that never compact.
   */
  afterTurn?(conversationId: string, provider: Provider): Promise<void>;
}

/**
 * Minimum number of new messages since the last flush before we flush again.
 * Prevents the flush LLM call from running on every compaction of the same convo.
 */
const MIN_MESSAGES_BETWEEN_FLUSHES = 20;

/**
 * SHA-256 of a comma-joined list of message IDs.
 * Used to detect when we're compacting the exact same chunk twice.
 */
async function chunkHash(messages: Message[]): Promise<string> {
  const raw = messages.map((m) => m.id).join(",");
  const data = new TextEncoder().encode(raw);
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

const FLUSH_EXTRACTION_PROMPT = `You are a memory consolidation system. Extract durable, long-term facts from this conversation chunk before it is archived.

Rules:
- Extract ONLY concrete facts about the user (preferences, decisions, personal info, technical choices)
- Do NOT extract transient information or summaries
- Each fact must be a single self-contained sentence
- Return a JSON array of strings: ["fact 1", "fact 2"]
- Return [] if no durable facts are worth preserving
- Maximum 8 facts`;

/**
 * Default context builder that assembles messages from ConversationStore + LongTermMemory.
 * Supports compaction when context exceeds token budget, with a pre-compaction memory flush
 * to preserve durable facts before the conversation chunk is archived.
 */
export class DefaultContextBuilder implements ContextWindowManager {
  // Per-conversation flush state: tracks last-flush message count and seen chunk hashes
  private readonly flushState = new Map<
    string,
    { messageCount: number; seenHashes: Set<string> }
  >();

  constructor(
    private readonly store: ConversationStore,
    private readonly ltm: LongTermMemory | undefined,
    private readonly logger: Logger,
    private readonly systemPrompt?: string,
  ) {}

  async buildContext(
    conversationId: string,
    budgetOverrides?: Partial<TokenBudget>,
  ): Promise<Result<Message[]>> {
    const budget = { ...DEFAULT_TOKEN_BUDGET, ...budgetOverrides };

    // Load recent messages
    const messagesResult = await this.store.loadMessages(conversationId, budget.maxTurns);
    if (!messagesResult.ok) return messagesResult;

    const messages = messagesResult.value;
    const context: Message[] = [];

    // Add system prompt if configured
    if (this.systemPrompt) {
      context.push({
        id: "system-prompt",
        role: "system",
        content: this.systemPrompt,
        timestamp: 0,
        source: "system",
      });
    }

    // Add relevant facts from LTM if available
    if (this.ltm) {
      const lastUserMessage = messages.filter((m) => m.role === "user").at(-1);
      if (lastUserMessage) {
        const factsResult = await this.ltm.recall(lastUserMessage.content, budget.maxFacts);
        if (factsResult.ok && factsResult.value.length > 0) {
          const factsText = factsResult.value.map((f) => `- ${f.content}`).join("\n");
          context.push({
            id: `facts-${Date.now()}`,
            role: "system",
            content: `Relevant context from previous conversations:\n${factsText}`,
            timestamp: 0,
            source: "system",
          });
        }
      }
    }

    // Add recent conversation messages
    for (const msg of messages) {
      context.push(msg);
    }

    return ok(context);
  }

  async compact(conversationId: string, provider: Provider): Promise<Result<void>> {
    const messagesResult = await this.store.loadMessages(conversationId);
    if (!messagesResult.ok) return messagesResult;

    const messages = messagesResult.value;
    if (messages.length < 10) return ok(undefined);

    // Take the oldest 60% of messages to summarize
    const cutoff = Math.floor(messages.length * 0.6);
    const toSummarize = messages.slice(0, cutoff);

    this.logger.info("Compacting conversation", {
      conversationId,
      totalMessages: messages.length,
      summarizing: toSummarize.length,
    });

    // ── Pre-compaction memory flush ──────────────────────────────────────
    // Extract durable facts from the chunk BEFORE it is compressed into a
    // summary and those details become inaccessible.
    if (this.ltm) {
      await this.maybeFlush(conversationId, toSummarize, provider, messages.length);
    }

    // ── Summary generation ───────────────────────────────────────────────
    const transcript = toSummarize
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const summaryPrompt: Message[] = [
      {
        id: `compact-prompt-${Date.now()}`,
        role: "system",
        content: "Summarize the following conversation concisely, preserving key decisions, facts, and context. Be brief but complete.",
        timestamp: Date.now(),
      },
      {
        id: `compact-input-${Date.now()}`,
        role: "user",
        content: transcript,
        timestamp: Date.now(),
      },
    ];

    let summary = "";
    for await (const chunk of provider.chat(summaryPrompt)) {
      if (chunk.type === "text") {
        summary += chunk.text;
      }
    }

    const summaryMessage: Message = {
      id: `compaction-${Date.now()}`,
      role: "system",
      content: `[Conversation summary]\n${summary}`,
      timestamp: Date.now(),
      source: "compaction",
    };

    const appendResult = await this.store.appendMessage(conversationId, summaryMessage);
    if (!appendResult.ok) return appendResult;

    this.logger.info("Compaction complete", {
      conversationId,
      summarizedTurns: toSummarize.length,
    });

    return ok(undefined);
  }

  /**
   * Run a pre-compaction memory flush if the rate-limit and chunk-hash
   * dedup guards allow it.
   */
  private async maybeFlush(
    conversationId: string,
    toSummarize: Message[],
    provider: Provider,
    totalMessageCount: number,
  ): Promise<void> {
    try {
      let state = this.flushState.get(conversationId);
      if (!state) {
        state = { messageCount: 0, seenHashes: new Set() };
        this.flushState.set(conversationId, state);
      }

      // Guardrail 1: rate limit — skip if we flushed recently
      const messagesSinceFlush = totalMessageCount - state.messageCount;
      if (state.messageCount > 0 && messagesSinceFlush < MIN_MESSAGES_BETWEEN_FLUSHES) {
        this.logger.debug("Compaction flush skipped (rate limit)", {
          conversationId,
          messagesSinceFlush,
        });
        return;
      }

      // Guardrail 2: chunk hash dedup — skip if we've seen this exact chunk
      const hash = await chunkHash(toSummarize);
      if (state.seenHashes.has(hash)) {
        this.logger.debug("Compaction flush skipped (duplicate chunk)", {
          conversationId,
          hash: hash.slice(0, 8),
        });
        return;
      }

      // Run the flush
      this.logger.info("Running pre-compaction memory flush", {
        conversationId,
        messages: toSummarize.length,
      });

      const facts = await this.extractFlushFacts(toSummarize, provider);

      for (const content of facts) {
        if (content.length < 5 || content.length > 300) continue;
        // Cap confidence: 0.6–0.75 — compaction prompts produce broad statements
        await this.ltm!.remember({
          conversationId,
          content,
          source: "compaction-flush",
          confidence: 0.65,
        });
      }

      // Mark as flushed
      state.messageCount = totalMessageCount;
      state.seenHashes.add(hash);

      this.logger.info("Pre-compaction flush complete", {
        conversationId,
        factsStored: facts.length,
      });
    } catch (flushErr) {
      // Flush failure must never block compaction
      this.logger.warn("Pre-compaction flush failed (non-fatal)", {
        conversationId,
        error: String(flushErr),
      });
    }
  }

  /**
   * One LLM call to extract durable facts from a chunk of messages.
   */
  private async extractFlushFacts(
    messages: Message[],
    provider: Provider,
  ): Promise<string[]> {
    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    if (!transcript.trim()) return [];

    const prompt: Message[] = [
      {
        id: `flush-sys-${Date.now()}`,
        role: "system",
        content: FLUSH_EXTRACTION_PROMPT,
        timestamp: Date.now(),
      },
      {
        id: `flush-input-${Date.now()}`,
        role: "user",
        content: transcript,
        timestamp: Date.now(),
      },
    ];

    let response = "";
    for await (const chunk of provider.chat(prompt)) {
      if (chunk.type === "text") {
        response += chunk.text;
      }
    }

    return this.parseFactsJson(response);
  }

  /**
   * Parse a JSON array of strings from LLM output.
   * Tolerates markdown fences, trailing commas, and extra text.
   */
  private parseFactsJson(raw: string): string[] {
    let cleaned = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)```/g, "$1").trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];

    cleaned = arrayMatch[0].replace(/,\s*]/g, "]");

    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item: unknown): item is string => typeof item === "string");
    } catch {
      const strings: string[] = [];
      const re = /"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cleaned)) !== null) {
        const s = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
        if (s.length >= 5) strings.push(s);
      }
      return strings;
    }
  }

  /**
   * Eagerly extract and persist facts from the latest exchange (last user + assistant pair).
   * Runs in the background after every agent response so facts reach LTM immediately —
   * long before compaction would ever trigger in short conversations.
   *
   * Uses the same seenHashes dedup as maybeFlush so we never process the same pair twice.
   */
  async afterTurn(conversationId: string, provider: Provider): Promise<void> {
    if (!this.ltm) return;

    try {
      const messagesResult = await this.store.loadMessages(conversationId, 10);
      if (!messagesResult.ok) return;

      const messages = messagesResult.value;

      // Need at least a user + assistant pair
      const userAssistant = messages.filter(
        (m) => m.role === "user" || m.role === "assistant",
      );
      if (userAssistant.length < 2) return;

      // Only look at the most recent pair
      const recentPair = userAssistant.slice(-2);
      if (!recentPair.some((m) => m.role === "user")) return;

      // Dedup: skip if we already extracted facts from this exact pair
      const hash = await chunkHash(recentPair);
      let state = this.flushState.get(conversationId);
      if (!state) {
        state = { messageCount: 0, seenHashes: new Set() };
        this.flushState.set(conversationId, state);
      }
      if (state.seenHashes.has(hash)) return;

      const facts = await this.extractFlushFacts(recentPair, provider);

      let stored = 0;
      for (const content of facts) {
        if (content.length < 5 || content.length > 300) continue;
        await this.ltm!.remember({
          conversationId,
          content,
          source: "turn-flush",
          // Direct observation → higher confidence than compaction-flush
          confidence: 0.75,
        });
        stored++;
      }

      state.seenHashes.add(hash);

      if (stored > 0) {
        this.logger.info("Turn facts persisted to LTM", {
          conversationId,
          factsStored: stored,
        });
      }
    } catch (err) {
      this.logger.warn("Turn fact extraction failed (non-fatal)", {
        conversationId,
        error: String(err),
      });
    }
  }

  /**
   * Simple token estimator: ~4 characters per token.
   * Good enough for budget checks; upgrade to tiktoken later if needed.
   */
  estimateTokens(messages: Message[]): number {
    let chars = 0;
    for (const msg of messages) {
      chars += msg.role.length + msg.content.length + 10; // overhead for role markers
    }
    return Math.ceil(chars / 4);
  }

  needsCompaction(messages: Message[], budget: TokenBudget): boolean {
    const estimated = this.estimateTokens(messages);
    const threshold = budget.maxTokens * budget.compactionThreshold;
    return estimated > threshold;
  }
}
