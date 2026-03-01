import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BudgetGuard } from "../budget-guard";
import type { Task, TaskBudget, EventBus, BudgetSnapshot } from "@spaceduck/core";

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

function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: "test-task-1",
    definition: {
      type: "heartbeat",
      name: "Test Task",
      prompt: "Check status",
      resultRoute: "silent",
    },
    schedule: {},
    budget: {},
    status: "running",
    priority: 5,
    nextRunAt: null,
    lastRunAt: null,
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("BudgetGuard", () => {
  let guard: BudgetGuard;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let task: Task;

  const defaultBudget: Required<TaskBudget> = {
    maxTokens: 1000,
    maxCostUsd: 0.50,
    maxWallClockMs: 60_000,
    maxToolCalls: 5,
    maxMemoryWrites: 10,
  };

  beforeEach(() => {
    eventBus = createMockEventBus();
    task = createMockTask();
    guard = new BudgetGuard(defaultBudget, eventBus, task);
  });

  afterEach(() => {
    guard.dispose();
  });

  it("starts with empty snapshot", () => {
    const snap = guard.snapshot;
    expect(snap.tokensUsed).toBe(0);
    expect(snap.estimatedCostUsd).toBe(0);
    expect(snap.toolCallsMade).toBe(0);
    expect(snap.memoryWritesMade).toBe(0);
    expect(snap.wallClockMs).toBeGreaterThanOrEqual(0);
  });

  it("is not exceeded initially", () => {
    expect(guard.isExceeded).toBe(false);
    expect(guard.signal.aborted).toBe(false);
  });

  it("tracks chars and converts to tokens at 3 chars/token", () => {
    guard.trackChars(300); // 300 / 3 = 100 tokens
    expect(guard.snapshot.tokensUsed).toBe(100);
  });

  it("tracks exact tokens", () => {
    guard.trackExactTokens(500);
    expect(guard.snapshot.tokensUsed).toBe(500);
  });

  it("tracks tool calls", () => {
    guard.trackToolCall();
    guard.trackToolCall();
    expect(guard.snapshot.toolCallsMade).toBe(2);
  });

  it("aborts when tool calls exceed limit", () => {
    for (let i = 0; i < 5; i++) guard.trackToolCall();
    expect(guard.isExceeded).toBe(true);
    expect(guard.signal.aborted).toBe(true);
  });

  it("emits budget_exceeded on tool call limit", () => {
    for (let i = 0; i < 5; i++) guard.trackToolCall();
    const exceeded = eventBus.emitted.filter((e) => e.event === "task:budget_exceeded");
    expect(exceeded.length).toBe(1);
    expect(exceeded[0].data.limitExceeded).toBe("tool_calls");
  });

  it("emits warning at 80% token usage", () => {
    guard.trackExactTokens(800); // 80% of 1000
    const warnings = eventBus.emitted.filter((e) => e.event === "task:budget_warning");
    expect(warnings.length).toBe(1);
    expect(warnings[0].data.thresholdPct).toBe(80);
  });

  it("aborts when tokens exceed limit", () => {
    guard.trackExactTokens(1001);
    expect(guard.isExceeded).toBe(true);
  });

  it("emits budget_exceeded on token limit", () => {
    guard.trackExactTokens(1001);
    const exceeded = eventBus.emitted.filter((e) => e.event === "task:budget_exceeded");
    expect(exceeded.length).toBe(1);
    expect(exceeded[0].data.limitExceeded).toBe("tokens");
  });

  it("tracks cost and aborts at limit", () => {
    guard.trackCost(0.51);
    expect(guard.isExceeded).toBe(true);
    const exceeded = eventBus.emitted.filter((e) => e.event === "task:budget_exceeded");
    expect(exceeded.length).toBe(1);
    expect(exceeded[0].data.limitExceeded).toBe("cost");
  });

  it("emits warning only once", () => {
    guard.trackExactTokens(800);
    guard.trackExactTokens(50);
    const warnings = eventBus.emitted.filter((e) => e.event === "task:budget_warning");
    expect(warnings.length).toBe(1);
  });

  it("does not abort if within limits", () => {
    guard.trackExactTokens(500);
    guard.trackToolCall();
    guard.trackCost(0.10);
    expect(guard.isExceeded).toBe(false);
  });

  it("wall clock timeout triggers abort", async () => {
    const shortGuard = new BudgetGuard(
      { ...defaultBudget, maxWallClockMs: 50 },
      eventBus,
      task,
    );

    await new Promise((r) => setTimeout(r, 100));

    expect(shortGuard.isExceeded).toBe(true);
    const exceeded = eventBus.emitted.filter((e) => e.event === "task:budget_exceeded");
    expect(exceeded.some((e) => e.data.limitExceeded === "wall_clock")).toBe(true);
    shortGuard.dispose();
  });

  it("dispose clears wall clock timer", () => {
    guard.dispose();
    // Should not throw or cause issues
    expect(guard.isExceeded).toBe(false);
  });

  it("accumulates multiple trackChars calls", () => {
    guard.trackChars(90);  // 30 tokens
    guard.trackChars(60);  // 20 tokens
    guard.trackChars(150); // 50 tokens
    expect(guard.snapshot.tokensUsed).toBe(100);
  });

  it("wallClockMs increases over time", async () => {
    const snap1 = guard.snapshot.wallClockMs;
    await new Promise((r) => setTimeout(r, 50));
    const snap2 = guard.snapshot.wallClockMs;
    expect(snap2).toBeGreaterThan(snap1);
  });

  it("replaceWithExactUsage overwrites char-estimated tokens", () => {
    guard.trackChars(300); // char estimate: 100 tokens
    expect(guard.snapshot.tokensUsed).toBe(100);

    guard.replaceWithExactUsage({ inputTokens: 150, outputTokens: 5, totalTokens: 155 });
    expect(guard.snapshot.tokensUsed).toBe(155);
  });

  it("replaceWithExactUsage triggers abort when over budget", () => {
    guard.replaceWithExactUsage({ inputTokens: 900, outputTokens: 200, totalTokens: 1100 });
    expect(guard.isExceeded).toBe(true);
    const exceeded = eventBus.emitted.filter((e) => e.event === "task:budget_exceeded");
    expect(exceeded.length).toBe(1);
    expect(exceeded[0].data.limitExceeded).toBe("tokens");
  });

  it("replaceWithExactUsage accepts cache token fields", () => {
    guard.replaceWithExactUsage({
      inputTokens: 500,
      outputTokens: 100,
      totalTokens: 600,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
    }, 0.01);
    expect(guard.snapshot.tokensUsed).toBe(600);
    expect(guard.snapshot.estimatedCostUsd).toBe(0.01);
  });

  it("tracks memory writes", () => {
    guard.trackMemoryWrite();
    guard.trackMemoryWrite();
    expect(guard.snapshot.memoryWritesMade).toBe(2);
    expect(guard.memoryWritesBudgetExhausted).toBe(false);
  });

  it("aborts when memory writes exceed limit", () => {
    for (let i = 0; i < 10; i++) guard.trackMemoryWrite();
    expect(guard.isExceeded).toBe(true);
    expect(guard.memoryWritesBudgetExhausted).toBe(true);
    const exceeded = eventBus.emitted.filter((e) => e.event === "task:budget_exceeded");
    expect(exceeded.length).toBe(1);
    expect(exceeded[0].data.limitExceeded).toBe("memory_writes");
  });

  it("memoryWritesBudgetExhausted is false when maxMemoryWrites is 0 (disabled)", () => {
    const unlimitedGuard = new BudgetGuard(
      { ...defaultBudget, maxMemoryWrites: 0 },
      eventBus,
      task,
    );
    for (let i = 0; i < 100; i++) unlimitedGuard.trackMemoryWrite();
    expect(unlimitedGuard.memoryWritesBudgetExhausted).toBe(false);
    expect(unlimitedGuard.isExceeded).toBe(false);
    unlimitedGuard.dispose();
  });
});
