-- Migration 001: Task scheduler tables
--
-- Adds:
--   1. tasks table — persistent task definitions with scheduling and budget config
--   2. task_runs table — execution history for each task run
--   3. schema_version entry for the scheduler

CREATE TABLE IF NOT EXISTS scheduler_schema_version (
  version     INTEGER NOT NULL,
  applied_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK(type IN ('heartbeat','scheduled','event','workflow')),
  name              TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  system_prompt     TEXT,
  conversation_id   TEXT,
  tool_allow        TEXT,
  tool_deny         TEXT,
  result_route      TEXT NOT NULL,
  cron              TEXT,
  interval_ms       INTEGER,
  event_trigger     TEXT,
  run_immediately   INTEGER NOT NULL DEFAULT 0,
  max_tokens        INTEGER,
  max_cost_usd      REAL,
  max_wall_clock_ms INTEGER,
  max_tool_calls    INTEGER,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','scheduled','running','completed','failed','dead_letter','cancelled')),
  priority          INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 0 AND priority <= 9),
  next_run_at       INTEGER,
  last_run_at       INTEGER,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  max_retries       INTEGER NOT NULL DEFAULT 3,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  error             TEXT,
  budget_consumed   TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC, next_run_at ASC);

CREATE TABLE IF NOT EXISTS task_runs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  status          TEXT NOT NULL CHECK(status IN ('running','completed','failed','budget_exceeded')),
  error           TEXT,
  budget_consumed TEXT,
  result_text     TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_completed ON task_runs(completed_at);

INSERT INTO scheduler_schema_version (version) VALUES (1);
