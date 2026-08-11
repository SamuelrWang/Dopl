-- MCP CREDITS — a per-(workspace, period) counter with an atomic check+spend.
--
-- One MCP TOOL CALL costs one credit. The plan allowances and the period rule
-- live in ONE place, `src/features/billing/credits.ts` — this migration owns
-- the storage and the concurrency, never the numbers. The limit is passed IN
-- on every call (`p_limit`) precisely so retuning a plan is a TypeScript edit
-- and not a migration.
--
-- WHY A COUNTER ROW AND NOT `COUNT(*)` OVER `mcp_tool_calls`:
--   * `mcp_tool_calls` counts LOOPBACK REQUESTS, not tool calls — `dopl_map`
--     fans out and `dopl_channel(op="await")` polls ~4x per call, so its row
--     count is not a call count and never was.
--   * its writer (`analytics/server/mcp-tool-calls.ts › logMcpToolCall`) is
--     fire-and-forget and swallows every error BY DESIGN. A billing counter
--     cannot be built on a writer that is allowed to silently drop writes.
--   * a `COUNT(*)` over a monotonically growing analytics table, on the
--     hottest path in the product, is exactly what INVARIANTS §12's "do not
--     tax the hot write path" warns against.
--
-- WHY NO ADVISORY LOCK. `check_and_record_rate_limit_subject`
-- (20260608010000) takes `pg_advisory_xact_lock` and COUNTs a row-per-event
-- table; the checkout claim (20260720210814) does NOT, and its header records
-- why: an earlier advisory-lock attempt LEAKED LOCKS through PgBouncer
-- transaction pooling. This function follows the checkout claim: a single
-- INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING statement, which is
-- a true cross-instance compare-and-set with no lock to leak.

-- ════════════════════════════════════════════════════════════════════
-- 1. workspace_billing — the period ANCHOR (start) and the cancel flag
-- ════════════════════════════════════════════════════════════════════
--
-- `current_period_end` has been written by the Stripe webhook since
-- 20260716120000; the START was never stored, so a paid workspace had no way
-- to anchor a credit window to its own billing date. Nullable — free
-- workspaces have no subscription (and usually no row at all), and the period
-- resolver falls back to the UTC calendar month.
--
-- `cancel_at_period_end` mirrors Stripe's flag of the same name: the
-- subscription is live but will not renew. Written by the same webhook seam,
-- surfaced on `GET /api/billing/status` so the billing surface can say "ends
-- on <date>" instead of showing a plain active plan. NOT NULL DEFAULT false —
-- an unknown cancel intent must read as "not cancelling", the direction that
-- never tells a paying customer their plan is ending when it is not.

ALTER TABLE workspace_billing
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;

ALTER TABLE workspace_billing
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- ════════════════════════════════════════════════════════════════════
-- 2. workspace_credit_usage — one counter row per (workspace, period)
-- ════════════════════════════════════════════════════════════════════
--
-- The resolved `period_start` is STAMPED on the row, so the counter
-- self-rolls: the first consume of a new period inserts a fresh row and the
-- old one is simply never touched again. No reset cron, no sweep.
--
-- The PK leads with `workspace_id`, which covers the FK cascade (INVARIANTS
-- §12) and every read this table has — there is no second index to add.
--
-- `updated_at` is stamped by the WRITER here rather than by a trigger: the
-- only writer is the single-statement CAS below (service role), nothing orders
-- by the column, and a trigger would fire on the hottest write in the product.

CREATE TABLE IF NOT EXISTS workspace_credit_usage (
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  used         INTEGER     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_start)
);

ALTER TABLE workspace_credit_usage ENABLE ROW LEVEL SECURITY;

-- Base DML revoked to match the channels/presence hardening: no client may
-- write this table under any policy, and there is no INSERT/UPDATE/DELETE
-- policy at all. Every write is service-role through the RPC below.
REVOKE INSERT, UPDATE, DELETE ON public.workspace_credit_usage FROM authenticated, anon;

-- Any workspace member may READ their workspace's usage — the settings-modal
-- credit meter renders from it (via `GET /api/billing/status`, which reads as
-- service role; this policy is what keeps a direct PostgREST read honest).
DROP POLICY IF EXISTS workspace_credit_usage_member_select ON workspace_credit_usage;
CREATE POLICY workspace_credit_usage_member_select ON workspace_credit_usage
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

-- ════════════════════════════════════════════════════════════════════
-- 3. consume_workspace_credits — atomic check + spend, cross-instance
-- ════════════════════════════════════════════════════════════════════
--
-- Returns (allowed, used): `allowed` says whether THIS call spent its credits,
-- `used` is the counter AFTER the attempt (unchanged when refused), so the
-- caller can render "500 / 500" on the refusal without a second read.
--
-- BOTH paths are guarded, and that is the detail to get right:
--   * the UPDATE path by the `ON CONFLICT ... WHERE u.used + p_amount <=
--     p_limit` predicate;
--   * the fresh-INSERT path by `IF p_amount <= p_limit` in the body. The
--     ON CONFLICT WHERE clause guards ONLY the update, so without the IF a
--     workspace on a zero-credit plan would be granted its first call free.
--
-- Concurrency (READ COMMITTED, the default), same reasoning as
-- `claim_workspace_checkout`:
--   * row absent  -> exactly one INSERT wins the PK; the loser conflicts,
--     falls to DO UPDATE and re-evaluates the predicate against the winner's
--     committed tuple.
--   * row present -> both conflict to DO UPDATE and serialize on the row lock;
--     Postgres re-evaluates the DO UPDATE WHERE against the winner's committed
--     row (EvalPlanQual), so an over-limit loser updates 0 rows.
-- A DO UPDATE whose WHERE is false is a no-op (not an error) and RETURNING
-- then yields nothing, leaving `v_used` NULL -> the refusal branch.
--
-- EVERY column reference is table-qualified (`u.used`). `used` is also an
-- OUT parameter name here, and an UNQUALIFIED `used` inside SQL would be an
-- ambiguous-reference error under plpgsql's default variable_conflict setting.
--
-- SECURITY DEFINER (the table has no client write policy at all, so the
-- function must not run as the caller) with a pinned `search_path`, and
-- EXECUTE revoked from public/anon/authenticated per 20260619040000 — it is
-- called exclusively through the service-role client.

CREATE OR REPLACE FUNCTION consume_workspace_credits(
  p_workspace_id UUID,
  p_period_start TIMESTAMPTZ,
  p_amount       INT,
  p_limit        INT
)
RETURNS TABLE (allowed BOOLEAN, used INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used INT;
BEGIN
  IF p_amount <= p_limit THEN
    INSERT INTO workspace_credit_usage AS u (workspace_id, period_start, used, updated_at)
    VALUES (p_workspace_id, p_period_start, p_amount, now())
    ON CONFLICT (workspace_id, period_start) DO UPDATE
      SET used = u.used + p_amount, updated_at = now()
      WHERE u.used + p_amount <= p_limit
    RETURNING u.used INTO v_used;

    IF v_used IS NOT NULL THEN
      RETURN QUERY SELECT TRUE, v_used;
      RETURN;
    END IF;
  END IF;

  -- Refused. Read the current counter so the caller can say how much of the
  -- allowance is gone; a workspace with no row yet has spent nothing.
  SELECT u.used INTO v_used
    FROM workspace_credit_usage u
   WHERE u.workspace_id = p_workspace_id
     AND u.period_start = p_period_start;

  RETURN QUERY SELECT FALSE, COALESCE(v_used, 0);
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- Grants — service-role only (called exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION consume_workspace_credits(UUID, TIMESTAMPTZ, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_workspace_credits(UUID, TIMESTAMPTZ, INT, INT)
  TO service_role;
