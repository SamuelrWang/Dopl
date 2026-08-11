-- Channels — a TOMBSTONED channel is no longer readable through RLS (C-15a,
-- Samuel's decision 2026-08-10: "it should be permanently delete").
--
-- ⚠️ WRITTEN, NOT APPLIED. Review first, then apply. This file must land
-- BEFORE 20260810110000_purge_legacy_soft_deleted_non_dm_channels.sql — see
-- "ORDER" below.
--
-- ── PURPOSE ────────────────────────────────────────────────────────────────
-- `20260725120000_channels.sql` shipped every channel-scoped SELECT policy
-- WITHOUT a `deleted_at` filter, on the stated argument that "the service
-- layer hides trashed rows … so a soft-delete UPDATE event still reaches
-- subscribers". The service layer does hide them (`repository.listChannels` /
-- `findChannelById` / `findChannelAccess` / `findChannelBySlug` all carry
-- `.is("deleted_at", null)`) — but the service layer is not the only reader.
-- `authenticated` holds SELECT on all three tables so Realtime and direct
-- PostgREST work, and the browser ships the anon key
-- (`src/shared/supabase/browser.ts`). So any member of a channel could read a
-- "deleted" channel's ENTIRE transcript straight off `/rest/v1/channel_messages`
-- after the app had told them it was gone. That is C-15's second half.
--
-- This adds the missing conjunct to every CHANNEL-TRANSPARENT read policy —
-- the ones whose rule is "you may read this because you are in channel X, or
-- because X is public". Owner-scoped policies are deliberately untouched; see
-- "WHAT IS NOT IN HERE".
--
-- ── THE DM CASE, WHICH IS THE ONLY REASON THIS NEEDED THINKING ─────────────
-- `channels.deleted_at` is NOT a trash (ENGINEERING §7, "DELETES ARE
-- PERMANENT"). Since 2026-08-08 (C-16 / F-173) it is a DM-ONLY mechanic: a
-- direct channel SOFT-deletes because that is the CLOSE half of close/reopen,
-- and either side's next open revives the SAME row with its full history. A
-- tombstoned DM is LIVE PRODUCT STATE. So the question this file has to answer
-- is not "is hiding tombstones correct" but "does hiding a CLOSED DM's rows at
-- the RLS layer break the reopen".
--
-- It does not, and the reason is that NOTHING reads a closed DM through RLS:
--   • `reopenDirectChannel` → `repo.findDirectChannelAnyStatus` →
--     `repo.reviveChannel` (service-writes.ts:143/175/214, repository.ts:182)
--     all go through `supabaseAdmin()`. service_role BYPASSES RLS entirely, so
--     the revive path cannot see this change at all.
--   • `existingSlugs` (the read that must see tombstoned rows, because the
--     unique index is non-partial and a hidden DM still owns its slug) is also
--     service_role.
--   • Every other channels/members/messages read in the feature is
--     service_role via the repository. There is no authenticated PostgREST
--     read of these tables anywhere in the app (verified by grep: the only
--     browser-client `.from()` calls in `src/` are `profiles` and the OAuth
--     tables; the desktop SPA's Supabase use is `postgres_changes` bindings
--     only, and it treats every event as a doorbell).
-- So the members' DIRECT reads of a closed DM go dark, which is exactly the
-- product: closed = hidden until reopened. Reopen clears `deleted_at` and the
-- rows come back for both sides, unchanged.
--
-- ── REALTIME: WHAT GOES QUIET, AND THE ONE REGRESSION, STATED ──────────────
-- The SELECT policy feeds the Realtime publication (ENGINEERING §7: walrus
-- evaluates the policy as the SUBSCRIBER's role), so three things follow:
--   1. ✅ A member of a CLOSED DM stops receiving its CDC events. Correct —
--      closed should be quiet.
--   2. ✅ REOPEN STILL PROPAGATES LIVE. `reviveChannel` writes
--      `deleted_at = null`, and walrus tests the policy against the NEW record,
--      which now passes. The peer's window learns immediately, as today.
--   3. ⚠️ THE CLOSE ITSELF STOPS BEING A LIVE EVENT. `softDeleteChannel` is an
--      UPDATE whose new record FAILS the policy, so the frame is dropped for
--      both members instead of delivered. Today the peer's sidebar loses the
--      closed DM the instant the doorbell arrives; after this it loses it on
--      the next natural refetch, and a click in that window resolves to the
--      "channel not found" path (`findChannelById` already filtered it). This
--      is a liveness regression, not a correctness or security one, and it is
--      the price of the fix — the policy is the same expression for reads and
--      for CDC; there is no way to hide the row from PostgREST while keeping
--      it deliverable over CDC. If the live close is wanted back, the remedy
--      is at the SERVICE layer, not here: have the DM branch of
--      `deleteChannel` also touch the peer's `channel_members` row (that table
--      is in the same subscriber table-set and rides the same refetch signal,
--      and its own policy no longer sees the channel either — so use a plain
--      UPDATE that lands BEFORE the tombstone stamp). Left undone deliberately:
--      it is a service change, and this file is a security fix.
--
-- ── WHY ONE MERGED `EXISTS` PER CHILD TABLE ────────────────────────────────
-- The child policies read "member OR the channel is public", where the second
-- branch is already an `EXISTS` on `channels`. Folding `deleted_at IS NULL`
-- into that single `EXISTS` and moving `is_channel_member` inside it costs one
-- primary-key lookup on a narrow, cache-hot table in the member case, and
-- SAVES one `is_channel_member` call in the public case (the OR no longer has
-- to fail that function first). A separate `NOT EXISTS (… deleted_at IS NOT
-- NULL)` conjunct would cost the same lookup and read worse.
--
-- No new policy helper function is introduced ON PURPOSE. Per
-- `20260730052410_realtime_rls_helpers_grant_anon_execute.sql`, ANY new
-- function referenced by a SELECT policy on a PUBLISHED table must also be
-- `GRANT EXECUTE`d to `anon`, or an expired-JWT subscriber joining as anon
-- raises 42501 inside `realtime.apply_rls` and kills the CDC pipeline for
-- EVERY subscriber in the project (observed in prod 2026-07-29). An inline
-- `EXISTS` has no such footgun. `is_channel_member` (already granted to anon
-- there) is the only function used, and it stays SECURITY DEFINER so the
-- `channel_members` policy still does not recurse into itself.
--
-- ── WHAT IS NOT IN HERE, AND WHY ───────────────────────────────────────────
-- • `channel_task_participants_member_select` — INHERITS the guard and needs no
--   edit. Its `EXISTS` is on `channel_tasks`, which is itself RLS-filtered for
--   the same caller, and `channel_tasks_member_select` is fixed below. (This is
--   the same "a referenced table in a policy expression is subject to its own
--   policy" rule that made `is_channel_member` SECURITY DEFINER necessary in
--   the first place.) Do not "fix" it with a third nesting level.
-- • `channel_consent_requests_operator_select` and `channel_sessions_owner_select`
--   — OWNER-scoped, not channel-transparent: they return the CALLER'S OWN rows
--   (their consent audit trail, their own machine's session state), not a
--   shared transcript. Hiding a caller's own audit row because the other party
--   closed the DM is a different product decision, and the consent table is
--   `REPLICA IDENTITY FULL` with a load-bearing live-UPDATE path (the consent
--   card) that is not worth disturbing for a tombstone.
-- • `channels.deleted_at` is NOT dropped and the service-layer
--   `.is("deleted_at", null)` filters are NOT removed. Defense in depth; §7's
--   standing rule is that a new read of a `deleted_at` table still carries the
--   guard.
--
-- ── ORDER ──────────────────────────────────────────────────────────────────
-- APPLY THIS BEFORE `20260810110000_purge_legacy_soft_deleted_non_dm_channels.sql`
-- (the filenames already sort that way). Either order reaches the same end
-- state, so this is about the window in between: RLS-first closes the
-- disclosure for EVERY tombstone immediately, including the ones the purge
-- cannot reach (DMs, which stay soft-deleted forever, and any non-DM tombstone
-- created between the two migrations). Purge-first would leave the DM
-- transcripts readable for the length of that window and leaves the fix
-- dependent on a data sweep having run. Nothing in the purge depends on this
-- file: `realtime.apply_rls` does not evaluate RLS for DELETE at all
-- (`20260807150000` documents that), so the policy has no bearing on which
-- delete frames the purge emits.
--
-- ── VERIFICATION (run BEFORE applying, to size the blast radius) ───────────
--   -- How many channels go dark, and how many of those are LIVE DM state:
--   select is_direct,
--          count(*)                                  as tombstoned_channels,
--          (select count(*) from public.channel_messages m
--             join public.channels c2 on c2.id = m.channel_id
--            where c2.deleted_at is not null
--              and c2.is_direct = c.is_direct)        as their_messages
--     from public.channels c
--    where c.deleted_at is not null
--    group by is_direct;
--
-- ── VERIFICATION (run AFTER applying) ──────────────────────────────────────
--   -- Every one of these five USING expressions must mention deleted_at:
--   select polrelid::regclass as tbl, polname,
--          pg_get_expr(polqual, polrelid) as using_expr
--     from pg_policy
--    where polname in ('channels_member_select',
--                      'channel_members_member_select',
--                      'channel_messages_member_select',
--                      'channel_tasks_member_select',
--                      'channel_agents_member_select')
--    order by tbl, polname;
--
--   -- End to end, as a real member (replace both uuids). Expect 0 rows for a
--   -- tombstoned channel and >0 for a live one:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<member-user-uuid>","role":"authenticated"}';
--   select count(*) from public.channel_messages where channel_id = '<tombstoned-channel-uuid>';
--   reset role;
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Restores the 20260725120000 / 20260727150000 / 20260731120000 expressions
-- verbatim. Safe to run at any time; it re-opens the disclosure this file
-- closes.
--
--   DROP POLICY IF EXISTS channels_member_select ON public.channels;
--   CREATE POLICY channels_member_select ON public.channels FOR SELECT USING (
--     is_current_workspace_member(workspace_id, 'viewer'::text)
--     AND ((visibility = 'public'::text) OR is_channel_member(id)));
--
--   DROP POLICY IF EXISTS channel_members_member_select ON public.channel_members;
--   CREATE POLICY channel_members_member_select ON public.channel_members FOR SELECT USING (
--     is_current_workspace_member(workspace_id, 'viewer'::text)
--     AND (is_channel_member(channel_id) OR EXISTS (
--       SELECT 1 FROM public.channels c
--        WHERE c.id = channel_members.channel_id AND c.visibility = 'public'::text)));
--
--   DROP POLICY IF EXISTS channel_messages_member_select ON public.channel_messages;
--   CREATE POLICY channel_messages_member_select ON public.channel_messages FOR SELECT USING (
--     is_current_workspace_member(workspace_id, 'viewer'::text)
--     AND (is_channel_member(channel_id) OR EXISTS (
--       SELECT 1 FROM public.channels c
--        WHERE c.id = channel_messages.channel_id AND c.visibility = 'public'::text)));
--
--   DROP POLICY IF EXISTS channel_tasks_member_select ON public.channel_tasks;
--   CREATE POLICY channel_tasks_member_select ON public.channel_tasks FOR SELECT USING (
--     is_current_workspace_member(workspace_id, 'viewer'::text)
--     AND (is_channel_member(channel_id) OR EXISTS (
--       SELECT 1 FROM public.channels c
--        WHERE c.id = channel_tasks.channel_id AND c.visibility = 'public'::text)));
--
--   DROP POLICY IF EXISTS channel_agents_member_select ON public.channel_agents;
--   CREATE POLICY channel_agents_member_select ON public.channel_agents FOR SELECT USING (
--     is_current_workspace_member(workspace_id, 'viewer'::text)
--     AND (is_channel_member(channel_id) OR EXISTS (
--       SELECT 1 FROM public.channels c
--        WHERE c.id = channel_agents.channel_id AND c.visibility = 'public'::text)));


-- ===========================================================================
-- channels — the row itself
-- ===========================================================================
DROP POLICY IF EXISTS channels_member_select ON public.channels;

CREATE POLICY channels_member_select ON public.channels
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND deleted_at IS NULL
    AND (
      (visibility = 'public'::text)
      OR is_channel_member(id)
    )
  );


-- ===========================================================================
-- channel_members — the roster
-- ===========================================================================
DROP POLICY IF EXISTS channel_members_member_select ON public.channel_members;

CREATE POLICY channel_members_member_select ON public.channel_members
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_members.channel_id
        AND c.deleted_at IS NULL
        AND (
          c.visibility = 'public'::text
          OR is_channel_member(c.id)
        )
    )
  );


-- ===========================================================================
-- channel_messages — the transcript (the row C-15 is actually about)
-- ===========================================================================
DROP POLICY IF EXISTS channel_messages_member_select ON public.channel_messages;

CREATE POLICY channel_messages_member_select ON public.channel_messages
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_messages.channel_id
        AND c.deleted_at IS NULL
        AND (
          c.visibility = 'public'::text
          OR is_channel_member(c.id)
        )
    )
  );


-- ===========================================================================
-- channel_tasks — the OTHER half of the transcript (threads)
-- ===========================================================================
-- Not in the realtime publication (`20260728010000` removed it), so this is a
-- direct-PostgREST read-model fix only. `channel_task_participants` inherits
-- via its `EXISTS` on this table — see the header.
DROP POLICY IF EXISTS channel_tasks_member_select ON public.channel_tasks;

CREATE POLICY channel_tasks_member_select ON public.channel_tasks
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_tasks.channel_id
        AND c.deleted_at IS NULL
        AND (
          c.visibility = 'public'::text
          OR is_channel_member(c.id)
        )
    )
  );


-- ===========================================================================
-- channel_agents — the agent roster
-- ===========================================================================
-- Also unpublished (`20260807000000` removed it). Same rule as the human
-- roster: a closed room's participants are not readable while it is closed.
DROP POLICY IF EXISTS channel_agents_member_select ON public.channel_agents;

CREATE POLICY channel_agents_member_select ON public.channel_agents
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_agents.channel_id
        AND c.deleted_at IS NULL
        AND (
          c.visibility = 'public'::text
          OR is_channel_member(c.id)
        )
    )
  );
