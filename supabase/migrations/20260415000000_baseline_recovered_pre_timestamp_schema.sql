-- ======================================================================
-- BASELINE — the schema that existed BEFORE the timestamped migration
-- set begins (2026-04-16 06:17). RECOVERED FROM GIT, not hand-written.
-- ======================================================================
--
-- WHY THIS FILE EXISTS
--
-- Until this file was added, `supabase db reset` — and therefore local
-- dev, staging, and any rebuild-from-repo — died on the FIRST migration:
--
--     Applying 20260416061700_early_supporter_grant.sql...
--     ERROR: relation "profiles" does not exist
--
-- Roughly two dozen tables that the set ALTERs, TRUNCATEs, DROPs, indexes
-- and writes policies against were created by migrations that are not in
-- supabase/migrations/. `supabase migration list` reported "149 in sync /
-- 0 pending" the whole time: it compares history ROWS to FILENAMES, and
-- structurally cannot notice that the files do not build a database.
--
-- PROVENANCE — this is recovered history, not invention
--
-- The repo used numbered migrations (001_… … 035_…) before switching to
-- timestamps. The switch DELETED the numbered files without porting them.
-- Every one was recovered from git history:
--
--     5ab6386^   001_… … 025_…              (deleted 2026-04-14)
--     b1817ff^   026_… … 030_…              (deleted 2026-04-16)
--     1c1e0b9^   035_…, 20260429000000_…    (deleted 2026-06-10)
--
-- §1 is 001…029 CONCATENATED VERBATIM, in order, each behind a banner
-- naming its original filename and the ref it was recovered from. All
-- comments are the original authors'.
--
-- §2 is the only part that is reconstructed rather than recovered:
-- `mcp_events`, `system_events` and `webhook_events`. Files 031–034 were
-- never committed to git at all, so these three are rebuilt from the
-- production schema dump with everything a LATER migration adds
-- subtracted back out (noted per table).
--
-- §3 is 20260429000000_workspaces_overhaul.sql, recovered verbatim.
--
-- WHAT IS DELIBERATELY *NOT* HERE — and why
--
-- 030_credits_system.sql and 035_webhook_two_phase.sql created the credits
-- feature: `credit_ledger`, `user_credits`, their RLS policies, and the
-- RPCs grant_daily_bonus_atomic / reset_cycle_atomic / handle_upgrade_atomic
-- / init_credits_atomic. NONE of those objects exist in production today,
-- and NO migration in the set drops them — they were removed by hand,
-- outside the migration history. Replaying them here would build a local
-- database that production does not have, i.e. it would manufacture drift.
-- They are omitted, and recoverable verbatim from b1817ff^ / 1c1e0b9^ if
-- the feature is ever revived.
--
-- The ONE surviving effect of 030 — widening profiles' tier CHECK from
-- (free|pro) to (free|pro|power) — is kept, verbatim, at the end of §1.
--
-- Separately: 035 cannot be applied by Supabase CLI v2.75.0 even in
-- isolation. Its `CREATE FUNCTION` form makes the CLI's statement splitter
-- emit all four functions as a single statement, and Postgres rejects that
-- with "cannot insert multiple commands into a prepared statement". The
-- fix is a CLI upgrade (2.75.0 is 37 releases stale).
--
-- HOW IT IS RECORDED
--
-- Everything in this file is ALREADY present in production — the file
-- describes what production has had since April. It is therefore recorded
-- with `supabase migration repair --status applied 20260415000000` and is
-- NEVER pushed. It exists so a clean database can be built from this repo.
--
-- WHAT IT IS NOT
--
-- Not a squash. The 149 migrations that follow are untouched and still
-- replay on top of it one by one, with their commentary intact.
--
-- ======================================================================


-- ======================================================================
-- §1 — RECOVERED NUMBERED MIGRATIONS (001 … 029), VERBATIM
-- ======================================================================

-- ======================================================================
-- §1 · supabase/migrations/001_initial_schema.sql   [recovered from 5ab6386^]
-- ======================================================================

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


-- ======================================================================
-- §1 · supabase/migrations/002_add_instagram_source_type.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Add 'instagram_post' to the sources.source_type CHECK constraint.
-- Drop the existing constraint and recreate with the new value.

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_source_type_check;

ALTER TABLE sources ADD CONSTRAINT sources_source_type_check
  CHECK (source_type IN (
    'tweet_text', 'tweet_thread', 'image', 'code_screenshot',
    'architecture_diagram', 'blog_post', 'github_repo',
    'github_file', 'video_transcript', 'instagram_post', 'other'
  ));


-- ======================================================================
-- §1 · supabase/migrations/003_add_thumbnail_url.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Add thumbnail_url column to entries for visual browse cards.
-- Populated during ingestion from tweet images, Instagram display images, or OG images.

ALTER TABLE entries ADD COLUMN thumbnail_url TEXT;


-- ======================================================================
-- §1 · supabase/migrations/004_api_keys.sql   [recovered from 5ab6386^]
-- ======================================================================

-- API key authentication system.
-- Keys are stored as SHA-256 hashes. Plaintext is shown once at creation.

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,       -- e.g. "sk-dopl-a1b2c3" for display
  name TEXT NOT NULL,             -- human label
  rate_limit_rpm INTEGER DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ          -- NULL = active
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

CREATE TABLE api_key_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_key_usage_rate ON api_key_usage(api_key_id, requested_at);


-- ======================================================================
-- §1 · supabase/migrations/005_add_reddit_source_type.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Add 'reddit_post' to the sources.source_type CHECK constraint.
-- Drop the existing constraint and recreate with the new value.

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_source_type_check;

ALTER TABLE sources ADD CONSTRAINT sources_source_type_check
  CHECK (source_type IN (
    'tweet_text', 'tweet_thread', 'image', 'code_screenshot',
    'architecture_diagram', 'blog_post', 'github_repo',
    'github_file', 'video_transcript', 'instagram_post',
    'reddit_post', 'other'
  ));


-- ======================================================================
-- §1 · supabase/migrations/006_user_profiles.sql   [recovered from 5ab6386^]
-- ======================================================================

-- User profiles table linked to Supabase Auth
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_email ON profiles(email);

-- Auto-create a profile when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ======================================================================
-- §1 · supabase/migrations/007_api_keys_user_id.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Link API keys to user accounts
-- Existing keys (created via admin) will have NULL user_id and still work
ALTER TABLE api_keys ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);


-- ======================================================================
-- §1 · supabase/migrations/008_entries_ingested_by.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Track which user ingested an entry (informational, not access control)
-- All entries remain visible to all authenticated users
ALTER TABLE entries ADD COLUMN ingested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;


-- ======================================================================
-- §1 · supabase/migrations/009_clusters.sql   [recovered from 5ab6386^]
-- ======================================================================

-- 009_clusters.sql — Persist canvas clusters for MCP access

CREATE TABLE clusters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_clusters_slug ON clusters(slug);

CREATE TABLE cluster_panels (
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  entry_id   UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cluster_id, entry_id)
);

CREATE INDEX idx_cluster_panels_entry ON cluster_panels(entry_id);


-- ======================================================================
-- §1 · supabase/migrations/010_search_entries_entry_ids_filter.sql   [recovered from 5ab6386^]
-- ======================================================================

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


-- ======================================================================
-- §1 · supabase/migrations/011_canvas_panels.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Canvas panels: server-side persistence for entry panels on the user's canvas.
-- Only entry-type panels are stored here (chat/ingestion/browse are transient).
-- The MCP server uses these endpoints to let Claude read/modify the canvas.

CREATE TABLE canvas_panels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id   UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  title      TEXT,
  summary    TEXT,
  source_url TEXT,
  x          FLOAT DEFAULT 0,
  y          FLOAT DEFAULT 0,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, entry_id)
);

CREATE INDEX idx_canvas_panels_user ON canvas_panels(user_id);
CREATE INDEX idx_canvas_panels_entry ON canvas_panels(entry_id);


-- ======================================================================
-- §1 · supabase/migrations/012_clusters_user_id.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Add user_id to clusters for per-user scoping.
-- Existing clusters keep NULL user_id (globally visible).
-- New MCP-created clusters get user_id for per-user isolation.

ALTER TABLE clusters ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_clusters_user_id ON clusters(user_id);

-- Replace global unique slug with per-user unique slug
DROP INDEX idx_clusters_slug;
CREATE UNIQUE INDEX idx_clusters_user_slug ON clusters(user_id, slug);


-- ======================================================================
-- §1 · supabase/migrations/013_cluster_brains.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Cluster brains: persistent "brain" for each cluster containing
-- synthesized instructions and user-created memories/overrides.

CREATE TABLE cluster_brains (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cluster_id)
);

CREATE TABLE cluster_brain_memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_brain_id UUID NOT NULL REFERENCES cluster_brains(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cluster_brains_cluster ON cluster_brains(cluster_id);
CREATE INDEX idx_cluster_brain_memories_brain ON cluster_brain_memories(cluster_brain_id);


-- ======================================================================
-- §1 · supabase/migrations/013_rls_policies.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Enable Row Level Security on all tables and add access policies.
-- Service role key (used by supabaseAdmin in API routes) bypasses RLS entirely.
-- These policies govern access via the anon/authenticated Supabase client.

-- ============================================================
-- PROFILES — users can only read/update their own profile
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================================
-- API_KEYS — users can only manage their own keys
-- ============================================================
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select_own ON api_keys
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY api_keys_insert_own ON api_keys
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY api_keys_delete_own ON api_keys
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================
-- API_KEY_USAGE — readable if user owns the parent api_key
-- ============================================================
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_key_usage_select_own ON api_key_usage
  FOR SELECT USING (
    api_key_id IN (SELECT id FROM api_keys WHERE user_id = auth.uid())
  );

-- ============================================================
-- CANVAS_PANELS — strictly per-user
-- ============================================================
ALTER TABLE canvas_panels ENABLE ROW LEVEL SECURITY;

CREATE POLICY canvas_panels_select_own ON canvas_panels
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY canvas_panels_insert_own ON canvas_panels
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY canvas_panels_update_own ON canvas_panels
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY canvas_panels_delete_own ON canvas_panels
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================
-- CLUSTERS — users see global (user_id IS NULL) + their own
-- ============================================================
ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY clusters_select_visible ON clusters
  FOR SELECT USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY clusters_insert_own ON clusters
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY clusters_update_own ON clusters
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY clusters_delete_own ON clusters
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================
-- CLUSTER_PANELS — readable if cluster is visible to user
-- Writable only if cluster is owned by user
-- ============================================================
ALTER TABLE cluster_panels ENABLE ROW LEVEL SECURITY;

CREATE POLICY cluster_panels_select_visible ON cluster_panels
  FOR SELECT USING (
    cluster_id IN (
      SELECT id FROM clusters WHERE user_id IS NULL OR user_id = auth.uid()
    )
  );

CREATE POLICY cluster_panels_insert_own ON cluster_panels
  FOR INSERT WITH CHECK (
    cluster_id IN (
      SELECT id FROM clusters WHERE user_id = auth.uid()
    )
  );

CREATE POLICY cluster_panels_delete_own ON cluster_panels
  FOR DELETE USING (
    cluster_id IN (
      SELECT id FROM clusters WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- ENTRIES — all authenticated users can read; writes via service role only
-- ============================================================
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY entries_select_authenticated ON entries
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- SOURCES — all authenticated users can read
-- ============================================================
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY sources_select_authenticated ON sources
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- CHUNKS — all authenticated users can read
-- ============================================================
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY chunks_select_authenticated ON chunks
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- TAGS — all authenticated users can read
-- ============================================================
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tags_select_authenticated ON tags
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- INGESTION_LOGS — all authenticated users can read
-- ============================================================
ALTER TABLE ingestion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingestion_logs_select_authenticated ON ingestion_logs
  FOR SELECT USING (auth.role() = 'authenticated');


-- ======================================================================
-- §1 · supabase/migrations/014_mcp_connected_at.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Track when the user's MCP server last connected (for onboarding detection).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mcp_connected_at TIMESTAMPTZ;


-- ======================================================================
-- §1 · supabase/migrations/015_content_type.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Add content_type column to entries table.
-- Supports 3 types: setup (replicable implementation), knowledge (conceptual/educational),
-- resource (post pointing to external tool/repo).
-- Defaults to 'setup' for backward compatibility with existing entries.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'setup'
  CHECK (content_type IN ('setup', 'knowledge', 'resource'));

CREATE INDEX IF NOT EXISTS idx_entries_content_type ON entries(content_type);


-- ======================================================================
-- §1 · supabase/migrations/016_conversations.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Chat conversation persistence
-- Each chat panel's conversation is stored per-user for cross-session persistence.

CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  panel_id   TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT 'New Chat',
  messages   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, panel_id)
);

CREATE INDEX idx_conversations_user ON conversations(user_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select_own ON conversations
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY conversations_insert_own ON conversations
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY conversations_update_own ON conversations
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY conversations_delete_own ON conversations
  FOR DELETE USING (user_id = auth.uid());


-- ======================================================================
-- §1 · supabase/migrations/017_conversation_expiry.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Add auto-expiry and pin support to conversations.
-- Unpinned conversations auto-delete 7 days after the last message.

ALTER TABLE conversations
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN expires_at TIMESTAMPTZ;

-- Backfill: set expires_at for existing rows based on updated_at
UPDATE conversations SET expires_at = updated_at + INTERVAL '7 days' WHERE expires_at IS NULL;

-- Make expires_at NOT NULL after backfill
ALTER TABLE conversations ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';

CREATE INDEX idx_conversations_expiry ON conversations(expires_at) WHERE NOT pinned;


-- ======================================================================
-- §1 · supabase/migrations/017_subscriptions.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Add subscription fields to profiles table
ALTER TABLE profiles
  ADD COLUMN subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN stripe_subscription_id TEXT,
  ADD COLUMN subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'past_due', 'canceled')),
  ADD COLUMN subscription_period_end TIMESTAMPTZ,
  ADD COLUMN ingestion_count INTEGER DEFAULT 0;

CREATE INDEX idx_profiles_stripe_customer ON profiles(stripe_customer_id);

-- Atomic increment for ingestion count (avoids race conditions)
CREATE OR REPLACE FUNCTION increment_ingestion_count(user_id_input UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET ingestion_count = ingestion_count + 1
  WHERE id = user_id_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ======================================================================
-- §1 · supabase/migrations/018_published_clusters.sql   [recovered from 5ab6386^]
-- ======================================================================

-- 018_published_clusters.sql — Community sharing: published clusters as posts

-- ── Published clusters (the "post" record) ──────────────────────────
CREATE TABLE published_clusters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id      UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  category        TEXT,
  thumbnail_url   TEXT,
  fork_count      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'published'
                    CHECK (status IN ('draft', 'published', 'archived')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_published_clusters_slug ON published_clusters(slug);
CREATE INDEX idx_published_clusters_user ON published_clusters(user_id);
CREATE INDEX idx_published_clusters_status ON published_clusters(status);
CREATE INDEX idx_published_clusters_category ON published_clusters(category);
CREATE INDEX idx_published_clusters_popular ON published_clusters(fork_count DESC);

-- ── Panels for the published canvas (separate from private canvas) ──
CREATE TABLE published_cluster_panels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_cluster_id  UUID NOT NULL REFERENCES published_clusters(id) ON DELETE CASCADE,
  entry_id              UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  title                 TEXT,
  summary               TEXT,
  source_url            TEXT,
  x                     FLOAT DEFAULT 0,
  y                     FLOAT DEFAULT 0,
  width                 FLOAT DEFAULT 520,
  height                FLOAT DEFAULT 700,
  UNIQUE(published_cluster_id, entry_id)
);

CREATE INDEX idx_published_panels_cluster ON published_cluster_panels(published_cluster_id);

-- ── Brain snapshot for published cluster ────────────────────────────
CREATE TABLE published_cluster_brains (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_cluster_id  UUID NOT NULL REFERENCES published_clusters(id) ON DELETE CASCADE,
  instructions          TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(published_cluster_id)
);

-- ── Fork tracking ───────────────────────────────────────────────────
CREATE TABLE cluster_forks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_published_cluster_id UUID NOT NULL REFERENCES published_clusters(id) ON DELETE CASCADE,
  forked_by_user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_cluster_id          UUID REFERENCES clusters(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_published_cluster_id, forked_by_user_id)
);

CREATE INDEX idx_cluster_forks_source ON cluster_forks(source_published_cluster_id);
CREATE INDEX idx_cluster_forks_user ON cluster_forks(forked_by_user_id);


-- ======================================================================
-- §1 · supabase/migrations/019_profiles_community.sql   [recovered from 5ab6386^]
-- ======================================================================

-- 019_profiles_community.sql — Extend profiles for community features

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS twitter_handle TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_username TEXT;


-- ======================================================================
-- §1 · supabase/migrations/020_published_clusters_rls.sql   [recovered from 5ab6386^]
-- ======================================================================

-- 020_published_clusters_rls.sql — Row-level security for community tables

-- ── published_clusters ──────────────────────────────────────────────
ALTER TABLE published_clusters ENABLE ROW LEVEL SECURITY;

-- Anyone can read published posts (for the public gallery / detail pages)
CREATE POLICY "published_clusters_select_public"
  ON published_clusters FOR SELECT
  USING (status = 'published');

-- Owners can read all their own posts (including draft/archived)
CREATE POLICY "published_clusters_select_own"
  ON published_clusters FOR SELECT
  USING (user_id = auth.uid());

-- Only owners can insert/update/delete their own posts
CREATE POLICY "published_clusters_insert_own"
  ON published_clusters FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "published_clusters_update_own"
  ON published_clusters FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "published_clusters_delete_own"
  ON published_clusters FOR DELETE
  USING (user_id = auth.uid());

-- ── published_cluster_panels ────────────────────────────────────────
ALTER TABLE published_cluster_panels ENABLE ROW LEVEL SECURITY;

-- Public read if parent is published
CREATE POLICY "published_panels_select_public"
  ON published_cluster_panels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.status = 'published'
    )
  );

-- Owner read (via parent ownership)
CREATE POLICY "published_panels_select_own"
  ON published_cluster_panels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.user_id = auth.uid()
    )
  );

-- Owner write
CREATE POLICY "published_panels_insert_own"
  ON published_cluster_panels FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.user_id = auth.uid()
    )
  );

CREATE POLICY "published_panels_update_own"
  ON published_cluster_panels FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.user_id = auth.uid()
    )
  );

CREATE POLICY "published_panels_delete_own"
  ON published_cluster_panels FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.user_id = auth.uid()
    )
  );

-- ── published_cluster_brains ────────────────────────────────────────
ALTER TABLE published_cluster_brains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "published_brains_select_public"
  ON published_cluster_brains FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.status = 'published'
    )
  );

CREATE POLICY "published_brains_select_own"
  ON published_cluster_brains FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.user_id = auth.uid()
    )
  );

CREATE POLICY "published_brains_insert_own"
  ON published_cluster_brains FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.user_id = auth.uid()
    )
  );

CREATE POLICY "published_brains_update_own"
  ON published_cluster_brains FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM published_clusters pc
      WHERE pc.id = published_cluster_id AND pc.user_id = auth.uid()
    )
  );

-- ── cluster_forks ───────────────────────────────────────────────────
ALTER TABLE cluster_forks ENABLE ROW LEVEL SECURITY;

-- Anyone can read forks (public stats)
CREATE POLICY "cluster_forks_select_all"
  ON cluster_forks FOR SELECT
  USING (true);

-- Users can insert their own forks
CREATE POLICY "cluster_forks_insert_own"
  ON cluster_forks FOR INSERT
  WITH CHECK (forked_by_user_id = auth.uid());


-- ======================================================================
-- §1 · supabase/migrations/021_cluster_fork_attribution.sql   [recovered from 5ab6386^]
-- ======================================================================

-- 021_cluster_fork_attribution.sql — Track fork lineage on clusters

ALTER TABLE clusters ADD COLUMN IF NOT EXISTS forked_from_slug TEXT;
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS forked_from_title TEXT;

-- Helper function for atomic fork count increment
CREATE OR REPLACE FUNCTION increment_fork_count(pc_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE published_clusters
  SET fork_count = fork_count + 1
  WHERE id = pc_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ======================================================================
-- §1 · supabase/migrations/022_community_thumbnails_bucket.sql   [recovered from 5ab6386^]
-- ======================================================================

-- 022_community_thumbnails_bucket.sql — Storage bucket for community thumbnails

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'community-thumbnails',
  'community-thumbnails',
  true,
  5242880,  -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "thumbnails_upload_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'community-thumbnails'
    AND auth.uid() IS NOT NULL
  );

-- Public read for all thumbnails
CREATE POLICY "thumbnails_read_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'community-thumbnails');

-- Owners can update/delete their uploads
CREATE POLICY "thumbnails_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'community-thumbnails'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "thumbnails_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'community-thumbnails'
    AND auth.uid() IS NOT NULL
  );


-- ======================================================================
-- §1 · supabase/migrations/023_published_cluster_search.sql   [recovered from 5ab6386^]
-- ======================================================================

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


-- ======================================================================
-- §1 · supabase/migrations/024_canvas_state.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Per-user canvas viewport state (camera, counters, preferences).
-- One row per user — the source of truth for canvas meta that was
-- previously stored only in localStorage.

CREATE TABLE canvas_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  camera_x        FLOAT NOT NULL DEFAULT 0,
  camera_y        FLOAT NOT NULL DEFAULT 0,
  camera_zoom     FLOAT NOT NULL DEFAULT 1,
  next_panel_id   INTEGER NOT NULL DEFAULT 1,
  next_cluster_id INTEGER NOT NULL DEFAULT 1,
  sidebar_open    BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_canvas_state_user ON canvas_state(user_id);

ALTER TABLE canvas_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY canvas_state_select_own ON canvas_state
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY canvas_state_insert_own ON canvas_state
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY canvas_state_update_own ON canvas_state
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY canvas_state_delete_own ON canvas_state
  FOR DELETE USING (user_id = auth.uid());


-- ======================================================================
-- §1 · supabase/migrations/025_canvas_panels_all_types.sql   [recovered from 5ab6386^]
-- ======================================================================

-- Expand canvas_panels to store ALL panel types (not just entry panels).
-- Adds panel_type, panel_id (client-side string id), dimensions, and a
-- JSONB blob for type-specific data.

-- New columns
ALTER TABLE canvas_panels
  ADD COLUMN panel_type TEXT NOT NULL DEFAULT 'entry',
  ADD COLUMN panel_id   TEXT,
  ADD COLUMN width      FLOAT,
  ADD COLUMN height     FLOAT,
  ADD COLUMN panel_data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- entry_id is nullable for non-entry panels (chat, connection, browse, cluster-brain)
ALTER TABLE canvas_panels ALTER COLUMN entry_id DROP NOT NULL;

-- Backfill panel_id for existing entry rows
UPDATE canvas_panels SET panel_id = 'entry-' || id::text WHERE panel_id IS NULL;
ALTER TABLE canvas_panels ALTER COLUMN panel_id SET NOT NULL;

-- Replace the old unique constraint with broader panel_id-based one
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_user_id_entry_id_key;
CREATE UNIQUE INDEX idx_canvas_panels_user_panel ON canvas_panels(user_id, panel_id);

-- Keep entry-specific uniqueness (one entry panel per entry per user)
CREATE UNIQUE INDEX idx_canvas_panels_user_entry ON canvas_panels(user_id, entry_id)
  WHERE entry_id IS NOT NULL;


-- ======================================================================
-- §1 · supabase/migrations/026_user_preferences.sql   [recovered from b1817ff^]
-- ======================================================================

-- Generic key-value store for per-user preferences.
-- Used for onboarding state, bookmarks, and future user settings.

CREATE TABLE user_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_preferences_select_own ON user_preferences
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_preferences_insert_own ON user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY user_preferences_update_own ON user_preferences
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY user_preferences_delete_own ON user_preferences
  FOR DELETE USING (user_id = auth.uid());


-- ======================================================================
-- §1 · supabase/migrations/027_chat_attachments.sql   [recovered from b1817ff^]
-- ======================================================================

-- Migration: chat_attachments table + storage bucket for multimodal chat support

-- ── Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  panel_id     TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_size    INTEGER NOT NULL,
  mime_type    TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_attachments_user ON chat_attachments(user_id);
CREATE INDEX idx_chat_attachments_panel ON chat_attachments(user_id, panel_id);

ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_attachments_select_own ON chat_attachments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY chat_attachments_insert_own ON chat_attachments
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY chat_attachments_delete_own ON chat_attachments
  FOR DELETE USING (user_id = auth.uid());

-- ── Storage bucket ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,  -- 10MB
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/markdown', 'text/csv',
    'application/json'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can only access their own folder ({uid}/...)
CREATE POLICY chat_attachments_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY chat_attachments_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY chat_attachments_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ======================================================================
-- §1 · supabase/migrations/028_fix_search_order.sql   [recovered from b1817ff^]
-- ======================================================================

-- 028_fix_search_order.sql
-- Fix search_entries to return results ordered by similarity DESC instead of UUID order.
-- The DISTINCT ON (e.id) clause requires ORDER BY e.id first, but the final result set
-- was being returned in UUID order. Wrapping in a subquery fixes this.

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
  SELECT
    sub.entry_id,
    sub.title,
    sub.summary,
    sub.use_case,
    sub.complexity,
    sub.readme,
    sub.agents_md,
    sub.manifest,
    sub.similarity
  FROM (
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
  ) sub
  ORDER BY sub.similarity DESC
  LIMIT match_count;
END;
$$;


-- ======================================================================
-- §1 · supabase/migrations/029_canvas_clusters_jsonb.sql   [recovered from b1817ff^]
-- ======================================================================

-- Store canvas clusters (visual panel groupings) as a JSONB column
-- on the existing canvas_state table. Previously clusters only lived
-- in localStorage and were lost on incognito / cross-device usage.

ALTER TABLE canvas_state
  ADD COLUMN clusters JSONB NOT NULL DEFAULT '[]'::jsonb;


-- ======================================================================
-- §1 · supabase/migrations/030_credits_system.sql   [recovered from b1817ff^]
--      PARTIAL — see "WHAT IS DELIBERATELY NOT HERE" in the file header.
--      Only the profiles tier-CHECK widening is kept; it is the single
--      effect of 030 that production still has. The credits tables, their
--      policies and the backfill are omitted.
-- ======================================================================

-- Allow 'power' as a valid subscription tier (extends existing free|pro).
-- If a CHECK constraint exists, drop it and recreate with the expanded set.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'profiles'
    AND att.attname = 'subscription_tier'
    AND con.contype = 'c'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE profiles DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'pro', 'power'));


-- ======================================================================
-- §2 — RECONSTRUCTED: the three tables no git commit ever held
-- ======================================================================
--
-- Numbered files 031–034 never entered git. The three tables they must
-- have created are still live in production, so their DDL is rebuilt from
-- the production `public` dump with every later migration's additions
-- subtracted back out — otherwise those later migrations would collide
-- with a shape from the future.
--
-- ======================================================================

-- ── mcp_events ──────────────────────────────────────────────────────
-- Analytics row per MCP tool call. Reconstructed from the production
-- dump MINUS `workspace_id` (+ its FK and index), which
-- 20260707150000_skills_phase3.sql adds. `api_key_id`'s FK to api_keys
-- is real here — 20260609000000_drop_api_key_auth.sql drops api_keys
-- CASCADE, which is what removes that constraint while keeping the
-- (now plain, nullable) column. That CASCADE only works if the FK
-- exists, so it must be created here.
CREATE TABLE IF NOT EXISTS mcp_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  api_key_id        UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  tool_name         TEXT NOT NULL,
  endpoint          TEXT NOT NULL,
  arguments         JSONB,
  response_status   INTEGER,
  response_summary  JSONB,
  latency_ms        INTEGER,
  session_id        TEXT,
  source            TEXT NOT NULL DEFAULT 'mcp'
                      CHECK (source IN ('mcp', 'web', 'api')),
  error             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_events_tool         ON mcp_events (tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_events_user_created ON mcp_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_events_session      ON mcp_events (session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE mcp_events ENABLE ROW LEVEL SECURITY;

-- ── system_events ───────────────────────────────────────────────────
-- Structured server-side event log. Reconstructed from the production
-- dump MINUS idx_system_events_user_id, which
-- 20260802180000_add_missing_fk_indexes.sql adds.
CREATE TABLE IF NOT EXISTS system_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ DEFAULT now(),
  severity     TEXT NOT NULL
                 CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  category     TEXT NOT NULL,
  source       TEXT NOT NULL,
  message      TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  metadata     JSONB,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_system_events_created     ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_category    ON system_events (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_fingerprint ON system_events (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_severity    ON system_events (severity, created_at DESC)
  WHERE severity IN ('error', 'critical');

ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

-- Retention sweep. Created here WITHOUT a pinned search_path on purpose:
-- 20260619040000_security_hardening_rpc_grants.sql is the migration that
-- pins it (`alter function ... set search_path = public`), and that
-- statement has to have something to alter.
CREATE OR REPLACE FUNCTION cleanup_system_events() RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM system_events WHERE created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- ── webhook_events ──────────────────────────────────────────────────
-- Stripe webhook idempotency ledger. Reconstructed from the production
-- dump in full: no migration in the set alters this table, so its
-- current shape IS its original shape. (035_webhook_two_phase.sql is
-- misnamed — it contains credit RPCs, not the two-phase columns.)
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id      TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  processed_at  TIMESTAMPTZ DEFAULT now(),
  processed     BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ,
  last_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed      ON webhook_events (processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_flag ON webhook_events (processed, processed_at DESC);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- ── hoisted from 20260419000000_realtime_canvas_brain.sql ────────────
-- §3 below (the 2026-04-29 workspaces overhaul) backfills canvas_id on
-- cluster_brains / cluster_brain_memories via `t.user_id`, and sets
-- cluster_brain_memories.author_id from user_id. Those columns are added
-- by 20260419000000, which in the real timeline ran BEFORE the overhaul.
-- Because §3 is hoisted into this baseline it now runs first, so the two
-- ADD COLUMN statements are copied here verbatim. 20260419000000 uses
-- ADD COLUMN IF NOT EXISTS, so it still applies cleanly as a no-op.
ALTER TABLE cluster_brains
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE;

-- ======================================================================
-- §3 — RECOVERED: 20260429000000_workspaces_overhaul.sql, VERBATIM
-- ======================================================================
--
-- Deleted from the repo on 2026-06-10 (1c1e0b9) but never reverted in
-- production, and never recorded in the remote migration history either.
-- Recovered from 1c1e0b9^.
--
-- Its real timestamp is 2026-04-29, i.e. AFTER 20260416…20260422. It is
-- folded in here rather than restored at its own timestamp so that this
-- baseline is the ONLY new migration version, and therefore needs only ONE
-- `migration repair --status applied` against production. Restoring it at
-- 20260429000000 would be the more faithful record and costs one extra
-- repair — see docs/ENGINEERING.md. The single ordering dependency that
-- the fold creates is patched at the end of §2 and commented there.
--
-- ======================================================================

-- Workspaces overhaul — consolidated migration.
--
-- Bundles every schema change introduced by the canvas-as-workspace
-- pivot (Phases 0–6) into one ordered apply. The split-file history
-- was useful while developing in stages; for a fresh deploy it's
-- cleaner to land the schema as a single transaction so a partial
-- failure doesn't leave the DB half-migrated.
--
-- Sections (ordering matters — each step assumes the previous one):
--   1. Canvas tables (canvases, canvas_members, canvas_invitations)
--      + RLS policies
--   2. Add nullable canvas_id columns to every user-scoped table
--   3. Backfill: one default canvas per auth.users row, fill canvas_id
--   4. SET NOT NULL + indexes + new (canvas_id, ...) UNIQUE constraints
--   5. Drop the legacy (user_id, ...) UNIQUE constraints
--   6. Memory scope (workspace | personal) + author_id on memories
--   7. brain_version column + auto-increment trigger
--   8. canvas_state version column + auto-increment trigger
--   9. create_cluster_with_entries RPC (transactional cluster create)
--
-- Idempotent everywhere — IF NOT EXISTS / IF EXISTS / DO blocks guard
-- every CREATE / ALTER / INSERT.

-- ════════════════════════════════════════════════════════════════════
-- 1. Canvas tables
-- ════════════════════════════════════════════════════════════════════

-- canvases — the unit of sharing. One row per workspace. `slug` is
-- unique per owner (so two users can each have a canvas slug 'default')
-- and used in URLs.
CREATE TABLE IF NOT EXISTS canvases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canvases_owner_slug_unique UNIQUE (owner_id, slug)
);

CREATE INDEX IF NOT EXISTS canvases_owner_id_idx ON canvases (owner_id);

-- canvas_members — membership row per (canvas, user). The owner has
-- a row here too (role='owner', status='active') — keeping a single
-- source of truth for "who can read this canvas" simplifies query
-- joins.
CREATE TABLE IF NOT EXISTS canvas_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id   UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','revoked')),
  invited_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at  TIMESTAMPTZ,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canvas_members_canvas_user_unique UNIQUE (canvas_id, user_id)
);

CREATE INDEX IF NOT EXISTS canvas_members_user_status_idx
  ON canvas_members (user_id, status);
CREATE INDEX IF NOT EXISTS canvas_members_canvas_id_idx
  ON canvas_members (canvas_id);

-- canvas_invitations — token-based invite rows. Email is stored as
-- text — we don't require the invitee to have an account at invite
-- time. Token is the URL-safe accept link.
CREATE TABLE IF NOT EXISTS canvas_invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id     UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  invited_role  TEXT NOT NULL CHECK (invited_role IN ('admin','editor','viewer')),
  invited_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  accepted_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvas_invitations_canvas_email_idx
  ON canvas_invitations (canvas_id, email);
CREATE INDEX IF NOT EXISTS canvas_invitations_email_idx
  ON canvas_invitations (email);

-- RLS — service-role writes bypass these; they only matter for
-- realtime subscriptions and any future direct-from-client reads.
-- Members can read their canvases + own membership row. Cross-member
-- reads (listing OTHER members of a canvas) go through the API
-- (service role) to avoid recursive policy evaluation against
-- canvas_members.
ALTER TABLE canvases ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canvases_member_select ON canvases;
CREATE POLICY canvases_member_select ON canvases
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM canvas_members m
      WHERE m.canvas_id = canvases.id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS canvas_members_self_select ON canvas_members;
CREATE POLICY canvas_members_self_select ON canvas_members
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS canvas_invitations_member_select ON canvas_invitations;
CREATE POLICY canvas_invitations_member_select ON canvas_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM canvas_members m
      WHERE m.canvas_id = canvas_invitations.canvas_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.role IN ('owner','admin')
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- 2. Add nullable canvas_id columns
-- ════════════════════════════════════════════════════════════════════
--
-- `cluster_panels` (the cluster→entry junction) inherits scope through
-- its `cluster_id` FK and does not need its own canvas_id.

ALTER TABLE clusters
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE canvas_panels
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE canvas_state
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE cluster_brains
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 3. Backfill canvases + memberships + canvas_id
-- ════════════════════════════════════════════════════════════════════
--
-- Invariant after this section:
--   - Every auth.users row has at least one canvas (slug='default').
--   - Every such canvas has the owner as an active 'owner' member.
--   - Every existing row in clusters / canvas_panels / canvas_state /
--     conversations / cluster_brains / cluster_brain_memories has a
--     canvas_id pointing at its owner's default canvas.

INSERT INTO canvases (owner_id, name, slug)
SELECT u.id, 'My Canvas', 'default'
FROM auth.users u
ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO canvas_members (canvas_id, user_id, role, status, joined_at)
SELECT c.id, c.owner_id, 'owner', 'active', c.created_at
FROM canvases c
ON CONFLICT (canvas_id, user_id) DO NOTHING;

UPDATE clusters AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE canvas_panels AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE canvas_state AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE conversations AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE cluster_brains AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE cluster_brain_memories AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- 3.5. Orphan cleanup — delete rows the backfill couldn't reach
-- ════════════════════════════════════════════════════════════════════
--
-- Any row left with canvas_id = NULL after Section 3 has a user_id
-- that's NULL or points at a deleted auth.users row, so no canvas
-- exists to attach it to. There's no honest way to recover ownership
-- for these — they're orphan data from before the overhaul. Delete
-- them so the NOT NULL transition below succeeds.
--
-- Order matters: child tables first (they FK back to clusters /
-- cluster_brains), then parents.

DELETE FROM cluster_brain_memories WHERE canvas_id IS NULL;
DELETE FROM cluster_brains         WHERE canvas_id IS NULL;
DELETE FROM cluster_panels
  WHERE cluster_id IN (SELECT id FROM clusters WHERE canvas_id IS NULL);
DELETE FROM clusters       WHERE canvas_id IS NULL;
DELETE FROM canvas_panels  WHERE canvas_id IS NULL;
DELETE FROM canvas_state   WHERE canvas_id IS NULL;
DELETE FROM conversations  WHERE canvas_id IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- 4. Lock canvas_id columns down + new UNIQUE constraints
-- ════════════════════════════════════════════════════════════════════
--
-- SET NOT NULL fails loudly on any orphan row (user deleted but data
-- not cascaded) — that's the signal to clean up before re-running.

ALTER TABLE clusters                 ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE canvas_panels            ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE canvas_state             ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE conversations            ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE cluster_brains           ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE cluster_brain_memories   ALTER COLUMN canvas_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS clusters_canvas_id_idx              ON clusters (canvas_id);
CREATE INDEX IF NOT EXISTS canvas_panels_canvas_id_idx         ON canvas_panels (canvas_id);
CREATE INDEX IF NOT EXISTS conversations_canvas_id_idx         ON conversations (canvas_id);
CREATE INDEX IF NOT EXISTS cluster_brains_canvas_id_idx        ON cluster_brains (canvas_id);
CREATE INDEX IF NOT EXISTS cluster_brain_memories_canvas_id_idx
  ON cluster_brain_memories (canvas_id);

-- canvas_state's canvas_id is enforced UNIQUE below — that already
-- creates a backing index, so no separate idx for it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_state_canvas_id_key'
  ) THEN
    ALTER TABLE canvas_state
      ADD CONSTRAINT canvas_state_canvas_id_key UNIQUE (canvas_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_panels_canvas_panel_unique'
  ) THEN
    ALTER TABLE canvas_panels
      ADD CONSTRAINT canvas_panels_canvas_panel_unique UNIQUE (canvas_id, panel_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_canvas_panel_unique'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_canvas_panel_unique UNIQUE (canvas_id, panel_id);
  END IF;
END $$;

-- cluster_brains keeps its existing UNIQUE(cluster_id) — one brain per
-- cluster, regardless of which canvas the cluster belongs to.

-- ════════════════════════════════════════════════════════════════════
-- 5. Drop legacy (user_id, ...) UNIQUE constraints
-- ════════════════════════════════════════════════════════════════════
--
-- Pre-overhaul, canvas_state had UNIQUE(user_id), and canvas_panels +
-- conversations had UNIQUE(user_id, panel_id). Those constraints
-- enforced the right invariant under the single-canvas world but
-- break the moment a user owns a second canvas: the new canvas's
-- first write hits the legacy constraint because the user already
-- has a row pointing at their first canvas.
--
-- Introspect pg_constraint and drop any UNIQUE on the legacy column
-- sets, regardless of constraint name (Postgres-default `_key` suffix
-- vs custom — both are caught).

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.canvas_state'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attnum)
        FROM pg_attribute att
        WHERE att.attrelid = pg_constraint.conrelid
          AND att.attnum = ANY (pg_constraint.conkey)
      ) = ARRAY['user_id']
  LOOP
    EXECUTE format('ALTER TABLE canvas_state DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.canvas_panels'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attnum)
        FROM pg_attribute att
        WHERE att.attrelid = pg_constraint.conrelid
          AND att.attnum = ANY (pg_constraint.conkey)
      ) = ARRAY['user_id', 'panel_id']
  LOOP
    EXECUTE format('ALTER TABLE canvas_panels DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.conversations'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attnum)
        FROM pg_attribute att
        WHERE att.attrelid = pg_constraint.conrelid
          AND att.attnum = ANY (pg_constraint.conkey)
      ) = ARRAY['user_id', 'panel_id']
  LOOP
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 6. Memory scope (workspace | personal) + author_id
-- ════════════════════════════════════════════════════════════════════
--
-- Visibility rule: workspace memories visible to every active member;
-- personal memories visible only to their author. The auth gate
-- already filters by canvas membership; these columns add the
-- per-row author + scope so the API can apply the second filter.

ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE cluster_brain_memories SET author_id = user_id WHERE author_id IS NULL;
UPDATE cluster_brain_memories SET scope = 'workspace' WHERE scope IS NULL;

ALTER TABLE cluster_brain_memories ALTER COLUMN author_id SET NOT NULL;
ALTER TABLE cluster_brain_memories ALTER COLUMN scope SET NOT NULL;
ALTER TABLE cluster_brain_memories ALTER COLUMN scope SET DEFAULT 'workspace';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cluster_brain_memories_scope_check'
  ) THEN
    ALTER TABLE cluster_brain_memories
      ADD CONSTRAINT cluster_brain_memories_scope_check
        CHECK (scope IN ('workspace', 'personal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cluster_brain_memories_brain_scope_idx
  ON cluster_brain_memories (cluster_brain_id, scope);
CREATE INDEX IF NOT EXISTS cluster_brain_memories_author_id_idx
  ON cluster_brain_memories (author_id);

-- ════════════════════════════════════════════════════════════════════
-- 7. brain_version + auto-increment trigger
-- ════════════════════════════════════════════════════════════════════
--
-- sync_skills decides "is this skill file up to date?" by version
-- match. The trigger uses IS DISTINCT FROM so a no-op write doesn't
-- invalidate every agent's cache.

ALTER TABLE cluster_brains
  ADD COLUMN IF NOT EXISTS brain_version BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_cluster_brain_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.instructions IS DISTINCT FROM OLD.instructions THEN
    NEW.brain_version := COALESCE(OLD.brain_version, 0) + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cluster_brains_version_bump'
  ) THEN
    CREATE TRIGGER cluster_brains_version_bump
      BEFORE UPDATE ON cluster_brains
      FOR EACH ROW
      EXECUTE FUNCTION bump_cluster_brain_version();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 8. canvas_state version + auto-increment trigger
-- ════════════════════════════════════════════════════════════════════
--
-- Optimistic locking: any UPDATE bumps the version, so two-tab races
-- resolve as 409 + refetch instead of silent overwrites.

ALTER TABLE canvas_state
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_canvas_state_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'canvas_state_version_bump'
  ) THEN
    CREATE TRIGGER canvas_state_version_bump
      BEFORE UPDATE ON canvas_state
      FOR EACH ROW
      EXECUTE FUNCTION bump_canvas_state_version();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 9. create_cluster_with_entries RPC
-- ════════════════════════════════════════════════════════════════════
--
-- The old createCluster service did two writes back-to-back: insert
-- the cluster row, then insert the cluster_panels junction rows. If
-- the second one fails the first is already committed and we get an
-- orphan cluster. The RPC wraps both writes in a Postgres function,
-- which Supabase runs atomically — either both inserts land or
-- neither does.
--
-- The TS service layer keeps the canvas-side-effects (brain panel +
-- canvas_state hydration) outside the RPC because they're already
-- non-fatal and tolerant of partial success.

CREATE OR REPLACE FUNCTION create_cluster_with_entries(
  p_canvas_id UUID,
  p_user_id UUID,
  p_name TEXT,
  p_slug TEXT,
  p_entry_ids UUID[]
)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_cluster_id UUID;
  new_cluster_row RECORD;
BEGIN
  INSERT INTO clusters (canvas_id, user_id, name, slug)
  VALUES (p_canvas_id, p_user_id, p_name, p_slug)
  RETURNING clusters.id INTO new_cluster_id;

  IF p_entry_ids IS NOT NULL AND array_length(p_entry_ids, 1) > 0 THEN
    INSERT INTO cluster_panels (cluster_id, entry_id)
    SELECT new_cluster_id, unnest(p_entry_ids);
  END IF;

  SELECT
    c.id,
    c.slug,
    c.name,
    c.created_at,
    c.updated_at
  INTO new_cluster_row
  FROM clusters c
  WHERE c.id = new_cluster_id;

  id := new_cluster_row.id;
  slug := new_cluster_row.slug;
  name := new_cluster_row.name;
  created_at := new_cluster_row.created_at;
  updated_at := new_cluster_row.updated_at;
  RETURN NEXT;
END;
$$;

-- The RPC is invoked exclusively from server-side code via the
-- service role. By default Postgres grants EXECUTE on functions to
-- PUBLIC, which means anon + authenticated roles can call the RPC
-- via Supabase's PostgREST RPC endpoint as if they were service role
-- (because of SECURITY DEFINER). Revoke that — only service role can
-- call this. The TS service layer's `resolveActiveCanvas` gates
-- access before the function is ever touched on the server side.

REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) TO service_role;
