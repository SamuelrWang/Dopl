-- Knowledge semantic search: pgvector chunk embeddings + hybrid RPC.
--
-- Entries are chunked app-side (markdown-aware packing, see
-- src/features/knowledge/server/embeddings.ts) and each chunk gets an
-- OpenAI text-embedding-3-small vector (1536 dims, cosine). Search
-- fuses the existing tsvector keyword rank with vector similarity via
-- reciprocal rank fusion in `search_knowledge_hybrid`. The old
-- `search_knowledge_entries` RPC stays as the no-embedding fallback.
--
-- Chunks are written exclusively by the service-role client (embedding
-- sync runs server-side after entry writes), so RLS is enabled with NO
-- policies — anon/authenticated can't touch the table at all.

-- ════════════════════════════════════════════════════════════════════
-- 1. Extension + chunk table
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_entry_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  -- sha256 of the chunk text — write path skips re-embedding unchanged
  -- chunks (autosave fires often; most saves touch one chunk).
  content_hash TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_entry_chunks_entry_idx
  ON knowledge_entry_chunks (entry_id);
CREATE INDEX IF NOT EXISTS knowledge_entry_chunks_workspace_idx
  ON knowledge_entry_chunks (workspace_id, knowledge_base_id);

-- HNSW beats IVFFlat at this scale (no training step, fine for <1M rows).
CREATE INDEX IF NOT EXISTS knowledge_entry_chunks_embedding_idx
  ON knowledge_entry_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE knowledge_entry_chunks ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role only.

-- ════════════════════════════════════════════════════════════════════
-- 2. RPC: search_knowledge_hybrid
-- ════════════════════════════════════════════════════════════════════
--
-- Reciprocal rank fusion of (a) the tsvector keyword rank over entries
-- and (b) cosine similarity of the best chunk per entry. RRF constant
-- 60 (standard). Either leg may be empty — pure-semantic queries with
-- zero keyword overlap still rank, and vice versa.
--
-- Snippet: keyword hits get ts_headline (matched terms in <b> tags,
-- same contract as search_knowledge_entries); vector-only hits get the
-- best-matching chunk's first 240 chars, plain text.
--
-- Soft-deleted entries are excluded by joining live rows only; chunks
-- survive soft-delete so restore needs no re-embedding.

CREATE OR REPLACE FUNCTION search_knowledge_hybrid(
  p_workspace_id UUID,
  p_query TEXT,
  p_embedding vector(1536),
  p_base_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  entry_id UUID,
  knowledge_base_id UUID,
  folder_id UUID,
  title TEXT,
  excerpt TEXT,
  snippet TEXT,
  rank REAL,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('simple', coalesce(p_query, '')) AS tsq
  ),
  keyword AS (
    SELECT
      e.id,
      row_number() OVER (
        ORDER BY ts_rank(e.search_tsv, q.tsq) DESC, e.updated_at DESC
      ) AS r
    FROM knowledge_entries e, q
    WHERE e.workspace_id = p_workspace_id
      AND e.deleted_at IS NULL
      AND (p_base_id IS NULL OR e.knowledge_base_id = p_base_id)
      AND e.search_tsv @@ q.tsq
    LIMIT 50
  ),
  semantic AS (
    SELECT
      c.entry_id AS id,
      min(c.embedding <=> p_embedding) AS dist,
      row_number() OVER (
        ORDER BY min(c.embedding <=> p_embedding) ASC
      ) AS r
    FROM knowledge_entry_chunks c
    JOIN knowledge_entries e
      ON e.id = c.entry_id AND e.deleted_at IS NULL
    WHERE c.workspace_id = p_workspace_id
      AND (p_base_id IS NULL OR c.knowledge_base_id = p_base_id)
    GROUP BY c.entry_id
    ORDER BY dist ASC
    LIMIT 50
  ),
  fused AS (
    SELECT
      coalesce(k.id, s.id) AS id,
      (coalesce(1.0 / (60 + k.r), 0) + coalesce(1.0 / (60 + s.r), 0))::REAL AS score
    FROM keyword k
    FULL OUTER JOIN semantic s ON s.id = k.id
  )
  SELECT
    e.id AS entry_id,
    e.knowledge_base_id,
    e.folder_id,
    e.title,
    e.excerpt,
    CASE
      WHEN e.search_tsv @@ q.tsq THEN ts_headline(
        'simple',
        coalesce(e.body, ''),
        q.tsq,
        'MaxWords=20, MinWords=5, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … "'
      )
      ELSE left(
        coalesce(
          (SELECT c2.content
             FROM knowledge_entry_chunks c2
            WHERE c2.entry_id = e.id
            ORDER BY c2.embedding <=> p_embedding ASC
            LIMIT 1),
          e.body
        ),
        240
      )
    END AS snippet,
    f.score AS rank,
    e.updated_at
  FROM fused f
  JOIN knowledge_entries e ON e.id = f.id
  CROSS JOIN q
  ORDER BY f.score DESC, e.updated_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 20), 100));
$$;

REVOKE ALL ON FUNCTION search_knowledge_hybrid(UUID, TEXT, vector, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_knowledge_hybrid(UUID, TEXT, vector, UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION search_knowledge_hybrid(UUID, TEXT, vector, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION search_knowledge_hybrid(UUID, TEXT, vector, UUID, INTEGER) TO service_role;
