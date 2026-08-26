-- OVERVIEW TIME-RANGE INDEXES — two composite indexes, no schema change, no
-- new object anything depends on.
--
-- ✅ APPLIED. ⚠ This header said "WRITTEN, NOT APPLIED" after it was live —
-- corrected 2026-08-24. Re-derive with `supabase migration list` / MCP
-- `list_migrations` and JOIN ON THE NAME: this file applied under version
-- `20260823091749`, not its filename prefix (INVARIANTS §12, F-304).
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- The desktop Overview page asks two shapes of question that did not exist
-- before it:
--   1. "how many rows in THIS workspace fell in THIS UTC day" — asked 31 times
--      per `GET /api/workspaces/[workspaceSlug]/overview-series` request, once
--      per bin (`workspaces/server/repository-overview.ts ›
--      countMessagesInWindow` / `› countThreadsInWindow`);
--   2. "how many messages in THIS workspace since UTC midnight"
--      (`› countMessagesSince`) and "who wrote them over 30 days"
--      (`› listRecentUserMessageAuthors`).
-- Both are `workspace_id = $1 AND created_at >= $2 [AND created_at < $3]`.
--
-- What exists today serves neither well:
--   * `channel_messages_workspace_idx` is `(workspace_id)` ALONE
--     (`20260725120000_channels.sql`) — it can find the workspace's rows but
--     then has to filter every one of them by date.
--   * `channel_tasks_workspace_idx` is `(workspace_id)` alone
--     (`20260727150000_channel_tasks.sql`). Its `(channel_id, created_at DESC)`
--     sibling is the wrong leading column for a workspace-wide question.
--   * `mcp_tool_calls_workspace_created_idx` ALREADY IS `(workspace_id,
--     created_at)` (`20260716120000`), which is exactly the shape below — so
--     the `mcp` metric needs nothing here and gets nothing. Do not add a third.
--
-- ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
-- ⚠ NOT A CORRECTNESS DEPENDENCY. Nothing in the app calls a function or reads
-- a column introduced here, and the overview routes were written to work with
-- this file unapplied: they degrade to a sequential scan — SLOW, NEVER WRONG —
-- so the standing "written, not applied" gate costs latency and nothing else.
-- ⚠ There is deliberately NO SECURITY DEFINER binning function. A route that
-- called an RPC this file introduces would be BROKEN, not slow, until the day
-- someone applies it, and "broken until deployed" is not a degradation.
--
-- ── COST ───────────────────────────────────────────────────────────────────
-- Two b-trees on two append-mostly tables. `channel_messages` is the hot write
-- path (every message, every agent narration row), so this is one extra index
-- maintenance per insert there — the reason the count-per-bin reads were kept
-- to TWO indexes and not one per filter combination. `IF NOT EXISTS` on both,
-- so re-running is a no-op.
--
-- ⚠ Plain (non-CONCURRENT) CREATE INDEX: these tables are small at the time of
-- writing and the migration runner wraps statements in a transaction, which
-- CONCURRENTLY cannot join. If `channel_messages` has grown by the time this is
-- applied, split it out and run it CONCURRENTLY outside a transaction instead.

CREATE INDEX IF NOT EXISTS channel_messages_workspace_created_idx
  ON public.channel_messages (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS channel_tasks_workspace_created_idx
  ON public.channel_tasks (workspace_id, created_at);

-- ROLLBACK (a NEW migration, never an edit to this one):
--   DROP INDEX IF EXISTS public.channel_messages_workspace_created_idx;
--   DROP INDEX IF EXISTS public.channel_tasks_workspace_created_idx;
--
-- VERIFY (a measurement, taken against the deployment — never recorded here):
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('channel_messages_workspace_created_idx',
--                        'channel_tasks_workspace_created_idx');
