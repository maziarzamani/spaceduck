-- Migration 002: Add result_text to tasks table
--
-- Stores the output from the most recent completed run directly on the task
-- row so it can be returned without joining task_runs.

ALTER TABLE tasks ADD COLUMN result_text TEXT;

UPDATE scheduler_schema_version SET version = 2, applied_at = unixepoch() * 1000;
