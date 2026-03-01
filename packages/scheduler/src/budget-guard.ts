// BudgetGuard: per-task budget enforcement via provider counting proxy

import type { TaskBudget, BudgetSnapshot, Task, EventBus, ProviderUsage } from "@spaceduck/core";

const CHARS_PER_TOKEN = 3;

export class BudgetGuard {
  private _snapshot: BudgetSnapshot = {
    tokensUsed: 0,
    estimatedCostUsd: 0,
    wallClockMs: 0,
    toolCallsMade: 0,
  };

  private readonly abortController: AbortController;
  private readonly startTime: number;
  private wallClockTimer: ReturnType<typeof setTimeout> | null = null;
  private warningEmitted = false;

  constructor(
    private readonly budget: Required<TaskBudget>,
    private readonly eventBus: EventBus,
    private readonly task: Task,
  ) {
    this.abortController = new AbortController();
    this.startTime = Date.now();

    if (budget.maxWallClockMs > 0) {
      this.wallClockTimer = setTimeout(
        () => this.abort("wall_clock"),
        budget.maxWallClockMs,
      );
    }
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get snapshot(): BudgetSnapshot {
    return {
      ...this._snapshot,
      wallClockMs: Date.now() - this.startTime,
    };
  }

  get isExceeded(): boolean {
    return this.abortController.signal.aborted;
  }

  /**
   * Track tokens from a provider chunk. Uses character count / 3 as a
   * conservative estimate. Call with exact counts when the provider
   * returns usage metadata.
   */
  trackChars(charCount: number): void {
    const tokens = Math.ceil(charCount / CHARS_PER_TOKEN);
    this._snapshot = {
      ...this._snapshot,
      tokensUsed: this._snapshot.tokensUsed + tokens,
    };
    this.checkThresholds();
  }

  trackExactTokens(tokens: number): void {
    this._snapshot = {
      ...this._snapshot,
      tokensUsed: this._snapshot.tokensUsed + tokens,
    };
    this.checkThresholds();
  }

  /**
   * Replace the char-estimated token count with exact provider-reported usage.
   * Call once when the provider yields a usage chunk at end of response.
   */
  replaceWithExactUsage(usage: ProviderUsage, estimatedCostUsd?: number): void {
    this._snapshot = {
      ...this._snapshot,
      tokensUsed: usage.inputTokens + usage.outputTokens,
      estimatedCostUsd: estimatedCostUsd ?? this._snapshot.estimatedCostUsd,
    };
    this.checkThresholds();
  }

  trackToolCall(): void {
    this._snapshot = {
      ...this._snapshot,
      toolCallsMade: this._snapshot.toolCallsMade + 1,
    };

    if (this._snapshot.toolCallsMade >= this.budget.maxToolCalls) {
      this.abort("tool_calls");
    }
  }

  trackCost(costUsd: number): void {
    this._snapshot = {
      ...this._snapshot,
      estimatedCostUsd: this._snapshot.estimatedCostUsd + costUsd,
    };
    this.checkThresholds();
  }

  dispose(): void {
    if (this.wallClockTimer) {
      clearTimeout(this.wallClockTimer);
      this.wallClockTimer = null;
    }
  }

  private checkThresholds(): void {
    if (this.abortController.signal.aborted) return;

    const snap = this.snapshot;

    const tokenPct = this.budget.maxTokens > 0 ? snap.tokensUsed / this.budget.maxTokens : 0;
    const costPct = this.budget.maxCostUsd > 0 ? snap.estimatedCostUsd / this.budget.maxCostUsd : 0;
    const maxPct = Math.max(tokenPct, costPct);

    if (maxPct >= 0.8 && !this.warningEmitted) {
      this.warningEmitted = true;
      this.eventBus.emit("task:budget_warning", {
        task: this.task,
        snapshot: snap,
        thresholdPct: Math.round(maxPct * 100),
      });
    }

    if (tokenPct >= 1) return this.abort("tokens");
    if (costPct >= 1) return this.abort("cost");
  }

  private abort(reason: string): void {
    if (this.abortController.signal.aborted) return;

    this.dispose();
    const snap = this.snapshot;

    this.eventBus.emit("task:budget_exceeded", {
      task: this.task,
      snapshot: snap,
      limitExceeded: reason,
    });

    this.abortController.abort(new Error(`Budget exceeded: ${reason}`));
  }
}
