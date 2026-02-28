// AgentLoop: orchestrator with agentic tool-calling cycle
//
// Flow: user message → build context → call provider → if tool_calls,
//   execute tools → append results → call provider again → repeat
//   until the LLM returns pure text (or maxToolRounds is hit).

import type {
  Message,
  Provider,
  ConversationStore,
  Logger,
  SessionManager,
  ToolCall,
  ToolResult,
  ToolDefinition,
} from "./types";
import type { ContextWindowManager } from "./context-builder";
import { DEFAULT_TOKEN_BUDGET } from "./context-builder";
import type { EventBus } from "./events";
import type { Middleware, MessageContext } from "./middleware";
import { composeMiddleware } from "./middleware";
import type { ToolRegistry } from "./tool-registry";
import type { MemoryExtractor } from "./memory-extractor";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface AgentDeps {
  readonly provider: Provider;
  readonly conversationStore: ConversationStore;
  readonly contextBuilder: ContextWindowManager;
  readonly sessionManager: SessionManager;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly memoryExtractor?: MemoryExtractor;
  readonly middleware?: Middleware[];
  readonly toolRegistry?: ToolRegistry;
  readonly maxToolRounds?: number;
}

export interface AgentRunResult {
  readonly messageId: string;
  readonly conversationId: string;
  readonly content: string;
  readonly durationMs: number;
  readonly toolCallsCount: number;
}

/**
 * Chunks yielded by AgentLoop.run().
 * The caller (WS handler) can route these to different protocol envelopes.
 */
export type AgentChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult }
  | { type: "usage"; usage: import("./types/provider").ProviderUsage };

const DEFAULT_MAX_TOOL_ROUNDS = 30;
const MAX_CONSECUTIVE_SAME_TOOL = 3;

/**
 * The agent loop: receives a user message, builds context, calls the provider,
 * streams the response, executes tool calls, and repeats until done.
 */
export class AgentLoop {
  private readonly pipeline: Middleware | null;
  private readonly logger: Logger;
  private readonly maxToolRounds: number;
  private _toolRegistry?: ToolRegistry;

  constructor(private readonly deps: AgentDeps) {
    this.logger = deps.logger.child({ component: "AgentLoop" });
    this.pipeline =
      deps.middleware && deps.middleware.length > 0
        ? composeMiddleware(deps.middleware)
        : null;
    this.maxToolRounds = deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this._toolRegistry = deps.toolRegistry;
  }

  get toolRegistry(): ToolRegistry | undefined {
    return this._toolRegistry;
  }

  setToolRegistry(next?: ToolRegistry): void {
    this._toolRegistry = next;
  }

  /**
   * Run the agent for a single user message.
   * Yields AgentChunks: text deltas, tool calls, and tool results.
   */
  async *run(
    conversationId: string,
    userMessage: Message,
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<AgentChunk> {
    const startTime = Date.now();
    const responseId = generateId();

    // Persist user message
    const appendResult = await this.deps.conversationStore.appendMessage(
      conversationId,
      userMessage,
    );
    if (!appendResult.ok) {
      this.logger.error("Failed to persist user message", {
        conversationId,
        error: appendResult.error.message,
      });
      throw appendResult.error;
    }

    this.deps.eventBus.emit("message:received", {
      conversationId,
      message: userMessage,
    });

    // Get tool definitions if a registry is available
    const toolDefs = this._toolRegistry?.getDefinitions() ?? [];
    let totalToolCalls = 0;
    let consecutiveSameTool = 0;
    let lastToolName = "";

    // ── Agentic loop: call provider, execute tools, repeat ──
    for (let round = 0; round <= this.maxToolRounds; round++) {
      if (options?.signal?.aborted) return;

      // Build context (re-read each round since tool messages get appended)
      const contextResult = await this.deps.contextBuilder.buildContext(conversationId);
      if (!contextResult.ok) {
        this.logger.error("Failed to build context", {
          conversationId,
          error: contextResult.error.message,
        });
        throw contextResult.error;
      }

      // Stream from provider
      let textContent = "";
      const pendingToolCalls: ToolCall[] = [];
      let status: "completed" | "failed_partial" | "failed_empty" = "failed_empty";

      // Always send tool definitions on every round. The model signals
      // completion via stop_reason/finish_reason, and maxToolRounds acts
      // as the safety cap against infinite loops.
      const roundTools = toolDefs.length > 0 ? toolDefs : undefined;

      try {
        for await (const chunk of this.deps.provider.chat(contextResult.value, {
          signal: options?.signal,
          tools: roundTools,
        })) {
          if (chunk.type === "text") {
            textContent += chunk.text;
            status = "failed_partial";
            yield { type: "text", text: chunk.text };
          } else if (chunk.type === "tool_call") {
            pendingToolCalls.push(chunk.toolCall);
          } else if (chunk.type === "usage") {
            yield { type: "usage", usage: chunk.usage };
          }
        }
        status = pendingToolCalls.length > 0 || textContent.length > 0 ? "completed" : status;
      } catch (err) {
        this.logger.error("Provider stream error", {
          conversationId,
          responseId,
          round,
          status,
          error: String(err),
        });
        if (status === "failed_empty" && textContent.length === 0) {
          throw err;
        }
      }

      // ── No tool calls → final text response ──
      if (pendingToolCalls.length === 0) {
        const assistantMessage: Message = {
          id: `${responseId}-r${round}`,
          role: "assistant",
          content: textContent,
          timestamp: Date.now(),
          status,
          source: "assistant",
        };

        await this.deps.conversationStore.appendMessage(conversationId, assistantMessage);

        this.deps.eventBus.emit("message:response", {
          conversationId,
          message: assistantMessage,
          durationMs: Date.now() - startTime,
        });

        // Background: compaction check
        this.maybeCompact(conversationId).catch((e) =>
          this.logger.error("Background compaction failed", {
            conversationId,
            error: String(e),
          }),
        );

        return; // Done
      }

      // ── Tool calls present → persist assistant message with calls, execute, loop ──
      const assistantWithCalls: Message = {
        id: `${responseId}-r${round}`,
        role: "assistant",
        content: textContent,
        timestamp: Date.now(),
        status: "completed",
        source: "assistant",
        toolCalls: pendingToolCalls,
      };

      await this.deps.conversationStore.appendMessage(conversationId, assistantWithCalls);

      // Execute each tool call
      for (const tc of pendingToolCalls) {
        if (options?.signal?.aborted) return;

        if (tc.name === lastToolName) {
          consecutiveSameTool++;
        } else {
          consecutiveSameTool = 1;
          lastToolName = tc.name;
        }

        // Circuit breaker: prevent degenerate loops calling the same tool repeatedly
        if (consecutiveSameTool > MAX_CONSECUTIVE_SAME_TOOL) {
          const loopResult: ToolResult = {
            toolCallId: tc.id,
            name: tc.name,
            content:
              `Error: "${tc.name}" has been called ${consecutiveSameTool} times in a row with no progress. ` +
              `You MUST try a different approach — use browser_snapshot to check page state, ` +
              `browser_navigate to go to a different URL, or respond with a text answer.`,
            isError: true,
          };
          this.logger.warn("Consecutive tool loop detected, injecting error", {
            conversationId,
            tool: tc.name,
            consecutiveSameTool,
            round,
          });
          yield { type: "tool_result", toolResult: loopResult };
          const loopMsg: Message = {
            id: generateId(),
            role: "tool",
            content: loopResult.content,
            timestamp: Date.now(),
            source: "tool",
            toolCallId: tc.id,
            toolName: tc.name,
          };
          await this.deps.conversationStore.appendMessage(conversationId, loopMsg);
          totalToolCalls++;
          continue;
        }

        this.logger.info("Executing tool", {
          conversationId,
          tool: tc.name,
          toolCallId: tc.id,
          round,
          args: tc.args,
        });

        yield { type: "tool_call", toolCall: tc };

        this.deps.eventBus.emit("tool:calling", {
          conversationId,
          toolCall: tc,
        });

        const toolStart = Date.now();
        let result: ToolResult;

        if (this._toolRegistry) {
          result = await this._toolRegistry.execute(tc);
        } else {
          result = {
            toolCallId: tc.id,
            name: tc.name,
            content: `Error: No tool registry configured. Cannot execute "${tc.name}".`,
            isError: true,
          };
        }

        totalToolCalls++;

        this.deps.eventBus.emit("tool:result", {
          conversationId,
          toolResult: result,
          durationMs: Date.now() - toolStart,
        });

        this.logger.debug("Tool result", {
          conversationId,
          tool: tc.name,
          toolCallId: tc.id,
          isError: result.isError,
          contentLength: result.content.length,
          contentPreview: result.content.slice(0, 200),
        });

        yield { type: "tool_result", toolResult: result };

        const toolMessage: Message = {
          id: generateId(),
          role: "tool",
          content: result.content,
          timestamp: Date.now(),
          source: "tool",
          toolCallId: tc.id,
          toolName: tc.name,
        };

        await this.deps.conversationStore.appendMessage(conversationId, toolMessage);
      }

      // Loop continues: next round will re-read context (now includes tool results)
      this.logger.debug("Tool round complete, continuing", {
        conversationId,
        round,
        toolCalls: pendingToolCalls.length,
        totalToolCalls,
      });
    }

    // If we exhaust maxToolRounds, yield a warning and stop
    this.logger.warn("Max tool rounds reached", {
      conversationId,
      maxToolRounds: this.maxToolRounds,
      totalToolCalls,
    });

    const bailoutText = `\n\n[Reached maximum tool call rounds (${this.maxToolRounds}). Stopping.]`;
    yield { type: "text", text: bailoutText };

    const bailoutMessage: Message = {
      id: `${responseId}-bailout`,
      role: "assistant",
      content: bailoutText,
      timestamp: Date.now(),
      status: "completed",
      source: "assistant",
    };

    await this.deps.conversationStore.appendMessage(conversationId, bailoutMessage);
  }

  private async maybeCompact(conversationId: string): Promise<void> {
    const contextResult = await this.deps.contextBuilder.buildContext(conversationId);
    if (!contextResult.ok) return;

    const budget = { ...DEFAULT_TOKEN_BUDGET };
    if (!this.deps.contextBuilder.needsCompaction(contextResult.value, budget)) return;

    this.logger.info("Auto-compacting conversation", { conversationId });
    await this.deps.contextBuilder.compact(conversationId, this.deps.provider);
  }
}
