-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE ONTOLOGY IS AN ONTOLOGY — the storage half of the vocabulary removal (Samuel, 2026-09-23)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ WRITTEN, NOT APPLIED — §12's standing gate. Apply BY NAME (`ontology_vocabulary_rename`).
--
-- ── WHAT SAMUEL ASKED FOR ───────────────────────────────────────────────────────────────────
--
-- Verbatim (2026-09-23): *"I want you to completely do the cluster cleanup. The terms, everything
-- should change to ontology. The word "cluster" is obsolete, so it needs to be completely
-- removed."* This file is the one place outside applied history that must still SPELL the old
-- names: a rename has to say what it renames. It supersedes the 2026-09-11 ruling that kept
-- identifiers, routes and DB names on the old word.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────────────────────────────
--
--   ontology_clusters                         → ontologies
--   ontology_memberships.cluster_id           → .ontology_id
--   dopl_ontology_readable(p_cluster_id)      → dopl_ontology_readable(p_ontology_id)
--   dopl_ontology_writable(p_cluster_id)      → dopl_ontology_writable(p_ontology_id)
--   dopl_ontology_share_level(p_cluster_id)   → dopl_ontology_share_level(p_ontology_id)
--   dopl_ontology_object_clusters(p_object_id)→ dopl_ontology_object_ontologies(p_object_id)
--   cascade_hard_delete_cluster(ws, id)       → cascade_hard_delete_ontology(ws, id)
--   revisions.resource_type 'ontology_cluster' → 'ontology'
--   plus every constraint, index, policy and trigger whose NAME carried the old word, and the
--   function bodies that only MENTIONED it (assert_ontology_share_scope,
--   cascade_hard_delete_folder, cascade_hard_delete_object, dopl_revision_readable).
--
-- ── WHAT IS DROPPED (DEAD) ──────────────────────────────────────────────────────────────────
--
--   cascade_soft_delete_cluster, cascade_restore_cluster, cascade_purge_cluster — no caller since
--   trash left (F-730). increment_fork_count(uuid) — updates a table dropped in 2026-06 and has
--   had no caller since; its body is the last live mention of the old word outside this file.
--
-- ⚠ RENAMES, NOT RE-CREATES. The table and column are `ALTER … RENAME`, so row data, OIDs,
-- table grants, RLS enablement, REPLICA IDENTITY USING INDEX and the `supabase_realtime`
-- membership (with its column list) all travel with the object untouched. Constraint, index and
-- trigger renames are catalog-only.
--
-- ⚠ WHAT A RENAME DOES NOT CARRY: a plpgsql/sql function body is TEXT, re-parsed at call time,
-- so every function that NAMES the old table, column or function is restated below with the
-- same logic, the same `SECURITY`/`search_path` header and the same ACL. A parameter NAME cannot
-- change under `CREATE OR REPLACE`, so the three predicates are dropped and re-created, and the
-- four SELECT policies that call them are dropped first and re-created after, the same
-- one-call predicates on the same tables.
--
-- ⚠ IDEMPOTENT. Every rename is guarded by an existence check, every function is
-- `DROP … IF EXISTS` / `CREATE OR REPLACE`, every policy is dropped under both names before it
-- is created, and the resource-type UPDATE is a no-op on a second run.
--
-- ⚠ COMPATIBILITY WITH RELEASED DESKTOPS (≤ 1.36.0). Their UI feed subscribes realtime to the
-- OLD table name. Realtime admits a subscription only for a table in the publication, and a view
-- cannot join a publication, so no compatibility VIEW can keep that binding alive — and one
-- unknown table refuses the whole channel. Those desktops lose live UI refresh (not data) until
-- they update. Apply this together with the server deploy and the desktop release that speak
-- the new names; the HTTP and MCP compatibility aliases live in the application, not here.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- A NEW migration that runs every rename below in reverse and restates the functions and
-- policies with the old names. Written as prose because the desktop's replica-identity suite
-- regexes this directory without stripping comments.

BEGIN;

-- ===========================================================================
-- 1. The table, the column, constraints, indexes and the trigger
-- ===========================================================================

DO $$
BEGIN
  IF to_regclass('public.ontology_clusters') IS NOT NULL THEN
    ALTER TABLE public.ontology_clusters RENAME TO ontologies;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ontology_memberships'
                AND column_name = 'cluster_id') THEN
    ALTER TABLE public.ontology_memberships RENAME COLUMN cluster_id TO ontology_id;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_clusters_pkey') THEN
    ALTER TABLE public.ontologies RENAME CONSTRAINT ontology_clusters_pkey TO ontologies_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_clusters_workspace_id_fkey') THEN
    ALTER TABLE public.ontologies RENAME CONSTRAINT ontology_clusters_workspace_id_fkey TO ontologies_workspace_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_clusters_created_by_fkey') THEN
    ALTER TABLE public.ontologies RENAME CONSTRAINT ontology_clusters_created_by_fkey TO ontologies_created_by_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_clusters_last_edited_by_fkey') THEN
    ALTER TABLE public.ontologies RENAME CONSTRAINT ontology_clusters_last_edited_by_fkey TO ontologies_last_edited_by_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_clusters_last_edited_source_check') THEN
    ALTER TABLE public.ontologies RENAME CONSTRAINT ontology_clusters_last_edited_source_check TO ontologies_last_edited_source_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_clusters_name_charset_check') THEN
    ALTER TABLE public.ontologies RENAME CONSTRAINT ontology_clusters_name_charset_check TO ontologies_name_charset_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ontology_memberships_cluster_id_fkey') THEN
    ALTER TABLE public.ontology_memberships RENAME CONSTRAINT ontology_memberships_cluster_id_fkey TO ontology_memberships_ontology_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ontology_clusters_touch_updated_at') THEN
    ALTER TRIGGER ontology_clusters_touch_updated_at ON public.ontologies
      RENAME TO ontologies_touch_updated_at;
  END IF;
END
$$;

ALTER INDEX IF EXISTS public.idx_ontology_clusters_created_by RENAME TO idx_ontologies_created_by;
ALTER INDEX IF EXISTS public.ontology_clusters_replica_identity_idx RENAME TO ontologies_replica_identity_idx;
ALTER INDEX IF EXISTS public.ontology_clusters_workspace_active_idx RENAME TO ontologies_workspace_active_idx;
ALTER INDEX IF EXISTS public.ontology_clusters_workspace_slug_active_idx RENAME TO ontologies_workspace_slug_active_idx;
ALTER INDEX IF EXISTS public.ontology_memberships_cluster_child_idx RENAME TO ontology_memberships_ontology_child_idx;

-- ===========================================================================
-- 2. The four SELECT policies leave, so their predicates can be re-created
-- ===========================================================================

DROP POLICY IF EXISTS ontology_clusters_member_select ON public.ontologies;
DROP POLICY IF EXISTS ontologies_member_select ON public.ontologies;
DROP POLICY IF EXISTS ontology_objects_member_select ON public.ontology_objects;
DROP POLICY IF EXISTS ontology_memberships_member_select ON public.ontology_memberships;
DROP POLICY IF EXISTS ontology_relationships_member_select ON public.ontology_relationships;

-- ===========================================================================
-- 3. The share predicates — same bodies as 20261001130000's, names moved
-- ===========================================================================

DROP FUNCTION IF EXISTS public.dopl_ontology_readable(uuid);
DROP FUNCTION IF EXISTS public.dopl_ontology_writable(uuid);
DROP FUNCTION IF EXISTS public.dopl_ontology_share_level(uuid);
DROP FUNCTION IF EXISTS public.dopl_ontology_object_clusters(uuid);

CREATE OR REPLACE FUNCTION public.dopl_ontology_share_level(p_ontology_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT CASE max(
           public.dopl_ontology_level_rank(
             CASE WHEN wm.role = 'guest' THEN s.guests_level ELSE s.members_level END
           ))
           WHEN 2 THEN 'edit'
           WHEN 1 THEN 'view'
           ELSE 'none'
         END
    FROM public.ontology_channel_shares s
    JOIN public.channels ch ON ch.id = s.channel_id
    JOIN public.workspace_members wm
      ON wm.workspace_id = ch.workspace_id
     AND wm.user_id = (SELECT auth.uid())
     AND wm.status = 'active'
   WHERE s.ontology_id = p_ontology_id
     AND ch.deleted_at IS NULL
     AND public.is_channel_member(s.channel_id);
$function$;

COMMENT ON FUNCTION public.dopl_ontology_share_level(uuid) IS
  'The CALLER''s human level on one ontology: the max rung across the home channels they are in, guests read guests_level and everyone else members_level (Samuel Q1 — an agent inherits its operator''s cell, and that cap is the service''s, not this function''s).';

CREATE OR REPLACE FUNCTION public.dopl_ontology_object_ontologies(p_object_id uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  WITH RECURSIVE ancestors(object_id) AS (
    SELECT p_object_id
    UNION
    SELECT m.parent_object_id
      FROM public.ontology_memberships m
      JOIN ancestors a ON m.child_object_id = a.object_id
     WHERE m.parent_object_id IS NOT NULL
  )
  SELECT DISTINCT m.ontology_id
    FROM public.ontology_memberships m
    JOIN ancestors a ON m.child_object_id = a.object_id
   WHERE m.ontology_id IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.dopl_ontology_readable(p_ontology_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.ontologies o
     WHERE o.id = p_ontology_id
       AND (
         public.is_current_workspace_member(o.workspace_id, 'viewer'::text)
         OR (
           NOT public.dopl_credential_is_shared()
           AND public.dopl_ontology_level_rank(
                 public.dopl_ontology_share_level(o.id)
               ) >= 1
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.dopl_ontology_writable(p_ontology_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.ontologies o
     WHERE o.id = p_ontology_id
       AND (
         public.is_current_workspace_member(o.workspace_id, 'editor'::text)
         OR (
           NOT public.dopl_credential_is_shared()
           AND public.dopl_ontology_level_rank(
                 public.dopl_ontology_share_level(o.id)
               ) >= 2
         )
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_ontology_share_level(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dopl_ontology_object_ontologies(uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dopl_ontology_readable(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dopl_ontology_writable(uuid)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_share_level(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_object_ontologies(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_readable(uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dopl_ontology_writable(uuid)          TO authenticated, service_role;

-- ===========================================================================
-- 4. The four SELECT policies, re-created on the new names
-- ===========================================================================

CREATE POLICY ontologies_member_select ON public.ontologies
  FOR SELECT
  USING (public.dopl_ontology_readable(id));

CREATE POLICY ontology_objects_member_select ON public.ontology_objects
  FOR SELECT
  USING (
    public.is_current_workspace_member(workspace_id, 'viewer'::text)
    OR EXISTS (
      SELECT 1
        FROM public.dopl_ontology_object_ontologies(ontology_objects.id) AS oid_
       WHERE public.dopl_ontology_readable(oid_)
    )
  );

CREATE POLICY ontology_memberships_member_select ON public.ontology_memberships
  FOR SELECT
  USING (
    public.is_current_workspace_member(workspace_id, 'viewer'::text)
    OR (ontology_id IS NOT NULL AND public.dopl_ontology_readable(ontology_id))
    OR (parent_object_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM public.dopl_ontology_object_ontologies(parent_object_id) AS oid_
       WHERE public.dopl_ontology_readable(oid_)
    ))
  );

CREATE POLICY ontology_relationships_member_select ON public.ontology_relationships
  FOR SELECT
  USING (
    public.is_current_workspace_member(workspace_id, 'viewer'::text)
    OR (
      EXISTS (
        SELECT 1
          FROM public.dopl_ontology_object_ontologies(source_object_id) AS oid_
         WHERE public.dopl_ontology_readable(oid_)
      )
      AND EXISTS (
        SELECT 1
          FROM public.dopl_ontology_object_ontologies(target_object_id) AS oid_
         WHERE public.dopl_ontology_readable(oid_)
      )
    )
  );

-- The three write policies on the renamed table keep their bodies (none names the old word);
-- only their names move. ALTER POLICY … RENAME carries roles, command and expressions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ontologies'
                AND policyname = 'ontology_clusters_editor_insert') THEN
    ALTER POLICY ontology_clusters_editor_insert ON public.ontologies RENAME TO ontologies_editor_insert;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ontologies'
                AND policyname = 'ontology_clusters_editor_update') THEN
    ALTER POLICY ontology_clusters_editor_update ON public.ontologies RENAME TO ontologies_editor_update;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ontologies'
                AND policyname = 'ontology_clusters_editor_delete') THEN
    ALTER POLICY ontology_clusters_editor_delete ON public.ontologies RENAME TO ontologies_editor_delete;
  END IF;
END
$$;

-- ===========================================================================
-- 5. The share-scope trigger function — same body as 20261001120000's, table name moved
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.assert_ontology_share_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner_workspace uuid;
  v_channel_kind    text;
BEGIN
  SELECT o.workspace_id INTO v_owner_workspace
    FROM public.ontologies o WHERE o.id = NEW.ontology_id;
  IF v_owner_workspace IS NULL THEN
    RAISE EXCEPTION 'ontology_channel_shares: ontology % does not exist', NEW.ontology_id;
  END IF;
  IF NEW.workspace_id <> v_owner_workspace THEN
    RAISE EXCEPTION
      'ontology_channel_shares.workspace_id must be the ONTOLOGY''s container (% ), not %',
      v_owner_workspace, NEW.workspace_id;
  END IF;

  SELECT w.kind INTO v_channel_kind
    FROM public.channels ch
    JOIN public.workspaces w ON w.id = ch.workspace_id
   WHERE ch.id = NEW.channel_id;
  IF v_channel_kind IS NULL THEN
    RAISE EXCEPTION 'ontology_channel_shares: channel % does not exist', NEW.channel_id;
  END IF;
  IF v_channel_kind <> 'link' THEN
    RAISE EXCEPTION
      'ontology_channel_shares: home channels only (Q5) — channel % is in a % container',
      NEW.channel_id, v_channel_kind;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assert_ontology_share_scope() FROM PUBLIC, anon, authenticated;

-- The one catalog COMMENT that named the old table, re-worded (same text otherwise).
COMMENT ON COLUMN public.ontology_channel_shares.owner_agents_level IS
  'The OWNER''s agents in THIS channel. Q1: nobody else gets a per-agent column — a member''s or guest''s agents inherit exactly that person''s level. Q2: seeded from ontologies.agents_may_edit at the first share; DEFAULT ''view'' is the drop a solo channel takes when it gains a peer.';

-- ===========================================================================
-- 6. The hard-delete RPCs — cascade_hard_delete_ontology replaces its predecessor
-- ===========================================================================
-- Same logic as 20260807120000's and 20260807140000's, names (and the comments that only
-- named the old word) moved. All three stay service-role only.

DROP FUNCTION IF EXISTS public.cascade_hard_delete_cluster(uuid, uuid);
DROP FUNCTION IF EXISTS public.cascade_soft_delete_cluster(uuid, uuid);
DROP FUNCTION IF EXISTS public.cascade_restore_cluster(uuid, text);
DROP FUNCTION IF EXISTS public.cascade_purge_cluster(uuid, text);
DROP FUNCTION IF EXISTS public.increment_fork_count(uuid);

CREATE OR REPLACE FUNCTION public.cascade_hard_delete_ontology(
  p_workspace_id UUID,
  p_ontology_id  UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ontology ontologies%ROWTYPE;
  v_count    INTEGER;
BEGIN
  SELECT * INTO v_ontology
    FROM ontologies
   WHERE workspace_id = p_workspace_id
     AND id = p_ontology_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH RECURSIVE ontology_objects_owned AS (
    SELECT m.child_object_id AS id
      FROM ontology_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.ontology_id = v_ontology.id
    UNION
    SELECT m.child_object_id
      FROM ontology_memberships m
      INNER JOIN ontology_objects_owned oo ON m.parent_object_id = oo.id
     WHERE m.workspace_id = p_workspace_id
  )
  DELETE FROM ontology_objects o
   WHERE o.workspace_id = p_workspace_id
     AND o.id IN (SELECT id FROM ontology_objects_owned);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM ontologies
   WHERE workspace_id = p_workspace_id
     AND id = v_ontology.id;

  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.cascade_hard_delete_ontology(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cascade_hard_delete_ontology(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.cascade_hard_delete_folder(
  p_workspace_id UUID,
  p_folder_id    UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_folder_ids UUID[];
  v_count      INTEGER;
BEGIN
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
    RETURN NULL;
  END IF;

  DELETE FROM knowledge_entries e
   WHERE e.workspace_id = p_workspace_id
     AND e.folder_id = ANY (v_folder_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM knowledge_folders f
   WHERE f.workspace_id = p_workspace_id
     AND f.id = p_folder_id;

  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.cascade_hard_delete_object(
  p_workspace_id UUID,
  p_object_id    UUID
)
RETURNS INTEGER
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

  DELETE FROM ontology_objects
   WHERE workspace_id = p_workspace_id
     AND id = p_object_id;

  IF v_descendants IS NULL THEN
    RETURN 0;
  END IF;

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

-- `CREATE OR REPLACE` keeps both ACLs; restated so a replay from zero reads the same.
REVOKE ALL ON FUNCTION public.cascade_hard_delete_folder(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cascade_hard_delete_object(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cascade_hard_delete_folder(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cascade_hard_delete_object(UUID, UUID) TO service_role;

-- ===========================================================================
-- 7. The revision resource-type word: 'ontology_cluster' → 'ontology'
-- ===========================================================================
-- Dropped, re-worded and re-added inside this one transaction, so there is no instant at
-- which the word is both illegal and present. Same constraint name as the inline CHECK
-- 20261002120000 created.

ALTER TABLE public.revisions DROP CONSTRAINT IF EXISTS revisions_resource_type_check;

UPDATE public.revisions SET resource_type = 'ontology' WHERE resource_type = 'ontology_cluster';

ALTER TABLE public.revisions
  ADD CONSTRAINT revisions_resource_type_check CHECK (resource_type IN
    ('knowledge_base','knowledge_folder','knowledge_entry','ontology','ontology_object'));

CREATE OR REPLACE FUNCTION public.dopl_revision_readable(
  p_resource_type text,
  p_resource_id   uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_resource_type
           WHEN 'knowledge_base' THEN
             public.dopl_knowledge_base_readable(p_resource_id)
           WHEN 'knowledge_folder' THEN
             EXISTS (
               SELECT 1 FROM public.knowledge_folders f
                WHERE f.id = p_resource_id
                  AND public.dopl_knowledge_base_readable(f.knowledge_base_id)
             )
           WHEN 'knowledge_entry' THEN
             EXISTS (
               SELECT 1 FROM public.knowledge_entries e
                WHERE e.id = p_resource_id
                  AND public.dopl_knowledge_base_readable(e.knowledge_base_id)
             )
           WHEN 'ontology' THEN
             public.dopl_ontology_readable(p_resource_id)
           WHEN 'ontology_object' THEN
             EXISTS (
               SELECT 1
                 FROM public.dopl_ontology_object_ontologies(p_resource_id) AS oid_
                WHERE public.dopl_ontology_readable(oid_)
             )
           ELSE false
         END;
$function$;

REVOKE ALL ON FUNCTION public.dopl_revision_readable(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dopl_revision_readable(text, uuid)
  TO authenticated, service_role;

-- ===========================================================================
-- 8. Verification — aborts the transaction if any fact is false
-- ===========================================================================

DO $$
DECLARE
  n int;
BEGIN
  IF to_regclass('public.ontologies') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.ontologies does not exist';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c
               JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relname LIKE '%clust%') THEN
    RAISE EXCEPTION 'ABORT: a relation or index still carries the old word';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND column_name LIKE '%clust%') THEN
    RAISE EXCEPTION 'ABORT: a column still carries the old word';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE pronamespace = 'public'::regnamespace
                AND (proname LIKE '%clust%' OR prosrc LIKE '%clust%'
                     OR pg_get_function_identity_arguments(oid) LIKE '%clust%')) THEN
    RAISE EXCEPTION 'ABORT: a function name, parameter or body still carries the old word';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE connamespace = 'public'::regnamespace
                AND (conname LIKE '%clust%' OR pg_get_constraintdef(oid) LIKE '%clust%')) THEN
    RAISE EXCEPTION 'ABORT: a constraint still carries the old word';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public'
                AND (policyname LIKE '%clust%' OR coalesce(qual, '') LIKE '%clust%'
                     OR coalesce(with_check, '') LIKE '%clust%')) THEN
    RAISE EXCEPTION 'ABORT: a policy still carries the old word';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%clust%') THEN
    RAISE EXCEPTION 'ABORT: a trigger still carries the old word';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_description d
               JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass
              WHERE c.relnamespace = 'public'::regnamespace AND d.description LIKE '%clust%') THEN
    RAISE EXCEPTION 'ABORT: a table or column comment still carries the old word';
  END IF;

  IF EXISTS (SELECT 1 FROM public.revisions WHERE resource_type LIKE '%clust%') THEN
    RAISE EXCEPTION 'ABORT: a revision row still carries the old resource type';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ontologies', 'ontology_objects',
                       'ontology_memberships', 'ontology_relationships')
     AND cmd = 'SELECT'
     AND qual LIKE '%dopl_ontology_readable%';
  IF n <> 4 THEN
    RAISE EXCEPTION 'ABORT: expected 4 ontology SELECT policies reaching dopl_ontology_readable, found %', n;
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'ontologies') <> 4 THEN
    RAISE EXCEPTION 'ABORT: public.ontologies must carry exactly 4 policies (select + 3 editor writes)';
  END IF;

  IF (SELECT count(*) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('dopl_ontology_share_level', 'dopl_ontology_object_ontologies',
                         'dopl_ontology_readable', 'dopl_ontology_writable')
         AND prosecdef) <> 4 THEN
    RAISE EXCEPTION 'ABORT: an ontology predicate is missing or lost SECURITY DEFINER';
  END IF;

  IF has_function_privilege('anon', 'public.dopl_ontology_readable(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cascade_hard_delete_ontology(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: a predicate or the hard-delete RPC is callable by a role that must not call it';
  END IF;

  IF (SELECT count(*) FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename IN ('ontologies', 'ontology_objects',
                           'ontology_memberships', 'ontology_relationships')) <> 4 THEN
    RAISE EXCEPTION 'ABORT: an ontology table left supabase_realtime';
  END IF;

  IF (SELECT count(*) FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname IN ('ontologies', 'ontology_memberships')
         AND relreplident = 'i') <> 2 THEN
    RAISE EXCEPTION 'ABORT: an ontology table lost REPLICA IDENTITY USING INDEX (20260807150000)';
  END IF;

  RAISE NOTICE 'ontology_vocabulary_rename: 1 table, 1 column, 1 resource-type word and 5 functions moved; 4 dead functions dropped; RLS, grants, publication and replica identity unchanged.';
END
$$;

COMMIT;
