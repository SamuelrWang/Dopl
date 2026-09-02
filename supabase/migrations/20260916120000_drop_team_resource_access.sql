-- DROP `team_resource_access` — and with it a five-migration trigger chain.
-- Wave B slice B1, last of three. Requires `20260914120000_resource_grants`.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ═══ WHAT THIS TABLE COST ═══════════════════════════════════════════════════
--
-- `assert_team_grant_workspace()` was written FIVE TIMES — `20260611020000` §7,
-- then `20260707210000`, `20260708120000`, `20260708150001` and
-- `20260811140000`, each a whole `CREATE OR REPLACE` of the same function to add
-- one `WHEN` arm to one `CASE`. Its GC was written FOUR more times, once per
-- resource type (`drop_knowledge_base_grants`, `drop_chat_grants`,
-- `drop_chat_folder_grants`, `drop_skill_grants`, plus
-- `delete_workflow_team_grants` for a feature since deleted). Adding a fifth
-- resource type meant touching all of it.
--
-- `resource_grants` replaces the chain with one `enforce_resource_grant()` and
-- two parameterised GC functions, and — per ruling B4 — **keeps the team
-- capability**: a team is now a `scope_type`, its grants are ordinary rows, and
-- everything the teams UI could express it can still express.
--
-- ⚠ **NO POLICY IS DELETED HERE.** `chats_member_select` and
-- `chat_messages_select` are RE-STATED onto `resource_grants` with every arm and
-- every rank unchanged. Tenancy risk 1 (findings-tenancy §5) forbids removing a
-- policy to "remove the duplicate", and `20260716150000` is this repo's record
-- of what a chats RLS gap cost the first time. The two policies dropped WITH the
-- table (`team_resource_access_member_select`, `team_resource_access_admin_write`)
-- are the table's own and have nothing left to guard.
--
-- ═══ THE FIVE ROWS ══════════════════════════════════════════════════════════
--
-- Measured on production 2026-09-02 (findings-tenancy §1): **5 rows, all inert**
-- — 0 teams-mode knowledge bases and 0 team-visibility templates, so no read
-- path resolves through any of them. `20260914120000` copied them (those whose
-- resource still exists) before this file runs. That is the whole data risk.
--
-- ═══ THE `'workflow'` VALUE, AND THE COMMENT THAT OUTLIVES IT ═══════════════
--
-- The CHECK deliberately kept `'workflow'` after `20260811120000` deleted the
-- feature, and `teams/access-levels.ts › RETIRED_RESOURCE_TYPES` filters it at
-- the UI boundary *because the CHECK still accepts it*. After this file that
-- justification is gone — `resource_grants` does not name the value — and the
-- filter becomes a fail-safe with nothing to fail against. Left standing, and
-- filed (F-466) rather than edited: `access-levels.ts` belongs to no slice in
-- this wave and a render filter that fails safe is not worth an ownership
-- breach.
--
-- ═══ APPLY / VERIFY / REPLAY ═══════════════════════════════════════════════
--
-- ⚠ **THE BEHAVIOURAL PROBES ARE OWED, NOT RUN** — no database on this branch.
-- Owed, all inside `BEGIN; … ROLLBACK;`, three per rewritten policy branch, as
-- the caller (`SET LOCAL ROLE authenticated` + a request JWT):
--   P1  owner reads own chat (any access_mode)                → 1 row
--   P2  admin reads a member's `private` chat                 → 1 row (the
--       blanket admin arm this policy has always had — unchanged)
--   P3  viewer reads a `public`/`workspace` chat              → 1 row
--   P4  guest reads a `public`/`workspace` chat               → 0 rows
--   P5  viewer reads a `public`/`teams` chat, in a team with a grant → 1 row
--   P6  viewer reads a `public`/`teams` chat, in no such team  → 0 rows
--   P7  P5 after DELETEing the `resource_grants` row           → 0 rows
--   P8  P5 with the grant's `scope_type` flipped to 'container'→ 0 rows (the
--       scope filter is load-bearing, not decorative)
--   P9  the same eight against `chat_messages_select`
--   P10 `SELECT … FROM team_resource_access`                   → 42P01 (gone)
--   P11 hard-DELETE a granted chat, then count `resource_grants` rows for it
--       → 0 (the GC moved to `20260914120000`'s parameterised trigger)
-- ⚠ REPLAY (`supabase db reset` → exit 0) IS THE GATE (INVARIANTS §12), OWED.
-- ⚠ NEW FILE — never an edit to an applied migration.
--
-- ROLLBACK (prose). Re-run `20260611020000` §3 (table, two indexes, two
-- policies) and §7's `assert_team_grant_workspace` AS `20260811140000` left it
-- — that is the live body, not §7's — plus the four GC functions and their
-- triggers from `20260707210000`, `20260708120000`, `20260708150001` and
-- `20260807130000`. Re-insert from `resource_grants WHERE scope_type='team'`,
-- then re-state the two chats policies with the bodies in `20260720211005`
-- STEP 2. ⚠ ORDERING TRAP: re-insert BEFORE re-stating the policies, or a
-- teams-mode chat is invisible to its team and visible to admins in between —
-- a partial outage that reports itself as an empty list, not as an error.

-- ── 1. The two chats policies, re-stated onto `resource_grants` ─────────────
-- Bodies are `20260720211005` STEP 2's, verbatim, with the join source changed
-- and the scope/type filters added. Ranks, arms and arm ORDER are untouched.
DROP POLICY IF EXISTS chats_member_select ON public.chats;
CREATE POLICY chats_member_select ON public.chats
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'admin'::text)
    OR (
      (visibility = 'public'::text)
      AND (access_mode = 'workspace'::text)
      AND is_current_workspace_member(workspace_id, 'viewer'::text)
    )
    OR (
      (visibility = 'public'::text)
      AND (access_mode = 'teams'::text)
      AND is_current_workspace_member(workspace_id, 'viewer'::text)
      AND (EXISTS (
        SELECT 1
        FROM (resource_grants g
          JOIN team_members tm ON ((tm.team_id = g.scope_id)))
        WHERE ((g.scope_type = 'team'::text)
          AND (g.resource_type = 'chat'::text)
          AND (g.resource_id = chats.id)
          AND (tm.user_id = (SELECT auth.uid())))
      ))
    )
  );

DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE ((c.id = chat_messages.chat_id)
        AND (
          (c.owner_id = (SELECT auth.uid()))
          OR is_current_workspace_member(c.workspace_id, 'admin'::text)
          OR (
            (c.visibility = 'public'::text)
            AND (c.access_mode = 'workspace'::text)
            AND is_current_workspace_member(c.workspace_id, 'viewer'::text)
          )
          OR (
            (c.visibility = 'public'::text)
            AND (c.access_mode = 'teams'::text)
            AND is_current_workspace_member(c.workspace_id, 'viewer'::text)
            AND (EXISTS (
              SELECT 1
              FROM (resource_grants g
                JOIN team_members tm ON ((tm.team_id = g.scope_id)))
              WHERE ((g.scope_type = 'team'::text)
                AND (g.resource_type = 'chat'::text)
                AND (g.resource_id = c.id)
                AND (tm.user_id = (SELECT auth.uid())))
            ))
          )
        ))
    )
  );

-- ── 2. The four GC triggers, and the fifth whose table is already gone ─────
DROP TRIGGER IF EXISTS knowledge_base_grants_cleanup ON public.knowledge_bases;
DROP TRIGGER IF EXISTS chat_grants_cleanup           ON public.chats;
DROP TRIGGER IF EXISTS chat_folder_grants_cleanup    ON public.chat_folders;
DROP TRIGGER IF EXISTS skill_grants_cleanup          ON public.skills;
-- `workflows` was dropped by `20260811120000`, taking its trigger with it. The
-- guard is here because `DROP TRIGGER … ON` a missing table is an ERROR, not a
-- no-op, and a replay from zero must not stop on it.
DO $$
BEGIN
  IF to_regclass('public.workflows') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS workflow_deleted_grant_cleanup ON public.workflows';
  END IF;
END $$;

-- ── 3. The table, its trigger and the five-migration function chain ────────
-- `team_grant_workspace_check` goes with the table.
DROP TABLE IF EXISTS public.team_resource_access;

DROP FUNCTION IF EXISTS public.assert_team_grant_workspace();
DROP FUNCTION IF EXISTS public.drop_knowledge_base_grants();
DROP FUNCTION IF EXISTS public.drop_chat_grants();
DROP FUNCTION IF EXISTS public.drop_chat_folder_grants();
DROP FUNCTION IF EXISTS public.drop_skill_grants();
DROP FUNCTION IF EXISTS public.delete_workflow_team_grants();

-- ── 4. Assert the outcome instead of trusting it (INVARIANTS §12) ──────────
--   SELECT to_regclass('public.team_resource_access');
--   SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
--     AND proname LIKE '%team_grant%';
--   SELECT policyname, qual FROM pg_policies
--     WHERE tablename IN ('chats','chat_messages') AND cmd='SELECT';
DO $$
DECLARE v_left text;
BEGIN
  IF to_regclass('public.team_resource_access') IS NOT NULL THEN
    RAISE EXCEPTION 'team_resource_access still exists';
  END IF;

  SELECT string_agg(proname, ', ' ORDER BY proname) INTO v_left
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('assert_team_grant_workspace','drop_knowledge_base_grants',
                     'drop_chat_grants','drop_chat_folder_grants',
                     'drop_skill_grants','delete_workflow_team_grants');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'grant functions survived the table: %', v_left;
  END IF;

  -- 🔒 The two chats policies must STILL EXIST and must read the new table.
  -- A policy that vanished with its join source is the leak `20260716150000`
  -- was written to close.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='chats'
       AND policyname='chats_member_select'
       AND qual::text LIKE '%resource_grants%'
  ) THEN
    RAISE EXCEPTION 'chats_member_select is missing or does not read resource_grants';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='chat_messages'
       AND policyname='chat_messages_select'
       AND qual::text LIKE '%resource_grants%'
  ) THEN
    RAISE EXCEPTION 'chat_messages_select is missing or does not read resource_grants';
  END IF;

  RAISE NOTICE 'team_resource_access dropped: 1 table, 2 policies, 1 validity trigger, 4 GC triggers and 6 functions; the chats policies were re-stated, never removed';
END $$;
