-- Migration 006: resize vector embeddings from 4096 → 768 dimensions
--
-- Reason: switching embedding provider from LM Studio (Qwen3-Embedding-8B, 4096d)
-- to Gemini text-embedding-004 (768d default).
--
-- sqlite-vec virtual tables cannot be ALTER'd — must drop + recreate.
-- Existing embeddings in vec_facts are discarded; the facts table is untouched
-- so the text content is preserved. Embeddings will be regenerated lazily as
-- new facts are recalled/stored with the new provider.

DROP TABLE IF EXISTS vec_facts;

CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(
  fact_id TEXT PRIMARY KEY,
  embedding float[768]
);

INSERT INTO schema_version (version) VALUES (6);
