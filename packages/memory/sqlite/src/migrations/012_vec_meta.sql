-- Migration 012: vec_meta table for tracking embedding identity
--
-- Stores the embedding fingerprint (provider, model, dimensions) so
-- the gateway can detect when the embedding configuration has changed
-- and automatically rebuild vec_facts instead of mixing incompatible vectors.

CREATE TABLE IF NOT EXISTS vec_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_version (version) VALUES (12);
