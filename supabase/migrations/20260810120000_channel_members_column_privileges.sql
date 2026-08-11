-- `channel_members` — ROLE IS PUBLIC, PER-MEMBER SETTINGS ARE PRIVATE (C-15b,
-- Samuel's decision 2026-08-10, verbatim: "the only thing available to other
-- members should be the role, ex member, admin, etc. But not the specific
-- permissions").
--
-- ⚠️ WRITTEN, NOT APPLIED. Review, apply, then run the AFTER-verification —
-- one of the two mechanisms this relies on is only partly provable from inside
-- this repo (see "THE MECHANISM, AND HOW FAR IT IS VERIFIED").
--
-- ── PURPOSE ────────────────────────────────────────────────────────────────
-- `dto.ts#mapMemberRow` nulls `agent_tool_profile` for everyone but the viewer,
-- "so it holds for every path". It does not hold for every path, because the
-- DTO is not on every path: `channel_members` is in the `supabase_realtime`
-- publication AND `authenticated` holds table-wide SELECT on it, so the RAW row
-- reaches any channel member twice over — once through `/rest/v1/channel_members`
-- and once through CDC. `agent_tool_profile` is how tightly a member scoped
-- their own responding agent (`full` / `dopl_only` / `read_only`); it is a
-- containment setting about someone's own machine, and it was roster-public.
-- That is C-15's first half. (C-11's other exposure, `notify_scope`, is already
-- gone — dropped by `20260808120000`, applied 2026-08-09.)
--
-- The fix has to live BELOW the DTO or it is not a fix. Column-level privileges
-- are the only lever that binds PostgREST and Realtime at once: revoke the
-- table-wide grant, then name the readable columns explicitly.
--
-- ── COLUMN CLASSIFICATION (the whole decision, in one table) ───────────────
-- `channel_members` has eight columns (`20260725120000` + `20260726120000`;
-- `notify_scope` was dropped by `20260808120000`):
--
--   channel_id          PUBLIC   — routing key, and an input to this table's own
--                                  SELECT policy. Revoking it would break RLS.
--   user_id             PUBLIC   — who is in the room. The roster IS the point.
--   workspace_id        PUBLIC   — ⚠ LOAD-BEARING: it is the Realtime
--                                  subscription filter (`workspace_id=eq.<id>`)
--                                  on both subscribers AND the outer fence in
--                                  the SELECT policy. Revoke it and the feed
--                                  dies, not just the payload.
--   role                PUBLIC   — Samuel's rule names this one explicitly:
--                                  owner / member is public.
--   joined_at           PUBLIC   — roster ordering (`listMembers` sorts by it).
--   added_by            PUBLIC   — membership provenance ("X added Y"), the same
--                                  class of fact as the roster itself. It is not
--                                  a permission and not a setting.
--   last_read_at        PUBLIC   — JUDGMENT CALL, STATED. It is read-receipt-ish,
--                                  which is a privacy question in its own right,
--                                  but it is not a PERMISSION and Samuel's rule
--                                  is about permissions ("role yes, specific
--                                  permissions no"). Left readable. If read
--                                  receipts are separately decided to be private,
--                                  moving it is a one-line edit to the GRANT
--                                  below — but that is a product decision, not
--                                  this migration's.
--   agent_tool_profile  PRIVATE  — the containment setting. The only column this
--                                  file takes away.
--
-- ── THE MECHANISM, AND HOW FAR IT IS VERIFIED ──────────────────────────────
-- Two consumers, two different levels of confidence. Read both before applying.
--
--   1. PostgREST — CERTAIN. Column privileges are plain Postgres. A column with
--      no SELECT grant cannot be read, and a `select=*` that resolves to it
--      raises 42501. Nothing in the app does that: EVERY `channel_members` read
--      in `src/` goes through `repository.ts` / `repository-collab.ts` on
--      `supabaseAdmin()` (service_role, whose grants are untouched here — grants
--      are per-role), and the only browser-client `.from()` calls anywhere in
--      `src/` are `profiles` and the OAuth tables. Verified by grep, both
--      directions. NOTE FOR THE FUTURE: an authenticated `select("*")` against
--      this table now ERRORS rather than returning a partial row. That is the
--      correct failure (loud, not silent), but it means a future direct read
--      must name its columns.
--
--   2. Realtime CDC — PROVABLE ONLY IN PART FROM THIS REPO, AND THAT IS THE
--      RISK THIS FILE CARRIES. What IS established in-tree: the DEPLOYED
--      `realtime.apply_rls` runs
--          has_column_privilege(role, entity, c.name, 'SELECT')
--      once per column per subscriber role — quoted verbatim from the deployed
--      function in `20260807150000_replica_identity_for_hard_deletes.sql:80-83`,
--      where it appears as a COST argument (FULL replica identity would take
--      that loop "from 1 column to ~15"). So the per-column privilege loop
--      exists and runs. What is NOT established in-tree is what the loop DOES
--      with a column that fails it — dropping it from the frame is the intended
--      behaviour and the reason this lever was chosen, but this repo has been
--      burned before by assuming the deployed walrus matches its upstream
--      (`20260807150000` again: the deployed `is_visible_through_filters`
--      returns FALSE where upstream master `coalesce(...)`s to TRUE, and
--      ENGINEERING §7 says in as many words not to verify against upstream
--      master because it lies about this database). So it is NOT verified here,
--      by design, and the AFTER-verification below is not optional.
--
--      THE FAILURE MODE TO WATCH FOR, NAMED. `has_table_privilege` does NOT
--      consider column-level grants. If the deployed `apply_rls` gates on
--      table-level SELECT anywhere ahead of its per-column loop, this migration
--      takes `channel_members` CDC DARK for `authenticated` instead of merely
--      redacting one column. Blast radius if that happens: the ROSTER DOORBELL
--      (join / leave / last-read) stops firing; the channel list and transcript
--      keep updating, because `channels` and `channel_messages` are separate
--      bindings on the same subscription and are untouched. Degraded liveness,
--      no data loss, no security regression — and the rollback is one
--      statement. That is an acceptable, stated risk; it is not an unnoticed
--      one.
--
--      WHY `anon` IS GRANTED THE PUBLIC COLUMNS RATHER THAN LEFT BARE. An anon
--      subscriber (signed-out tab, or a client whose stored JWT expired — the
--      exact scenario observed in prod 2026-07-29) executes this same loop.
--      `20260730052410` is the record of what happens when such a subscriber
--      raises 42501 inside `apply_rls`: it killed the CDC pipeline for EVERY
--      subscriber in the project, not just the offending one. Leaving `anon`
--      with zero readable columns on a published table is precisely that shape
--      of risk, for zero benefit — RLS already denies anon every row
--      (`is_current_workspace_member` resolves off `auth.uid()`, NULL for anon).
--      So anon gets the same public column set. It still reads nothing.
--
--      IF THE AFTER-VERIFICATION SHOWS CDC IS DARK: roll back (one line, below)
--      and move `agent_tool_profile` to its own `channel_member_settings` table
--      with a self-only SELECT policy and no publication membership. That is
--      strictly correct for both consumers and needs no assumption about
--      walrus's internals; it is not done here only because it is a schema
--      change plus a service change, and the column grant is the smaller move
--      if it works.
--
-- ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
-- • `service_role` keeps full table SELECT. Grants are per-role, so every
--   `select("*")` in the repository is unaffected. The assertion block proves it
--   rather than asserting it.
-- • `dto.ts#mapMemberRow`'s scrub STAYS. It is now defense in depth rather than
--   the only line of defense; its comment says so.
-- • No RLS policy, no publication membership, no replica identity, no data.
--   Metadata only.
--
-- ── VERIFICATION (BEFORE APPLYING — confirm who actually holds the grant) ──
--   select grantee, privilege_type
--     from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'channel_members'
--      and privilege_type = 'SELECT'
--    order by grantee;
--   -- Expect anon / authenticated / service_role (+ owner). If PUBLIC appears,
--   -- the REVOKEs below will not be enough — the assertion block will catch it
--   -- and abort, and the fix is to add `REVOKE SELECT ... FROM PUBLIC`.
--
-- ── VERIFICATION (AFTER APPLYING) ──────────────────────────────────────────
--   -- 1. Column privileges land as intended:
--   select grantee, column_name
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'channel_members'
--      and privilege_type = 'SELECT' and grantee in ('anon','authenticated')
--    order by grantee, column_name;
--   -- Expect exactly: added_by, channel_id, joined_at, last_read_at, role,
--   -- user_id, workspace_id. NOT agent_tool_profile.
--
--   -- 2. PostgREST, as a real member (replace the uuid). First must 401/42501,
--   --    second must return the roster:
--   --   GET /rest/v1/channel_members?select=*&channel_id=eq.<uuid>
--   --   GET /rest/v1/channel_members?select=user_id,role&channel_id=eq.<uuid>
--
--   -- 3. ⚠ CDC — THE ONE THAT IS NOT PROVABLE FROM THE TREE. Open the web app
--   --    (or a desktop window) on a workspace, then from another session add or
--   --    remove a channel member. The roster must still update live. If it does
--   --    not, `apply_rls` is gating on table privilege: ROLL BACK.
--   --    Inspect a frame directly if you want the payload rather than the
--   --    symptom — `agent_tool_profile` must be absent from `record`.
--
-- ── ROLLBACK (one statement, restores the status quo exactly) ──────────────
--   GRANT SELECT ON public.channel_members TO anon, authenticated;
--   -- (Table-level SELECT supersedes the column grants; they can be left in
--   --  place or dropped with
--   --  REVOKE SELECT (channel_id, user_id, workspace_id, role, last_read_at,
--   --                 added_by, joined_at)
--   --    ON public.channel_members FROM anon, authenticated;)

-- ===========================================================================
-- Take the table-wide grant away, then hand back exactly the public columns.
-- ===========================================================================
REVOKE SELECT ON public.channel_members FROM anon, authenticated;

GRANT SELECT (
  channel_id,
  user_id,
  workspace_id,
  role,
  last_read_at,
  added_by,
  joined_at
) ON public.channel_members TO anon, authenticated;


-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
-- Three ways this could land wrong and still look fine: a PUBLIC grant keeping
-- the sensitive column readable underneath the REVOKE, a typo taking away a
-- column the roster or the Realtime filter needs, or the REVOKE catching
-- service_role and breaking every server read. Each aborts the transaction.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.channel_members', 'agent_tool_profile', 'SELECT')
     OR has_column_privilege('anon', 'public.channel_members', 'agent_tool_profile', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: channel_members.agent_tool_profile is STILL SELECT-able by anon/authenticated after the revoke — something else (PUBLIC, or another granted role) holds the privilege; find it before shipping this';
  END IF;

  IF NOT (
    has_column_privilege('authenticated', 'public.channel_members', 'role',         'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_members', 'user_id',      'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_members', 'channel_id',   'SELECT')
    AND has_column_privilege('authenticated', 'public.channel_members', 'workspace_id', 'SELECT')
  ) THEN
    RAISE EXCEPTION
      'ABORT: authenticated lost SELECT on a load-bearing channel_members column (role / user_id / channel_id / workspace_id) — the roster read and the realtime workspace filter both depend on these';
  END IF;

  IF NOT has_column_privilege('service_role', 'public.channel_members', 'agent_tool_profile', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: service_role lost SELECT on channel_members.agent_tool_profile — every repository select("*") would 42501';
  END IF;

  RAISE NOTICE
    'channel_members column privileges: agent_tool_profile is now service_role-only; role/user_id/channel_id/workspace_id/last_read_at/added_by/joined_at stay readable to anon+authenticated';
END
$$;
