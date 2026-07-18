-- Ontology cluster cascade soft-delete / restore — ATOMIC RPCs (F-042 follow-up).
--
-- Why: `deleteCluster` used to do TWO non-transactional service-layer writes —
-- stamp the objects, then stamp the cluster — sharing a JS timestamp. If the
-- object write committed but the cluster write failed, objects were trashed
-- while the cluster stayed LIVE, and `restore_cluster` (which only finds a
-- TRASHED cluster) could never reach them. Retrying delete was worse: the
-- `deleted_at IS NULL` guard skipped the already-trashed objects, so the cluster
-- got a NEW timestamp — now cluster.deleted_at <> objects.deleted_at, and
-- restore's exact-timestamp match revived the cluster onto an EMPTY board,
-- permanently orphaning the objects. Reordering doesn't help — the retry desync
-- is symmetric. Only atomicity fixes it.
--
-- This migration mirrors the knowledge-base cascade RPCs
-- (`cascade_soft_delete_base` / `cascade_restore_base`, migration
-- 20260501040000): each cascade is now ONE PL/pgSQL function body, so the
-- object writes and the cluster write commit or roll back together — a partial
-- failure can never leave the two out of sync.
--
-- Object collection walks `ontology_memberships` (the cluster's column links
-- plus every nested parent→child link) with a recursive CTE. `UNION` (not
-- `UNION ALL`) dedupes the working set, which doubles as the cycle guard when
-- an object is shared across parents. Every statement is scoped by
-- `workspace_id` so the service-role bypass of RLS stays contained.
--
-- Both functions are SECURITY INVOKER (default) with a pinned `search_path`;
-- they're only ever called through the service-role client (`supabaseAdmin`),
-- which bypasses RLS, so EXECUTE is granted to `service_role` only.

-- ════════════════════════════════════════════════════════════════════
-- 1. cascade_soft_delete_cluster
-- ════════════════════════════════════════════════════════════════════
--
-- Stamps ONE shared `now()` on the cluster + every object it owns (its columns
-- plus all nested descendants) that is still LIVE. The `deleted_at IS NULL`
-- guard makes it idempotent and leaves independently-trashed objects on their
-- own timestamp, so `cascade_restore_cluster` (which revives only rows sharing
-- the cluster's stamp) leaves them in the trash. Returns the number of objects
-- newly soft-deleted (the set restore will revive).

CREATE OR REPLACE FUNCTION cascade_soft_delete_cluster(
  p_workspace_id UUID,
  p_cluster_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ := now();
  v_count INTEGER;
BEGIN
  WITH RECURSIVE cluster_objects AS (
    -- Columns: memberships that link the object directly to the cluster.
    SELECT m.child_object_id AS id
      FROM ontology_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.cluster_id = p_cluster_id
    UNION
    -- Nested cards: walk parent_object_id links down from the columns.
    SELECT m.child_object_id
      FROM ontology_memberships m
      INNER JOIN cluster_objects co ON m.parent_object_id = co.id
     WHERE m.workspace_id = p_workspace_id
  )
  UPDATE ontology_objects o
     SET deleted_at = v_deleted_at
   WHERE o.workspace_id = p_workspace_id
     AND o.deleted_at IS NULL
     AND o.id IN (SELECT id FROM cluster_objects);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE ontology_clusters
     SET deleted_at = v_deleted_at
   WHERE workspace_id = p_workspace_id
     AND id = p_cluster_id
     AND deleted_at IS NULL;

  RETURN v_count;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- 2. cascade_restore_cluster
-- ════════════════════════════════════════════════════════════════════
--
-- Finds the TRASHED cluster by id OR slug (scoped to the workspace; the
-- newest-trashed one wins when a reused slug left several tombstones), captures
-- its `deleted_at`, then in the same transaction restores the objects whose
-- `deleted_at` still matches that stamp and clears the cluster. Objects trashed
-- independently keep their own timestamp and stay in the trash.
--
-- If a LIVE cluster reused the slug while this one sat in the trash, restoring
-- as-is would violate the partial-unique active-slug index, so the cluster is
-- re-slugged off its name (mirrors the JS `restoreCluster`/`restoreWorkflow`
-- re-slug). Returns the restored cluster row, or no rows when nothing matched
-- (the service turns that into a 404).
--
-- `id::text = p_cluster_ref` compares without casting the ref to uuid, so a
-- non-UUID slug ref can't raise an invalid-uuid error.

CREATE OR REPLACE FUNCTION cascade_restore_cluster(
  p_workspace_id UUID,
  p_cluster_ref TEXT
) RETURNS SETOF ontology_clusters
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cluster   ontology_clusters%ROWTYPE;
  v_base_slug TEXT;
  v_new_slug  TEXT;
  v_suffix    INTEGER;
BEGIN
  SELECT * INTO v_cluster
    FROM ontology_clusters
   WHERE workspace_id = p_workspace_id
     AND deleted_at IS NOT NULL
     AND (slug = p_cluster_ref OR id::text = p_cluster_ref)
   ORDER BY deleted_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Revive the cascaded objects off the cluster's still-set trash timestamp.
  WITH RECURSIVE cluster_objects AS (
    SELECT m.child_object_id AS id
      FROM ontology_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.cluster_id = v_cluster.id
    UNION
    SELECT m.child_object_id
      FROM ontology_memberships m
      INNER JOIN cluster_objects co ON m.parent_object_id = co.id
     WHERE m.workspace_id = p_workspace_id
  )
  UPDATE ontology_objects o
     SET deleted_at = NULL
   WHERE o.workspace_id = p_workspace_id
     AND o.deleted_at = v_cluster.deleted_at
     AND o.id IN (SELECT id FROM cluster_objects);

  -- Re-slug only when a LIVE cluster reused this slug while it was trashed.
  v_new_slug := v_cluster.slug;
  IF EXISTS (
    SELECT 1 FROM ontology_clusters
     WHERE workspace_id = p_workspace_id
       AND deleted_at IS NULL
       AND slug = v_cluster.slug
  ) THEN
    -- Derive the base off the NAME (slugify parity: lowercase, non-alphanumeric
    -- runs collapse to a single hyphen, trim hyphens, fall back to 'cluster').
    v_base_slug := regexp_replace(lower(v_cluster.name), '[^a-z0-9]+', '-', 'g');
    v_base_slug := regexp_replace(v_base_slug, '^-+|-+$', '', 'g');
    IF v_base_slug = '' THEN
      v_base_slug := 'cluster';
    END IF;
    v_new_slug := v_base_slug;
    v_suffix := 2;
    WHILE EXISTS (
      SELECT 1 FROM ontology_clusters
       WHERE workspace_id = p_workspace_id
         AND deleted_at IS NULL
         AND slug = v_new_slug
    ) LOOP
      v_new_slug := v_base_slug || '-' || v_suffix;
      v_suffix := v_suffix + 1;
    END LOOP;
  END IF;

  RETURN QUERY
    UPDATE ontology_clusters
       SET deleted_at = NULL,
           slug = v_new_slug
     WHERE workspace_id = p_workspace_id
       AND id = v_cluster.id
       AND deleted_at IS NOT NULL
    RETURNING *;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Grants — service-role only (called exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION cascade_soft_delete_cluster(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cascade_restore_cluster(UUID, TEXT)     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION cascade_soft_delete_cluster(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION cascade_restore_cluster(UUID, TEXT)     TO service_role;
