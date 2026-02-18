-- Migration 004: vector embeddings for semantic memory
--
-- Adds:
--   1. vec_facts virtual table for vector similarity search (requires sqlite-vec)
--   2. content_hash column on facts for deterministic exact-duplicate prevention

-- vec0 virtual table for vector similarity search on facts.
-- Dimension locked to 4096 (Qwen3-Embedding-8B default).
-- If model changes dimensions, drop + recreate via backfill script.
CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(
  fact_id TEXT PRIMARY KEY,
  embedding float[4096]
);

-- Deterministic duplicate guard: SHA256 of normalized content.
-- Prevents exact duplicates regardless of race conditions.
-- Note: ALTER TABLE ADD COLUMN is a no-op if column already exists in newer SQLite,
-- but we guard in application code (SchemaManager checks table_info).
ALTER TABLE facts ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_content_hash
  ON facts(content_hash);

INSERT INTO schema_version (version) VALUES (4);
