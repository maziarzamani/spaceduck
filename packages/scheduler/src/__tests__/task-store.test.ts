import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteTaskStore } from "../task-store";
import type { TaskInput, TaskStatus, BudgetSnapshot, Logger } from "@spaceduck/core";

function createLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => createLogger(),
  } as any;
}

function createInput(overrides?: Partial<TaskInput>): TaskInput {
  return {
    definition: {
      type: "heartbeat",
      name: "Test Task",
      prompt: "Check status",
      resultRoute: "silent",
    },
    schedule: {
      intervalMs: 60_000,
    },
    ...overrides,
  };
}

const snapshot: BudgetSnapshot = {
  tokensUsed: 500,
  estimatedCostUsd: 0.05,
  wallClockMs: 1500,
  toolCallsMade: 2,
};

describe("SqliteTaskStore", () => {
  let db: Database;
  let store: SqliteTaskStore;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec("PRAGMA journal_mode = WAL");
    store = new SqliteTaskStore(db, createLogger());
    await store.migrate();
  });

  describe("migrate", () => {
    it("creates tables and schema version", () => {
      const row = db.query("SELECT MAX(version) as v FROM scheduler_schema_version").get() as any;
      expect(row.v).toBe(1);
    });

    it("is idempotent", async () => {
      await store.migrate();
      const row = db.query("SELECT MAX(version) as v FROM scheduler_schema_version").get() as any;
      expect(row.v).toBe(1);
    });
  });

  describe("create", () => {
    it("creates a task and returns it", async () => {
      const result = await store.create(createInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBeTruthy();
      expect(result.value.definition.name).toBe("Test Task");
      expect(result.value.definition.prompt).toBe("Check status");
      expect(result.value.definition.resultRoute).toBe("silent");
      expect(result.value.status).toBe("scheduled");
      expect(result.value.priority).toBe(5);
    });

    it("sets status to scheduled when interval is set", async () => {
      const result = await store.create(createInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("scheduled");
      expect(result.value.nextRunAt).not.toBeNull();
    });

    it("sets status to pending when no schedule", async () => {
      const result = await store.create(createInput({
        schedule: {},
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("pending");
    });

    it("respects custom priority", async () => {
      const result = await store.create(createInput({ priority: 9 }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.priority).toBe(9);
    });

    it("handles runImmediately", async () => {
      const result = await store.create(createInput({
        schedule: { runImmediately: true, intervalMs: 60_000 },
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("scheduled");
      expect(result.value.nextRunAt).toBeLessThanOrEqual(Date.now());
    });

    it("stores tool allow/deny lists", async () => {
      const result = await store.create(createInput({
        definition: {
          type: "scheduled",
          name: "Scoped Task",
          prompt: "Do things",
          resultRoute: "notify",
          toolAllow: ["web_search", "web_fetch"],
          toolDeny: ["browser"],
        },
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.definition.toolAllow).toEqual(["web_search", "web_fetch"]);
      expect(result.value.definition.toolDeny).toEqual(["browser"]);
    });

    it("stores chain_next result route", async () => {
      const result = await store.create(createInput({
        definition: {
          type: "workflow",
          name: "Chain Task",
          prompt: "Step 1",
          resultRoute: { type: "chain_next", taskDefinitionId: "step-2", contextFromResult: true },
        },
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const route = result.value.definition.resultRoute;
      expect(typeof route).toBe("object");
      if (typeof route === "object") {
        expect(route.type).toBe("chain_next");
        expect(route.taskDefinitionId).toBe("step-2");
        expect(route.contextFromResult).toBe(true);
      }
    });
  });

  describe("get", () => {
    it("returns task by id", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");

      const result = await store.get(created.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.id).toBe(created.value.id);
    });

    it("returns null for non-existent id", async () => {
      const result = await store.get("nonexistent");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });
  });

  describe("update", () => {
    it("updates task status", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");

      const result = await store.update(created.value.id, { status: "running" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("running");
    });

    it("updates multiple fields", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");

      const result = await store.update(created.value.id, {
        status: "failed",
        error: "Connection timeout",
        retryCount: 1,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("failed");
      expect(result.value.error).toBe("Connection timeout");
      expect(result.value.retryCount).toBe(1);
    });
  });

  describe("claim", () => {
    it("claims the highest priority due task", async () => {
      await store.create(createInput({ priority: 3 }));
      await store.create(createInput({ priority: 8 }));
      await store.create(createInput({ priority: 5 }));

      const result = await store.claim(Date.now() + 100_000);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value!.priority).toBe(8);
      expect(result.value!.status).toBe("running");
    });

    it("returns null when no tasks are due", async () => {
      await store.create(createInput({ schedule: { intervalMs: 60_000 } }));

      const result = await store.claim(0); // Time 0 = nothing due
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("does not double-claim the same task", async () => {
      await store.create(createInput());

      const claim1 = await store.claim(Date.now() + 100_000);
      const claim2 = await store.claim(Date.now() + 100_000);

      expect(claim1.ok).toBe(true);
      expect(claim2.ok).toBe(true);
      if (!claim1.ok || !claim2.ok) return;

      expect(claim1.value).not.toBeNull();
      expect(claim2.value).toBeNull();
    });
  });

  describe("complete", () => {
    it("marks task as completed for one-shot tasks", async () => {
      const created = await store.create(createInput({ schedule: {} }));
      if (!created.ok) throw new Error("Create failed");
      await store.update(created.value.id, { status: "scheduled", nextRunAt: Date.now() });
      await store.claim(Date.now() + 1000);

      const result = await store.complete(created.value.id, snapshot, "Done");
      expect(result.ok).toBe(true);

      const task = await store.get(created.value.id);
      expect(task.ok).toBe(true);
      if (!task.ok || !task.value) return;
      expect(task.value.status).toBe("completed");
    });

    it("reschedules recurring tasks", async () => {
      const created = await store.create(createInput({ schedule: { intervalMs: 60_000 } }));
      if (!created.ok) throw new Error("Create failed");
      await store.claim(Date.now() + 100_000);

      await store.complete(created.value.id, snapshot);

      const task = await store.get(created.value.id);
      expect(task.ok).toBe(true);
      if (!task.ok || !task.value) return;
      expect(task.value.status).toBe("scheduled");
      expect(task.value.nextRunAt).not.toBeNull();
      expect(task.value.retryCount).toBe(0);
    });

    it("records a task run", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");
      await store.claim(Date.now() + 100_000);

      await store.complete(created.value.id, snapshot, "All good");

      const runs = db.query("SELECT * FROM task_runs WHERE task_id = ?1").all(created.value.id) as any[];
      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe("completed");
      expect(runs[0].result_text).toBe("All good");
    });
  });

  describe("fail", () => {
    it("marks task as failed and increments retry count", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");
      await store.claim(Date.now() + 100_000);

      await store.fail(created.value.id, "Connection error", snapshot);

      const task = await store.get(created.value.id);
      expect(task.ok).toBe(true);
      if (!task.ok || !task.value) return;
      expect(task.value.status).toBe("failed");
      expect(task.value.error).toBe("Connection error");
      expect(task.value.retryCount).toBe(1);
    });
  });

  describe("deadLetter", () => {
    it("moves task to dead_letter status", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");

      await store.deadLetter(created.value.id, "Too many retries", snapshot);

      const task = await store.get(created.value.id);
      expect(task.ok).toBe(true);
      if (!task.ok || !task.value) return;
      expect(task.value.status).toBe("dead_letter");
      expect(task.value.nextRunAt).toBeNull();
    });
  });

  describe("cancel", () => {
    it("cancels a task", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");

      await store.cancel(created.value.id);

      const task = await store.get(created.value.id);
      expect(task.ok).toBe(true);
      if (!task.ok || !task.value) return;
      expect(task.value.status).toBe("cancelled");
      expect(task.value.nextRunAt).toBeNull();
    });
  });

  describe("listByStatus", () => {
    it("returns tasks filtered by status", async () => {
      await store.create(createInput());
      await store.create(createInput());
      await store.create(createInput({ schedule: {} }));

      const scheduled = await store.listByStatus("scheduled");
      expect(scheduled.ok).toBe(true);
      if (!scheduled.ok) return;
      expect(scheduled.value.length).toBe(2);

      const pending = await store.listByStatus("pending");
      expect(pending.ok).toBe(true);
      if (!pending.ok) return;
      expect(pending.value.length).toBe(1);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) await store.create(createInput());

      const result = await store.listByStatus("scheduled", 3);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(3);
    });
  });

  describe("listDue", () => {
    it("returns tasks due for execution", async () => {
      await store.create(createInput());
      await store.create(createInput());

      const futureTime = Date.now() + 200_000;
      const result = await store.listDue(futureTime);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });

    it("excludes tasks not yet due", async () => {
      await store.create(createInput());

      const result = await store.listDue(0);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(0);
    });
  });

  describe("sumSpend", () => {
    it("sums spend for the current day", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");
      await store.claim(Date.now() + 100_000);
      await store.complete(created.value.id, snapshot);

      const result = await store.sumSpend("day");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeCloseTo(0.05, 4);
    });

    it("sums spend for the current month", async () => {
      const c1 = await store.create(createInput());
      const c2 = await store.create(createInput());
      if (!c1.ok || !c2.ok) throw new Error("Create failed");

      await store.claim(Date.now() + 100_000);
      await store.complete(c1.value.id, snapshot);

      await store.claim(Date.now() + 100_000);
      await store.complete(c2.value.id, { ...snapshot, estimatedCostUsd: 0.10 });

      const result = await store.sumSpend("month");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeCloseTo(0.15, 4);
    });

    it("returns 0 when no runs exist", async () => {
      const result = await store.sumSpend("day");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(0);
    });
  });

  describe("recordRun", () => {
    it("records a run and returns it with an id", async () => {
      const created = await store.create(createInput());
      if (!created.ok) throw new Error("Create failed");

      const result = await store.recordRun({
        taskId: created.value.id,
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
        status: "completed",
        budgetConsumed: snapshot,
        resultText: "Success",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBeTruthy();
      expect(result.value.taskId).toBe(created.value.id);
      expect(result.value.status).toBe("completed");
    });
  });
});
