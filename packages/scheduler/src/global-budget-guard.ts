// GlobalBudgetGuard: daily/monthly USD limits across all task runs

import type { TaskStore, EventBus, Logger, Task, BudgetSnapshot } from "@spaceduck/core";

export interface GlobalBudgetConfig {
  readonly dailyLimitUsd: number;
  readonly monthlyLimitUsd: number;
  readonly alertThresholds: number[];
  readonly onLimitReached: "pause-all" | "pause-non-critical" | "alert-only";
}

export interface SchedulerControl {
  pause(): void;
  resume(): void;
  readonly isPaused: boolean;
}

export class GlobalBudgetGuard {
  private emittedThresholds = new Set<string>();

  constructor(
    private readonly store: TaskStore,
    private readonly config: GlobalBudgetConfig,
    private readonly eventBus: EventBus,
    private readonly scheduler: SchedulerControl,
    private readonly logger: Logger,
  ) {}

  /**
   * Check global spend limits after a task completes.
   * Returns true if execution should continue, false if paused.
   */
  async checkAndEnforce(task: Task, snapshot: BudgetSnapshot): Promise<boolean> {
    const dayResult = await this.store.sumSpend("day");
    const monthResult = await this.store.sumSpend("month");

    if (!dayResult.ok || !monthResult.ok) {
      this.logger.warn("Failed to query global spend, allowing execution to continue");
      return true;
    }

    const daySpend = dayResult.value;
    const monthSpend = monthResult.value;

    this.checkAlertThresholds(daySpend, "daily", this.config.dailyLimitUsd, task, snapshot);
    this.checkAlertThresholds(monthSpend, "monthly", this.config.monthlyLimitUsd, task, snapshot);

    const dailyExceeded = daySpend >= this.config.dailyLimitUsd;
    const monthlyExceeded = monthSpend >= this.config.monthlyLimitUsd;

    if (dailyExceeded || monthlyExceeded) {
      const limitType = dailyExceeded ? "global_daily" : "global_monthly";

      this.eventBus.emit("task:budget_exceeded", {
        task,
        snapshot,
        limitExceeded: limitType,
      });

      this.logger.warn("Global budget limit reached", {
        limitType,
        daySpend,
        monthSpend,
        dailyLimit: this.config.dailyLimitUsd,
        monthlyLimit: this.config.monthlyLimitUsd,
        action: this.config.onLimitReached,
      });

      if (this.config.onLimitReached === "pause-all" || this.config.onLimitReached === "pause-non-critical") {
        this.scheduler.pause();
        return false;
      }
    }

    return true;
  }

  /** Reset emitted thresholds (call at the start of each new day/month). */
  resetThresholds(): void {
    this.emittedThresholds.clear();
  }

  private checkAlertThresholds(
    spend: number,
    period: string,
    limit: number,
    task: Task,
    snapshot: BudgetSnapshot,
  ): void {
    if (limit <= 0) return;

    const pct = spend / limit;
    for (const threshold of this.config.alertThresholds) {
      const key = `${period}:${threshold}`;
      if (pct >= threshold && !this.emittedThresholds.has(key)) {
        this.emittedThresholds.add(key);
        this.eventBus.emit("task:budget_warning", {
          task,
          snapshot,
          thresholdPct: Math.round(threshold * 100),
        });

        this.logger.info("Global budget threshold reached", {
          period,
          threshold: `${Math.round(threshold * 100)}%`,
          spend: spend.toFixed(4),
          limit: limit.toFixed(2),
        });
      }
    }
  }
}
