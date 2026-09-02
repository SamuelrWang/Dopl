-- RESOURCE GRANTS — ONE grant table for every scope a resource can be lent to.
-- Wave B slice B1, from Samuel's ruling B4.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ═══ THE RULING, AND WHAT IT DOES NOT SAY ════════════════════════════════════
--
-- B4: **the team capability is NOT deleted. Team stops being a SPECIAL AXIS and
-- becomes one value of `scope_type`.** Everything a team could carry it still
-- carries; it simply stops having a table, a trigger chain and a junction of its
-- own. `resource_grants(scope_type ∈ channel|container|team, resource_type,
-- resource_id, level)` is the whole of the change.
--
--   * `channel_resource_grants` (`20260827120000`) — the (kb, channel) grant.
--   * `team_resource_access`    (`20260611020000` §3) — the (team, resource)
--     grant, polymorphic over four resource types across five migrations.
--   * `agent_template_teams`    (`20260822200000` §2) — a THIRD shape for the
--     same sentence, split off deliberately (F-277) because the polymorphic
--     table's `level` was always `'read'` for it.
--
-- Three tables, three triggers, one sentence: *somebody may reach this resource
-- through that scope.* This is the table; `20260915120000` and `20260916120000`
-- remove the other two. **Order is load-bearing: this file is purely additive
-- and the drops come after it, so a revert at any point leaves a working tree.**
--
-- ═══ 🔒 THE TRIGGER ASSERTS "THE GRANTOR MAY SHARE THIS" ════════════════════
--
-- `enforce_resource_grant()` replaces BOTH `enforce_channel_resource_grant()`'s
-- three-way workspace equality (`20260827120000` §4) and the five-migration
-- `CREATE OR REPLACE` chain behind `assert_team_grant_workspace`
-- (`20260611020000`, `20260707210000`, `20260708120000`, `20260708150001`,
-- `20260811140000` — each one re-stating the whole function to widen a CASE).
--
-- The old rule was `scope.workspace = resource.workspace = grant.workspace`. It
-- made cross-container LENDING structurally impossible, which is why the product
-- grew COPY ops instead (findings-tenancy F2: a snapshot with no back-pointer and
-- no sync). The new rule keeps every fence the old one had and answers the
-- question the old one could not:
--
--   1. the SCOPE exists and names a container;
--   2. the RESOURCE exists;
--   3. `workspace_id` IS THE RESOURCE'S container — the row is FILED under the
--      thing being lent, never under the borrower. One canonical tenancy per
--      row, so `workspace_id`-filtered reads keep meaning what they meant;
--   4. 🔒 **the GRANTOR may reach BOTH SIDES.** `created_by` must be an active
--      member of the resource's container (they may lend it out) AND of the
--      scope's container (they may lend it in). A `guest` ranks -1 in
--      `is_workspace_member` and fails both, which is the intended floor.
--
-- ⚠ **AN UNATTRIBUTED ROW (`created_by IS NULL`) FALLS BACK TO THE OLD
-- SAME-CONTAINER EQUALITY.** `created_by` is `ON DELETE SET NULL`, so a grant
-- outlives its grantor, and rows backfilled from `team_resource_access` (which
-- has no such column at all) arrive with none. Cross-container reach therefore
-- requires a NAMED grantor who was in both rooms — the audit trail is the
-- authority, and losing it narrows the grant rather than widening it.
--
-- ⚠ The floor is `viewer`, not `member`, and that is deliberate: the SERVICE is
-- the real gate (creator-or-admin, `service-channel-grants.ts ›
-- canManageChannelGrants`), and a `viewer` who CREATED a base may share it
-- today. A `member` floor here would silently narrow that on apply, and this
-- batch narrows nothing.
--
-- ═══ LEVELS — TWO VOCABULARIES, ONE COLUMN, A CHECK THAT KNOWS WHICH ═════════
--
-- `channel` carries the AUDIENCE pair `agent_only | visible`; `container` and
-- `team` carry the ACCESS pair `read | edit`. They are not rungs of one ladder
-- (`20260827120000`: "two AUDIENCES, not a high/low pair"), so the CHECK is
-- written per scope rather than as a union of four values — a `'visible'` team
-- grant or an `'edit'` channel grant is refused by the database, not by a
-- convention. `guest_write` is likewise channel-only, by CHECK.
--
-- ═══ THE MIRROR INTO `channel_resource_grants` (EXPAND/CONTRACT) ═════════════
--
-- 🔒 This migration does NOT drop `channel_resource_grants`. One reader outside
-- this slice's file ownership still selects from it —
-- `knowledge/server/repository-audience.ts › listGrantedBaseIdsForChannels`,
-- the agent's reachable-base set — and a table that silently stops receiving
-- writes would take that lane's answer with it. `mirror_channel_resource_grant()`
-- keeps the old table exact for channel/knowledge_base rows **inside one
-- transaction with the write**, so no reader can observe the two disagreeing.
-- Cross-container rows are SKIPPED rather than mirrored: the old table's own
-- trigger cannot hold them, and a mirror that can RAISE would turn a legal grant
-- into an outage.
-- ⚠ **BATCH 3 DELETES THIS**, together with `channel_resource_grants` and its two
-- triggers, once that last reader moves. It is one `DROP TRIGGER` plus one
-- `DROP FUNCTION`; it is not a second source of truth and nothing reads it back.
--
-- ═══ HARD-DELETE GC — the polymorphic-id leak, closed once ══════════════════
--
-- Neither `scope_id` nor `resource_id` can carry a foreign key (each is
-- polymorphic over three and five tables), so nothing cascades. Every sibling
-- grant table closes this with an AFTER DELETE trigger on the resource
-- (`20260807130000` says in as many words that "the fix is the one every sibling
-- type already uses"), and that precedent is followed here — but with TWO
-- parameterised functions instead of the SIX hand-written copies the old tables
-- accumulated (`drop_knowledge_base_grants`, `drop_chat_grants`,
-- `drop_chat_folder_grants`, `drop_skill_grants`, `delete_workflow_team_grants`,
-- `drop_channel_resource_grants_for_kb`). `TG_ARGV[0]` carries the type.
--
-- ═══ RLS — DEFENSE IN DEPTH ONLY (not the fence) ════════════════════════════
--
-- Every read in this app runs on the service-role client, which bypasses RLS.
-- These policies exist for direct PostgREST / realtime reads, and they are the
-- FINAL state of `channel_resource_grants` after `20260828120000` tightened it,
-- generalised to three scopes:
--   * WRITE at `admin` — `20260828120000` §1 raised it from `member` because a
--     container PEER can be granted `member` and PostgREST is a second door.
--   * SELECT: `admin` sees everything; everyone else sees a row only if it is
--     shared WITH PEOPLE (`level='visible'` on a channel scope; every non-channel
--     row, whose levels have no hidden audience), and a `guest` only on a channel
--     it is a REAL member of. ⚠ NO `visibility='public'` arm, ever.
-- ⚠ NOT A REALTIME CHANGE: not published, no replica identity, no column grant.
--
-- ═══ BACKFILL ══════════════════════════════════════════════════════════════
--
-- Both live tables, joined to their resource so a grant pointing at a vanished
-- row is dropped rather than carried (`team_resource_access` still ACCEPTS
-- `'workflow'`, a feature deleted by `20260811120000`, and its rows are the exact
-- garbage the polymorphic id was always able to keep). Measured on production
-- 2026-09-02 (findings-tenancy §1): **2 `channel_resource_grants` rows and 5
-- inert `team_resource_access` rows** — the whole data risk of this slice.
-- `ON CONFLICT DO NOTHING`, so a replay is a no-op.
--
-- ═══ APPLY / VERIFY / REPLAY ════════════════════════════════════════════════
--
-- ⚠ **THE BEHAVIOURAL PROBES ARE OWED, NOT RUN.** The `20260827120000` precedent
-- is three probes per trigger branch inside a ROLLED-BACK transaction, run
-- through the Supabase MCP against a real database. This branch has no database:
-- migrations are written and never applied here, and Wave A's seven are
-- themselves still unapplied. Recorded, not glossed. The probes owed, one line
-- each, all inside `BEGIN; … ROLLBACK;`:
--   P1  scope_type='nope'                                  → P0001 unsupported scope_type
--   P2  scope_type='channel', unknown scope_id             → P0001 channel … does not exist
--   P3  scope_type='team',    unknown scope_id             → P0001 team … does not exist
--   P4  resource_type='workflow'                           → 23514 (CHECK) before the trigger
--   P5  resource_type='knowledge_base', unknown id         → P0001 knowledge_base … does not exist
--   P6  workspace_id = the SCOPE's container, not the KB's → P0001 resource workspace mismatch
--   P7  created_by NULL, scope container <> KB container   → P0001 unattributed … may not cross
--   P8  created_by = a user in the scope only              → P0001 may not share out of container
--   P9  created_by = a user in the KB container only       → P0001 may not share into container
--   P10 created_by = a `guest` of both containers          → P0001 may not share out of container
--   P11 created_by = a `viewer` of both, different ones    → INSERT succeeds (the lend B4 unlocks)
--   P12 same container, level='edit' on a channel scope    → 23514 (the per-scope level CHECK)
--   P13 same row twice                                     → 23505 on the PK
--   P14 after P11, `SELECT … FROM channel_resource_grants` → 0 rows (cross-container is NOT mirrored)
--   P15 same-container channel grant, then the same SELECT → 1 row (mirror exact)
-- The in-migration `DO $$` block below RAISEs unless the table, the PK, the
-- enforce trigger, the mirror trigger, the eight GC triggers, the resource index
-- and both policies exist.
-- ⚠ REPLAY (`supabase db reset` → exit 0) IS THE GATE (INVARIANTS §12) and is
-- OWED: Docker was unavailable for all of Wave A and is unavailable here.
-- ⚠ Join on the NAME, not the filename version (F-304's re-stamp): match
-- `resource_grants` in `list_migrations`.
-- ⚠ NEW FILE — never an edit to an applied migration.
--
-- ROLLBACK (prose). `DROP TRIGGER resource_grants_channel_mirror ON
-- resource_grants;` then `DROP TABLE resource_grants;` (its own triggers and
-- policies go with it), then the eight GC triggers off their resource/scope
-- tables, then `DROP FUNCTION enforce_resource_grant(),
-- mirror_channel_resource_grant(), drop_resource_grants_for_resource(),
-- drop_resource_grants_for_scope();`. ⚠ NO ORDERING TRAP and NO DATA LOSS while
-- the drops that follow this file are also reverted: every row here is a COPY of
-- one still standing in `channel_resource_grants` or `team_resource_access`.
-- Reverting this file ALONE, after `20260916120000` has run, loses the team
-- grants — which is why the three files are reverted in reverse order.

-- ── 1. The table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resource_grants (
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('channel','container','team')),
  scope_id      UUID NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN
                   ('knowledge_base','agent_template','skill','chat','chat_folder')),
  resource_id   UUID NOT NULL,
  -- 🔒 THE RESOURCE'S container, never the scope's — see the header, rule 3.
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  level         TEXT NOT NULL,
  guest_write   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id, resource_type, resource_id),
  -- Two vocabularies, one column, and the database knows which is which.
  CONSTRAINT resource_grants_level_check CHECK (
    CASE scope_type
      WHEN 'channel' THEN level IN ('agent_only','visible')
      ELSE                level IN ('read','edit')
    END
  ),
  -- `guest_write` is a CHANNEL question ("may the person in this room edit it").
  CONSTRAINT resource_grants_guest_write_check
    CHECK (NOT guest_write OR scope_type = 'channel')
);

-- "Which scopes is THIS resource lent to" + the `workspace_id` FK cascade cover.
-- The PK's own prefix `(scope_type, scope_id, …)` answers the other direction,
-- so there is deliberately no second scope index.
CREATE INDEX IF NOT EXISTS resource_grants_resource_idx
  ON public.resource_grants (workspace_id, resource_type, resource_id);

-- ── 2. RLS — the tightened `20260828120000` shape, over three scopes ─────────
ALTER TABLE public.resource_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resource_grants_admin_write ON public.resource_grants;
CREATE POLICY resource_grants_admin_write ON public.resource_grants
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'admin'))
  WITH CHECK (is_current_workspace_member(workspace_id, 'admin'));

DROP POLICY IF EXISTS resource_grants_member_select ON public.resource_grants;
CREATE POLICY resource_grants_member_select ON public.resource_grants
  FOR SELECT
  USING (
    -- The managing audience: admin+ reads every row, `agent_only` included.
    is_current_workspace_member(workspace_id, 'admin')
    OR (
      -- Everyone else reads only what is shared WITH PEOPLE. A channel grant at
      -- `agent_only` names no human audience, so its EXISTENCE must not leak.
      (scope_type <> 'channel' OR level = 'visible')
      AND (
        is_current_workspace_member(workspace_id, 'viewer')
        OR (
          is_current_workspace_member(workspace_id, 'guest')
          AND scope_type = 'channel'
          AND is_channel_member(scope_id)
        )
      )
    )
  );

-- ── 3. updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS resource_grants_touch_updated_at ON public.resource_grants;
CREATE TRIGGER resource_grants_touch_updated_at
  BEFORE UPDATE ON public.resource_grants
  FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();

-- ── 4. 🔒 The validity trigger — "the grantor may share this" ────────────────
CREATE OR REPLACE FUNCTION public.enforce_resource_grant() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  scope_ws UUID;
  res_ws   UUID;
BEGIN
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
    WHEN 'knowledge_base' THEN SELECT workspace_id INTO res_ws FROM knowledge_bases WHERE id = NEW.resource_id;
    WHEN 'agent_template' THEN SELECT workspace_id INTO res_ws FROM agent_templates WHERE id = NEW.resource_id;
    WHEN 'skill'          THEN SELECT workspace_id INTO res_ws FROM skills          WHERE id = NEW.resource_id;
    WHEN 'chat'           THEN SELECT workspace_id INTO res_ws FROM chats           WHERE id = NEW.resource_id;
    WHEN 'chat_folder'    THEN SELECT workspace_id INTO res_ws FROM chat_folders    WHERE id = NEW.resource_id;
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

  -- 4. 🔒 The grantor may reach both sides. Unattributed rows keep the old
  --    same-container rule — reach across containers is bought with an author.
  IF NEW.created_by IS NULL THEN
    IF scope_ws <> res_ws THEN
      RAISE EXCEPTION 'resource_grants: an unattributed grant may not cross containers (resource=%, scope=%)',
        res_ws, scope_ws;
    END IF;
  ELSIF NOT is_workspace_member(res_ws, NEW.created_by, 'viewer') THEN
    RAISE EXCEPTION 'resource_grants: grantor % may not share out of container %',
      NEW.created_by, res_ws;
  ELSIF NOT is_workspace_member(scope_ws, NEW.created_by, 'viewer') THEN
    RAISE EXCEPTION 'resource_grants: grantor % may not share into container %',
      NEW.created_by, scope_ws;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS resource_grant_validity_check ON public.resource_grants;
CREATE TRIGGER resource_grant_validity_check
  BEFORE INSERT OR UPDATE ON public.resource_grants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_resource_grant();

-- ── 5. Hard-delete GC, two parameterised functions for eight triggers ────────
-- `TG_ARGV[0]` is the type this trigger's table stands for. Six hand-written
-- copies across the old tables become these two.
CREATE OR REPLACE FUNCTION public.drop_resource_grants_for_resource() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM resource_grants
   WHERE resource_type = TG_ARGV[0] AND resource_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.drop_resource_grants_for_scope() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM resource_grants
   WHERE scope_type = TG_ARGV[0] AND scope_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS resource_grants_cleanup ON public.knowledge_bases;
CREATE TRIGGER resource_grants_cleanup AFTER DELETE ON public.knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_resource('knowledge_base');
DROP TRIGGER IF EXISTS resource_grants_cleanup ON public.agent_templates;
CREATE TRIGGER resource_grants_cleanup AFTER DELETE ON public.agent_templates
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_resource('agent_template');
DROP TRIGGER IF EXISTS resource_grants_cleanup ON public.skills;
CREATE TRIGGER resource_grants_cleanup AFTER DELETE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_resource('skill');
DROP TRIGGER IF EXISTS resource_grants_cleanup ON public.chats;
CREATE TRIGGER resource_grants_cleanup AFTER DELETE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_resource('chat');
DROP TRIGGER IF EXISTS resource_grants_cleanup ON public.chat_folders;
CREATE TRIGGER resource_grants_cleanup AFTER DELETE ON public.chat_folders
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_resource('chat_folder');

-- The SCOPE side has no FK either: a container lent TO is not this row's
-- `workspace_id`, so the cascade on that column does not reach it.
DROP TRIGGER IF EXISTS resource_grants_scope_cleanup ON public.channels;
CREATE TRIGGER resource_grants_scope_cleanup AFTER DELETE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_scope('channel');
DROP TRIGGER IF EXISTS resource_grants_scope_cleanup ON public.teams;
CREATE TRIGGER resource_grants_scope_cleanup AFTER DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_scope('team');
DROP TRIGGER IF EXISTS resource_grants_scope_cleanup ON public.workspaces;
CREATE TRIGGER resource_grants_scope_cleanup AFTER DELETE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.drop_resource_grants_for_scope('container');

-- ── 6. Backfill — both live tables, joined to a LIVE resource ───────────────
INSERT INTO public.resource_grants
  (scope_type, scope_id, resource_type, resource_id, workspace_id, level, guest_write, created_by, created_at, updated_at)
SELECT 'channel', g.channel_id, 'knowledge_base', g.resource_id, g.workspace_id,
       g.level, g.guest_write, g.created_by, g.created_at, g.updated_at
  FROM public.channel_resource_grants g
  JOIN public.knowledge_bases kb ON kb.id = g.resource_id
 WHERE g.resource_type = 'knowledge_base'
ON CONFLICT DO NOTHING;

-- ⚠ Per resource type rather than one polymorphic statement: the join target IS
-- the type, and a `'workflow'` row (a CHECK value kept alive by
-- `20260811120000` after its feature was deleted) has no table to join to. It is
-- dropped here rather than carried, which is what
-- `access-levels.ts › RETIRED_RESOURCE_TYPES` has been filtering at the UI
-- boundary in the meantime.
INSERT INTO public.resource_grants
  (scope_type, scope_id, resource_type, resource_id, workspace_id, level, created_at, updated_at)
SELECT 'team', a.team_id, 'knowledge_base', a.resource_id, a.workspace_id, a.level, a.updated_at, a.updated_at
  FROM public.team_resource_access a
  JOIN public.knowledge_bases r ON r.id = a.resource_id
 WHERE a.resource_type = 'knowledge_base'
ON CONFLICT DO NOTHING;
INSERT INTO public.resource_grants
  (scope_type, scope_id, resource_type, resource_id, workspace_id, level, created_at, updated_at)
SELECT 'team', a.team_id, 'skill', a.resource_id, a.workspace_id, a.level, a.updated_at, a.updated_at
  FROM public.team_resource_access a
  JOIN public.skills r ON r.id = a.resource_id
 WHERE a.resource_type = 'skill'
ON CONFLICT DO NOTHING;
INSERT INTO public.resource_grants
  (scope_type, scope_id, resource_type, resource_id, workspace_id, level, created_at, updated_at)
SELECT 'team', a.team_id, 'chat', a.resource_id, a.workspace_id, a.level, a.updated_at, a.updated_at
  FROM public.team_resource_access a
  JOIN public.chats r ON r.id = a.resource_id
 WHERE a.resource_type = 'chat'
ON CONFLICT DO NOTHING;
INSERT INTO public.resource_grants
  (scope_type, scope_id, resource_type, resource_id, workspace_id, level, created_at, updated_at)
SELECT 'team', a.team_id, 'chat_folder', a.resource_id, a.workspace_id, a.level, a.updated_at, a.updated_at
  FROM public.team_resource_access a
  JOIN public.chat_folders r ON r.id = a.resource_id
 WHERE a.resource_type = 'chat_folder'
ON CONFLICT DO NOTHING;

-- `agent_template_teams` carries no level; team visibility on a template is READ
-- and writes stay creator-or-admin (F-277, the reason it was never folded into
-- the polymorphic table). Measured 0 rows on 2026-09-02; the statement is here
-- so a replay of a tree that HAS rows does not lose them.
INSERT INTO public.resource_grants
  (scope_type, scope_id, resource_type, resource_id, workspace_id, level, created_by, created_at, updated_at)
SELECT 'team', t.team_id, 'agent_template', t.template_id, t.workspace_id, 'read', t.granted_by, t.granted_at, t.granted_at
  FROM public.agent_template_teams t
  JOIN public.agent_templates r ON r.id = t.template_id
ON CONFLICT DO NOTHING;

-- ── 7. The compatibility mirror into `channel_resource_grants` ──────────────
-- ⚠ EXPAND/CONTRACT, NOT A SECOND SOURCE OF TRUTH. Nothing reads it back; it
-- exists so `repository-audience.ts › listGrantedBaseIdsForChannels` — the one
-- reader outside this slice's file ownership — keeps answering. Created AFTER
-- the backfill so the backfill does not churn rows that are already correct.
-- **Batch 3 deletes this trigger, this function and the old table together.**
CREATE OR REPLACE FUNCTION public.mirror_channel_resource_grant() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE channel_ws UUID;
BEGIN
  IF TG_OP <> 'INSERT'
     AND OLD.scope_type = 'channel' AND OLD.resource_type = 'knowledge_base' THEN
    DELETE FROM channel_resource_grants
     WHERE channel_id = OLD.scope_id
       AND resource_type = 'knowledge_base'
       AND resource_id = OLD.resource_id;
  END IF;

  IF TG_OP = 'DELETE'
     OR NEW.scope_type <> 'channel' OR NEW.resource_type <> 'knowledge_base' THEN
    RETURN NULL;
  END IF;

  -- ⚠ A CROSS-CONTAINER GRANT IS SKIPPED, NOT MIRRORED. The old table's
  -- `enforce_channel_resource_grant()` requires the three workspaces to match,
  -- so mirroring one would RAISE and turn a legal lend into an outage. Its
  -- reader is a per-container audience read, which cannot ask this question
  -- anyway.
  SELECT workspace_id INTO channel_ws FROM channels WHERE id = NEW.scope_id;
  IF channel_ws IS DISTINCT FROM NEW.workspace_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO channel_resource_grants
    (channel_id, resource_type, resource_id, workspace_id, level, guest_write, created_by, created_at, updated_at)
  VALUES
    (NEW.scope_id, 'knowledge_base', NEW.resource_id, NEW.workspace_id,
     NEW.level, NEW.guest_write, NEW.created_by, NEW.created_at, NEW.updated_at)
  ON CONFLICT (channel_id, resource_type, resource_id) DO UPDATE
    SET level = EXCLUDED.level,
        guest_write = EXCLUDED.guest_write,
        created_by = EXCLUDED.created_by,
        updated_at = EXCLUDED.updated_at;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS resource_grants_channel_mirror ON public.resource_grants;
CREATE TRIGGER resource_grants_channel_mirror
  AFTER INSERT OR UPDATE OR DELETE ON public.resource_grants
  FOR EACH ROW EXECUTE FUNCTION public.mirror_channel_resource_grant();

-- ── 8. Trigger fns never need direct EXECUTE from API roles (advisor 0028/9) ─
REVOKE EXECUTE ON FUNCTION public.enforce_resource_grant()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.drop_resource_grants_for_resource() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.drop_resource_grants_for_scope()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_channel_resource_grant()     FROM anon, authenticated;

-- ── 9. Assert the outcome instead of trusting it (INVARIANTS §12) ───────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid='public.resource_grants'::regclass;
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--     WHERE NOT tgisinternal AND tgfoid IN (
--       'public.drop_resource_grants_for_resource'::regproc,
--       'public.drop_resource_grants_for_scope'::regproc);
--   SELECT policyname, qual FROM pg_policies WHERE tablename='resource_grants';
DO $$
DECLARE
  v_pk_cols text;
  v_gc      int;
BEGIN
  IF to_regclass('public.resource_grants') IS NULL THEN
    RAISE EXCEPTION 'resource_grants table missing';
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY array_position(con.conkey, a.attnum))
    INTO v_pk_cols
  FROM pg_constraint con
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
  WHERE con.conrelid = 'public.resource_grants'::regclass AND con.contype = 'p';
  IF v_pk_cols <> 'scope_type,scope_id,resource_type,resource_id' THEN
    RAISE EXCEPTION 'unexpected PK columns: %', v_pk_cols;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='resource_grants'
       AND indexname='resource_grants_resource_idx'
  ) THEN
    RAISE EXCEPTION 'resource_idx missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.resource_grants'::regclass
       AND tgname='resource_grant_validity_check'
  ) THEN
    RAISE EXCEPTION 'validity trigger missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.resource_grants'::regclass
       AND tgname='resource_grants_channel_mirror'
  ) THEN
    RAISE EXCEPTION 'channel mirror trigger missing';
  END IF;

  -- Five resource tables + three scope tables; a missing one is a grant table
  -- that keeps rows for a resource that no longer exists.
  SELECT count(*) INTO v_gc
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgfoid IN ('public.drop_resource_grants_for_resource'::regproc,
                    'public.drop_resource_grants_for_scope'::regproc);
  IF v_gc <> 8 THEN
    RAISE EXCEPTION 'expected 8 grant-GC triggers, found %', v_gc;
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public' AND tablename='resource_grants') <> 2 THEN
    RAISE EXCEPTION 'expected exactly two RLS policies';
  END IF;

  RAISE NOTICE 'resource_grants verified: PK=(%), resource_idx, validity + mirror triggers, % GC triggers, 2 RLS policies', v_pk_cols, v_gc;
END $$;
