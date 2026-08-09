-- Two more ATOMIC hard-delete cascades (soft-delete removal, §2b) — the ones
-- 20260807120000 left behind when it fixed the cluster path.
--
--   1. cascade_hard_delete_folder  — knowledge folder subtree
--   2. cascade_hard_delete_object  — ontology object subtree
--
-- Both close the SAME two failures the cluster RPC closed, for the same reason:
-- with trash, restore and the retention purge gone (2026-08-07), a delete that
-- half-lands is not a recoverable mess — it is permanent, unreconstructible
-- damage. Quoting 20260807120000's own argument: "One function body = both
-- DELETEs commit or neither."
--
-- Additive and deploy-safe on their own (they add functions and touch no data),
-- but the SERVICE code that calls them ships in the same change, so treat all
-- three of the 202608071*0000 delete RPCs as one deploy unit.


-- ════════════════════════════════════════════════════════════════════
-- 1. cascade_hard_delete_folder — knowledge folder subtree
-- ════════════════════════════════════════════════════════════════════
--
-- Replaces `hardDeleteFolder`'s JS sequence (repository-folders.ts): N SELECTs
-- to walk `parent_id` breadth-first, then TWO independent DELETEs with nothing
-- binding them. The torn state is specific and unrecoverable: the entries
-- DELETE commits, the folder DELETE fails, and the user is left with a folder
-- that still exists and is now empty — its notes permanently gone, with no
-- trash to fish them out of. That is strictly worse than either the delete
-- succeeding or the delete failing.
--
-- ORDERING IS LOAD-BEARING and is preserved exactly from the JS: entries are
-- deleted BEFORE the folder. `knowledge_entries.folder_id` is
-- `ON DELETE SET NULL` (20260501000000_knowledge_bases.sql:54), so deleting the
-- folder first would not remove its entries — it would ORPHAN them into the
-- base root, which is a silent corruption rather than a delete. Descendant
-- FOLDERS need no explicit statement: `knowledge_folders.parent_id` is
-- `ON DELETE CASCADE` (line 40), so the single root-folder DELETE sweeps them.
-- The subtree CTE exists only to find the ENTRIES that would otherwise survive
-- as orphans, which is why it collects folder ids and the entry DELETE matches
-- on `folder_id IN (subtree)`.
--
-- `UNION` (not `UNION ALL`) dedupes and doubles as the cycle guard, matching
-- the cluster RPC. Every statement is workspace-scoped so the service-role
-- bypass of RLS stays contained.
--
-- Returns the number of ENTRIES deleted, or NULL when no folder matched the id
-- in that workspace — same "nothing matched" vs. "deleted an empty folder"
-- contract as `cascade_hard_delete_cluster`.

CREATE OR REPLACE FUNCTION cascade_hard_delete_folder(
  p_workspace_id UUID,
  p_folder_id    UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_folder_ids UUID[];
  v_count      INTEGER;
BEGIN
  -- Resolve the folder and its whole descendant subtree in one walk. Note the
  -- deliberate absence of a `deleted_at IS NULL` predicate: legacy tombstoned
  -- folders under a live one are unreachable garbage now that trash is gone,
  -- and leaving them would strand their entries (same call the cluster RPC
  -- makes about tombstoned objects).
  WITH RECURSIVE subtree AS (
    SELECT f.id
      FROM knowledge_folders f
     WHERE f.workspace_id = p_workspace_id
       AND f.id = p_folder_id
    UNION
    SELECT f.id
      FROM knowledge_folders f
      INNER JOIN subtree s ON f.parent_id = s.id
     WHERE f.workspace_id = p_workspace_id
  )
  SELECT array_agg(id) INTO v_folder_ids FROM subtree;

  IF v_folder_ids IS NULL THEN
    -- No folder with that id in this workspace. NULL (not 0) so the caller can
    -- tell it apart from "deleted a folder that held 0 entries".
    RETURN NULL;
  END IF;

  -- Entries FIRST (folder_id is ON DELETE SET NULL — see header).
  DELETE FROM knowledge_entries e
   WHERE e.workspace_id = p_workspace_id
     AND e.folder_id = ANY (v_folder_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Then the root folder; descendant folders cascade via parent_id.
  DELETE FROM knowledge_folders f
   WHERE f.workspace_id = p_workspace_id
     AND f.id = p_folder_id;

  RETURN v_count;
END
$$;


-- ════════════════════════════════════════════════════════════════════
-- 2. cascade_hard_delete_object — ontology object subtree
-- ════════════════════════════════════════════════════════════════════
--
-- THE BUG THIS FIXES IS DATA INTEGRITY, not atomicity.
--
-- `hardDeleteObject` deletes exactly one `ontology_objects` row. Every FK into
-- that row is `ON DELETE CASCADE` — but they are the MEMBERSHIP rows, not the
-- child objects (20260706120000_ontology.sql:64: `parent_object_id ...
-- ON DELETE CASCADE` lives on `ontology_memberships`). So deleting a column or
-- a card removes the LINKS to everything underneath it and leaves those objects
-- alive, parented to nothing.
--
-- An object with no membership row is reachable through NOTHING. The service
-- builds `columnIds`/`childIds` from memberships; the kanban board, the graph
-- derivation and the object picker all walk down from `cluster.columnIds`. The
-- row is invisible in every surface, cannot be relinked (the links are gone,
-- not tombstoned), and — because `workspace-billing.ts` counts every
-- `deleted_at IS NULL` object — permanently consumes the workspace's object
-- quota. Under soft-delete none of this happened: the memberships survived and
-- `cascade_restore_cluster` re-linked the tree.
--
-- WHAT IT DELETES, AND WHAT IT DELIBERATELY DOES NOT. The target object always
-- goes. A descendant goes only if the target was its LAST way in. An object may
-- legitimately hang under two parents (the `(parent_object_id, child_object_id)`
-- unique index is per-pair, and the cluster RPC's own `UNION` exists because
-- "an object is shared across parents" is a real state) — a shared card must
-- survive on the board that still holds it. So this does not blind-delete the
-- subtree: it deletes the root, then repeatedly deletes subtree members that
-- have been left with NO membership at all, which is exactly the orphan
-- condition. The loop is needed because each round's deletes cascade away the
-- next level's links, exposing the next round's orphans; it terminates because
-- the candidate set is a fixed array that only shrinks.
--
-- `ontology_relationships` (both directions) cascades on every object delete,
-- so edges never need naming here.
--
-- Returns the number of DESCENDANTS deleted alongside the target (0 for a leaf
-- or a fully-shared subtree), or NULL when no object matched the id in that
-- workspace — the same contract as the cluster RPC, and enough for the UI to
-- say what a delete will actually take.

CREATE OR REPLACE FUNCTION cascade_hard_delete_object(
  p_workspace_id UUID,
  p_object_id    UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_descendants UUID[];
  v_total       INTEGER := 0;
  v_round       INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ontology_objects
     WHERE workspace_id = p_workspace_id AND id = p_object_id
  ) THEN
    RETURN NULL;
  END IF;

  -- Everything under the target, at any depth. `UNION` dedupes and guards
  -- against a cycle in the membership graph (same construction as
  -- `cascade_hard_delete_cluster`). The target itself is excluded.
  WITH RECURSIVE descendants AS (
    SELECT m.child_object_id AS id
      FROM ontology_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.parent_object_id = p_object_id
    UNION
    SELECT m.child_object_id
      FROM ontology_memberships m
      INNER JOIN descendants d ON m.parent_object_id = d.id
     WHERE m.workspace_id = p_workspace_id
  )
  SELECT array_agg(id) INTO v_descendants
    FROM descendants
   WHERE id <> p_object_id;

  -- The target. Its memberships (as parent AND as child) cascade off, which is
  -- what strands the level-1 descendants the loop below then collects.
  DELETE FROM ontology_objects
   WHERE workspace_id = p_workspace_id
     AND id = p_object_id;

  IF v_descendants IS NULL THEN
    RETURN 0;
  END IF;

  -- Sweep the newly parentless. A descendant that still has ANY membership row
  -- is reachable from somewhere else (another parent, or directly from a
  -- cluster as a column) and is left alone.
  LOOP
    DELETE FROM ontology_objects o
     WHERE o.workspace_id = p_workspace_id
       AND o.id = ANY (v_descendants)
       AND NOT EXISTS (
         SELECT 1 FROM ontology_memberships m WHERE m.child_object_id = o.id
       );
    GET DIAGNOSTICS v_round = ROW_COUNT;
    v_total := v_total + v_round;
    EXIT WHEN v_round = 0;
  END LOOP;

  RETURN v_total;
END
$$;


-- ════════════════════════════════════════════════════════════════════
-- Grants — service-role only (both are called exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION cascade_hard_delete_folder(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cascade_hard_delete_object(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION cascade_hard_delete_folder(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION cascade_hard_delete_object(UUID, UUID) TO service_role;
