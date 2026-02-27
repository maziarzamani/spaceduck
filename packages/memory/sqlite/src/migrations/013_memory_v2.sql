-- Migration 013: Memory v2 — typed, scoped, self-correcting memories
--
-- Adds:
--   1. memories table with kind/scope/status/importance/confidence
--   2. memories_fts virtual table for keyword search
--   3. vec_memories virtual table for vector similarity search
--   4. vec_memories_meta for embedding fingerprint tracking
--   5. Triggers to keep FTS in sync
--
-- Non-destructive: the existing facts table and vec_facts are untouched.
-- Dual-write is managed in application code during migration.

CREATE TABLE IF NOT EXISTS memories (
  id                     TEXT PRIMARY KEY,
  kind                   TEXT NOT NULL CHECK(kind IN ('fact','episode','procedure')),
  title                  TEXT NOT NULL,
  content                TEXT NOT NULL,
  summary                TEXT NOT NULL DEFAULT '',
  scope_type             TEXT NOT NULL DEFAULT 'global',
  scope_id               TEXT,
  entity_refs            TEXT NOT NULL DEFAULT '[]',
  source_type            TEXT NOT NULL,
  source_id              TEXT,
  source_conversation_id TEXT,
  source_run_id          TEXT,
  source_tool_name       TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  last_seen_at           INTEGER NOT NULL,
  occurred_at            INTEGER,
  expires_at             INTEGER,
  procedure_subtype      TEXT CHECK(procedure_subtype IS NULL OR procedure_subtype IN ('behavioral','workflow','constraint')),
  importance             REAL NOT NULL DEFAULT 0.5,
  confidence             REAL NOT NULL DEFAULT 0.7,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('candidate','active','stale','superseded','archived')),
  superseded_by          TEXT,
  embedding_version      TEXT,
  tags                   TEXT NOT NULL DEFAULT '[]',
  content_hash           TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_kind_status ON memories(kind, status);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_occurred_at ON memories(occurred_at) WHERE occurred_at IS NOT NULL;

-- FTS5 for keyword search over memories (title + content + summary)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, content, summary,
  content='memories', content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, summary)
  VALUES (new.rowid, new.title, new.content, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, summary)
  VALUES ('delete', old.rowid, old.title, old.content, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, summary)
  VALUES ('delete', old.rowid, old.title, old.content, old.summary);
  INSERT INTO memories_fts(rowid, title, content, summary)
  VALUES (new.rowid, new.title, new.content, new.summary);
END;

-- vec_memories: vector similarity search (created dynamically by reconcileVecMemories,
-- but we create the meta table here for fingerprint tracking)
CREATE TABLE IF NOT EXISTS vec_memories_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_version (version) VALUES (13);
