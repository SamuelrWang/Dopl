-- CHANNELS V2, PHASE 1 — ONE CLOCK FOR "WHEN DID THIS THREAD LAST SEE ACTIVITY".
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `repository-tasks.ts › listTasksByChannel` ordered a channel's threads by
-- `created_at DESC`, which is the order they were OPENED in — so a thread with
-- hourly traffic sank below a thread opened this morning and spoken in never.
-- Threads no longer close (docs/CHANNELS-V2-WIRING-PLAN.md Phase 1), so opening
-- order is the wrong spine for a list nothing ever leaves.
--
-- The correct clock already exists and is already argued, in
-- `20260807160000_channel_tasks_stale_activity.sql`: activity lives in
-- `channel_messages`, NOT in `channel_tasks.updated_at` (whose only writers are
-- close / set_mode / reopen, so it equals `created_at` for every thread that was
-- never closed — that was C-1). This migration reuses that derivation's SHAPE
-- for the READ MODEL rather than inventing a second one.
--
-- ── WHY A VIEW AND NOT A TRIGGER, A WRITE-PATH TOUCH, OR A SECOND RPC ───────
--   (a) TRIGGER on channel_messages -> UPDATE channel_tasks, or (b) a touch
--       inside `postMessage`. Both rejected for the reasons `20260807160000`
--       spells out in full and INVARIANTS §12 states as a rule: do not tax the
--       hot write path to answer a question a reader asks. Nothing here touches
--       the write path.
--   (c) A SECOND RPC beside `channel_tasks_stale`. Rejected on the READ side of
--       §9: an RPC returns whatever its body selects, so the caller cannot
--       express "these columns, this order, this limit" — the three things §9
--       requires of a new list read — and the ordering decision would live in
--       SQL where the repository's own tests cannot observe it. The old
--       `select("*")` non-conformer would be replaced by an opaque one.
--   (d) THIS — a VIEW carrying the derived column, read through PostgREST like
--       any table. The repository selects COLUMNS, orders by
--       `last_activity_at`, and carries a `limit`; the derivation stays in SQL
--       beside the one that already exists. Cost is identical to (c).
--
-- ── WHAT COUNTS AS ACTIVITY — THE SAME DEFINITION, DELIBERATELY ─────────────
-- Every message tagged for the thread (`metadata->>'taskId'`) EXCEPT a close
-- proposal (`metadata->>'closeProposed' = 'true'`), falling back to the thread's
-- own `created_at` when nobody has posted into it. That is `channel_tasks_stale`
-- verbatim, and the point is that it IS verbatim: two clocks that agree today
-- and are written twice are two clocks that disagree later. A proposal is a
-- request for a decision, not work on the thread.
--   ⚠ The proposal exclusion is inherited, not re-argued. Close proposals are
--   retired in Phase 4 of the wiring plan, at which point the predicate goes
--   inert here and `channel_tasks_stale` loses its only caller — see
--   docs/REFACTOR-FINDINGS.md F-207 for what merges then.
--   ⚠ CORRECTED 2026-08-18 (fix wave 3): this line read F-201 until now. Written
--   at Phase 1, it GUESSED the id Phase 4 would file and guessed wrong — F-201 is
--   the SPA sidebar's consent poll, a different finding entirely. Comment-only;
--   the SQL below is byte-identical, so replay is unaffected (INVARIANTS §12).
--
-- ── COST ────────────────────────────────────────────────────────────────────
-- The lateral is answered from `channel_messages_thread_activity_idx`
-- (channel_id, (metadata->>'taskId')), created by `20260807160000`. Every read
-- of this view filters `channel_id` first — `channel_tasks_channel_idx` covers
-- that — so the lateral runs once per thread OF ONE CHANNEL, and a thread's
-- message count is tens to hundreds. No new index.
--
-- ── NO `deleted_at` JOIN, DELIBERATELY ──────────────────────────────────────
-- `channel_tasks_stale` joins `channels` to skip tombstoned DMs because it scans
-- the whole table on a cron's behalf. This view is only ever read for ONE
-- channel that the service has already resolved and gated
-- (`service-reads.ts › listChannelTasks` -> `loadVisibleChannel`), so the join
-- would re-answer a question already answered, once per read, forever.
--
-- ── SECURITY ────────────────────────────────────────────────────────────────
-- `security_invoker = true` (PG15+; local stack is 17 per supabase/config.toml)
-- so the view carries NO privileges of its own — the reader's own RLS on
-- `channel_tasks` / `channel_messages` applies, and a future GRANT to
-- `authenticated` could not become an RLS bypass by accident. Belt and braces:
-- SELECT is granted to `service_role` only, the same contract as
-- `channel_tasks_stale`'s EXECUTE, because the only caller is `supabaseAdmin`.
-- A view cannot be added to a publication, so this is not a realtime change
-- (INVARIANTS §7) and `channel_tasks` stays out of the publication either way.

CREATE OR REPLACE VIEW public.channel_tasks_activity
WITH (security_invoker = true) AS
  SELECT
    t.id,
    t.channel_id,
    t.workspace_id,
    t.title,
    t.status,
    t.outcome,
    t.mode,
    t.created_by,
    t.target_user_id,
    t.created_at,
    t.updated_at,
    t.closed_at,
    t.outcome_summary,
    t.client_msg_id,
    COALESCE(a.last_at, t.created_at) AS last_activity_at
  FROM public.channel_tasks t
  CROSS JOIN LATERAL (
    SELECT max(m.created_at) AS last_at
    FROM public.channel_messages m
    WHERE m.channel_id = t.channel_id
      AND m.metadata ->> 'taskId' = t.id::text
      AND COALESCE(m.metadata ->> 'closeProposed', '') <> 'true'
  ) a;

COMMENT ON VIEW public.channel_tasks_activity IS
  'channel_tasks + last_activity_at derived from channel_messages (same rule as channel_tasks_stale). Read model for the thread list; service_role only.';

-- ════════════════════════════════════════════════════════════════════
-- Grants — service-role only (read exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

-- ⚠ `service_role` IS IN THE REVOKE LIST TOO, then granted back SELECT alone.
-- Supabase's default privileges hand every new relation in `public` the full
-- ALL to service_role, so revoking only anon/authenticated would leave this view
-- carrying INSERT/UPDATE/DELETE it has no business offering — measured on the
-- local stack, 2026-08-18, before this line existed. (A view over a lateral is
-- not auto-updatable, so those privileges were unusable; the point is that the
-- grant list says what it means.)
REVOKE ALL ON public.channel_tasks_activity
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.channel_tasks_activity TO service_role;

-- Verify after applying (read-only; safe on prod):
--   -- The thread list one channel's sidebar would render, most recent first.
--   SELECT id, title, created_at, last_activity_at
--   FROM channel_tasks_activity
--   WHERE channel_id = '<a channel uuid>'
--   ORDER BY last_activity_at DESC, created_at DESC
--   LIMIT 200;
--
--   -- The order it replaces, side by side. Rows whose two ranks disagree are
--   -- exactly the threads the old `created_at DESC` list mis-sorted.
--   SELECT title, created_at, last_activity_at,
--          rank() OVER (ORDER BY last_activity_at DESC) AS by_activity,
--          rank() OVER (ORDER BY created_at DESC)       AS by_creation
--   FROM channel_tasks_activity
--   WHERE channel_id = '<a channel uuid>';
--
-- ROLLBACK is `DROP VIEW public.channel_tasks_activity;` in a NEW migration,
-- and the repository must be reverted in the same release — it has no fallback
-- query and would 500 on a missing view rather than silently reverting to the
-- creation-order list, which is the intended failure direction.
