// Task system types: definitions, scheduling, budgets, persistence

import type { Result } from "./errors";

// ---------------------------------------------------------------------------
// Task definition — what to run
// ---------------------------------------------------------------------------

export type TaskType = "heartbeat" | "scheduled" | "event" | "workflow";

export interface TaskDefinition {
  readonly type: TaskType;
  readonly name: string;
  /** The "wake-up" prompt sent as a synthetic user message. */
  readonly prompt: string;
  /** Override the default system prompt for this task. */
  readonly systemPrompt?: string;
  /** Scope to an existing conversation, or omit for an ephemeral one. */
  readonly conversationId?: string;
  /** Only these tools are available to the task (allowlist). */
  readonly toolAllow?: string[];
  /** These tools are blocked for the task (denylist). */
  readonly toolDeny?: string[];
  readonly resultRoute: TaskResultRoute;
}

// ---------------------------------------------------------------------------
// Task schedule — when to run
// ---------------------------------------------------------------------------

export interface TaskSchedule {
  /** 5-field cron expression (minute hour dom month dow). */
  readonly cron?: string;
  /** Simple repeating interval in milliseconds (alternative to cron). */
  readonly intervalMs?: number;
  /** EventBus event name that triggers this task. */
  readonly eventTrigger?: string;
  /** Run once immediately on task creation. */
  readonly runImmediately?: boolean;
}

// ---------------------------------------------------------------------------
// Task budget — per-task resource limits
// ---------------------------------------------------------------------------

/**
 * Per-task resource limits. Every field is optional — omitted fields fall back
 * to the scheduler's `defaultBudget` config.
 *
 * Budgets are divisible: a parent task can allocate sub-budgets that sum to at
 * most its remaining budget (Phase 3 sub-agent support, no schema changes needed).
 */
export interface TaskBudget {
  /** Max total tokens (input + output) per run. */
  readonly maxTokens?: number;
  /** Hard dollar ceiling per run. */
  readonly maxCostUsd?: number;
  /** Wall-clock timeout in milliseconds. */
  readonly maxWallClockMs?: number;
  /** Max individual tool invocations (not agent loop rounds). */
  readonly maxToolCalls?: number;
}

// ---------------------------------------------------------------------------
// Result routing
// ---------------------------------------------------------------------------

export type TaskResultRoute =
  | "silent"
  | "notify"
  | "memory_update"
  | {
      readonly type: "chain_next";
      readonly taskDefinitionId: string;
      /** If true, the previous task's output is injected into the chained task's prompt. */
      readonly contextFromResult?: boolean;
    };

// ---------------------------------------------------------------------------
// Task status lifecycle
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "pending"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "dead_letter"
  | "cancelled";

// ---------------------------------------------------------------------------
// Budget snapshot — consumed resources for a single run
// ---------------------------------------------------------------------------

export interface BudgetSnapshot {
  readonly tokensUsed: number;
  readonly estimatedCostUsd: number;
  readonly wallClockMs: number;
  readonly toolCallsMade: number;
}

// ---------------------------------------------------------------------------
// Task — the full persisted record
// ---------------------------------------------------------------------------

export interface Task {
  readonly id: string;
  readonly definition: TaskDefinition;
  readonly schedule: TaskSchedule;
  readonly budget: TaskBudget;
  readonly status: TaskStatus;
  /** 0-9, higher priority dequeued first. */
  readonly priority: number;
  /** Next scheduled execution time (ms epoch). Null if not scheduled. */
  readonly nextRunAt: number | null;
  readonly lastRunAt: number | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error?: string;
  readonly budgetConsumed?: BudgetSnapshot;
}

// ---------------------------------------------------------------------------
// Task input / patch — for create and update
// ---------------------------------------------------------------------------

export interface TaskInput {
  readonly definition: TaskDefinition;
  readonly schedule: TaskSchedule;
  readonly budget?: TaskBudget;
  readonly priority?: number;
  readonly maxRetries?: number;
}

export interface TaskPatch {
  readonly status?: TaskStatus;
  readonly nextRunAt?: number | null;
  readonly lastRunAt?: number;
  readonly retryCount?: number;
  readonly error?: string | null;
  readonly budgetConsumed?: BudgetSnapshot;
}

// ---------------------------------------------------------------------------
// Task run — history record for a single execution
// ---------------------------------------------------------------------------

export type TaskRunStatus = "running" | "completed" | "failed" | "budget_exceeded";

export interface TaskRun {
  readonly id: string;
  readonly taskId: string;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly status: TaskRunStatus;
  readonly error?: string;
  readonly budgetConsumed?: BudgetSnapshot;
  readonly resultText?: string;
}

// ---------------------------------------------------------------------------
// Spend period for global budget queries
// ---------------------------------------------------------------------------

export type SpendPeriod = "day" | "month";

// ---------------------------------------------------------------------------
// TaskStore — persistence interface
// ---------------------------------------------------------------------------

export interface TaskStore {
  create(input: TaskInput): Promise<Result<Task>>;
  get(id: string): Promise<Result<Task | null>>;
  update(id: string, patch: TaskPatch): Promise<Result<Task>>;

  /**
   * Atomic dequeue: claim the highest-priority task that is due for execution.
   * Sets status to 'running' atomically to prevent double-claiming.
   * Returns null if no tasks are due.
   */
  claim(now: number): Promise<Result<Task | null>>;

  complete(id: string, snapshot: BudgetSnapshot, resultText?: string): Promise<Result<void>>;
  fail(id: string, error: string, snapshot: BudgetSnapshot): Promise<Result<void>>;
  deadLetter(id: string, error: string, snapshot: BudgetSnapshot): Promise<Result<void>>;
  cancel(id: string): Promise<Result<void>>;

  listByStatus(status: TaskStatus, limit?: number): Promise<Result<Task[]>>;
  listDue(now: number): Promise<Result<Task[]>>;

  /** Sum estimated_cost_usd from task_runs for the given period (day/month). */
  sumSpend(period: SpendPeriod): Promise<Result<number>>;

  /** Record a task run in the history table. */
  recordRun(run: Omit<TaskRun, "id">): Promise<Result<TaskRun>>;
}
