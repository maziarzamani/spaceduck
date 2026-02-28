# Autonomous Agent Layer — Technical Architecture

**Status:** Phase 1 in progress
**Last updated:** 2026-02-28

---

## Overview

The autonomous agent layer adds proactive, budget-constrained task execution to
Spaceduck. Instead of only responding to user messages, the agent can wake up on
a schedule (heartbeat, cron, event trigger), execute a task within strict budget
limits, and route the result (notify user, update memory, chain to next task, or
stay silent).

The system is designed around one core principle: **safety is a default, not an
add-on.** Every task has a budget. Global daily/monthly spend limits are enforced
at the scheduler level. Memory writes from autonomous tasks carry provenance for
attribution and future purge capabilities.

---

## Phasing

### Phase 1 (current)

- Task types and `TaskStore` interface in `@spaceduck/core`
- Memory provenance (`taskId`, `skillId` on `MemorySource`)
- Memory retrieval budgets (`maxMemoryTokens`, `maxEntries`, pre-computed `estimated_tokens`)
- `@spaceduck/scheduler` package:
  - `SqliteTaskStore` — persistent task and run history
  - `TaskScheduler` — heartbeat timer, cron evaluator, event-driven triggers
  - `TaskQueue` — session lanes, priority ordering, concurrency gate, dead letter + retry
  - `BudgetGuard` — per-task token/cost/time/tool-call enforcement
  - `GlobalBudgetGuard` — daily/monthly USD limits, pause-on-breach
  - `TaskRunner` — budget-bounded agent execution, result routing
  - Cron parser (zero-dependency, ~50 LOC)
- Scheduler config in `@spaceduck/config` with hot-apply support
- Gateway integration: REST API, lifecycle management

### Phase 1.5 (before skill system)

- Memory injection boundary + pre-injection classifier (instruction-like content detection)
- Temporal confidence decay (category-based fact staleness)
- Contradiction-aware retrieval (retrieval-time conflict detection among retrieved set)
- Heartbeat escalation pattern (cheap model detects anomaly -> structured signal -> spawn capable-model task)
- Task dashboard + cost dashboard in Tauri desktop app

### Phase 2 (ecosystem)

- SKILL.md parser with OpenClaw compatibility
- Typed skill manifests (JSON schema inputs/outputs for chaining)
- Sandboxed execution with declared permissions
- Skill memory write attribution + cascading purge by skill ID
- Automated security scanner (static analysis, permission audit, IOC check)
- Marketplace scaffolding (registry, install/uninstall, trust scores)

### Phase 3 (advanced, user-demand-driven)

- Checkpointing and resumption for long-running tasks
- Sub-agent spawning with inherited, divisible budgets
- Shared memory with access control and conflict resolution
- Agent-to-agent messaging

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       Trigger Sources                           │
│  Heartbeat Timer │ Cron Evaluator │ EventBus Trigger │ REST API │
└────────┬────────────────┬──────────────────┬──────────┬────────┘
         │                │                  │          │
         ▼                ▼                  ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       TaskScheduler                             │
│  tick() — query due tasks, compute nextRunAt from cron/interval │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        TaskQueue                                │
│  Session Lanes (per-conversation RunLock)                       │
│  Priority Sort (0-9, higher first)                              │
│  Concurrency Gate (max N parallel tasks)                        │
│  Dead Letter Queue (retry with backoff, then quarantine)        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       TaskRunner                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ BudgetGuard (per-task)                                   │   │
│  │  - Token counting (3 chars/token conservative estimate)  │   │
│  │  - Cost estimation                                       │   │
│  │  - Wall-clock timeout via AbortController                │   │
│  │  - Tool call counter                                     │   │
│  │  - 80% warning / 100% abort                              │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│                 ▼                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ AgentLoop.run() — existing agentic tool-calling cycle    │   │
│  │  Synthetic user message from task prompt                 │   │
│  │  Task-scoped tool allow/deny list                        │   │
│  │  Optional system prompt override                         │   │
│  └──────────────┬───────────────────────────────────────────┘   │
│                 │                                               │
│                 ▼                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Result Router                                            │   │
│  │  silent — drop (log only)                                │   │
│  │  notify — send to user via channel                       │   │
│  │  memory_update — store with taskId provenance            │   │
│  │  chain_next — enqueue follow-up task (with context)      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GlobalBudgetGuard                             │
│  Aggregates spend from task_runs table                          │
│  Enforces daily/monthly USD limits                              │
│  Pauses scheduler on breach (configurable: pause-all,           │
│    pause-non-critical, alert-only)                              │
│  Alert thresholds at 50%, 80%, 90%                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Types

All task types live in `packages/core/src/types/task.ts`.

### TaskType

```typescript
type TaskType = "heartbeat" | "scheduled" | "event" | "workflow";
```

### TaskDefinition

Describes what to run:

```typescript
interface TaskDefinition {
  readonly type: TaskType;
  readonly name: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly conversationId?: string;
  readonly toolAllow?: string[];
  readonly toolDeny?: string[];
  readonly resultRoute: TaskResultRoute;
}
```

### TaskSchedule

Describes when to run:

```typescript
interface TaskSchedule {
  readonly cron?: string;            // 5-field cron expression
  readonly intervalMs?: number;      // simple interval alternative
  readonly eventTrigger?: string;    // EventBus event name
  readonly runImmediately?: boolean;
}
```

### TaskBudget

Per-task limits. Divisible for future sub-agent allocation (Phase 3).

```typescript
interface TaskBudget {
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
  readonly maxWallClockMs?: number;
  readonly maxToolCalls?: number;    // individual invocations, not rounds
}
```

### TaskResultRoute

Where the output goes:

```typescript
type TaskResultRoute =
  | "silent"
  | "notify"
  | "memory_update"
  | { readonly type: "chain_next"; readonly taskDefinitionId: string; readonly contextFromResult?: boolean };
```

When `contextFromResult` is true, the previous task's output is injected into the
chained task's prompt inside `<previous_task_output>` tags.

### Task (persisted record)

```typescript
interface Task {
  readonly id: string;
  readonly definition: TaskDefinition;
  readonly schedule: TaskSchedule;
  readonly budget: TaskBudget;
  readonly status: TaskStatus;
  readonly priority: number;           // 0-9
  readonly nextRunAt: number | null;
  readonly lastRunAt: number | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error?: string;
  readonly budgetConsumed?: BudgetSnapshot;
}
```

### BudgetSnapshot

Consumed resources for a single run:

```typescript
interface BudgetSnapshot {
  readonly tokensUsed: number;
  readonly estimatedCostUsd: number;
  readonly wallClockMs: number;
  readonly toolCallsMade: number;
}
```

---

## Memory Hardening (Phase 1)

### Provenance

`MemorySource` (in `packages/core/src/types/memory.ts`) gains two optional fields:

- `taskId?: string` — which scheduled task wrote this memory (null for interactive)
- `skillId?: string` — which skill wrote this memory (Phase 2, null until then)

This is additive and non-breaking. The `memories` table in SQLite gains nullable
`task_id` and `skill_id` columns.

**Purpose:** If a skill or task is later found to be malicious or buggy, all
memories it wrote can be queried by provenance and quarantined in bulk.

### Retrieval Budgets

`MemoryRecallOptions` gains:

- `maxMemoryTokens?: number` — max tokens from memory in this task's context
- `maxEntries?: number` — max discrete entries to retrieve

The `memories` table gains an `estimated_tokens` column, computed at write time
using a conservative 3 chars/token estimate. During retrieval, the recall pipeline
sums `estimated_tokens` after RRF scoring and stops when the budget is reached.

Default budgets by task type:

| Task Type   | maxMemoryTokens | maxEntries |
|-------------|-----------------|------------|
| heartbeat   | 500             | 5          |
| scheduled   | 2,000           | 15         |
| event       | 1,500           | 10         |
| workflow    | 3,000           | 20         |
| interactive | 4,000           | 25         |

---

## Budget Enforcement

### Per-Task (BudgetGuard)

Wraps `Provider` as a transparent counting proxy. The agent loop and existing
provider interface are unmodified.

- **Token counting:** 3 chars/token conservative estimate (biased to fire early).
  Providers returning exact usage metadata override the estimate.
- **Cost estimation:** Based on provider/model pricing tables.
- **Wall-clock timeout:** `AbortController` + `setTimeout`. Signal passed to `AgentLoop.run()`.
- **Tool call limit:** Counts individual invocations (not agent loop rounds).
- **Thresholds:** Warning event at 80%, abort at 100%.

### Global (GlobalBudgetGuard)

Aggregates `estimated_cost_usd` from the `task_runs` table.

- **Daily limit:** Configurable USD ceiling. Default: $5.00/day.
- **Monthly limit:** Configurable USD ceiling. Default: $50.00/month.
- **Alert thresholds:** Configurable array (default: 50%, 80%, 90%).
- **On limit reached:** `pause-all` (default), `pause-non-critical`, or `alert-only`.
- **Enforcement:** Called after every task completion. Pauses the scheduler timer
  and rejects new task enqueues until the next period or manual resume.

---

## SQLite Schema

Tasks share the same database connection as the memory store.

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  name            TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  system_prompt   TEXT,
  conversation_id TEXT,
  tool_allow      TEXT,              -- JSON array or null
  tool_deny       TEXT,              -- JSON array or null
  result_route    TEXT NOT NULL,     -- JSON or string literal
  cron            TEXT,
  interval_ms     INTEGER,
  event_trigger   TEXT,
  run_immediately INTEGER DEFAULT 0,
  max_tokens      INTEGER,
  max_cost_usd    REAL,
  max_wall_clock_ms INTEGER,
  max_tool_calls  INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending',
  priority        INTEGER NOT NULL DEFAULT 5,
  next_run_at     INTEGER,
  last_run_at     INTEGER,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  error           TEXT,
  budget_consumed TEXT               -- JSON BudgetSnapshot
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC, next_run_at ASC);

CREATE TABLE IF NOT EXISTS task_runs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  started_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  status          TEXT NOT NULL,
  error           TEXT,
  budget_consumed TEXT,               -- JSON BudgetSnapshot
  result_text     TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_completed ON task_runs(completed_at);
```

---

## Scheduler Config

```typescript
scheduler: {
  enabled: boolean;              // default: false (opt-in)
  heartbeatIntervalMs: number;   // default: 60_000
  maxConcurrentTasks: number;    // default: 3
  defaultBudget: {
    maxTokens: number;           // default: 50_000
    maxCostUsd: number;          // default: 0.50
    maxWallClockMs: number;      // default: 300_000
    maxToolCalls: number;        // default: 10
  };
  globalBudget: {
    dailyLimitUsd: number;       // default: 5.00
    monthlyLimitUsd: number;     // default: 50.00
    alertThresholds: number[];   // default: [0.5, 0.8, 0.9]
    onLimitReached: string;      // default: "pause-all"
  };
  retry: {
    maxAttempts: number;         // default: 3
    backoffBaseMs: number;       // default: 5_000
    backoffMaxMs: number;        // default: 300_000
  };
}
```

All paths under `/scheduler/*` are hot-appliable — changing `enabled` starts
or stops the scheduler without a gateway restart.

---

## REST API

All endpoints require authentication (existing gateway auth).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks` | Create a task |
| `GET` | `/api/tasks` | List tasks (optional `?status=` filter) |
| `GET` | `/api/tasks/:id` | Get task details |
| `DELETE` | `/api/tasks/:id` | Cancel a task |
| `POST` | `/api/tasks/:id/retry` | Retry a dead-lettered task |
| `GET` | `/api/tasks/budget` | Budget snapshots for running tasks + global spend |

---

## EventBus Events

```typescript
"task:scheduled":       { task: Task }
"task:started":         { task: Task }
"task:completed":       { task: Task; snapshot: BudgetSnapshot }
"task:failed":          { task: Task; error: string; retryCount: number }
"task:dead_letter":     { task: Task; error: string }
"task:budget_warning":  { task: Task; snapshot: BudgetSnapshot; thresholdPct: number }
"task:budget_exceeded": { task: Task; snapshot: BudgetSnapshot; limitExceeded: string }
```

---

## Design Decisions

- **Safe by default.** Every task has a per-task budget and a global daily/monthly
  budget. No budget specified = defaults apply. No surprise bills.
- **Conservative token estimation.** 3 chars/token (not 4). Non-English text, code,
  and structured output have lower chars/token ratios. Better to stop early.
- **`maxToolCalls` not `maxToolRounds`.** Counts individual tool invocations. If the
  agent calls 3 tools in parallel in one round, that counts as 3.
- **Pre-computed `estimated_tokens`.** Memory entries store token estimates at write
  time. Retrieval budget enforcement sums integers, no runtime estimation.
- **Budgets are divisible.** The `TaskBudget` type supports future sub-agent budget
  allocation (Phase 3) without schema changes.
- **Provenance is structural.** `taskId` and `skillId` on memory writes from day one.
  Retrofitting attribution later is painful.
- **Composition over inheritance.** `TaskRunner` composes `AgentLoop`, `BudgetGuard`,
  and `RunLock` rather than subclassing.
- **RunLock reuse.** Per-conversation serialization uses the existing `RunLock`.
- **No new dependencies.** Cron parsing is ~50 LOC. No library.
- **SQLite for persistence.** Tasks survive gateway restarts. Same DB connection as
  memory store. WAL mode for concurrent reads.

---

## Open Questions

1. **Heartbeat escalation (Phase 1.5).** The runner currently uses the configured
   provider. Cheap-model → structured escalation signal → capable-model task is
   deferred until the basic runner is proven.

2. **Sandbox implementation (Phase 2).** Docker containers, V8 isolates, or
   Deno-style permission flags. Each has different tradeoffs.

3. **SKILL.md compatibility depth (Phase 2).** Full OpenClaw compatibility vs.
   compatible-enough with adaptations for sandboxing.

4. **Multi-agent budget inheritance (Phase 3).** When a parent spawns sub-agents,
   does the budget split equally or does the parent allocate per-subtask?

5. **Checkpoint storage (Phase 3).** SQLite or filesystem. How much data to retain
   before garbage collection.
