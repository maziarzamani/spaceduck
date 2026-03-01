import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureCustomSQLite } from "@spaceduck/memory-sqlite";
import { GlobalBudgetGuard } from "../global-budget-guard";

ensureCustomSQLite();
import { SqliteTaskStore } from "../task-store";
import type { Task, BudgetSnapshot, EventBus, Logger } from "@spaceduck/core";

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

function createMockTask(): Task {
  return {
    id: "test-task-1",
    definition: {
      type: "heartbeat",
      name: "Test",
      prompt: "test",
      resultRoute: "silent",
    },
    schedule: {},
    budget: {},
    status: "completed",
    priority: 5,
    nextRunAt: null,
    lastRunAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const snapshot: BudgetSnapshot = {
  tokensUsed: 500,
  estimatedCostUsd: 0.05,
  wallClockMs: 1000,
  toolCallsMade: 1,
  memoryWritesMade: 0,
};

describe("GlobalBudgetGuard", () => {
  let db: Database;
  let store: SqliteTaskStore;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let paused: boolean;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA journal_mode = WAL");
    store = new SqliteTaskStore(db, createLogger());
    await store.migrate();
    eventBus = createMockEventBus();
    paused = false;
  });

  function createGuard(overrides?: {
    dailyLimitUsd?: number;
    monthlyLimitUsd?: number;
  }) {
    return new GlobalBudgetGuard(
      store,
      {
        dailyLimitUsd: overrides?.dailyLimitUsd ?? 5.00,
        monthlyLimitUsd: overrides?.monthlyLimitUsd ?? 50.00,
        alertThresholds: [0.5, 0.8, 0.9],
        onLimitReached: "pause-all",
      },
      eventBus,
      {
        pause: () => { paused = true; },
        resume: () => { paused = false; },
        get isPaused() { return paused; },
      },
      createLogger(),
    );
  }

  it("allows execution when under budget", async () => {
    const guard = createGuard();
    const ok = await guard.checkAndEnforce(createMockTask(), snapshot);
    expect(ok).toBe(true);
    expect(paused).toBe(false);
  });

  it("pauses scheduler when daily limit is exceeded", async () => {
    const guard = createGuard({ dailyLimitUsd: 0.04 });

    const created = await store.create({
      definition: { type: "heartbeat", name: "t", prompt: "p", resultRoute: "silent" },
      schedule: { intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");
    await store.claim(Date.now() + 200_000);
    await store.complete(created.value.id, snapshot);

    const ok = await guard.checkAndEnforce(createMockTask(), snapshot);
    expect(ok).toBe(false);
    expect(paused).toBe(true);
  });

  it("pauses scheduler when monthly limit is exceeded", async () => {
    const guard = createGuard({ monthlyLimitUsd: 0.04 });

    const created = await store.create({
      definition: { type: "heartbeat", name: "t", prompt: "p", resultRoute: "silent" },
      schedule: { intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");
    await store.claim(Date.now() + 200_000);
    await store.complete(created.value.id, snapshot);

    const ok = await guard.checkAndEnforce(createMockTask(), snapshot);
    expect(ok).toBe(false);
    expect(paused).toBe(true);
  });

  it("emits budget_exceeded event on limit breach", async () => {
    const guard = createGuard({ dailyLimitUsd: 0.04 });

    const created = await store.create({
      definition: { type: "heartbeat", name: "t", prompt: "p", resultRoute: "silent" },
      schedule: { intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");
    await store.claim(Date.now() + 200_000);
    await store.complete(created.value.id, snapshot);

    await guard.checkAndEnforce(createMockTask(), snapshot);

    const exceeded = eventBus.emitted.filter((e) => e.event === "task:budget_exceeded");
    expect(exceeded.length).toBe(1);
    expect(exceeded[0].data.limitExceeded).toBe("global_daily");
  });

  it("emits warning at alert thresholds", async () => {
    const guard = createGuard({ dailyLimitUsd: 0.10 });

    const created = await store.create({
      definition: { type: "heartbeat", name: "t", prompt: "p", resultRoute: "silent" },
      schedule: { intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");
    await store.claim(Date.now() + 200_000);
    await store.complete(created.value.id, snapshot); // 0.05 = 50% of 0.10

    await guard.checkAndEnforce(createMockTask(), snapshot);

    const warnings = eventBus.emitted.filter((e) => e.event === "task:budget_warning");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not emit same threshold twice", async () => {
    const guard = createGuard({ dailyLimitUsd: 0.10 });

    const created = await store.create({
      definition: { type: "heartbeat", name: "t", prompt: "p", resultRoute: "silent" },
      schedule: { intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");
    await store.claim(Date.now() + 200_000);
    await store.complete(created.value.id, snapshot);

    await guard.checkAndEnforce(createMockTask(), snapshot);
    await guard.checkAndEnforce(createMockTask(), snapshot);

    const warnings = eventBus.emitted.filter((e) => e.event === "task:budget_warning");
    const daily50 = warnings.filter((w) => w.data.thresholdPct === 50);
    expect(daily50.length).toBeLessThanOrEqual(1);
  });

  it("resetThresholds clears emitted state", async () => {
    const guard = createGuard({ dailyLimitUsd: 0.10 });

    const created = await store.create({
      definition: { type: "heartbeat", name: "t", prompt: "p", resultRoute: "silent" },
      schedule: { intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");
    await store.claim(Date.now() + 200_000);
    await store.complete(created.value.id, snapshot);

    await guard.checkAndEnforce(createMockTask(), snapshot);
    const before = eventBus.emitted.length;

    guard.resetThresholds();
    await guard.checkAndEnforce(createMockTask(), snapshot);

    expect(eventBus.emitted.length).toBeGreaterThan(before);
  });

  it("does not pause in alert-only mode", async () => {
    const guard = new GlobalBudgetGuard(
      store,
      {
        dailyLimitUsd: 0.04,
        monthlyLimitUsd: 50.00,
        alertThresholds: [0.5, 0.8, 0.9],
        onLimitReached: "alert-only",
      },
      eventBus,
      {
        pause: () => { paused = true; },
        resume: () => { paused = false; },
        get isPaused() { return paused; },
      },
      createLogger(),
    );

    const created = await store.create({
      definition: { type: "heartbeat", name: "t", prompt: "p", resultRoute: "silent" },
      schedule: { intervalMs: 60_000 },
    });
    if (!created.ok) throw new Error("Create failed");
    await store.claim(Date.now() + 200_000);
    await store.complete(created.value.id, snapshot);

    const ok = await guard.checkAndEnforce(createMockTask(), snapshot);
    expect(ok).toBe(true);
    expect(paused).toBe(false);
  });
});
