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
