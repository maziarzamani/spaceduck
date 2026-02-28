// SqliteTaskStore: persistent task storage using bun:sqlite

import { Database } from "bun:sqlite";
import type {
  TaskStore, Task, TaskInput, TaskPatch, TaskStatus,
  BudgetSnapshot, TaskRun, SpendPeriod, Result, Logger,
  TaskDefinition, TaskSchedule, TaskBudget, TaskResultRoute,
} from "@spaceduck/core";
import { ok, err, SpaceduckError } from "@spaceduck/core";
import { nextRun } from "./cron";

const MIGRATIONS_DIR = new URL("./migrations", import.meta.url).pathname;

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

interface TaskRow {
  id: string;
  type: string;
  name: string;
  prompt: string;
  system_prompt: string | null;
  conversation_id: string | null;
  tool_allow: string | null;
  tool_deny: string | null;
  result_route: string;
  cron: string | null;
  interval_ms: number | null;
  event_trigger: string | null;
  run_immediately: number;
  max_tokens: number | null;
  max_cost_usd: number | null;
  max_wall_clock_ms: number | null;
  max_tool_calls: number | null;
  status: string;
  priority: number;
  next_run_at: number | null;
  last_run_at: number | null;
  retry_count: number;
  max_retries: number;
  created_at: number;
  updated_at: number;
  error: string | null;
  budget_consumed: string | null;
}

function rowToTask(row: TaskRow): Task {
  const definition: TaskDefinition = {
    type: row.type as TaskDefinition["type"],
    name: row.name,
    prompt: row.prompt,
    systemPrompt: row.system_prompt ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    toolAllow: row.tool_allow ? JSON.parse(row.tool_allow) : undefined,
    toolDeny: row.tool_deny ? JSON.parse(row.tool_deny) : undefined,
    resultRoute: parseResultRoute(row.result_route),
  };

  const schedule: TaskSchedule = {
    cron: row.cron ?? undefined,
    intervalMs: row.interval_ms ?? undefined,
    eventTrigger: row.event_trigger ?? undefined,
    runImmediately: row.run_immediately === 1,
  };

  const budget: TaskBudget = {
    maxTokens: row.max_tokens ?? undefined,
    maxCostUsd: row.max_cost_usd ?? undefined,
    maxWallClockMs: row.max_wall_clock_ms ?? undefined,
    maxToolCalls: row.max_tool_calls ?? undefined,
  };

  return {
    id: row.id,
    definition,
    schedule,
    budget,
    status: row.status as TaskStatus,
    priority: row.priority,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error ?? undefined,
    budgetConsumed: row.budget_consumed ? JSON.parse(row.budget_consumed) : undefined,
  };
}

function parseResultRoute(raw: string): TaskResultRoute {
  if (raw === "silent" || raw === "notify" || raw === "memory_update") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return "silent";
  }
}

function serializeResultRoute(route: TaskResultRoute): string {
  if (typeof route === "string") return route;
  return JSON.stringify(route);
}

function computeNextRunAt(schedule: TaskSchedule, now: number): number | null {
  if (schedule.cron) {
    return nextRun(schedule.cron, new Date(now)).getTime();
  }
  if (schedule.intervalMs) {
    return now + schedule.intervalMs;
  }
  return null;
}

export class SqliteTaskStore implements TaskStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async migrate(): Promise<void> {
    const currentVersion = this.getCurrentVersion();
    if (currentVersion >= 1) {
      this.logger.info("Scheduler schema is up to date", { version: currentVersion });
      return;
    }

    const { readdir } = await import("node:fs/promises");
    let files: string[];
    try {
      files = await readdir(MIGRATIONS_DIR);
    } catch {
      this.logger.warn("No scheduler migrations directory found", { path: MIGRATIONS_DIR });
      return;
    }

    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();
    for (const file of sqlFiles) {
      const match = file.match(/^(\d+)_/);
      if (!match) continue;

      const version = parseInt(match[1], 10);
      if (version <= currentVersion) continue;

      const sql = await Bun.file(`${MIGRATIONS_DIR}/${file}`).text();
      this.logger.info("Applying scheduler migration", { version, name: file });

      this.db.exec("BEGIN TRANSACTION");
      try {
        this.db.exec(sql);
        this.db.exec("COMMIT");
      } catch (migErr) {
        this.db.exec("ROLLBACK");
        this.logger.error("Scheduler migration failed", { version, error: String(migErr) });
        throw migErr;
      }
    }
  }

  private getCurrentVersion(): number {
    try {
      const row = this.db
        .query("SELECT MAX(version) as version FROM scheduler_schema_version")
        .get() as { version: number } | null;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  async create(input: TaskInput): Promise<Result<Task>> {
    try {
      const id = generateId();
      const now = Date.now();
      const priority = input.priority ?? 5;
      const maxRetries = input.maxRetries ?? 3;

      let nextRunAt: number | null = null;
      let status: TaskStatus = "pending";

      if (input.schedule.runImmediately) {
        nextRunAt = now;
        status = "scheduled";
      } else {
        nextRunAt = computeNextRunAt(input.schedule, now);
        if (nextRunAt !== null) status = "scheduled";
      }

      this.db
        .query(
          `INSERT INTO tasks
             (id, type, name, prompt, system_prompt, conversation_id,
              tool_allow, tool_deny, result_route, cron, interval_ms,
              event_trigger, run_immediately, max_tokens, max_cost_usd,
              max_wall_clock_ms, max_tool_calls, status, priority,
              next_run_at, max_retries, created_at, updated_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?22)`,
        )
        .run(
          id, input.definition.type, input.definition.name,
          input.definition.prompt, input.definition.systemPrompt ?? null,
          input.definition.conversationId ?? null,
          input.definition.toolAllow ? JSON.stringify(input.definition.toolAllow) : null,
          input.definition.toolDeny ? JSON.stringify(input.definition.toolDeny) : null,
          serializeResultRoute(input.definition.resultRoute),
          input.schedule.cron ?? null, input.schedule.intervalMs ?? null,
          input.schedule.eventTrigger ?? null,
          input.schedule.runImmediately ? 1 : 0,
          input.budget?.maxTokens ?? null, input.budget?.maxCostUsd ?? null,
          input.budget?.maxWallClockMs ?? null, input.budget?.maxToolCalls ?? null,
          status, priority, nextRunAt, maxRetries, now,
        );

      return this.get(id) as Promise<Result<Task>>;
    } catch (cause) {
      return err(new SpaceduckError(`Failed to create task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async get(id: string): Promise<Result<Task | null>> {
    try {
      const row = this.db.query("SELECT * FROM tasks WHERE id = ?1").get(id) as TaskRow | null;
      return ok(row ? rowToTask(row) : null);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to get task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async update(id: string, patch: TaskPatch): Promise<Result<Task>> {
    try {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      let idx = 1;

      if (patch.status !== undefined) { sets.push(`status = ?${idx++}`); params.push(patch.status); }
      if (patch.nextRunAt !== undefined) { sets.push(`next_run_at = ?${idx++}`); params.push(patch.nextRunAt); }
      if (patch.lastRunAt !== undefined) { sets.push(`last_run_at = ?${idx++}`); params.push(patch.lastRunAt); }
      if (patch.retryCount !== undefined) { sets.push(`retry_count = ?${idx++}`); params.push(patch.retryCount); }
      if (patch.error !== undefined) { sets.push(`error = ?${idx++}`); params.push(patch.error); }
      if (patch.budgetConsumed !== undefined) { sets.push(`budget_consumed = ?${idx++}`); params.push(JSON.stringify(patch.budgetConsumed)); }

      sets.push(`updated_at = ?${idx++}`);
      params.push(Date.now());
      params.push(id);

      this.db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?${idx}`).run(...params);

      const result = await this.get(id);
      if (!result.ok) return result as Result<Task>;
      if (!result.value) return err(new SpaceduckError("Task not found after update", "TASK_ERROR"));
      return ok(result.value);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to update task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async claim(now: number): Promise<Result<Task | null>> {
    try {
      const row = this.db
        .query(
          `UPDATE tasks
           SET status = 'running', updated_at = ?1
           WHERE id = (
             SELECT id FROM tasks
             WHERE status = 'scheduled' AND next_run_at <= ?1
             ORDER BY priority DESC, next_run_at ASC
             LIMIT 1
           )
           RETURNING *`,
        )
        .get(now) as TaskRow | null;

      return ok(row ? rowToTask(row) : null);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to claim task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async complete(id: string, snapshot: BudgetSnapshot, resultText?: string): Promise<Result<void>> {
    try {
      const now = Date.now();
      const task = this.db.query("SELECT * FROM tasks WHERE id = ?1").get(id) as TaskRow | null;
      if (!task) return err(new SpaceduckError("Task not found", "TASK_ERROR"));

      const nextAt = computeNextRunAt(
        { cron: task.cron ?? undefined, intervalMs: task.interval_ms ?? undefined },
        now,
      );
      const nextStatus: TaskStatus = nextAt ? "scheduled" : "completed";

      this.db
        .query(
          `UPDATE tasks SET status = ?1, last_run_at = ?2, next_run_at = ?3,
             budget_consumed = ?4, error = NULL, retry_count = 0, updated_at = ?2
           WHERE id = ?5`,
        )
        .run(nextStatus, now, nextAt, JSON.stringify(snapshot), id);

      await this.recordRun({
        taskId: id, startedAt: now - snapshot.wallClockMs,
        completedAt: now, status: "completed",
        budgetConsumed: snapshot, resultText,
      });

      return ok(undefined);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to complete task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async fail(id: string, error: string, snapshot: BudgetSnapshot): Promise<Result<void>> {
    try {
      const now = Date.now();
      this.db
        .query(
          `UPDATE tasks SET status = 'failed', error = ?1, last_run_at = ?2,
             budget_consumed = ?3, retry_count = retry_count + 1, updated_at = ?2
           WHERE id = ?4`,
        )
        .run(error, now, JSON.stringify(snapshot), id);

      await this.recordRun({
        taskId: id, startedAt: now - snapshot.wallClockMs,
        completedAt: now, status: "failed", error, budgetConsumed: snapshot,
      });

      return ok(undefined);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to fail task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async deadLetter(id: string, error: string, snapshot: BudgetSnapshot): Promise<Result<void>> {
    try {
      const now = Date.now();
      this.db
        .query(
          `UPDATE tasks SET status = 'dead_letter', error = ?1, last_run_at = ?2,
             budget_consumed = ?3, updated_at = ?2, next_run_at = NULL
           WHERE id = ?4`,
        )
        .run(error, now, JSON.stringify(snapshot), id);

      await this.recordRun({
        taskId: id, startedAt: now - snapshot.wallClockMs,
        completedAt: now, status: "failed", error, budgetConsumed: snapshot,
      });

      return ok(undefined);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to dead-letter task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async cancel(id: string): Promise<Result<void>> {
    try {
      this.db
        .query("UPDATE tasks SET status = 'cancelled', next_run_at = NULL, updated_at = ?1 WHERE id = ?2")
        .run(Date.now(), id);
      return ok(undefined);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to cancel task: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async listByStatus(status: TaskStatus, limit?: number): Promise<Result<Task[]>> {
    try {
      const rows = this.db
        .query(`SELECT * FROM tasks WHERE status = ?1 ORDER BY priority DESC, created_at DESC LIMIT ?2`)
        .all(status, limit ?? 100) as TaskRow[];
      return ok(rows.map(rowToTask));
    } catch (cause) {
      return err(new SpaceduckError(`Failed to list tasks: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async listDue(now: number): Promise<Result<Task[]>> {
    try {
      const rows = this.db
        .query(
          `SELECT * FROM tasks
           WHERE status = 'scheduled' AND next_run_at <= ?1
           ORDER BY priority DESC, next_run_at ASC`,
        )
        .all(now) as TaskRow[];
      return ok(rows.map(rowToTask));
    } catch (cause) {
      return err(new SpaceduckError(`Failed to list due tasks: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async sumSpend(period: SpendPeriod): Promise<Result<number>> {
    try {
      const now = new Date();
      let since: number;

      if (period === "day") {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        since = startOfDay.getTime();
      } else {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        since = startOfMonth.getTime();
      }

      const rows = this.db
        .query(
          `SELECT budget_consumed FROM task_runs
           WHERE completed_at >= ?1 AND budget_consumed IS NOT NULL`,
        )
        .all(since) as { budget_consumed: string }[];

      let total = 0;
      for (const row of rows) {
        try {
          const snapshot: BudgetSnapshot = JSON.parse(row.budget_consumed);
          total += snapshot.estimatedCostUsd;
        } catch {
          // skip malformed entries
        }
      }

      return ok(total);
    } catch (cause) {
      return err(new SpaceduckError(`Failed to sum spend: ${cause}`, "TASK_ERROR", cause));
    }
  }

  async recordRun(run: Omit<TaskRun, "id">): Promise<Result<TaskRun>> {
    try {
      const id = generateId();
      this.db
        .query(
          `INSERT INTO task_runs (id, task_id, started_at, completed_at, status, error, budget_consumed, result_text)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .run(
          id, run.taskId, run.startedAt, run.completedAt ?? null,
          run.status, run.error ?? null,
          run.budgetConsumed ? JSON.stringify(run.budgetConsumed) : null,
          run.resultText ?? null,
        );

      return ok({ id, ...run });
    } catch (cause) {
      return err(new SpaceduckError(`Failed to record run: ${cause}`, "TASK_ERROR", cause));
    }
  }
}
