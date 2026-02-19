-- Add derived_from_message_id to track which user message produced each fact.
-- Enables write guards: pre-context regex extraction wins over post-response LLM
-- extraction for identity slots on the same message.

ALTER TABLE facts ADD COLUMN derived_from_message_id TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (11, unixepoch() * 1000);
