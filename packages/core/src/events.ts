// EventBus: typed pub/sub for cross-cutting concerns

import type { Message, Conversation, Fact, Logger, ToolCall, ToolResult, Task, BudgetSnapshot } from "./types";
import type { SpaceduckError } from "./types";

export interface SpaceduckEvents {
  "message:received": { conversationId: string; message: Message };
  "message:response": { conversationId: string; message: Message; durationMs: number };
  "conversation:created": { conversation: Conversation };
  "conversation:deleted": { conversationId: string };
  "session:compacted": { conversationId: string; summarizedTurns: number };
  "fact:extracted": { fact: Fact };
  "tool:calling": { conversationId: string; toolCall: ToolCall };
  "tool:result": { conversationId: string; toolResult: ToolResult; durationMs: number };
  "task:scheduled": { task: Task };
  "task:started": { task: Task };
  "task:completed": { task: Task; snapshot: BudgetSnapshot };
  "task:failed": { task: Task; error: string; retryCount: number };
  "task:dead_letter": { task: Task; error: string };
  "task:budget_warning": { task: Task; snapshot: BudgetSnapshot; thresholdPct: number };
  "task:budget_exceeded": { task: Task; snapshot: BudgetSnapshot; limitExceeded: string };
  "error": { error: SpaceduckError; context: string };
}

export interface EventBus {
  /** Fire-and-forget emit. Listener errors are caught and logged, never block the caller. */
  emit<K extends keyof SpaceduckEvents>(event: K, data: SpaceduckEvents[K]): void;
  /** Async emit. Awaits all listeners and collects errors. */
  emitAsync<K extends keyof SpaceduckEvents>(event: K, data: SpaceduckEvents[K]): Promise<void>;
  on<K extends keyof SpaceduckEvents>(event: K, handler: (data: SpaceduckEvents[K]) => void | Promise<void>): void;
  off<K extends keyof SpaceduckEvents>(event: K, handler: (data: SpaceduckEvents[K]) => void | Promise<void>): void;
}

type Handler = (data: unknown) => void | Promise<void>;

export class SimpleEventBus implements EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: "EventBus" });
  }

  emit<K extends keyof SpaceduckEvents>(event: K, data: SpaceduckEvents[K]): void {
    const handlers = this.handlers.get(event as string);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        const result = handler(data);
        // If handler returns a promise, catch async errors silently
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            this.logger.error("Async listener error (fire-and-forget)", {
              event: event as string,
              error: String(err),
            });
          });
        }
      } catch (err) {
        this.logger.error("Sync listener error", {
          event: event as string,
          error: String(err),
        });
      }
    }
  }

  async emitAsync<K extends keyof SpaceduckEvents>(event: K, data: SpaceduckEvents[K]): Promise<void> {
    const handlers = this.handlers.get(event as string);
    if (!handlers) return;

    const errors: unknown[] = [];
    const promises: Promise<void>[] = [];

    for (const handler of handlers) {
      try {
        const result = handler(data);
        if (result && typeof (result as Promise<void>).then === "function") {
          promises.push(
            (result as Promise<void>).catch((err) => {
              errors.push(err);
            }),
          );
        }
      } catch (err) {
        errors.push(err);
      }
    }

    await Promise.all(promises);

    if (errors.length > 0) {
      this.logger.error("emitAsync listener errors", {
        event: event as string,
        errorCount: errors.length,
        errors: errors.map(String),
      });
    }
  }

  on<K extends keyof SpaceduckEvents>(event: K, handler: (data: SpaceduckEvents[K]) => void | Promise<void>): void {
    const key = event as string;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler as Handler);
  }

  off<K extends keyof SpaceduckEvents>(event: K, handler: (data: SpaceduckEvents[K]) => void | Promise<void>): void {
    const handlers = this.handlers.get(event as string);
    if (handlers) {
      handlers.delete(handler as Handler);
    }
  }
}
