-- C-1 — GIVE THE STALE-THREAD SWEEP A CLOCK THAT MEASURES ACTIVITY.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- `/api/cron/stale-threads` selected `channel_tasks` rows with
-- `updated_at < now() - 14d` and its docblock claimed that column measured last
-- activity. It never did. The ONLY writer to `channel_tasks.updated_at` is
-- `repository-tasks.updateTask`, reached exclusively from close / set_mode /
-- reopen. `postMessage` bumps `channels.updated_at`; the task row is untouched.
-- There is no trigger. So for any thread that was never closed or re-moded,
-- `updated_at == created_at` forever, and the sweep's two failure modes are
-- both maximal:
--   • a 15-day-old thread with HOURLY traffic is swept and told "no activity
--     for a while" — the sweep fires hardest on the busiest threads;
--   • `set_thread_mode` resets the clock to now with zero activity, so a thread
--     nobody has touched in months looks fresh.
-- Currently inert (CRON_SECRET is unset in Vercel, every /api/cron/* answers
-- 503), which is also why shipping the fix turns this job on for the first time
-- against a 14-day backlog. See the route's docblock for what that implies.
--
-- ── WHY A READ-SIDE RPC AND NOT A TRIGGER OR A WRITE-PATH TOUCH ─────────────
-- Three shapes were on the table. They differ in WHERE the cost lands, and that
-- is the whole decision:
--
--   (a) TRIGGER on channel_messages -> UPDATE channel_tasks. Correct, and pays
--       on the hottest write path in the feature: one extra row version, index
--       maintenance and WAL record for EVERY message, forever, to answer a
--       question asked once a day. It also keeps overloading one column with
--       two meanings, so `set_thread_mode` would still reset the activity clock
--       — the second half of the bug survives the fix.
--   (b) A touch inside `postMessage`. Strictly worse than (a): the same write
--       amplification plus a second network round-trip per post from the app
--       server, and it covers only the one writer that remembers to call it.
--   (c) THIS — derive activity from `channel_messages` at read time.
--       O(open threads) reads once per day instead of O(messages) writes
--       forever, and `updated_at` keeps its one honest meaning ("this row was
--       modified"). The sweep never consults it again, so the
--       `set_thread_mode`-resets-the-clock half of C-1 disappears with no
--       further code.
--
-- This repo has already made exactly this trade twice in the last two days —
-- `20260807000000` / `20260807100000` trimmed the realtime publication on the
-- argument that a per-write cost paid forever for an occasional reader is the
-- wrong shape, and `20260807150000` chose `USING INDEX` over `FULL` for the
-- same reason. A daily cron is the most occasional reader in the system.
--
-- ── WHAT COUNTS AS ACTIVITY ────────────────────────────────────────────────
-- Every message tagged for the thread (`metadata->>'taskId'`) EXCEPT a close
-- proposal (`metadata->>'closeProposed' = 'true'`). A proposal is a request for
-- a decision, not work on the thread, and counting it would let the sweep reset
-- the very clock that decides whether the thread is idle — a job that could
-- never fire twice on the same thread and would report itself as activity. A
-- thread with no tagged message at all falls back to `channel_tasks.created_at`,
-- so a thread that was opened and never spoken in still ages.
--
-- ── AND WHAT THE SWEEP MUST NOT DO: TALK OVER A LIVE PROMPT ────────────────
-- `NOT EXISTS (a close proposal newer than the last real activity)`. If the
-- newest thing in the thread is somebody's close proposal, a prompt is already
-- standing in front of the human and a second one adds nothing — worse, the web
-- card renders the MOST RECENT proposal, so a sweep row posted on top of an
-- agent's would REPLACE that agent's stated reason with "no activity for a
-- while". That is C-6's "the cron steals the agent's reason", and this
-- predicate is where it is closed for good (the two now also use disjoint
-- `client_msg_id` namespaces — see `service-tasks-propose.ts`).
--
-- It doubles as the sweep's real idempotency: once the job posts its own
-- proposal, that row is newer than `anchor_seq`, so tomorrow's run does not
-- select the thread at all. The route's `client_msg_id` collision is belt and
-- braces behind this, not the mechanism.
--
-- ── DELETED CHANNELS ARE OUT OF SCOPE ──────────────────────────────────────
-- `JOIN channels ... deleted_at IS NULL`. A tombstoned channel is a CLOSED DM
-- (that column is the DM close/reopen mechanic — ENGINEERING §7), and posting a
-- system prompt into a conversation both sides have closed would resurface it
-- in nobody's UI while writing into a transcript neither party asked to reopen.
-- The previous query had no such guard.
--
-- ── COST ───────────────────────────────────────────────────────────────────
-- The lateral runs once per OPEN task whose `created_at` already predates the
-- cutoff — a task created after the cutoff cannot have older activity than its
-- own creation, so that pre-filter is exact, not heuristic, and keeps the
-- lateral off every young thread. `channel_messages_thread_activity_idx` below
-- answers the lateral from (channel_id, taskId); a thread's message count is
-- tens to hundreds. Production currently holds a single-digit number of open
-- threads, and MAX_PER_RUN caps the write side at 50 regardless.
--
-- ── RETURN SHAPE ───────────────────────────────────────────────────────────
-- `anchor_seq` is returned rather than recomputed by the caller because it is
-- the SAME number the dedupe key is built from, and deriving it twice from two
-- queries is how the two drift apart. 0 when the thread has no non-proposal
-- message (a thread opened and never spoken in), never NULL, so the key is a
-- total function.
--
-- SECURITY INVOKER (default) with a pinned `search_path`; called exclusively
-- through the service-role client (`supabaseAdmin`), so EXECUTE is granted to
-- `service_role` only — same contract as `channel_message_insert` and
-- `cascade_hard_delete_cluster`.

-- Supports the lateral's (channel_id, taskId) lookup. NOT partial: a filter on
-- `metadata ? 'taskId'` would exclude exactly the rows the anti-join needs to
-- see, and the table's only partial index is the `client_msg_id` idempotency
-- unique (a distinction `repository-messages.ts` already documents).
CREATE INDEX IF NOT EXISTS channel_messages_thread_activity_idx
  ON public.channel_messages (channel_id, (metadata ->> 'taskId'));

CREATE OR REPLACE FUNCTION public.channel_tasks_stale(
  p_before timestamptz,
  p_limit  integer
)
RETURNS TABLE (
  id               uuid,
  channel_id       uuid,
  workspace_id     uuid,
  title            text,
  last_activity_at timestamptz,
  anchor_seq       bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    t.id,
    t.channel_id,
    t.workspace_id,
    t.title,
    COALESCE(a.last_at, t.created_at) AS last_activity_at,
    COALESCE(a.max_seq, 0)            AS anchor_seq
  FROM public.channel_tasks t
  JOIN public.channels c
    ON c.id = t.channel_id
   AND c.deleted_at IS NULL
  CROSS JOIN LATERAL (
    SELECT max(m.created_at) AS last_at, max(m.seq) AS max_seq
    FROM public.channel_messages m
    WHERE m.channel_id = t.channel_id
      AND m.metadata ->> 'taskId' = t.id::text
      AND COALESCE(m.metadata ->> 'closeProposed', '') <> 'true'
  ) a
  WHERE t.status = 'open'
    -- Exact pre-filter, not a heuristic: activity cannot predate creation.
    AND t.created_at < p_before
    AND COALESCE(a.last_at, t.created_at) < p_before
    -- A close proposal newer than the last real activity IS the live prompt.
    AND NOT EXISTS (
      SELECT 1
      FROM public.channel_messages p
      WHERE p.channel_id = t.channel_id
        AND p.metadata ->> 'taskId' = t.id::text
        AND p.metadata ->> 'closeProposed' = 'true'
        AND p.seq > COALESCE(a.max_seq, 0)
    )
  ORDER BY COALESCE(a.last_at, t.created_at) ASC
  LIMIT GREATEST(p_limit, 0);
$function$;

-- ════════════════════════════════════════════════════════════════════
-- Grants — service-role only (called exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.channel_tasks_stale(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.channel_tasks_stale(timestamptz, integer)
  TO service_role;

-- Verify after applying (read-only; safe on prod):
--   -- What the sweep WOULD prompt on today, without prompting on anything.
--   SELECT * FROM channel_tasks_stale(now() - interval '14 days', 50);
--
--   -- The clock it replaces, side by side. Rows where these disagree are the
--   -- bug: `updated_at` old but `last_activity_at` recent = a live thread the
--   -- old query would have swept.
--   SELECT t.id, t.updated_at, s.last_activity_at
--   FROM channel_tasks t
--   LEFT JOIN LATERAL channel_tasks_stale(now(), 1000) s ON s.id = t.id
--   WHERE t.status = 'open';
--
-- ROLLBACK is `DROP FUNCTION public.channel_tasks_stale(timestamptz, integer);`
-- plus `DROP INDEX public.channel_messages_thread_activity_idx;` in a NEW
-- migration, and the route must be reverted in the same release — it has no
-- fallback query and would 500 on a missing function rather than silently
-- reverting to the broken clock, which is the intended failure direction.
