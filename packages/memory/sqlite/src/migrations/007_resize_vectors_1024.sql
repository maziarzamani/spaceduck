-- Migration 007: resize vector embeddings from 768 → 1024 dimensions
--
-- Reason: switching embedding provider from Gemini text-embedding-004 (768d)
-- to Amazon Titan Text Embeddings V2 (amazon.titan-embed-text-v2:0, 1024d).
--
-- sqlite-vec virtual tables cannot be ALTER'd — must drop + recreate.
-- Existing embeddings in vec_facts are discarded; the facts table is untouched
-- so the text content is preserved. Embeddings will be regenerated lazily as
-- new facts are stored with the new provider.

DROP TABLE IF EXISTS vec_facts;

CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(
  fact_id TEXT PRIMARY KEY,
  embedding float[1024]
);

INSERT INTO schema_version (version) VALUES (7);
