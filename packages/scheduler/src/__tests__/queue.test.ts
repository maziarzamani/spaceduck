import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureCustomSQLite } from "@spaceduck/memory-sqlite";
import { TaskQueue } from "../queue";

ensureCustomSQLite();
import { SqliteTaskStore } from "../task-store";
import { GlobalBudgetGuard } from "../global-budget-guard";
import type {
  Task, TaskInput, BudgetSnapshot, EventBus, Logger,
} from "@spaceduck/core";
import type { RunLock } from "../run-lock";
import type { TaskRunnerFn } from "../runner";
import type { TaskRunResult } from "../queue";

function createLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => createLogger(),
  } as any;
}

function createMockEventBus(): EventBus & { emitted: Array<{ event: string; data: any }> } {
  const emitted: Array<{ event: string; data: any }> = [];
  return {
    emitted,
    emit(event: string, data: any) { emitted.push({ event, data }); },
    emitAsync: async () => {},
    on: () => {},
    off: () => {},
  } as any;
}

function createRunLock(): RunLock & { lockedConvs: Set<string> } {
  const lockedConvs = new Set<string>();
  return {
    lockedConvs,
    async acquire(convId: string) {
      lockedConvs.add(convId);
      return () => { lockedConvs.delete(convId); };
    },
    isLocked(convId: string) { return lockedConvs.has(convId); },
  };
}

const snapshot: BudgetSnapshot = {
  tokensUsed: 100,
  estimatedCostUsd: 0.01,
  wallClockMs: 500,
  toolCallsMade: 1,
  memoryWritesMade: 0,
};

function createInput(name?: string): TaskInput {
  return {
    definition: {
      type: "heartbeat",
      name: name ?? "Test",
      prompt: "Check",
      resultRoute: "silent",
    },
    schedule: { runImmediately: true, intervalMs: 60_000 },
  };
}

describe("TaskQueue", () => {
  let db: Database;
  let store: SqliteTaskStore;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let runLock: ReturnType<typeof createRunLock>;
  let runnerCalls: Task[];

  function createQueue(
    runner?: TaskRunnerFn,
    opts?: { maxConcurrent?: number },
  ) {
    const actualRunner: TaskRunnerFn = runner ?? (async (task) => {
      runnerCalls.push(task);
      return { response: "OK", snapshot };
    });

    const globalBudget = new GlobalBudgetGuard(
      store,
      { dailyLimitUsd: 100, monthlyLimitUsd: 1000, alertThresholds: [], onLimitReached: "pause-all" },
      eventBus,
      { pause: () => {}, resume: () => {}, get isPaused() { return false; } },
      createLogger(),
    );

    return new TaskQueue(
      store,
      runLock,
      actualRunner,
      globalBudget,
      eventBus,
      createLogger(),
      {
        maxConcurrent: opts?.maxConcurrent ?? 3,
        maxRetries: 3,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
      },
    );
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA journal_mode = WAL");
    store = new SqliteTaskStore(db, createLogger());
    await store.migrate();
    eventBus = createMockEventBus();
    runLock = createRunLock();
    runnerCalls = [];
  });

  it("drains and executes due tasks", async () => {
    const created = await store.create(createInput());
    if (!created.ok) throw new Error("Create failed");

    const queue = createQueue();
    await queue.drain();

    // Wait for async execution
    await new Promise((r) => setTimeout(r, 100));

    expect(runnerCalls.length).toBe(1);
    expect(runnerCalls[0].definition.name).toBe("Test");
  });

  it("emits task:scheduled on enqueue", async () => {
    const created = await store.create(createInput());
    if (!created.ok) throw new Error("Create failed");

    const queue = createQueue();
    await queue.enqueue(created.value);

    const scheduled = eventBus.emitted.filter((e) => e.event === "task:scheduled");
    expect(scheduled.length).toBe(1);
  });

  it("emits task:started and task:completed on success", async () => {
    const created = await store.create(createInput());
    if (!created.ok) throw new Error("Create failed");

    const queue = createQueue();
    await queue.drain();
    await new Promise((r) => setTimeout(r, 100));

    const started = eventBus.emitted.filter((e) => e.event === "task:started");
    const completed = eventBus.emitted.filter((e) => e.event === "task:completed");
    expect(started.length).toBe(1);
    expect(completed.length).toBe(1);
  });

  it("handles runner failure and schedules retry", async () => {
    const created = await store.create(createInput());
    if (!created.ok) throw new Error("Create failed");

    const failingRunner: TaskRunnerFn = async () => {
      throw new Error("Provider timeout");
    };

    const queue = createQueue(failingRunner);
    await queue.drain();
    await new Promise((r) => setTimeout(r, 100));

    const failed = eventBus.emitted.filter((e) => e.event === "task:failed");
    expect(failed.length).toBe(1);
    expect(failed[0].data.error).toContain("Provider timeout");

    const task = await store.get(created.value.id);
    if (!task.ok || !task.value) throw new Error("Get failed");
    expect(task.value.status).toBe("scheduled");
  });

  it("moves to dead letter after max retries", async () => {
    const created = await store.create({
      definition: {
        type: "heartbeat",
        name: "Test",
        prompt: "Check",
        resultRoute: "silent",
      },
      schedule: { runImmediately: true, intervalMs: 60_000 },
      maxRetries: 1,
    });
    if (!created.ok) throw new Error("Create failed");

    // Set retry count so next failure exceeds maxRetries
    await store.update(created.value.id, { retryCount: 1, status: "scheduled", nextRunAt: Date.now() });

    const failingRunner: TaskRunnerFn = async () => {
      throw new Error("Persistent failure");
    };

    const queue = createQueue(failingRunner);
    await queue.drain();
    await new Promise((r) => setTimeout(r, 200));

    const deadLettered = eventBus.emitted.filter((e) => e.event === "task:dead_letter");
    expect(deadLettered.length).toBe(1);
  });

  it("dead-letters budget exceeded errors immediately", async () => {
    const created = await store.create(createInput());
    if (!created.ok) throw new Error("Create failed");

    const budgetRunner: TaskRunnerFn = async () => {
      throw new Error("Budget exceeded: tokens");
    };

    const queue = createQueue(budgetRunner);
    await queue.drain();
    await new Promise((r) => setTimeout(r, 100));

    const deadLettered = eventBus.emitted.filter((e) => e.event === "task:dead_letter");
    expect(deadLettered.length).toBe(1);
  });

  it("respects maxConcurrent limit", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const slowRunner: TaskRunnerFn = async (task) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 50));
      concurrentCount--;
      return { response: "OK", snapshot };
    };

    for (let i = 0; i < 5; i++) {
      await store.create(createInput(`task-${i}`));
    }

    const queue = createQueue(slowRunner, { maxConcurrent: 2 });
    await queue.drain();
    await new Promise((r) => setTimeout(r, 500));

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("acquires and releases run lock for conversation-scoped tasks", async () => {
    const created = await store.create({
      definition: {
        type: "scheduled",
        name: "Conv Task",
        prompt: "Check",
        resultRoute: "silent",
        conversationId: "conv-123",
      },
      schedule: { runImmediately: true, intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");

    let lockHeld = false;
    const lockCheckRunner: TaskRunnerFn = async (task) => {
      lockHeld = runLock.isLocked("conv-123");
      return { response: "OK", snapshot };
    };

    const queue = createQueue(lockCheckRunner);
    await queue.drain();
    await new Promise((r) => setTimeout(r, 100));

    expect(lockHeld).toBe(true);
    expect(runLock.isLocked("conv-123")).toBe(false); // Released after execution
  });
});
