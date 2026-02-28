// TaskScheduler: heartbeat timer, cron evaluator, event-driven triggers

import type {
  Lifecycle, LifecycleStatus, TaskStore, EventBus, Logger, Task,
} from "@spaceduck/core";
import type { TaskQueue } from "./queue";
import type { SchedulerControl } from "./global-budget-guard";
import { nextRun } from "./cron";

export interface TaskSchedulerConfig {
  readonly heartbeatIntervalMs: number;
}

export class TaskScheduler implements Lifecycle, SchedulerControl {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _status: LifecycleStatus = "stopped";
  private _isPaused = false;
  private eventHandlers: Array<{ event: string; handler: (...args: any[]) => void }> = [];

  constructor(
    private readonly store: TaskStore,
    private readonly queue: TaskQueue,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private config: TaskSchedulerConfig,
  ) {}

  get status(): LifecycleStatus {
    return this._status;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  async start(): Promise<void> {
    if (this._status === "running") return;
    this._status = "starting";

    this.timer = setInterval(() => {
      this.tick().catch((e) =>
        this.logger.error("Scheduler tick error", { error: String(e) }),
      );
    }, this.config.heartbeatIntervalMs);

    await this.registerEventTriggers();

    this._status = "running";
    this._isPaused = false;
    this.logger.info("Scheduler started", { intervalMs: this.config.heartbeatIntervalMs });

    // Run an initial tick immediately
    this.tick().catch((e) =>
      this.logger.error("Initial tick error", { error: String(e) }),
    );
  }

  async stop(): Promise<void> {
    if (this._status === "stopped") return;
    this._status = "stopping";

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    for (const { event, handler } of this.eventHandlers) {
      this.eventBus.off(event as any, handler);
    }
    this.eventHandlers = [];

    this._status = "stopped";
    this.logger.info("Scheduler stopped");
  }

  pause(): void {
    if (this._isPaused) return;
    this._isPaused = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.warn("Scheduler paused (global budget limit)");
  }

  resume(): void {
    if (!this._isPaused) return;
    this._isPaused = false;

    if (this._status === "running") {
      this.timer = setInterval(() => {
        this.tick().catch((e) =>
          this.logger.error("Scheduler tick error", { error: String(e) }),
        );
      }, this.config.heartbeatIntervalMs);
    }

    this.logger.info("Scheduler resumed");
  }

  updateConfig(config: Partial<TaskSchedulerConfig>): void {
    if (config.heartbeatIntervalMs && config.heartbeatIntervalMs !== this.config.heartbeatIntervalMs) {
      this.config = { ...this.config, ...config };
      if (this._status === "running" && !this._isPaused) {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
          this.tick().catch((e) =>
            this.logger.error("Scheduler tick error", { error: String(e) }),
          );
        }, this.config.heartbeatIntervalMs);
      }
      this.logger.info("Scheduler interval updated", { intervalMs: this.config.heartbeatIntervalMs });
    }
  }

  async tick(): Promise<void> {
    if (this._isPaused) return;

    const now = Date.now();
    const result = await this.store.listDue(now);
    if (!result.ok) {
      this.logger.error("Failed to list due tasks", { error: String(result.error) });
      return;
    }

    const dueTasks = result.value;
    if (dueTasks.length === 0) return;

    this.logger.debug("Tick found due tasks", { count: dueTasks.length });

    for (const task of dueTasks) {
      await this.queue.enqueue(task);
    }

    await this.queue.drain();
  }

  private async registerEventTriggers(): Promise<void> {
    const scheduledResult = await this.store.listByStatus("scheduled", 1000);
    if (!scheduledResult.ok) return;

    const eventTasks = scheduledResult.value.filter((t) => t.schedule.eventTrigger);
    const uniqueEvents = new Set(eventTasks.map((t) => t.schedule.eventTrigger!));

    for (const eventName of uniqueEvents) {
      const handler = () => {
        this.handleEventTrigger(eventName).catch((e) =>
          this.logger.error("Event trigger error", { event: eventName, error: String(e) }),
        );
      };

      this.eventBus.on(eventName as any, handler);
      this.eventHandlers.push({ event: eventName, handler });
    }

    if (uniqueEvents.size > 0) {
      this.logger.info("Registered event triggers", { events: [...uniqueEvents] });
    }
  }

  private async handleEventTrigger(eventName: string): Promise<void> {
    if (this._isPaused) return;

    const scheduledResult = await this.store.listByStatus("scheduled", 1000);
    if (!scheduledResult.ok) return;

    const matching = scheduledResult.value.filter(
      (t) => t.schedule.eventTrigger === eventName,
    );

    for (const task of matching) {
      await this.store.update(task.id, { nextRunAt: Date.now() });
      await this.queue.enqueue(task);
    }

    if (matching.length > 0) {
      await this.queue.drain();
    }
  }
}
