-- Ontology cluster cascade HARD delete — ATOMIC RPC (soft-delete removal, §2b).
--
-- Why: deleting is now PERMANENT and IMMEDIATE (product decision 2026-08-07,
-- RETIREMENT-UNWIRING-PLAN §2b / D6). Trash, restore and the retention purge
-- are gone, so `deleteCluster` needs a hard-delete cascade of the same shape
-- the soft-delete cascade had.
--
-- Why an RPC rather than composing the two existing ones: the atomicity is the
-- whole point. `cascade_soft_delete_cluster` (migration 20260718000040) exists
-- BECAUSE the old two-write JS sequence could commit the object write and lose
-- the cluster write, leaving objects trashed under a live cluster. Composing
-- `cascade_soft_delete_cluster` + `cascade_purge_cluster` from the service would
-- re-introduce exactly that failure mode, and worse: a crash between the two
-- calls leaves the objects HARD-GONE with the cluster surviving as a tombstone
-- that no surviving code path can ever reach. One function body = both DELETEs
-- commit or neither does.
--
-- This function is `cascade_purge_cluster` (migration 20260718000060) with the
-- trash predicates removed: it resolves a LIVE cluster by id and deletes every
-- object in its membership tree regardless of `deleted_at`. Deleting tombstoned
-- objects under it is intentional — with trash gone they are unreachable
-- garbage, and the one-time sweep (20260807110000) removes the rest.
--
-- Object collection walks the same recursive `UNION` CTE over
-- `ontology_memberships` (the cluster's column links plus every nested
-- parent->child link); `UNION` (not `UNION ALL`) dedupes the working set and
-- doubles as the cycle guard when an object is shared across parents. Every
-- statement is scoped by `workspace_id` so the service-role bypass of RLS stays
-- contained.
--
-- Ordering: objects are deleted BEFORE the cluster. The recursive CTE finds the
-- cluster's columns via `ontology_memberships.cluster_id`; deleting the cluster
-- first would cascade those membership rows away (ON DELETE CASCADE) and leave
-- the CTE unable to collect the objects. `ontology_memberships` and
-- `ontology_relationships` both FK to objects/cluster with ON DELETE CASCADE
-- (verified in 20260706120000_ontology.sql), so the two hard DELETEs clear the
-- join rows automatically — no explicit membership/relationship delete needed.
--
-- Returns the number of objects deleted, or NULL (not 0) when no live cluster
-- matched, so the service can tell "nothing matched" (404) from "deleted a
-- cluster that owned 0 objects" (count 0) — same contract as
-- `cascade_purge_cluster`.
--
-- SECURITY INVOKER (default) with a pinned `search_path`; called exclusively
-- through the service-role client (`supabaseAdmin`), so EXECUTE is granted to
-- `service_role` only.
--
-- The soft-delete / restore / purge RPCs are deliberately LEFT IN PLACE and
-- unreferenced: this migration adds a function, it does not tear the old model
-- down. Dropping them is a later, separate schema cleanup (the `deleted_at`
-- columns stay too).

CREATE OR REPLACE FUNCTION cascade_hard_delete_cluster(
  p_workspace_id UUID,
  p_cluster_id   UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cluster ontology_clusters%ROWTYPE;
  v_count   INTEGER;
BEGIN
  -- Resolve the LIVE cluster (workspace-scoped). Legacy tombstones are not
  -- addressable here — the one-time sweep owns those.
  SELECT * INTO v_cluster
    FROM ontology_clusters
   WHERE workspace_id = p_workspace_id
     AND id = p_cluster_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    -- NULL (not 0) so the service can tell "nothing matched" (404) from
    -- "deleted a cluster that owned 0 objects" (count 0).
    RETURN NULL;
  END IF;

  -- Hard-delete every object the cluster owns: its columns plus every nested
  -- card underneath them. Must run before the cluster delete (see header).
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
     AND o.id IN (SELECT id FROM cluster_objects);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM ontology_clusters
   WHERE workspace_id = p_workspace_id
     AND id = v_cluster.id;

  RETURN v_count;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- Grants — service-role only (called exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION cascade_hard_delete_cluster(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION cascade_hard_delete_cluster(UUID, UUID) TO service_role;
