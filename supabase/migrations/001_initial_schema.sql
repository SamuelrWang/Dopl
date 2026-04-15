-- Dopl - Initial Schema
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table: entries
-- The main table. One row per ingested post/knowledge package.
CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source reference
  source_url TEXT NOT NULL,
  source_platform TEXT DEFAULT 'x',
  source_author TEXT,
  source_date TIMESTAMPTZ,
  -- Generated artifacts
  readme TEXT,
  agents_md TEXT,
  manifest JSONB,
  -- Metadata
  title TEXT,
  summary TEXT,
  use_case TEXT,
  complexity TEXT CHECK (complexity IN ('simple', 'moderate', 'complex', 'advanced')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error')),
  -- Full raw content
  raw_content JSONB,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  ingested_at TIMESTAMPTZ
);

CREATE INDEX idx_entries_status ON entries(status);
CREATE INDEX idx_entries_use_case ON entries(use_case);
CREATE INDEX idx_entries_complexity ON entries(complexity);
CREATE INDEX idx_entries_source_url ON entries(source_url);

-- Table: sources
-- Individual pieces of raw content tied to an entry.
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  url TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'tweet_text', 'tweet_thread', 'image', 'code_screenshot',
    'architecture_diagram', 'blog_post', 'github_repo',
    'github_file', 'video_transcript', 'other'
  )),
  raw_content TEXT,
  extracted_content TEXT,
  content_metadata JSONB,
  storage_path TEXT,
  mime_type TEXT,
  parent_source_id UUID REFERENCES sources(id),
  depth INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sources_entry_id ON sources(entry_id);
CREATE INDEX idx_sources_type ON sources(source_type);

-- Table: chunks
-- Vectorized segments of entry content for semantic search.
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_type TEXT DEFAULT 'content',
  chunk_index INTEGER,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_entry_id ON chunks(entry_id);
CREATE INDEX idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Table: tags
-- Filterable tags for structured search.
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  tag_type TEXT NOT NULL CHECK (tag_type IN (
    'tool', 'platform', 'language', 'framework',
    'use_case', 'pattern', 'integration', 'custom'
  )),
  tag_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tags_entry_id ON tags(entry_id);
CREATE INDEX idx_tags_type_value ON tags(tag_type, tag_value);
CREATE INDEX idx_tags_value ON tags(tag_value);

-- Table: ingestion_logs
-- Track the ingestion process for debugging.
CREATE TABLE ingestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT CHECK (status IN ('started', 'completed', 'error')),
  details JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ingestion_logs_entry_id ON ingestion_logs(entry_id);

-- RPC: Semantic Search Function
CREATE OR REPLACE FUNCTION search_entries(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  filter_tags TEXT[] DEFAULT NULL,
  filter_use_case TEXT DEFAULT NULL,
  filter_complexity TEXT DEFAULT NULL
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
  ORDER BY e.id, similarity DESC
  LIMIT match_count;
END;
$$;
