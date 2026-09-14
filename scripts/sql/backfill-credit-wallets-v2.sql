-- Seed the credit-model v2.1 wallets from the attribution ledger's LEGACY rows.
--
-- RUN ONCE, RIGHT AFTER the v2.1 web deploy (`feat/credit-model-v2`). Before the
-- deploy prod runs the pooled model, which writes `workspace_credit_usage` + a
-- ledger row and never touches the two per-payer wallets — so on deploy day every
-- wallet reads 0 while the ledger holds the month's real spend. This adds that
-- spend to each wallet so nobody's meter resets mid-month.
--
-- ⚠ **STILL VALID AFTER `20261004120000_credit_consume_with_ledger.sql`, AND ITS
-- SECOND JOB IS GONE (2026-09-13, Samuel: the histogram must equal the wallet,
-- always; F-693).** After that migration the counter UPDATE and the
-- `credit_usage_events` INSERT are one transaction inside `consume_user_credits`
-- / `consume_member_credits`, so a refused consume writes neither and a failed
-- insert rolls the counter back: **the two cannot diverge going forward.** This
-- script is therefore a deploy-day catch-up and a hand repair, never a repair
-- loop, and it must **never be scheduled**.
-- `GET /api/billing/status › credits.ledgerDrift`
-- (`src/features/billing/server/credits-audit.ts`) is how a residual
-- disagreement is NOTICED, and a person decides what to do about it.
--
-- ══ WHAT IT TOUCHES, AND WHY EACH NARROWING IS LOAD-BEARING ════════════════
--
-- 🔒 **LEGACY ROWS ONLY — `wallet = 'workspace'`, the column's `DEFAULT`.**
-- ⚠ **THE SUPERSEDED VERSION READ THE WHOLE LEDGER AND `SET used` TO AN ABSOLUTE
-- SUM. UNDER RULE B THAT LOSES BALANCES.** A v2.1 row already moved its counter
-- atomically, and — this is the part that bites — the row records the ADDRESSED
-- container while a SEAT burn's CHARGED workspace appears on it NOWHERE
-- (`billing/server/credit-ledger.ts › CreditUsageEvent`; rule B arm 2 is a
-- workspace-channel agent reaching into a personal shelf). So re-deriving a seat
-- counter from `origin_workspace_id` dropped every cross-container burn from the
-- total it then OVERWROTE, and wrote a `workspace_member_credit_usage` row keyed
-- on a `kind='personal'` container besides. **Legacy rows have no such problem:
-- rule B did not exist when they were written, so the origin container IS the
-- charged one for every one of them.**
--
-- 🔒 **ADDITIVE, NOT ABSOLUTE.** Legacy spend was never counted by either wallet,
-- so it is ADDED to whatever the atomic RPCs have already charged for that period.
--
-- 🔒 **AND IT LABELS THE ROWS IT COUNTED** (`wallet`, `payer_user_id`), which is
-- two things at once:
--   * **IDEMPOTENCE.** A labelled row is no longer `wallet='workspace'`, so a
--     second run finds nothing to add. Re-running is exact by arithmetic, not by
--     luck.
--   * **NO PHANTOM DRIFT.** `credit_ledger_sum` (`20261004120000` §4) keys on
--     `(payer_user_id, wallet, period_start)` and a legacy row carries neither of
--     the first two — so seeding a counter from unlabelled rows made
--     `credits.ledgerDrift` equal to the whole backfill, and /home's Usage card
--     would have printed **Unreconciled** under the bar for every existing user
--     for the rest of the month. Labelling is what makes the two sides agree.
--   ⚠ The /home histogram is unaffected either way: its LEGACY arm
--     (`home/server/overview-tally.ts › isPersonalWalletBurn`) matches the same
--     rows before labelling that its v2.1 arm matches after, and that arm STAYS —
--     rows whose origin container is gone are never labelled, and older periods in
--     other deployments may hold unlabelled rows.
--
-- ⚠ **NO PERIOD FILTER, DELIBERATELY.** The superseded version matched
-- `date_trunc('month', now())`, which is wrong twice: it is the SESSION
-- timezone's month while both period rules stamp the **UTC** one
-- (`billing/credits.ts › calendarMonth`), and a PAID wallet's `period_start` is
-- its Stripe anchor rather than the 1st, so every payer was silently skipped. The
-- aggregates group by the row's OWN stamped `period_start`, which is the counter's
-- key by definition — so there is nothing left for a filter to get right.
--
-- ⚠ **DO NOT RUN THIS AFTER THE SUPERSEDED ABSOLUTE FORM.** That one SET the
-- counters from the full ledger and labelled nothing; this one ADDS. Running the
-- old shape first and this one after double-counts every legacy row. The old
-- shape has never been run in production (v2.1 ships with this file), which is
-- what makes replacing it safe rather than a migration of its own.
--
-- MAPPING (credit-wallets.sql §4, credits-service.ts › resolveBillingTarget):
--   origin container kind personal / link  → the OWNER's personal wallet
--   origin container kind standard         → the caller's seat wallet there
-- Rows whose origin container is gone (`origin_workspace_id` is NULL, or the
-- `workspaces` row was deleted) are SKIPPED: there is nothing to charge, and they
-- were unmetered under both models.
-- ⚠ The personal payer is `workspaces.owner_id` — the same column
-- `home/server/repository-overview.ts › listOwnedPersonalContainerIds` follows —
-- and NOT `findActiveOwnerUserId`'s `workspace_members` row, which is what the
-- live credit path resolves. They agree on every container the product mints; a
-- hand-edited one where they disagree is a person's problem, not this script's.

BEGIN;

WITH legacy AS (
  SELECT
    e.id,
    e.amount,
    e.period_start,
    w.id      AS workspace_id,
    e.user_id AS caller_id,
    w.owner_id,
    CASE WHEN w.kind = 'standard' THEN 'seat' ELSE 'personal' END AS wallet
  FROM public.credit_usage_events e
  JOIN public.workspaces w ON w.id = e.origin_workspace_id
  WHERE e.wallet = 'workspace'
),
-- The payer this row will be labelled with, NULL when there is nobody to charge.
payable AS (
  SELECT
    l.*,
    CASE WHEN l.wallet = 'personal' THEN l.owner_id ELSE l.caller_id END AS payer_id
  FROM legacy l
),
personal AS (
  SELECT payer_id AS user_id, period_start, SUM(amount)::int AS used
  FROM payable WHERE wallet = 'personal' AND payer_id IS NOT NULL
  GROUP BY 1, 2
),
seat AS (
  SELECT workspace_id, payer_id AS user_id, period_start, SUM(amount)::int AS used
  FROM payable WHERE wallet = 'seat' AND payer_id IS NOT NULL
  GROUP BY 1, 2, 3
),
-- ⚠ SAME STATEMENT, SAME SNAPSHOT: `legacy` reads the rows as they were before
-- this UPDATE, so the aggregates above cannot see the labels being written here.
labelled AS (
  UPDATE public.credit_usage_events e
     SET wallet = p.wallet, payer_user_id = p.payer_id
    FROM payable p
   WHERE e.id = p.id AND p.payer_id IS NOT NULL
  RETURNING 1
),
up_personal AS (
  INSERT INTO public.user_credit_usage AS u (user_id, period_start, used, updated_at)
  SELECT user_id, period_start, used, now() FROM personal
  ON CONFLICT (user_id, period_start) DO UPDATE
    SET used = u.used + EXCLUDED.used, updated_at = now()
  RETURNING 1
),
up_seat AS (
  INSERT INTO public.workspace_member_credit_usage AS u (workspace_id, user_id, period_start, used, updated_at)
  SELECT workspace_id, user_id, period_start, used, now() FROM seat
  ON CONFLICT (workspace_id, user_id, period_start) DO UPDATE
    SET used = u.used + EXCLUDED.used, updated_at = now()
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM labelled)    AS ledger_rows_labelled,
  (SELECT count(*) FROM up_personal) AS personal_wallets_written,
  (SELECT count(*) FROM up_seat)     AS seat_wallets_written;

COMMIT;
