-- CREDIT USAGE EVENTS — the per-burn ATTRIBUTION ledger that
-- `workspace_credit_usage` cannot be (F-328).
--
-- ✅ ALREADY APPLIED when this file was committed on 2026-09-01 — MEASURED, not
-- assumed: the table, all three indexes plus the pkey, `relrowsecurity`, and the
-- `credit_usage_events_member_select` policy were all present on the linked
-- project, with 0 rows (consistent with "it starts EMPTY" below). ⚠ It applied
-- under a version stamp that is NOT this filename prefix — the F-304 pattern
-- `20260822150000_channel_sessions_telemetry.sql` records — so JOIN ON THE NAME
-- and re-derive from the catalog rather than trusting this line.
--
-- ── WHY THIS TABLE EXISTS ──────────────────────────────────────────────────
-- `workspace_credit_usage` (20260811130000) is a `(workspace_id, period_start,
-- used)` COUNTER: one row per billing period, updated by a compare-and-set. It
-- is the right shape for enforcement and the wrong shape for every question
-- Samuel actually asks of it — "which channel burned this month's credits" and
-- "which person did". Those need a DIMENSION the counter does not have and
-- cannot grow, because a counter has one row to hang a dimension off.
--
-- 🔒 **THIS IS NOT THE BILLING COUNTER AND MUST NEVER BECOME IT.**
-- `consume_workspace_credits` stays the sole authority on whether a call is
-- allowed and on how much of the allowance is gone. This table is written
-- BESIDE it, AFTER the spend is already committed, by a FIRE-AND-FORGET writer
-- (`credits-service.ts › recordCreditUsageEvent`) that swallows its own errors.
-- The consequences are stated rather than hidden:
--   * the ledger may UNDER-COUNT — a dropped insert costs an attribution row,
--     never a credit;
--   * `SUM(amount)` here is therefore a FLOOR and the surfaces that read it say
--     so, exactly as the /home Overview's scanned/truncated rails already do;
--   * it starts EMPTY. Every burn before this migration is applied exists only
--     in the counter, so the breakdowns are sparse until traffic accrues. A
--     surface reading this must render "nothing yet", never a confident zero.
-- The inverse — building enforcement on a writer allowed to drop writes — is
-- what 20260811130000's own header forbids, and nothing here changes that.
--
-- ── THE TWO WORKSPACE COLUMNS, AND WHY THERE IS NO `channel_id` ────────────
-- A burn has TWO workspaces and conflating them would make the rails lie:
--   * `workspace_id`        — the PAYER, i.e. whose counter actually moved
--                             (`credits-service.ts › resolveBillingTarget`). For
--                             a `kind='link'` home container this is NOT the
--                             container: it is the container OWNER's default
--                             standard workspace, because a container is a
--                             relationship and has no plan.
--   * `origin_workspace_id` — WHERE the call was made, i.e. the container (or
--                             the workspace, when they are the same). **This is
--                             the "by channel" dimension** on /home: a home
--                             container holds exactly ONE channel by
--                             construction (`home/server/repository-containers.ts
--                             › listContainerChannels`), so grouping by origin
--                             IS grouping by channel, and the reader joins the
--                             channel's NAME from that map it already builds.
--
-- ⚠ **`channel_id` IS DELIBERATELY ABSENT.** The only writer is
-- `POST /api/mcp/credits/consume`, whose auth context carries a workspace and a
-- user and NO channel — resolving one would add a round trip to the hottest
-- write path in the product, which INVARIANTS §12 forbids by name. Storing a
-- column no writer can populate would be worse than not having it: every read
-- would have to special-case a NULL that is always NULL. When a caller that
-- genuinely knows its channel appears, add the column WITH its writer.
--
-- ⚠ `period_start` is DENORMALIZED from the resolved credit period rather than
-- derived from `created_at`. A paid workspace's period is anchored to its
-- SUBSCRIPTION date, not the 1st (`billing/credits.ts › resolveCreditPeriod`),
-- so "this period's credits by channel" cannot be recovered from a timestamp
-- without re-deriving the anchor per row. Stamping the key the counter used is
-- what keeps the ledger and the meter describing the same window.

CREATE TABLE IF NOT EXISTS public.credit_usage_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- SET NULL, never CASCADE: deleting a relationship container must not erase
  -- the payer's billing history. The row survives, unattributed.
  origin_workspace_id UUID        REFERENCES public.workspaces(id) ON DELETE SET NULL,
  user_id             UUID        REFERENCES auth.users(id)        ON DELETE SET NULL,
  amount              INTEGER     NOT NULL CHECK (amount > 0),
  period_start        TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── INDEXES ────────────────────────────────────────────────────────────────
-- THREE, and every one of them is paid for on the hottest insert in the
-- product, so each is justified against INVARIANTS §12's rule that an FK
-- cascade/SET-NULL scan counts as a named statement needing cover:
--   1. (workspace_id, period_start) — the payer's own ledger read, and the
--      cover for this table's ON DELETE CASCADE.
--   2. (origin_workspace_id, period_start) — THE /home read: "credits by
--      channel" and "credits by person" are both an `origin IN (containers)`
--      scan narrowed by period, and it covers the origin SET NULL scan.
--   3. (user_id) — cover for the user SET NULL scan. It is NOT the by-person
--      read's index: that read is fenced by ORIGIN first and groups in the
--      application, so it rides #2.
CREATE INDEX IF NOT EXISTS credit_usage_events_workspace_period_idx
  ON public.credit_usage_events (workspace_id, period_start);

CREATE INDEX IF NOT EXISTS credit_usage_events_origin_period_idx
  ON public.credit_usage_events (origin_workspace_id, period_start);

CREATE INDEX IF NOT EXISTS credit_usage_events_user_idx
  ON public.credit_usage_events (user_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Same posture as `workspace_credit_usage`, and for the same reason: there is
-- no client write policy AT ALL, base DML is revoked, and every write is
-- service-role. A member may READ their own workspace's ledger — the /home
-- Overview reads it as service role, and this policy is what keeps a direct
-- PostgREST read honest.
--
-- ⚠ THE POLICY FENCES ON `workspace_id`, THE PAYER — not on the origin. A
-- member of the paying workspace may see what their allowance was spent on;
-- membership of a link CONTAINER grants nothing here, which is correct: the
-- guest who burned the credit is not entitled to the payer's ledger.
ALTER TABLE public.credit_usage_events ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.credit_usage_events FROM authenticated, anon;

DROP POLICY IF EXISTS credit_usage_events_member_select ON public.credit_usage_events;
CREATE POLICY credit_usage_events_member_select ON public.credit_usage_events
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));
