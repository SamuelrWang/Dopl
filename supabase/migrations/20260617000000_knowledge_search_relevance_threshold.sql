-- Knowledge hybrid search: add a relevance cutoff to the SEMANTIC leg.
--
-- Bug (MCP audit, MCP-1): the `semantic` CTE returned the 50 nearest
-- chunks for ANY query with no distance threshold, so every embedded
-- entry surfaced through the FULL OUTER JOIN — searching gibberish
-- ("zzzznonexistentword99") returned every entry in the base. The
-- keyword leg (tsvector @@) already filters correctly; only the vector
-- leg polluted the results.
--
-- Fix: drop semantic hits whose best-chunk cosine DISTANCE (`<=>`,
-- 0 = identical … 2 = opposite) exceeds MAX_SEMANTIC_DISTANCE. For
-- text-embedding-3-small, genuinely related text sits well under ~0.6
-- and unrelated text lands ~0.75+; 0.72 sits in that gap, so real
-- semantic matches (incl. synonym/paraphrase, no keyword overlap) still
-- rank while noise is cut. Keyword hits are unaffected — exact-term
-- precision is preserved. Identical signature → CREATE OR REPLACE truly
-- replaces (no overload).

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
    -- Relevance cutoff: only keep entries whose best chunk is actually
    -- close to the query. Without this, every embedded entry ranked.
    HAVING min(c.embedding <=> p_embedding) < 0.72
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
