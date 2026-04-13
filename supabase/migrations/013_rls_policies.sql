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
