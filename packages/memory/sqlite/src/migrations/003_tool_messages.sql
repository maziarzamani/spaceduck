-- Migration 003: add tool-calling support to messages table
--
-- The agent loop persists:
--   1. assistant messages with tool_calls JSON  (role = 'assistant')
--   2. tool result messages                      (role = 'tool')
--
-- SQLite cannot ALTER a CHECK constraint, so we recreate the table.

-- Step 1: create new table with updated schema
CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT,
  trace_id TEXT,
  source TEXT,
  request_id TEXT,
  -- Tool calling fields
  tool_calls TEXT,       -- JSON array of tool calls (on assistant messages)
  tool_call_id TEXT,     -- links a tool result back to its call (on tool messages)
  tool_name TEXT,        -- the tool that was called (on tool messages)
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Step 2: copy existing data
INSERT INTO messages_new (id, conversation_id, role, content, timestamp, status, trace_id, source, request_id)
  SELECT id, conversation_id, role, content, timestamp, status, trace_id, source, request_id
  FROM messages;

-- Step 3: drop old table and rename
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

-- Step 4: recreate indexes
CREATE INDEX idx_messages_conversation_ts
  ON messages(conversation_id, timestamp);

CREATE INDEX idx_messages_request_id
  ON messages(request_id);

INSERT INTO schema_version (version) VALUES (3);
