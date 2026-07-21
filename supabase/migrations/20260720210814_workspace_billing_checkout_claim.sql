-- Cross-instance checkout claim: close the concurrent-checkout duplicate-
-- subscription race (M-3, full fix).
--
-- The 409 guard in /api/billing/checkout only trips once
-- `stripe_subscription_id` is persisted — i.e. AFTER the Stripe webhook lands.
-- Between "start checkout" and that webhook write, two racing requests each
-- read a subscription-less billing row and each mint a Stripe subscription;
-- the webhook then overwrites one pointer, stranding a duplicate UNTRACKED
-- sub that keeps billing the customer. The prior mitigation was an in-process
-- `Set`, which does NOTHING across Vercel lambda instances (concurrent
-- requests may land on different lambdas), and an earlier advisory-lock
-- attempt leaked locks through PgBouncer transaction pooling.
--
-- Fix: a short-lived exclusive claim stamped in the DB, taken with a single
-- atomic statement so it is a true cross-instance compare-and-set — immune to
-- the pooling/leak problems of session-level advisory locks.
--
--   * `checkout_claim_at` — when the in-flight checkout took the claim.
--   * `claim_workspace_checkout(uuid)` — atomically stamps it and returns
--     whether THIS caller won the claim (see below).
--
-- The claim SELF-EXPIRES after 2 minutes: a request that crashes between
-- claiming and creating the Stripe session briefly (<= 2 min) blocks a
-- re-checkout, then the stale claim ages out and the next attempt succeeds.
-- The happy path clears it explicitly on `checkout.session.completed` (the
-- webhook) and on session-create failure (the route), so the window is
-- normally milliseconds.

-- ════════════════════════════════════════════════════════════════════
-- 1. Claim column — nullable; NULL means "no checkout in flight".
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE workspace_billing
  ADD COLUMN IF NOT EXISTS checkout_claim_at TIMESTAMPTZ;

-- ════════════════════════════════════════════════════════════════════
-- 2. claim_workspace_checkout — atomic cross-instance compare-and-set.
-- ════════════════════════════════════════════════════════════════════
--
-- Returns TRUE iff this caller took the claim; FALSE means another checkout
-- is already in flight for the workspace (-> the route returns 409).
--
-- INSERT ... ON CONFLICT DO UPDATE (not a bare UPDATE) is REQUIRED: most
-- workspaces have no `workspace_billing` row until their first paid event, so
-- a bare `UPDATE ... WHERE workspace_id = $1` would match 0 rows and falsely
-- report "in flight" for every FIRST-TIME checkout. The upsert creates the
-- free row and claims it in one statement.
--
-- Atomicity / concurrency (READ COMMITTED, the default):
--   * Row absent  -> exactly one INSERT wins the PK; the loser conflicts,
--     falls to DO UPDATE, re-reads the winner's fresh `checkout_claim_at`
--     (now ~now()), fails the WHERE, updates 0 rows -> RETURNING empty ->
--     FALSE.
--   * Row present -> both conflict to DO UPDATE and serialize on the row
--     lock; Postgres re-evaluates the DO UPDATE `WHERE` against the winner's
--     committed tuple (EvalPlanQual), so the loser sees the just-set claim
--     and updates 0 rows -> FALSE.
-- A DO UPDATE whose WHERE is false is a no-op (no error), and RETURNING then
-- yields no row, leaving `v_claimed` NULL -> COALESCE -> FALSE.
--
-- The claim is reclaimable once older than 2 minutes (self-expiry), so a
-- crashed request cannot wedge a workspace out of checkout permanently.
--
-- SECURITY INVOKER (default) with a pinned `search_path`; called exclusively
-- through the service-role client (`supabaseAdmin`), so EXECUTE is granted to
-- `service_role` only — mirrors cascade_purge_cluster (20260718000060).

CREATE OR REPLACE FUNCTION claim_workspace_checkout(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_claimed BOOLEAN;
BEGIN
  INSERT INTO workspace_billing (workspace_id, checkout_claim_at)
  VALUES (p_workspace_id, now())
  ON CONFLICT (workspace_id) DO UPDATE
    SET checkout_claim_at = now()
    WHERE workspace_billing.checkout_claim_at IS NULL
       OR workspace_billing.checkout_claim_at < now() - INTERVAL '2 minutes'
  RETURNING TRUE INTO v_claimed;

  RETURN COALESCE(v_claimed, FALSE);
END
$$;

-- ════════════════════════════════════════════════════════════════════
-- Grants — service-role only (called exclusively via supabaseAdmin)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION claim_workspace_checkout(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_workspace_checkout(UUID) TO service_role;
