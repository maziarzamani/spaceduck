-- Migration 008: Add attachments column to messages table
-- Stores attachment metadata as JSON (array of {id, filename, mimeType, size})

ALTER TABLE messages ADD COLUMN attachments TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (8, unixepoch() * 1000);
