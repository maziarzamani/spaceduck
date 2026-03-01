-- Migration 003: Add skill_id to tasks table
--
-- Persists the skill ID on the task row so skill instructions can be
-- resolved when the task is loaded from the database for execution.

ALTER TABLE tasks ADD COLUMN skill_id TEXT;

UPDATE scheduler_schema_version SET version = 3, applied_at = unixepoch() * 1000;
