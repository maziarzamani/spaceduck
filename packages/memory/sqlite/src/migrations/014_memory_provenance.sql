-- Migration 014: Memory provenance + retrieval budgets
--
-- Adds:
--   1. source_task_id, source_skill_id columns to memories table for provenance tracking
--   2. estimated_tokens column for pre-computed token estimation (retrieval budget enforcement)
--
-- Non-destructive: all new columns are nullable, existing rows get NULL defaults.

ALTER TABLE memories ADD COLUMN source_task_id TEXT;
ALTER TABLE memories ADD COLUMN source_skill_id TEXT;
ALTER TABLE memories ADD COLUMN estimated_tokens INTEGER;

CREATE INDEX IF NOT EXISTS idx_memories_task_id ON memories(source_task_id) WHERE source_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_skill_id ON memories(source_skill_id) WHERE source_skill_id IS NOT NULL;

INSERT INTO schema_version (version) VALUES (14);
