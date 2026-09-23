-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- AGENT TEMPLATES ARE AGENT IDENTITIES — the storage half of the rename (Samuel, 2026-09-22)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ WRITTEN, NOT APPLIED — §12's standing gate. Apply BY NAME
-- (`rename_agent_templates_to_agent_identities`). §7 restates the whole refusal CHECK and adds
-- `no-model`; no separate migration carries that word.
--
-- ── WHAT SAMUEL ASKED FOR ───────────────────────────────────────────────────────────────────
--
-- Verbatim (2026-09-22): *"Agent templates will be called agent identities, but in the channel
-- page, we're still calling things agents."* and *"I think we should make the full change and
-- rename the internals as well."*
--
-- GLOSSARY, so a reader of this schema never has to guess:
--   • an AGENT IDENTITY (was "agent template") is a ROLE OF THE USER — one piece of their
--     digital twin. "Coder" is the user as a coder. It is the durable, authored row.
--   • an AGENT is a RUNNING SESSION in a channel, launched FROM an identity (or blank).
--     `channel_sessions` stays the agent's table and keeps its name.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────────────────────────────
--
--   agent_templates                         → agent_identities
--   agent_template_knowledge_bases          → agent_identity_knowledge_bases
--     .template_id                          → .identity_id
--   channel_launch_directives.template_id   → .identity_id
--   channel_launch_directives.template_name → .identity_name
--   channel_sessions.template_name          → .identity_name
--   resource_grants.resource_type 'agent_template'       → 'agent_identity'
--   channel_launch_directives.refusal_reason 'no-template' → 'no-identity'
--   can_current_user_read_agent_template(p_template_id)  → can_current_user_read_agent_identity(p_identity_id)
--   assert_agent_template_kb_workspace()                 → assert_agent_identity_kb_workspace()
--   plus every constraint, index, policy and trigger whose NAME carried the old word.
--
-- ⚠ RENAMES, NOT RE-CREATES. Every table and column is `ALTER … RENAME`, so row data, OIDs,
-- table + column grants (the OPERATOR-ONLY column split on `channel_sessions` included), RLS
-- enablement, replica identity and publication membership (none of these tables is published)
-- all travel with the object untouched. Constraint and index renames are catalog-only.
--
-- ⚠ WHAT A RENAME DOES **NOT** CARRY, AND WHY THIS FILE REWRITES IT: a plpgsql/sql function body
-- is TEXT, re-parsed at call time. The four live functions that NAME the old table or the old
-- resource-type word would fail at their next call. So each is restated below with the same
-- body, the same `SECURITY`/`search_path` header and the same ACL, only the names moved. The
-- SELECT policies are re-created because their function is (a parameter NAME cannot change
-- under `CREATE OR REPLACE`); they are the same one-call predicate, on the same tables.
--
-- ⚠ THE VOCABULARY WORDS ARE DATA, SO THEY ARE UPDATED IN PLACE. `resource_grants` and the
-- refusal column are re-worded between dropping and restating their `CHECK`s, inside one
-- transaction, so there is no instant at which either word is illegal AND present. The grant
-- validity trigger is paused for that one UPDATE on purpose: re-wording a label is not a new
-- grant, and step 4 of `enforce_resource_grant()` re-asking "may the grantor still share this"
-- of a months-old row would refuse the rename for a reason that has nothing to do with it.
--
-- ⚠ NO BACK-COMPAT, AND THAT IS SAMUEL'S CALL ("I'm the only user anyway"). A desktop built
-- before this change still selects `template_*`, writes `no-template` and sends
-- `resource_type = 'agent_template'`; each of those now fails. Ship server + desktop together.
--
-- ── VERIFICATION (READ-ONLY, AFTER APPLYING) ───────────────────────────────────────────────
-- The canonical snippet is in the change's report; the in-file `DO` block at the end asserts
-- the same facts and aborts the transaction if any is false.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- A NEW migration that runs every rename below in reverse and restates the four functions with
-- the old names. Written as prose because `ui-sync-replica-identity.test.mjs` regexes this
-- directory without stripping comments.

BEGIN;

-- ===========================================================================
-- 1. Tables and columns
-- ===========================================================================

ALTER TABLE public.agent_templates RENAME TO agent_identities;
ALTER TABLE public.agent_template_knowledge_bases RENAME TO agent_identity_knowledge_bases;
ALTER TABLE public.agent_identity_knowledge_bases RENAME COLUMN template_id TO identity_id;

ALTER TABLE public.channel_launch_directives RENAME COLUMN template_id TO identity_id;
ALTER TABLE public.channel_launch_directives RENAME COLUMN template_name TO identity_name;
ALTER TABLE public.channel_sessions RENAME COLUMN template_name TO identity_name;

-- ===========================================================================
-- 2. Constraints (an index-backed constraint's rename renames its index too)
-- ===========================================================================

ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_pkey TO agent_identities_pkey;
ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_created_by_fkey TO agent_identities_created_by_fkey;
ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_workspace_id_fkey TO agent_identities_workspace_id_fkey;
ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_fields_shape_check TO agent_identities_fields_shape_check;
ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_model_charset_check TO agent_identities_model_charset_check;
ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_name_charset_check TO agent_identities_name_charset_check;
ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_prose_charset_check TO agent_identities_prose_charset_check;
ALTER TABLE public.agent_identities RENAME CONSTRAINT agent_templates_visibility_check TO agent_identities_visibility_check;

ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_knowledge_bases_pkey TO agent_identity_knowledge_bases_pkey;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_knowledge_bases_template_id_fkey TO agent_identity_knowledge_bases_identity_id_fkey;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_knowledge_bases_knowledge_base_id_fkey TO agent_identity_knowledge_bases_knowledge_base_id_fkey;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_knowledge_bases_folder_id_fkey TO agent_identity_knowledge_bases_folder_id_fkey;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_knowledge_bases_entry_id_fkey TO agent_identity_knowledge_bases_entry_id_fkey;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_knowledge_bases_workspace_id_fkey TO agent_identity_knowledge_bases_workspace_id_fkey;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_knowledge_bases_added_by_user_id_fkey TO agent_identity_knowledge_bases_added_by_user_id_fkey;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_kb_scope_kind_check TO agent_identity_kb_scope_kind_check;
ALTER TABLE public.agent_identity_knowledge_bases RENAME CONSTRAINT agent_template_kb_scope_shape_check TO agent_identity_kb_scope_shape_check;

ALTER TABLE public.channel_launch_directives RENAME CONSTRAINT channel_launch_directives_template_id_fkey TO channel_launch_directives_identity_id_fkey;
ALTER TABLE public.channel_launch_directives RENAME CONSTRAINT channel_launch_directives_template_name_charset_check TO channel_launch_directives_identity_name_charset_check;
ALTER TABLE public.channel_sessions RENAME CONSTRAINT channel_sessions_template_name_charset_check TO channel_sessions_identity_name_charset_check;

-- ===========================================================================
-- 3. Plain indexes
-- ===========================================================================

ALTER INDEX public.agent_templates_workspace_name_idx RENAME TO agent_identities_workspace_name_idx;
ALTER INDEX public.agent_templates_creator_idx RENAME TO agent_identities_creator_idx;
ALTER INDEX public.agent_template_kb_base_scope_uniq RENAME TO agent_identity_kb_base_scope_uniq;
ALTER INDEX public.agent_template_kb_folder_scope_uniq RENAME TO agent_identity_kb_folder_scope_uniq;
ALTER INDEX public.agent_template_kb_entry_scope_uniq RENAME TO agent_identity_kb_entry_scope_uniq;
ALTER INDEX public.agent_template_knowledge_bases_kb_idx RENAME TO agent_identity_knowledge_bases_kb_idx;
ALTER INDEX public.agent_template_knowledge_bases_workspace_idx RENAME TO agent_identity_knowledge_bases_workspace_idx;
ALTER INDEX public.agent_template_knowledge_bases_added_by_idx RENAME TO agent_identity_knowledge_bases_added_by_idx;
ALTER INDEX public.agent_template_knowledge_bases_folder_idx RENAME TO agent_identity_knowledge_bases_folder_idx;
ALTER INDEX public.agent_template_knowledge_bases_entry_idx RENAME TO agent_identity_knowledge_bases_entry_idx;
ALTER INDEX public.channel_launch_directives_template_idx RENAME TO channel_launch_directives_identity_idx;

-- ===========================================================================
-- 4. The read predicate + its two SELECT policies
-- ===========================================================================
-- Same body as `20260923140000_grant_read_arm.sql`'s, names moved. The policies go first
-- because they depend on the old function.

DROP POLICY IF EXISTS agent_templates_member_select ON public.agent_identities;
DROP POLICY IF EXISTS agent_template_knowledge_bases_member_select ON public.agent_identity_knowledge_bases;
DROP FUNCTION IF EXISTS public.can_current_user_read_agent_template(uuid);

CREATE OR REPLACE FUNCTION public.can_current_user_read_agent_identity(
  p_identity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.agent_identities t
     WHERE t.id = p_identity_id
       AND (
         (
           public.is_current_workspace_member(t.workspace_id, 'viewer'::text)
           AND (
             t.visibility = 'workspace'
             OR (
               NOT public.dopl_credential_is_shared()
               AND (
                 t.created_by = (SELECT auth.uid())
                 OR (
                   t.visibility = 'team'
                   AND public.dopl_teams_mode_visible(
                         t.workspace_id, 'agent_identity', t.id, t.created_by
                       )
                 )
               )
             )
           )
         )
         OR (
           NOT public.dopl_credential_is_shared()
           AND public.dopl_grant_admits('agent_identity', t.id)
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.can_current_user_read_agent_identity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_current_user_read_agent_identity(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_current_user_read_agent_identity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_current_user_read_agent_identity(uuid) TO service_role;

CREATE POLICY agent_identities_member_select ON public.agent_identities
  FOR SELECT
  USING (public.can_current_user_read_agent_identity(id));

CREATE POLICY agent_identity_knowledge_bases_member_select
  ON public.agent_identity_knowledge_bases
  FOR SELECT
  USING (public.can_current_user_read_agent_identity(identity_id));

-- ===========================================================================
-- 5. The junction's workspace trigger
-- ===========================================================================
-- Same body as `20260930150000_agent_template_knowledge_scopes.sql`'s, names moved.

CREATE OR REPLACE FUNCTION public.assert_agent_identity_kb_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  idn_ws UUID;
  kb_ws UUID;
  fld_base UUID;
  fld_deleted TIMESTAMPTZ;
  ent_base UUID;
  ent_deleted TIMESTAMPTZ;
BEGIN
  SELECT workspace_id INTO idn_ws FROM agent_identities WHERE id = NEW.identity_id;
  SELECT workspace_id INTO kb_ws FROM knowledge_bases WHERE id = NEW.knowledge_base_id;
  IF idn_ws IS NULL THEN
    RAISE EXCEPTION 'agent_identity_knowledge_bases: identity % does not exist', NEW.identity_id;
  END IF;
  IF kb_ws IS NULL THEN
    RAISE EXCEPTION 'agent_identity_knowledge_bases: knowledge base % does not exist', NEW.knowledge_base_id;
  END IF;
  IF idn_ws <> NEW.workspace_id OR kb_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'agent_identity_knowledge_bases: workspace mismatch (junction=%, identity=%, kb=%)',
      NEW.workspace_id, idn_ws, kb_ws;
  END IF;

  IF NEW.folder_id IS NOT NULL THEN
    SELECT knowledge_base_id, deleted_at INTO fld_base, fld_deleted
      FROM knowledge_folders WHERE id = NEW.folder_id;
    IF fld_base IS NULL THEN
      RAISE EXCEPTION 'agent_identity_knowledge_bases: folder % does not exist', NEW.folder_id;
    END IF;
    IF fld_base <> NEW.knowledge_base_id THEN
      RAISE EXCEPTION 'agent_identity_knowledge_bases: folder % lives in base %, not %',
        NEW.folder_id, fld_base, NEW.knowledge_base_id;
    END IF;
    IF fld_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'agent_identity_knowledge_bases: folder % is deleted', NEW.folder_id;
    END IF;
  END IF;

  IF NEW.entry_id IS NOT NULL THEN
    SELECT knowledge_base_id, deleted_at INTO ent_base, ent_deleted
      FROM knowledge_entries WHERE id = NEW.entry_id;
    IF ent_base IS NULL THEN
      RAISE EXCEPTION 'agent_identity_knowledge_bases: entry % does not exist', NEW.entry_id;
    END IF;
    IF ent_base <> NEW.knowledge_base_id THEN
      RAISE EXCEPTION 'agent_identity_knowledge_bases: entry % lives in base %, not %',
        NEW.entry_id, ent_base, NEW.knowledge_base_id;
    END IF;
    IF ent_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'agent_identity_knowledge_bases: entry % is deleted', NEW.entry_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.assert_agent_identity_kb_workspace()
  FROM anon, authenticated;

DROP TRIGGER IF EXISTS agent_template_kb_workspace_check
  ON public.agent_identity_knowledge_bases;
CREATE TRIGGER agent_identity_kb_workspace_check
  BEFORE INSERT OR UPDATE ON public.agent_identity_knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.assert_agent_identity_kb_workspace();

DROP FUNCTION IF EXISTS public.assert_agent_template_kb_workspace();

ALTER TRIGGER agent_templates_touch_updated_at ON public.agent_identities
  RENAME TO agent_identities_touch_updated_at;

-- ===========================================================================
-- 6. The resource-type word: 'agent_template' → 'agent_identity'
-- ===========================================================================
-- Both functions below are restated WHOLE from the live catalog (`pg_get_functiondef`,
-- 2026-09-22), only the `agent_template` arm re-worded. `CREATE OR REPLACE` keeps each ACL.

CREATE OR REPLACE FUNCTION public.dopl_user_may_share_resource(
  p_user_id uuid, p_resource_type text, p_resource_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE p_resource_type
    WHEN 'knowledge_base' THEN EXISTS (
      SELECT 1 FROM public.knowledge_bases r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.created_by = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'knowledge_base', r.id, r.created_by))
    )
    WHEN 'skill' THEN EXISTS (
      SELECT 1 FROM public.skills r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.created_by = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'skill', r.id, r.created_by))
    )
    WHEN 'chat' THEN EXISTS (
      SELECT 1 FROM public.chats r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.owner_id = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'chat', r.id, r.owner_id))
    )
    WHEN 'chat_folder' THEN EXISTS (
      SELECT 1 FROM public.chat_folders r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (r.visibility = 'public' OR r.user_id = p_user_id)
         AND (r.access_mode IS DISTINCT FROM 'teams'
              OR public.dopl_teams_visible_for_user(
                   p_user_id, r.workspace_id, 'chat_folder', r.id, r.user_id))
    )
    WHEN 'agent_identity' THEN EXISTS (
      SELECT 1 FROM public.agent_identities r
       WHERE r.id = p_resource_id
         AND public.is_workspace_member(r.workspace_id, p_user_id, 'member')
         AND (
           r.visibility = 'workspace'
           OR r.created_by = p_user_id
           OR (r.visibility = 'team'
               AND public.dopl_teams_visible_for_user(
                     p_user_id, r.workspace_id, 'agent_identity', r.id, r.created_by))
         )
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_resource_grant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  scope_ws UUID;
  res_ws   UUID;
BEGIN
  -- 0. De-attribution is not a re-grant (F-584).
  IF TG_OP = 'UPDATE'
     AND OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND (NEW.scope_type, NEW.scope_id, NEW.resource_type, NEW.resource_id,
          NEW.workspace_id, NEW.level, NEW.guest_write)
         IS NOT DISTINCT FROM
         (OLD.scope_type, OLD.scope_id, OLD.resource_type, OLD.resource_id,
          OLD.workspace_id, OLD.level, OLD.guest_write)
  THEN
    RETURN NEW;
  END IF;

  -- 1. The scope exists, and resolves to a container.
  CASE NEW.scope_type
    WHEN 'channel'   THEN SELECT workspace_id INTO scope_ws FROM channels   WHERE id = NEW.scope_id;
    WHEN 'container' THEN SELECT id           INTO scope_ws FROM workspaces WHERE id = NEW.scope_id;
    WHEN 'team'      THEN SELECT workspace_id INTO scope_ws FROM teams      WHERE id = NEW.scope_id;
    ELSE RAISE EXCEPTION 'resource_grants: unsupported scope_type %', NEW.scope_type;
  END CASE;
  IF scope_ws IS NULL THEN
    RAISE EXCEPTION 'resource_grants: % % does not exist', NEW.scope_type, NEW.scope_id;
  END IF;

  -- 2. The resource exists.
  CASE NEW.resource_type
    WHEN 'knowledge_base' THEN SELECT workspace_id INTO res_ws FROM knowledge_bases  WHERE id = NEW.resource_id;
    WHEN 'agent_identity' THEN SELECT workspace_id INTO res_ws FROM agent_identities WHERE id = NEW.resource_id;
    WHEN 'skill'          THEN SELECT workspace_id INTO res_ws FROM skills           WHERE id = NEW.resource_id;
    WHEN 'chat'           THEN SELECT workspace_id INTO res_ws FROM chats            WHERE id = NEW.resource_id;
    WHEN 'chat_folder'    THEN SELECT workspace_id INTO res_ws FROM chat_folders     WHERE id = NEW.resource_id;
    ELSE RAISE EXCEPTION 'resource_grants: unsupported resource_type %', NEW.resource_type;
  END CASE;
  IF res_ws IS NULL THEN
    RAISE EXCEPTION 'resource_grants: % % does not exist', NEW.resource_type, NEW.resource_id;
  END IF;

  -- 3. The row is filed under the RESOURCE's container.
  IF res_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'resource_grants: resource workspace mismatch (grant=%, resource=%)',
      NEW.workspace_id, res_ws;
  END IF;

  -- 4. The grantor may reach both sides (F-583: edit-capable rank AND the resource's own
  --    visibility test on the resource side; `viewer` on the scope side).
  IF NEW.created_by IS NULL THEN
    IF scope_ws <> res_ws THEN
      RAISE EXCEPTION 'resource_grants: an unattributed grant may not cross containers (resource=%, scope=%)',
        res_ws, scope_ws;
    END IF;
  ELSIF NOT is_workspace_member(res_ws, NEW.created_by, 'member') THEN
    RAISE EXCEPTION 'resource_grants: grantor % is not edit-capable in container %',
      NEW.created_by, res_ws;
  ELSIF NOT dopl_user_may_share_resource(NEW.created_by, NEW.resource_type, NEW.resource_id) THEN
    RAISE EXCEPTION 'resource_grants: grantor % may not share % %',
      NEW.created_by, NEW.resource_type, NEW.resource_id;
  ELSIF NOT is_workspace_member(scope_ws, NEW.created_by, 'viewer') THEN
    RAISE EXCEPTION 'resource_grants: grantor % may not share into container %',
      NEW.created_by, scope_ws;
  END IF;

  RETURN NEW;
END $$;

ALTER TABLE public.resource_grants DROP CONSTRAINT IF EXISTS resource_grants_resource_type_check;

ALTER TABLE public.resource_grants DISABLE TRIGGER resource_grant_validity_check;
UPDATE public.resource_grants SET resource_type = 'agent_identity'
 WHERE resource_type = 'agent_template';
ALTER TABLE public.resource_grants ENABLE TRIGGER resource_grant_validity_check;

ALTER TABLE public.resource_grants
  ADD CONSTRAINT resource_grants_resource_type_check
  CHECK (resource_type IN ('knowledge_base', 'agent_identity', 'skill', 'chat', 'chat_folder'));

-- The AFTER DELETE cleanup names its resource type as a trigger ARGUMENT, which is fixed at
-- CREATE TRIGGER time — so it is re-created, same name, same function, new word.
DROP TRIGGER IF EXISTS resource_grants_cleanup ON public.agent_identities;
CREATE TRIGGER resource_grants_cleanup AFTER DELETE ON public.agent_identities
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_resource('agent_identity');

-- ===========================================================================
-- 7. The refusal word: 'no-template' → 'no-identity'
-- ===========================================================================
-- Restated WHOLE from `20260910120000` §3A: `no-template` becomes `no-identity`, and `no-model`
-- is added (a launch naming a model the machine's live roster does not offer is refused).

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_refusal_reason_check;

UPDATE public.channel_launch_directives SET refusal_reason = 'no-identity'
 WHERE refusal_reason = 'no-template';

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_refusal_reason_check
  CHECK (
    refusal_reason IS NULL OR refusal_reason IN (
      'cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
      'no-identity', 'no-session', 'bad-name', 'no-chain', 'no-model'
    )
  );

-- ===========================================================================
-- 8. Column comments, in the new words
-- ===========================================================================

-- Guarded: the held drop (migrations-held/20260923120000) sorts before this file, so on a
-- replay after its release the column is already gone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'agent_identities'
                AND column_name = 'home_scoped') THEN
    COMMENT ON COLUMN public.agent_identities.home_scoped IS
      'Unused: read and written by nothing. The personal shelf is the caller''s kind=personal container. Dropped by migrations-held/20260923120000_drop_home_scoped.sql.';
  END IF;
END $$;

COMMENT ON COLUMN public.channel_sessions.identity_name IS
  'OPERATOR-ONLY. Name of the agent identity this session (agent) was launched from, SNAPSHOTTED AT SPAWN — deliberately not an FK, so a session keeps reporting what it RAN AS after the identity is renamed or deleted. NULL = launched blank, or a desktop older than the field.';

COMMENT ON COLUMN public.channel_launch_directives.identity_id IS
  'The agent identity this directive asks to run as, resolved under the ORCHESTRATOR''s visibility at create. SET NULL on identity delete — read it beside identity_name: a NULL id with a live name is a DELETION and the desktop refuses (no-identity), not a blank launch.';

COMMENT ON COLUMN public.channel_launch_directives.identity_name IS
  'Name of the named identity, SNAPSHOTTED AT CREATE. Deliberately not an FK and never re-read — it is the only signal that survives ON DELETE SET NULL on identity_id (spec E-4).';

COMMENT ON COLUMN public.channel_launch_directives.target_name IS
  'The rename''s new display name. NOT NULL on kind=rename and NULL on every other kind; the EMPTY STRING is legal and means "clear it, back to Agent #<id>". Bounded at 60 — main/agent-names.js MAX_NAME, the store that actually holds it — not at agent_identities.name''s 120.';

-- ===========================================================================
-- 9. Assert the outcome instead of trusting it
-- ===========================================================================
DO $$
DECLARE
  n INT;
  def TEXT;
  word TEXT;
BEGIN
  IF to_regclass('public.agent_templates') IS NOT NULL
     OR to_regclass('public.agent_template_knowledge_bases') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: an agent_template* table survived the rename';
  END IF;
  IF to_regclass('public.agent_identities') IS NULL
     OR to_regclass('public.agent_identity_knowledge_bases') IS NULL THEN
    RAISE EXCEPTION 'ABORT: an agent_identit* table is missing after the rename';
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (column_name ILIKE '%template%' AND table_name <> 'ontology_objects');
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % public column(s) still carry "template" outside ontology_objects', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE connamespace = 'public'::regnamespace
     AND (conname ILIKE '%template%' OR pg_get_constraintdef(oid) ILIKE '%template%');
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % constraint(s) still name or admit a template word', n;
  END IF;

  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = 'public' AND indexname ILIKE '%template%';
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % index(es) still carry "template"', n;
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE NOT tgisinternal
     AND (tgname ILIKE '%template%' OR pg_get_triggerdef(oid) ILIKE '%template%');
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % trigger(s) still carry "template"', n;
  END IF;

  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND (proname ILIKE '%agent_template%' OR prosrc ILIKE '%agent_template%');
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % function(s) still name agent_template', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('agent_identities', 'agent_identity_knowledge_bases')
     AND (cmd <> 'SELECT' OR qual NOT LIKE '%can_current_user_read_agent_identity%');
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: an agent-identity policy is not the one-call SELECT predicate';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('agent_identities', 'agent_identity_knowledge_bases');
  IF n <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected 2 SELECT policies on the identity tables, found %', n;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.agent_identities'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.agent_identity_knowledge_bases'::regclass) THEN
    RAISE EXCEPTION 'ABORT: RLS is off on an identity table';
  END IF;

  IF has_table_privilege('authenticated', 'public.agent_identities', 'INSERT')
     OR has_table_privilege('authenticated', 'public.agent_identities', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.agent_identities', 'DELETE')
     OR has_table_privilege('authenticated', 'public.agent_identity_knowledge_bases', 'INSERT')
     OR has_table_privilege('authenticated', 'public.agent_identity_knowledge_bases', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.agent_identity_knowledge_bases', 'DELETE') THEN
    RAISE EXCEPTION 'ABORT: authenticated gained DML on an identity table — the service is the fence';
  END IF;

  -- Every word, not only the two that moved: re-creating a CHECK whole is how a word is dropped
  -- by accident. The `%template%` constraint sweep above keeps `template-approval` out.
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_refusal_reason_check'
     AND convalidated;
  IF def IS NULL THEN
    RAISE EXCEPTION 'ABORT: the refusal CHECK is missing or NOT VALIDATED';
  END IF;
  FOREACH word IN ARRAY ARRAY['cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
                              'no-identity', 'no-session', 'bad-name', 'no-chain', 'no-model'] LOOP
    IF position(quote_literal(word) IN def) = 0 THEN
      RAISE EXCEPTION 'ABORT: the refusal CHECK lost %', word;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.can_current_user_read_agent_identity(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: anon can execute can_current_user_read_agent_identity';
  END IF;

  IF has_column_privilege('authenticated', 'public.channel_sessions', 'identity_name', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: channel_sessions.identity_name became member-readable — it is OPERATOR-ONLY';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE schemaname = 'public'
                AND tablename IN ('agent_identities', 'agent_identity_knowledge_bases')) THEN
    RAISE EXCEPTION 'ABORT: an identity table is published — it has no subscriber by design';
  END IF;

  RAISE NOTICE 'rename_agent_templates_to_agent_identities: 2 tables, 4 columns, 2 vocabulary words, 4 functions moved; RLS, grants and publication membership unchanged.';
END
$$;

COMMIT;
