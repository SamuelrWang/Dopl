-- 023_published_cluster_search.sql — Semantic search for published clusters

-- Add embedding column
ALTER TABLE published_clusters ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- HNSW index (matches chunks table config from 001_initial_schema.sql)
CREATE INDEX IF NOT EXISTS idx_published_clusters_embedding
  ON published_clusters
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Semantic search RPC function (mirrors search_entries pattern)
CREATE OR REPLACE FUNCTION search_published_clusters(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 20,
  filter_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  title TEXT,
  description TEXT,
  category TEXT,
  thumbnail_url TEXT,
  fork_count INTEGER,
  user_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.id,
    pc.slug,
    pc.title,
    pc.description,
    pc.category,
    pc.thumbnail_url,
    pc.fork_count,
    pc.user_id,
    pc.created_at,
    pc.updated_at,
    (1 - (pc.embedding <=> query_embedding))::FLOAT AS similarity
  FROM published_clusters pc
  WHERE
    pc.status = 'published'
    AND pc.embedding IS NOT NULL
    AND (1 - (pc.embedding <=> query_embedding))::FLOAT >= match_threshold
    AND (filter_category IS NULL OR pc.category = filter_category)
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
