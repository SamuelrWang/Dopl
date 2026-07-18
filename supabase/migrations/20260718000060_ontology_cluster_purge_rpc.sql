-- Ontology cluster PERMANENT purge — ATOMIC RPC (Trash-page Phase 1).
--
-- Why: Trash needs a "delete forever" that hard-DELETEs a TRASHED cluster and
-- exactly the objects its cascade soft-delete trashed, in ONE transaction. The
-- daily retention sweep (`/api/cron/purge-trash`) already hard-deletes aged
-- rows wholesale by `deleted_at`; this is the targeted, user-initiated purge of
-- a single cluster from the Trash view.
--
-- Mirrors `cascade_soft_delete_cluster` (migration 20260718000040) but HARD
-- DELETEs instead of stamping `deleted_at`. Object collection walks the same
-- recursive `UNION` CTE over `ontology_memberships` (the cluster's column links
-- plus every nested parent->child link); `UNION` (not `UNION ALL`) dedupes the
-- working set and doubles as the cycle guard when an object is shared across
-- parents. Every statement is scoped by `workspace_id` so the service-role
-- bypass of RLS stays contained.
--
-- Only a TRASHED cluster is purgeable: the resolve filters `deleted_at IS NOT
-- NULL`, and returns NULL (not 0) when nothing matched so the service can
-- surface a 404, exactly like `cascade_restore_cluster`. `id::text = ref`
-- compares without casting the ref to uuid, so a non-UUID slug ref can't raise
-- an invalid-uuid error.
--
-- Ordering: objects are deleted BEFORE the cluster. The recursive CTE finds the
-- cluster's columns via `ontology_memberships.cluster_id`; deleting the cluster
-- first would cascade those membership rows away (ON DELETE CASCADE) and leave
-- the CTE unable to collect the objects. `ontology_memberships` and
-- `ontology_relationships` both FK to objects/cluster with ON DELETE CASCADE
-- (verified in 20260706120000_ontology.sql), so the two hard DELETEs clear the
-- join rows automatically — no explicit membership/relationship delete needed.
--
-- SECURITY INVOKER (default) with a pinned `search_path`; called exclusively
-- through the service-role client (`supabaseAdmin`), so EXECUTE is granted to
-- `service_role` only.

CREATE OR REPLACE FUNCTION cascade_purge_cluster(
  p_workspace_id UUID,
  p_cluster_ref  TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cluster ontology_clusters%ROWTYPE;
  v_count   INTEGER;
BEGIN
  -- Resolve the TRASHED cluster by id OR slug (workspace-scoped; the
  -- newest-trashed one wins when a reused slug left several tombstones).
  SELECT * INTO v_cluster
    FROM ontology_clusters
   WHERE workspace_id = p_workspace_id
     AND deleted_at IS NOT NULL
     AND (slug = p_cluster_ref OR id::text = p_cluster_ref)
   ORDER BY deleted_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    -- NULL (not 0) so the service can tell "nothing matched" (404) from
    -- "purged a cluster that owned 0 objects" (count 0).
    RETURN NULL;
  END IF;

  -- Hard-delete exactly the objects the cluster's cascade soft-delete trashed:
  -- those in the cluster's membership tree whose `deleted_at` still matches the
  -- cluster's trash stamp. Objects trashed independently carry a different
  -- stamp and are left alone. Must run before the cluster delete (see header).
  WITH RECURSIVE cluster_objects AS (
    -- Columns: memberships that link the object directly to the cluster.
    SELECT m.child_object_id AS id
      FROM ontology_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.cluster_id = v_cluster.id
    UNION
    -- Nested cards: walk parent_object_id links down from the columns.
    SELECT m.child_object_id
      FROM ontology_memberships m
      INNER JOIN cluster_objects co ON m.parent_object_id = co.id
     WHERE m.workspace_id = p_workspace_id
  )
  DELETE FROM ontology_objects o
   WHERE o.workspace_id = p_workspace_id
     AND o.deleted_at = v_cluster.deleted_at
     AND o.id IN (SELECT id FROM cluster_objects);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM ontology_clusters
   WHERE workspace_id = p_workspace_id
     AND id = v_cluster.id
     AND deleted_at IS NOT NULL;

  RETURN v_count;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- Grants — service-role only (called exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION cascade_purge_cluster(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION cascade_purge_cluster(UUID, TEXT) TO service_role;
