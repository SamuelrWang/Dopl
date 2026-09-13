-- Backfill the credit-model v2.1 wallets from the attribution ledger.
--
-- RUN ONCE, RIGHT AFTER the v2.1 web deploy (`feat/credit-model-v2`, merged
-- 2026-09-10), for the CURRENT period. Before the deploy prod still runs the
-- pooled model, which writes `workspace_credit_usage` + a ledger row and never
-- touches the two wallets — so on deploy day every wallet reads 0 while the
-- ledger holds the month's real spend. This sets each wallet to the ledger's
-- sum so nobody's meter resets mid-month.
--
-- IDEMPOTENT: `used` is SET to the sum, not added. Re-running after new-code
-- burns is still exact, because those burns also write ledger rows.
--
-- ⚠ **STILL VALID AFTER `20261004120000_credit_consume_with_ledger.sql`, AND ITS
-- SECOND JOB IS GONE (2026-09-13, Samuel: the histogram must equal the wallet,
-- always; F-693).** This script sets each counter FROM the ledger, so it remains
-- the deploy-day catch-up it was written to be — and it is also how a
-- PRE-migration divergence is repaired by hand, which is what happened to
-- Samuel's personal wallet the day the rule was set (counter 8, five ledger rows).
-- ⚠ **AFTER THAT MIGRATION THE TWO CANNOT DIVERGE**: the counter UPDATE and the
-- `credit_usage_events` INSERT are one transaction inside `consume_user_credits` /
-- `consume_member_credits`, so a refused consume writes neither and a failed
-- insert rolls the counter back. Running this on rows written since then is a
-- no-op by arithmetic, not by luck. ⚠ It is therefore NOT a repair loop and must
-- never be scheduled: `GET /api/billing/status › credits.ledgerDrift`
-- (`src/features/billing/server/credits-audit.ts`) is how a residual disagreement
-- is NOTICED, and a person decides what to do about it.
--
-- MAPPING (credit-wallets.sql §4, credits-service.ts › resolveBillingTarget):
--   origin container kind personal / link  → the OWNER's personal wallet
--   origin container kind standard         → the caller's seat wallet there
-- Ledger rows written by the NEW code already carry `wallet` + `payer_user_id`;
-- legacy rows carry wallet='workspace' and no payer, so the payer is derived
-- from the origin container. Rows whose origin container is gone are skipped
-- (nothing to charge; they were unmetered under both models).

BEGIN;

WITH period AS (
  SELECT date_trunc('month', now()) AS start
),
attributed AS (
  SELECT
    e.amount,
    e.period_start,
    w.kind,
    w.id AS workspace_id,
    e.user_id AS caller_id,
    COALESCE(e.payer_user_id, w.owner_id) AS owner_id,
    COALESCE(
      NULLIF(e.wallet, 'workspace'),
      CASE WHEN w.kind = 'standard' THEN 'seat' ELSE 'personal' END
    ) AS wallet
  FROM public.credit_usage_events e
  JOIN public.workspaces w ON w.id = e.origin_workspace_id
  CROSS JOIN period p
  WHERE e.period_start = p.start
),
personal AS (
  SELECT owner_id AS user_id, period_start, SUM(amount)::int AS used
  FROM attributed WHERE wallet = 'personal' AND owner_id IS NOT NULL
  GROUP BY 1, 2
),
seat AS (
  SELECT workspace_id, caller_id AS user_id, period_start, SUM(amount)::int AS used
  FROM attributed WHERE wallet = 'seat' AND caller_id IS NOT NULL
  GROUP BY 1, 2, 3
),
up_personal AS (
  INSERT INTO public.user_credit_usage AS u (user_id, period_start, used, updated_at)
  SELECT user_id, period_start, used, now() FROM personal
  ON CONFLICT (user_id, period_start) DO UPDATE
    SET used = EXCLUDED.used, updated_at = now()
  RETURNING 1
),
up_seat AS (
  INSERT INTO public.workspace_member_credit_usage AS u (workspace_id, user_id, period_start, used, updated_at)
  SELECT workspace_id, user_id, period_start, used, now() FROM seat
  ON CONFLICT (workspace_id, user_id, period_start) DO UPDATE
    SET used = EXCLUDED.used, updated_at = now()
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM up_personal) AS personal_wallets_written,
  (SELECT count(*) FROM up_seat)     AS seat_wallets_written;

COMMIT;
