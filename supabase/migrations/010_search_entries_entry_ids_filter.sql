-- 010_search_entries_entry_ids_filter.sql
-- Add filter_entry_ids parameter to search_entries for cluster-scoped search.

CREATE OR REPLACE FUNCTION search_entries(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  filter_tags TEXT[] DEFAULT NULL,
  filter_use_case TEXT DEFAULT NULL,
  filter_complexity TEXT DEFAULT NULL,
  filter_entry_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  entry_id UUID,
  title TEXT,
  summary TEXT,
  use_case TEXT,
  complexity TEXT,
  readme TEXT,
  agents_md TEXT,
  manifest JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (e.id)
    e.id AS entry_id,
    e.title,
    e.summary,
    e.use_case,
    e.complexity,
    e.readme,
    e.agents_md,
    e.manifest,
    (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
  FROM chunks c
  JOIN entries e ON e.id = c.entry_id
  LEFT JOIN tags t ON t.entry_id = e.id
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
    AND e.status = 'complete'
    AND (filter_use_case IS NULL OR e.use_case = filter_use_case)
    AND (filter_complexity IS NULL OR e.complexity = filter_complexity)
    AND (filter_tags IS NULL OR t.tag_value = ANY(filter_tags))
    AND (filter_entry_ids IS NULL OR e.id = ANY(filter_entry_ids))
  ORDER BY e.id, similarity DESC
  LIMIT match_count;
END;
$$;
