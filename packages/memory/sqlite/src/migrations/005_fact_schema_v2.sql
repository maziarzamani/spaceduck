-- Migration 005: Memory v2 schema — richer Fact fields for hybrid recall
--
-- Adds to facts table:
--   source      — where the fact came from (auto-extracted, manual, compaction-flush)
--   confidence  — 0-1 quality score set by the firewall heuristic
--   expires_at  — optional expiry timestamp (ms); NULL = never expires
--   updated_at  — set on create; updated when fact is rewritten/merged
--
-- NOT NULL defaults ensure existing rows stay valid without a full-table rewrite.
-- updated_at is nullable then immediately backfilled to avoid a second ALTER TABLE.

ALTER TABLE facts ADD COLUMN source TEXT NOT NULL DEFAULT 'auto-extracted';
ALTER TABLE facts ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;
ALTER TABLE facts ADD COLUMN expires_at INTEGER;
ALTER TABLE facts ADD COLUMN updated_at INTEGER DEFAULT NULL;

-- Backfill: pre-v2 rows get updated_at = created_at so decay starts from the
-- correct baseline. Without this, age = (now - 0) which would mark all old
-- facts as maximally stale on the very first hybrid recall.
UPDATE facts SET updated_at = created_at WHERE updated_at IS NULL;

-- Partial index: only rows with an expiry set (most facts never expire).
-- Keeps the index small and speeds up "WHERE expires_at IS NOT NULL AND expires_at <= ?"
-- queries in the batch JOIN.
CREATE INDEX IF NOT EXISTS idx_facts_expires_at ON facts(expires_at)
  WHERE expires_at IS NOT NULL;

-- Full index: benefits future SQL-side cleanup jobs (prune expired/stale facts)
-- and any future move of decay ranking into SQL.
CREATE INDEX IF NOT EXISTS idx_facts_updated_at ON facts(updated_at);

INSERT INTO schema_version (version) VALUES (5);
