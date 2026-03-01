// TaskQueue: concurrent execution with session lanes, priority, retry, dead letter

import type {
  TaskStore, Task, BudgetSnapshot, EventBus, Logger,
} from "@spaceduck/core";
import type { RunLock } from "./run-lock";
import type { TaskRunnerFn } from "./runner";
import type { GlobalBudgetGuard } from "./global-budget-guard";

export interface TaskQueueConfig {
  readonly maxConcurrent: number;
  readonly maxRetries: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
}

export interface TaskRunResult {
  readonly response: string;
  readonly snapshot: BudgetSnapshot;
}

export class TaskQueue {
  private active = 0;
  private draining = false;

  constructor(
    private readonly store: TaskStore,
    private readonly runLock: RunLock,
    private readonly runner: TaskRunnerFn,
    private readonly globalBudget: GlobalBudgetGuard,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly config: TaskQueueConfig,
  ) {}

  get activeCount(): number {
    return this.active;
  }

  async enqueue(task: Task): Promise<void> {
    this.eventBus.emit("task:scheduled", { task });
    this.drain().catch((e) =>
      this.logger.error("Drain error", { error: String(e) }),
    );
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.active < this.config.maxConcurrent) {
        const result = await this.store.claim(Date.now());
        if (!result.ok || !result.value) break;

        const task = result.value;
        this.active++;

        this.execute(task)
          .catch((e) => this.logger.error("Unexpected execute error", { taskId: task.id, error: String(e) }))
          .finally(() => {
            this.active--;
            this.drain().catch(() => {});
          });
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(task: Task): Promise<void> {
    const convId = task.definition.conversationId;
    let release: (() => void) | undefined;

    try {
      if (convId) {
        release = await this.runLock.acquire(convId);
      }

      this.eventBus.emit("task:started", { task });

      const result = await this.runner(task);

      await this.store.complete(task.id, result.snapshot, result.response);

      const updatedResult = await this.store.get(task.id);
      const updatedTask = updatedResult.ok && updatedResult.value ? updatedResult.value : task;

      this.eventBus.emit("task:completed", { task: updatedTask, snapshot: result.snapshot });

      await this.globalBudget.checkAndEnforce(updatedTask, result.snapshot);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const emptySnapshot: BudgetSnapshot = {
        tokensUsed: 0, estimatedCostUsd: 0, wallClockMs: 0, toolCallsMade: 0, memoryWritesMade: 0,
      };

      const isBudgetExceeded = errorMsg.includes("Budget exceeded");

      const maxRetries = task.maxRetries ?? this.config.maxRetries;
      if (task.retryCount + 1 >= maxRetries || isBudgetExceeded) {
        await this.store.deadLetter(task.id, errorMsg, emptySnapshot);

        this.eventBus.emit("task:dead_letter", { task, error: errorMsg });

        this.logger.warn("Task moved to dead letter queue", {
          taskId: task.id, error: errorMsg, retryCount: task.retryCount,
        });
      } else {
        await this.store.fail(task.id, errorMsg, emptySnapshot);

        this.eventBus.emit("task:failed", {
          task, error: errorMsg, retryCount: task.retryCount + 1,
        });

        const backoffMs = Math.min(
          this.config.backoffBaseMs * Math.pow(2, task.retryCount),
          this.config.backoffMaxMs,
        );
        const retryAt = Date.now() + backoffMs;

        await this.store.update(task.id, {
          status: "scheduled",
          nextRunAt: retryAt,
        });

        this.logger.info("Task scheduled for retry", {
          taskId: task.id, retryCount: task.retryCount + 1, retryAt,
          backoffMs,
        });
      }
    } finally {
      release?.();
    }
  }
}
