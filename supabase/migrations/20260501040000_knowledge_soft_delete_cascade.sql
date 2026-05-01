-- Knowledge soft-delete cascade (audit PR-3, findings #7 + #15).
--
-- Until now, soft-delete on a base or folder did NOT propagate to
-- descendants. The audit confirmed:
--   * Trashing folder F leaves F's children with `deleted_at = NULL` —
--     they're invisible in the tree (because tree walks parent_id) but
--     `kb_search` happily returns them, and they re-attach to the
--     wrong place if a sibling is moved.
--   * After the 30-day cron purge, the parent's CASCADE FK wipes the
--     orphans — so the data eventually consistents itself, but during
--     the trash window the model is broken.
--
-- This migration:
--   1. Adds four PL/pgSQL functions that perform an atomic cascade.
--      Soft-delete stamps the parent + every active descendant with
--      the same timestamp; restore matches on that timestamp so an
--      independently-trashed descendant (different timestamp) stays
--      trashed when its ancestor restores.
--   2. Backfills existing orphans: every active row under a currently-
--      trashed parent gets the parent's `deleted_at`. Processed in
--      `deleted_at ASC` order so deeper-but-earlier events stamp first
--      and ancestor cascades skip already-stamped subtrees.
--
-- After this migration the repository switches `markBaseDeleted` /
-- `markFolderDeleted` / `restoreBaseRow` / `restoreFolderRow` to call
-- these RPCs. The search RPC (`search_knowledge_entries`) needs no
-- change — it filters `e.deleted_at IS NULL`, which now correctly
-- excludes cascaded entries.
--
-- All four functions are SECURITY INVOKER (default). They're called
-- from the service via the supabase service-role client, which
-- bypasses RLS. Granting EXECUTE to authenticated keeps the door open
-- for future client-side calls without re-issuing grants.

-- ════════════════════════════════════════════════════════════════════
-- 1. cascade_soft_delete_base
-- ════════════════════════════════════════════════════════════════════
--
-- Stamps `deleted_at = p_deleted_at` on the base + every active folder
-- + every active entry in that base. Idempotent — already-trashed rows
-- are skipped via the `AND deleted_at IS NULL` filter, so calling on a
-- partially-trashed base only stamps the still-active rows.

CREATE OR REPLACE FUNCTION cascade_soft_delete_base(
  p_base_id UUID,
  p_deleted_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE knowledge_entries
     SET deleted_at = p_deleted_at
   WHERE knowledge_base_id = p_base_id
     AND deleted_at IS NULL;

  UPDATE knowledge_folders
     SET deleted_at = p_deleted_at
   WHERE knowledge_base_id = p_base_id
     AND deleted_at IS NULL;

  UPDATE knowledge_bases
     SET deleted_at = p_deleted_at
   WHERE id = p_base_id
     AND deleted_at IS NULL;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- 2. cascade_restore_base
-- ════════════════════════════════════════════════════════════════════
--
-- Reads the base's current deleted_at, then restores everything under
-- the base whose deleted_at matches. Independently-trashed rows (with
-- different timestamps) stay trashed.
--
-- No-op if the base is already active.

CREATE OR REPLACE FUNCTION cascade_restore_base(p_base_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT deleted_at INTO v_deleted_at
    FROM knowledge_bases
   WHERE id = p_base_id;

  IF v_deleted_at IS NULL THEN
    RETURN;
  END IF;

  UPDATE knowledge_entries
     SET deleted_at = NULL
   WHERE knowledge_base_id = p_base_id
     AND deleted_at = v_deleted_at;

  UPDATE knowledge_folders
     SET deleted_at = NULL
   WHERE knowledge_base_id = p_base_id
     AND deleted_at = v_deleted_at;

  UPDATE knowledge_bases
     SET deleted_at = NULL
   WHERE id = p_base_id;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. cascade_soft_delete_folder
-- ════════════════════════════════════════════════════════════════════
--
-- Walks the descendant tree via recursive CTE (intentionally NOT
-- filtering on deleted_at in the walk — a trashed intermediate folder
-- still has descendants we want to find). Stamps every active folder
-- and entry in the subtree with the given timestamp.
--
-- The descendant set includes the folder itself, so this also stamps
-- the target folder (matching the historic `markFolderDeleted` semantics).

CREATE OR REPLACE FUNCTION cascade_soft_delete_folder(
  p_folder_id UUID,
  p_deleted_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  WITH RECURSIVE descendant_folders AS (
    SELECT id FROM knowledge_folders WHERE id = p_folder_id
    UNION ALL
    SELECT f.id
      FROM knowledge_folders f
      INNER JOIN descendant_folders d ON f.parent_id = d.id
  )
  UPDATE knowledge_entries
     SET deleted_at = p_deleted_at
   WHERE folder_id IN (SELECT id FROM descendant_folders)
     AND deleted_at IS NULL;

  WITH RECURSIVE descendant_folders AS (
    SELECT id FROM knowledge_folders WHERE id = p_folder_id
    UNION ALL
    SELECT f.id
      FROM knowledge_folders f
      INNER JOIN descendant_folders d ON f.parent_id = d.id
  )
  UPDATE knowledge_folders
     SET deleted_at = p_deleted_at
   WHERE id IN (SELECT id FROM descendant_folders)
     AND deleted_at IS NULL;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- 4. cascade_restore_folder
-- ════════════════════════════════════════════════════════════════════
--
-- Mirror of cascade_restore_base for folders. Walks the same recursive
-- CTE and restores rows whose deleted_at exactly matches the folder's.

CREATE OR REPLACE FUNCTION cascade_restore_folder(p_folder_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT deleted_at INTO v_deleted_at
    FROM knowledge_folders
   WHERE id = p_folder_id;

  IF v_deleted_at IS NULL THEN
    RETURN;
  END IF;

  WITH RECURSIVE descendant_folders AS (
    SELECT id FROM knowledge_folders WHERE id = p_folder_id
    UNION ALL
    SELECT f.id
      FROM knowledge_folders f
      INNER JOIN descendant_folders d ON f.parent_id = d.id
  )
  UPDATE knowledge_entries
     SET deleted_at = NULL
   WHERE folder_id IN (SELECT id FROM descendant_folders)
     AND deleted_at = v_deleted_at;

  WITH RECURSIVE descendant_folders AS (
    SELECT id FROM knowledge_folders WHERE id = p_folder_id
    UNION ALL
    SELECT f.id
      FROM knowledge_folders f
      INNER JOIN descendant_folders d ON f.parent_id = d.id
  )
  UPDATE knowledge_folders
     SET deleted_at = NULL
   WHERE id IN (SELECT id FROM descendant_folders)
     AND deleted_at = v_deleted_at;
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- 5. Grants
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION cascade_soft_delete_base(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION cascade_restore_base(UUID)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION cascade_soft_delete_folder(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION cascade_restore_folder(UUID)                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cascade_soft_delete_base(UUID, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cascade_restore_base(UUID)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cascade_soft_delete_folder(UUID, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cascade_restore_folder(UUID)                TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 6. Backfill existing orphans
-- ════════════════════════════════════════════════════════════════════
--
-- Process trashed events in `deleted_at ASC` order so deeper-but-earlier
-- events stamp their descendants first; later ancestor cascades hit the
-- `AND deleted_at IS NULL` filter on those subtrees and skip them.
-- After this loop, every row under a trashed parent should also be
-- trashed.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT 'folder'::text AS kind, id, deleted_at
      FROM knowledge_folders WHERE deleted_at IS NOT NULL
    UNION ALL
    SELECT 'base'::text AS kind, id, deleted_at
      FROM knowledge_bases   WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at ASC
  LOOP
    IF rec.kind = 'folder' THEN
      PERFORM cascade_soft_delete_folder(rec.id, rec.deleted_at);
    ELSE
      PERFORM cascade_soft_delete_base(rec.id, rec.deleted_at);
    END IF;
  END LOOP;
END $$;
