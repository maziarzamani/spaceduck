-- Migration 002: add FTS5 full-text search index on facts for fast recall

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  content,
  content='facts',
  content_rowid='rowid'
);

-- Populate FTS from existing facts
INSERT INTO facts_fts(facts_fts) VALUES('rebuild');

-- Triggers to keep FTS in sync with facts table
CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;

INSERT INTO schema_version (version) VALUES (2);
