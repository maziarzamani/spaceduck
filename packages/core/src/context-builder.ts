// Context builder: assembles messages for LLM, manages token budget, handles compaction

import type { Message, ConversationStore, MemoryStore, ScoredMemory, Provider, Logger, MemoryRecallOptions } from "./types";
import type { Result } from "./types";
import { ok } from "./types";

export interface TokenBudget {
  readonly maxTokens: number;
  readonly systemPromptReserve: number;
  readonly maxTurns: number;
  readonly maxFacts: number;
  readonly maxProcedures: number;
  readonly maxEpisodes: number;
  readonly compactionThreshold: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  maxTokens: 200_000,
  systemPromptReserve: 1000,
  maxTurns: 50,
  maxFacts: 10,
  maxProcedures: 3,
  maxEpisodes: 3,
  compactionThreshold: 0.85,
};

export interface ContextBuildOptions {
  readonly budgetOverrides?: Partial<TokenBudget>;
  readonly memoryRecallOptions?: Partial<MemoryRecallOptions>;
}

export interface ContextWindowManager {
  buildContext(conversationId: string, options?: ContextBuildOptions): Promise<Result<Message[]>>;
  compact(conversationId: string, provider: Provider): Promise<Result<void>>;
  estimateTokens(messages: Message[]): number;
  needsCompaction(messages: Message[], budget: TokenBudget): boolean;
}

/**
 * Prioritize procedures by subtype: constraint > workflow > behavioral.
 * Within a subtype, preserve the recall score ordering (already sorted by RRF).
 */
const PROCEDURE_SUBTYPE_PRIORITY: Record<string, number> = {
  constraint: 0,
  workflow: 1,
  behavioral: 2,
};

export function prioritizeProcedures(
  procedures: ScoredMemory[],
  max: number,
): ScoredMemory[] {
  const sorted = [...procedures].sort((a, b) => {
    const pa = PROCEDURE_SUBTYPE_PRIORITY[a.memory.procedureSubtype ?? "behavioral"] ?? 2;
    const pb = PROCEDURE_SUBTYPE_PRIORITY[b.memory.procedureSubtype ?? "behavioral"] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.score - a.score;
  });
  return sorted.slice(0, max);
}

/**
 * Default context builder that assembles messages from ConversationStore + MemoryStore.
 * Supports compaction when context exceeds token budget.
 *
 * Memories are recalled by kind and injected with kind-aware formatting:
 * facts (up to maxFacts), procedures (up to maxProcedures, prioritized by
 * subtype: constraint > workflow > behavioral), episodes (up to maxEpisodes).
 */
export class DefaultContextBuilder implements ContextWindowManager {
  constructor(
    private readonly store: ConversationStore,
    private readonly logger: Logger,
    private systemPrompt?: string,
    private readonly memoryStore?: MemoryStore,
  ) {}

  setSystemPrompt(prompt: string | undefined): void {
    this.systemPrompt = prompt;
  }

  async buildContext(
    conversationId: string,
    options?: ContextBuildOptions,
  ): Promise<Result<Message[]>> {
    const budget = { ...DEFAULT_TOKEN_BUDGET, ...options?.budgetOverrides };

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

    // Inject recalled memories from MemoryStore
    const lastUserMessage = messages.filter((m) => m.role === "user").at(-1);
    if (lastUserMessage && this.memoryStore) {
      await this.injectMemoryV2(context, lastUserMessage.content, budget, options?.memoryRecallOptions);
    }

    // Add recent conversation messages
    for (const msg of messages) {
      context.push(msg);

      // Inject a system hint after any user message that has attachments
      if (msg.role === "user" && msg.attachments?.length) {
        const hints = msg.attachments.map(
          (a) =>
            `The user attached: ${a.filename} (${a.mimeType}, ${a.size} bytes). To process this PDF, call the marker_scan tool with attachmentId: "${a.id}".`,
        );
        context.push({
          id: `attachment-hint-${msg.id}`,
          role: "system",
          content: hints.join("\n"),
          timestamp: msg.timestamp,
          source: "system",
        });
      }
    }

    return ok(context);
  }

  /**
   * Memory v2: recall typed memories and inject kind-aware system messages.
   * Procedures are capped and prioritized by subtype (constraint > workflow > behavioral).
   */
  private async injectMemoryV2(
    context: Message[],
    query: string,
    budget: TokenBudget,
    recallOverrides?: Partial<MemoryRecallOptions>,
  ): Promise<void> {
    const totalK = budget.maxFacts + budget.maxProcedures + budget.maxEpisodes;
    const result = await this.memoryStore!.recall(query, {
      kinds: ["fact", "procedure", "episode"],
      status: ["active"],
      topK: totalK,
      ...recallOverrides,
    });

    if (!result.ok || result.value.length === 0) return;

    const facts: ScoredMemory[] = [];
    const procedures: ScoredMemory[] = [];
    const episodes: ScoredMemory[] = [];

    for (const sm of result.value) {
      switch (sm.memory.kind) {
        case "fact":
          if (facts.length < budget.maxFacts) facts.push(sm);
          break;
        case "procedure":
          procedures.push(sm);
          break;
        case "episode":
          if (episodes.length < budget.maxEpisodes) episodes.push(sm);
          break;
      }
    }

    const selectedProcedures = prioritizeProcedures(procedures, budget.maxProcedures);

    const blocks: string[] = [];

    if (facts.length > 0) {
      const lines = facts.map((sm) => `- ${sm.memory.content}`);
      blocks.push(`Known facts about the user:\n${lines.join("\n")}`);
    }

    if (selectedProcedures.length > 0) {
      const lines = selectedProcedures.map((sm) => {
        const tag = sm.memory.procedureSubtype
          ? `[${sm.memory.procedureSubtype}] `
          : "";
        return `- ${tag}${sm.memory.content}`;
      });
      blocks.push(
        `Behavioral instructions and constraints (always follow these):\n${lines.join("\n")}`,
      );
    }

    if (episodes.length > 0) {
      const lines = episodes.map((sm) => {
        const when = sm.memory.occurredAt
          ? ` (${new Date(sm.memory.occurredAt).toISOString().slice(0, 10)})`
          : "";
        return `- ${sm.memory.content}${when}`;
      });
      blocks.push(`Relevant past events:\n${lines.join("\n")}`);
    }

    if (blocks.length === 0) return;

    context.push({
      id: `memories-${Date.now()}`,
      role: "system",
      content: `Previously stored user information (may be outdated). If the user's message contradicts a stored memory, assume the new message is correct. Only ask a clarifying question if the correction is ambiguous.\n\n${blocks.join("\n\n")}`,
      timestamp: 0,
      source: "system",
    });
  }

  async compact(conversationId: string, provider: Provider): Promise<Result<void>> {
    const messagesResult = await this.store.loadMessages(conversationId);
    if (!messagesResult.ok) return messagesResult;

    const messages = messagesResult.value;
    if (messages.length < 10) return ok(undefined);

    const cutoff = Math.floor(messages.length * 0.6);
    const toSummarize = messages.slice(0, cutoff);

    this.logger.info("Compacting conversation", {
      conversationId,
      totalMessages: messages.length,
      summarizing: toSummarize.length,
    });

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

  estimateTokens(messages: Message[]): number {
    let chars = 0;
    for (const msg of messages) {
      chars += msg.role.length + msg.content.length + 10;
    }
    return Math.ceil(chars / 4);
  }

  needsCompaction(messages: Message[], budget: TokenBudget): boolean {
    const estimated = this.estimateTokens(messages);
    const threshold = budget.maxTokens * budget.compactionThreshold;
    return estimated > threshold;
  }
}
