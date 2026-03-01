/**
 * Integration test for the scheduler REST API routes used by the tasks dashboard.
 * Validates that endpoints return data in the shape the UI hooks expect.
 *
 * Run:
 *   bun test packages/gateway/src/__tests__/scheduler-routes.test.ts
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureCustomSQLite } from "@spaceduck/memory-sqlite";

ensureCustomSQLite();

import { SqliteTaskStore } from "@spaceduck/scheduler";
import { handleSchedulerRoute } from "../scheduler-routes";
import type { TaskInput, Logger } from "@spaceduck/core";

function createLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => createLogger(),
  } as any;
}

function makeRequest(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

async function callRoute(method: string, path: string, deps: any, body?: unknown) {
  const req = makeRequest(method, path, body);
  const url = new URL(req.url);
  const res = await handleSchedulerRoute(req, url, deps);
  expect(res).not.toBeNull();
  return { status: res!.status, body: await res!.json() };
}

const mockScheduler = { status: "running" as const, isPaused: false };

describe("scheduler routes (tasks dashboard contract)", () => {
  let store: SqliteTaskStore;
  let deps: any;

  beforeEach(async () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA journal_mode = WAL");
    const logger = createLogger();
    store = new SqliteTaskStore(db, logger);
    await store.migrate();
    deps = { store, scheduler: mockScheduler, logger };
  });

  const sampleTask: TaskInput = {
    definition: {
      type: "heartbeat",
      name: "test-heartbeat",
      prompt: "check status",
      resultRoute: "silent",
    },
    schedule: { intervalMs: 60_000 },
    budget: { maxTokens: 1000, maxCostUsd: 0.01 },
  };

  it("POST /api/tasks creates a task with full Task shape", async () => {
    const { status, body } = await callRoute("POST", "/api/tasks", deps, sampleTask);
    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    expect(body.definition.name).toBe("test-heartbeat");
    expect(body.status).toBe("scheduled");
    expect(body.budget).toBeDefined();
    expect(body.createdAt).toBeGreaterThan(0);
  });

  it("GET /api/tasks returns { tasks: Task[] }", async () => {
    await callRoute("POST", "/api/tasks", deps, sampleTask);
    await callRoute("POST", "/api/tasks", deps, {
      ...sampleTask,
      definition: { ...sampleTask.definition, name: "second-task" },
    });

    const { status, body } = await callRoute("GET", "/api/tasks", deps);
    expect(status).toBe(200);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.length).toBe(2);
    for (const task of body.tasks) {
      expect(task.id).toBeDefined();
      expect(task.definition).toBeDefined();
      expect(task.status).toBeDefined();
    }
  });

  it("GET /api/tasks?status=scheduled filters correctly", async () => {
    await callRoute("POST", "/api/tasks", deps, sampleTask);
    const { body } = await callRoute("GET", "/api/tasks?status=scheduled", deps);
    expect(body.tasks.length).toBeGreaterThan(0);
    for (const task of body.tasks) {
      expect(task.status).toBe("scheduled");
    }
  });

  it("GET /api/tasks/budget returns spend summary and scheduler status", async () => {
    const { status, body } = await callRoute("GET", "/api/tasks/budget", deps);
    expect(status).toBe(200);
    expect(body).toHaveProperty("daily");
    expect(body).toHaveProperty("monthly");
    expect(body).toHaveProperty("schedulerStatus");
    expect(body.schedulerStatus).toBe("running");
    expect(body).toHaveProperty("schedulerPaused");
    expect(body.schedulerPaused).toBe(false);
  });

  it("GET /api/tasks/:id returns single task", async () => {
    const created = await callRoute("POST", "/api/tasks", deps, sampleTask);
    const { status, body } = await callRoute("GET", `/api/tasks/${created.body.id}`, deps);
    expect(status).toBe(200);
    expect(body.id).toBe(created.body.id);
    expect(body.definition.name).toBe("test-heartbeat");
  });

  it("DELETE /api/tasks/:id cancels a task", async () => {
    const created = await callRoute("POST", "/api/tasks", deps, sampleTask);
    const taskId = created.body.id;

    const { status, body } = await callRoute("DELETE", `/api/tasks/${taskId}`, deps);
    expect(status).toBe(200);
    expect(body.status).toBe("cancelled");

    const after = await callRoute("GET", `/api/tasks/${taskId}`, deps);
    expect(after.body.status).toBe("cancelled");
  });

  it("POST /api/tasks/:id/retry re-queues a failed task", async () => {
    const created = await callRoute("POST", "/api/tasks", deps, sampleTask);
    const taskId = created.body.id;

    await store.fail(taskId, "test error", {
      tokensUsed: 0,
      estimatedCostUsd: 0,
      wallClockMs: 0,
      toolCallsMade: 0,
      memoryWritesMade: 0,
    });

    const failed = await callRoute("GET", `/api/tasks/${taskId}`, deps);
    expect(failed.body.status).toBe("failed");

    const { status, body } = await callRoute("POST", `/api/tasks/${taskId}/retry`, deps);
    expect(status).toBe(200);
    expect(body.status).toBe("scheduled");
  });

  it("POST /api/tasks/:id/retry rejects non-failed tasks", async () => {
    const created = await callRoute("POST", "/api/tasks", deps, sampleTask);
    const { status, body } = await callRoute("POST", `/api/tasks/${created.body.id}/retry`, deps);
    expect(status).toBe(400);
    expect(body.error).toContain("Cannot retry");
  });

  it("spend summary reflects task run costs", async () => {
    const created = await callRoute("POST", "/api/tasks", deps, sampleTask);

    await store.recordRun({
      taskId: created.body.id,
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      status: "completed",
      budgetConsumed: {
        tokensUsed: 500,
        estimatedCostUsd: 0.0025,
        wallClockMs: 5000,
        toolCallsMade: 1,
        memoryWritesMade: 0,
      },
    });

    const { body } = await callRoute("GET", "/api/tasks/budget", deps);
    expect(typeof body.daily).toBe("number");
    expect(body.daily).toBeGreaterThanOrEqual(0.0025);
  });

  it("GET /api/tasks/:id returns 404 for unknown id", async () => {
    const { status, body } = await callRoute("GET", "/api/tasks/nonexistent-id", deps);
    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it("creates a skill-based task with budget from manifest", async () => {
    const skillTask: TaskInput = {
      definition: {
        type: "scheduled",
        name: "daily-summary",
        prompt: "Run skill: daily-summary",
        toolAllow: [],
        resultRoute: "memory_update",
      },
      schedule: { runImmediately: true },
      budget: { maxTokens: 10000, maxCostUsd: 0.05, maxToolCalls: 0, maxMemoryWrites: 5 },
    };

    const { status, body } = await callRoute("POST", "/api/tasks", deps, skillTask);
    expect(status).toBe(201);
    expect(body.definition.name).toBe("daily-summary");
    expect(body.definition.resultRoute).toBe("memory_update");
    expect(body.definition.toolAllow).toEqual([]);
    expect(body.budget.maxTokens).toBe(10000);
  });

  it("creates a custom task with cron schedule", async () => {
    const cronTask: TaskInput = {
      definition: {
        type: "scheduled",
        name: "weekly-check",
        prompt: "Check project status and summarize",
        resultRoute: "notify",
      },
      schedule: { cron: "0 9 * * 1" },
      budget: { maxTokens: 5000, maxCostUsd: 0.10 },
    };

    const { status, body } = await callRoute("POST", "/api/tasks", deps, cronTask);
    expect(status).toBe(201);
    expect(body.definition.name).toBe("weekly-check");
    expect(body.definition.resultRoute).toBe("notify");
    expect(body.schedule.cron).toBe("0 9 * * 1");
    expect(body.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("creates a custom task with interval schedule", async () => {
    const intervalTask: TaskInput = {
      definition: {
        type: "heartbeat",
        name: "hourly-heartbeat",
        prompt: "Check if anything needs attention",
        resultRoute: "silent",
      },
      schedule: { intervalMs: 3_600_000 },
    };

    const { status, body } = await callRoute("POST", "/api/tasks", deps, intervalTask);
    expect(status).toBe(201);
    expect(body.definition.type).toBe("heartbeat");
    expect(body.schedule.intervalMs).toBe(3_600_000);
  });

  it("task creation and immediate list retrieval round-trips correctly", async () => {
    const tasks = [
      { ...sampleTask, definition: { ...sampleTask.definition, name: "task-a" } },
      { ...sampleTask, definition: { ...sampleTask.definition, name: "task-b", skillId: "inbox-triage" } },
      { ...sampleTask, definition: { ...sampleTask.definition, name: "task-c" }, schedule: { cron: "0 8 * * *" } },
    ];

    for (const t of tasks) {
      const res = await callRoute("POST", "/api/tasks", deps, t);
      expect(res.status).toBe(201);
    }

    const { body } = await callRoute("GET", "/api/tasks", deps);
    expect(body.tasks.length).toBe(3);
    const names = body.tasks.map((t: any) => t.definition.name).sort();
    expect(names).toEqual(["task-a", "task-b", "task-c"]);
  });
});
