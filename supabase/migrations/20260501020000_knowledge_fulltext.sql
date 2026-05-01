-- Knowledge System Overhaul Item 5.D: full-text search on knowledge_entries.
--
-- Adds a generated `search_tsv` tsvector column with weighted terms:
--   A — title           (highest weight)
--   B — excerpt
--   C — body            (lowest)
--
-- Plus a GIN index for cheap lookups (partial — active rows only) and
-- an RPC `search_knowledge_entries` that filters by workspace +
-- optional base, ranks by ts_rank, returns top results with snippets.
--
-- The RPC runs SECURITY INVOKER (default) so RLS still applies. Only
-- members of a workspace get hits from that workspace's bases.

-- ════════════════════════════════════════════════════════════════════
-- 1. tsvector column + index
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS knowledge_entries_search_tsv_idx
  ON knowledge_entries USING gin (search_tsv)
  WHERE deleted_at IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- 2. RPC: search_knowledge_entries
-- ════════════════════════════════════════════════════════════════════
--
-- Returns up to `p_limit` matches scored by `ts_rank`. Snippets use
-- ts_headline so the caller gets a short body excerpt with the matched
-- terms highlighted (HTML <b> tags by default — we strip them client
-- side or render).
--
-- `p_query` is parsed via websearch_to_tsquery for natural-language
-- friendliness ("foo OR bar", quoted phrases, leading `-` for NOT all
-- supported without manual escaping).

CREATE OR REPLACE FUNCTION search_knowledge_entries(
  p_workspace_id UUID,
  p_query TEXT,
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
  )
  SELECT
    e.id AS entry_id,
    e.knowledge_base_id,
    e.folder_id,
    e.title,
    e.excerpt,
    ts_headline(
      'simple',
      coalesce(e.body, ''),
      q.tsq,
      'MaxWords=20, MinWords=5, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … "'
    ) AS snippet,
    ts_rank(e.search_tsv, q.tsq) AS rank,
    e.updated_at
  FROM knowledge_entries e, q
  WHERE e.workspace_id = p_workspace_id
    AND e.deleted_at IS NULL
    AND (p_base_id IS NULL OR e.knowledge_base_id = p_base_id)
    AND e.search_tsv @@ q.tsq
  ORDER BY rank DESC, e.updated_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 20), 100));
$$;

REVOKE ALL ON FUNCTION search_knowledge_entries(UUID, TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_knowledge_entries(UUID, TEXT, UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION search_knowledge_entries(UUID, TEXT, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION search_knowledge_entries(UUID, TEXT, UUID, INTEGER) TO service_role;
