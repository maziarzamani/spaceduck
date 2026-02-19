-- Add structured fact fields: slot, slot_value, lang, is_active
-- Enables deterministic conflict resolution (only one active per slot)
-- and language tracking for cross-lingual recall.
-- Idempotent: skips if columns already exist.

ALTER TABLE facts ADD COLUMN slot TEXT;
ALTER TABLE facts ADD COLUMN slot_value TEXT;
ALTER TABLE facts ADD COLUMN lang TEXT NOT NULL DEFAULT 'und';
ALTER TABLE facts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_facts_slot_active ON facts(slot, is_active) WHERE slot IS NOT NULL;

INSERT INTO schema_version (version, applied_at) VALUES (10, unixepoch() * 1000);
