import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureCustomSQLite } from "@spaceduck/memory-sqlite";
import { TaskScheduler } from "../scheduler";

ensureCustomSQLite();
import { TaskQueue } from "../queue";
import { SqliteTaskStore } from "../task-store";
import { GlobalBudgetGuard } from "../global-budget-guard";
import type { EventBus, Logger, BudgetSnapshot } from "@spaceduck/core";
import type { RunLock } from "../run-lock";
import type { TaskRunnerFn } from "../runner";

function createLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => createLogger(),
  } as any;
}

function createMockEventBus(): EventBus & {
  emitted: Array<{ event: string; data: any }>;
  handlers: Map<string, Function[]>;
} {
  const emitted: Array<{ event: string; data: any }> = [];
  const handlers = new Map<string, Function[]>();
  return {
    emitted,
    handlers,
    emit(event: string, data: any) {
      emitted.push({ event, data });
      for (const h of handlers.get(event) ?? []) h(data);
    },
    emitAsync: async () => {},
    on(event: string, handler: Function) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    off(event: string, handler: Function) {
      const list = handlers.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    },
  } as any;
}

function createRunLock(): RunLock {
  return {
    async acquire() { return () => {}; },
    isLocked() { return false; },
  };
}

const snapshot: BudgetSnapshot = {
  tokensUsed: 100,
  estimatedCostUsd: 0.01,
  wallClockMs: 200,
  toolCallsMade: 1,
  memoryWritesMade: 0,
};

describe("TaskScheduler", () => {
  let db: Database;
  let store: SqliteTaskStore;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let scheduler: TaskScheduler;
  let queue: TaskQueue;
  let runnerCalls: string[];

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA journal_mode = WAL");
    store = new SqliteTaskStore(db, createLogger());
    await store.migrate();
    eventBus = createMockEventBus();
    runnerCalls = [];

    const runner: TaskRunnerFn = async (task) => {
      runnerCalls.push(task.id);
      return { response: "done", snapshot };
    };

    const globalBudget = new GlobalBudgetGuard(
      store,
      { dailyLimitUsd: 100, monthlyLimitUsd: 1000, alertThresholds: [], onLimitReached: "pause-all" },
      eventBus,
      { pause: () => scheduler?.pause(), resume: () => scheduler?.resume(), get isPaused() { return false; } },
      createLogger(),
    );

    queue = new TaskQueue(
      store, createRunLock(), runner, globalBudget, eventBus, createLogger(),
      { maxConcurrent: 3, maxRetries: 3, backoffBaseMs: 100, backoffMaxMs: 1000 },
    );

    scheduler = new TaskScheduler(
      store, queue, eventBus, createLogger(),
      { heartbeatIntervalMs: 100 },
    );
  });

  afterEach(async () => {
    await scheduler.stop();
  });

  it("starts in stopped state", () => {
    expect(scheduler.status).toBe("stopped");
    expect(scheduler.isPaused).toBe(false);
  });

  it("transitions to running on start", async () => {
    await scheduler.start();
    expect(scheduler.status).toBe("running");
  });

  it("transitions to stopped on stop", async () => {
    await scheduler.start();
    await scheduler.stop();
    expect(scheduler.status).toBe("stopped");
  });

  it("tick picks up due tasks", async () => {
    await store.create({
      definition: { type: "heartbeat", name: "t1", prompt: "check", resultRoute: "silent" },
      schedule: { runImmediately: true, intervalMs: 60_000 },
    });

    await scheduler.tick();
    await new Promise((r) => setTimeout(r, 200));

    expect(runnerCalls.length).toBe(1);
  });

  it("tick ignores tasks not yet due", async () => {
    await store.create({
      definition: { type: "heartbeat", name: "t1", prompt: "check", resultRoute: "silent" },
      schedule: { intervalMs: 600_000 }, // 10 minutes from now
    });

    // Tick with current time — nextRunAt is ~10 min in the future
    const result = await store.listDue(Date.now());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(0);
  });

  it("pause and resume work correctly", async () => {
    await scheduler.start();

    scheduler.pause();
    expect(scheduler.isPaused).toBe(true);

    scheduler.resume();
    expect(scheduler.isPaused).toBe(false);
  });

  it("tick is a no-op when paused", async () => {
    // Pause the scheduler before creating any tasks
    await scheduler.start();
    scheduler.pause();
    runnerCalls = [];

    // Now create a task that would be immediately due
    await store.create({
      definition: { type: "heartbeat", name: "t1", prompt: "check", resultRoute: "silent" },
      schedule: { runImmediately: true, intervalMs: 60_000 },
    });

    await scheduler.tick();
    await new Promise((r) => setTimeout(r, 100));

    expect(runnerCalls.length).toBe(0);
  });

  it("periodic tick executes tasks over time", async () => {
    await store.create({
      definition: { type: "heartbeat", name: "periodic", prompt: "check", resultRoute: "silent" },
      schedule: { runImmediately: true, intervalMs: 50 },
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 500));
    await scheduler.stop();

    expect(runnerCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("updateConfig changes heartbeat interval", async () => {
    await scheduler.start();
    scheduler.updateConfig({ heartbeatIntervalMs: 200 });
    // Should not throw, scheduler keeps running
    expect(scheduler.status).toBe("running");
  });

  it("start is idempotent", async () => {
    await scheduler.start();
    await scheduler.start();
    expect(scheduler.status).toBe("running");
  });

  it("stop is idempotent", async () => {
    await scheduler.stop();
    expect(scheduler.status).toBe("stopped");
  });
});
