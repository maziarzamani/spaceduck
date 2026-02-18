-- Migration 001: initial schema for conversations, messages, facts, sessions

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  last_active_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT,
  trace_id TEXT,
  source TEXT,
  request_id TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_ts
  ON messages(conversation_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_messages_request_id
  ON messages(request_id);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_facts_conversation
  ON facts(conversation_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  last_active_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(channel_id, sender_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_lookup
  ON sessions(channel_id, sender_id);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

INSERT INTO schema_version (version) VALUES (1);
