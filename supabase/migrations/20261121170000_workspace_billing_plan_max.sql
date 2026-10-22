-- PLAN TAXONOMY v4 — `max`, the SECOND personal paid tier (2026-10-22,
-- Samuel's "third tier at $24.99 … 20,000 credits a month").
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY HAS NOT RUN** on the authoring machine
-- (no Docker, so `supabase db reset` cannot start; CI's `rls-redteam` job is
-- the replay gate). This directory's standing gate is recorded, not glossed.
--
-- ⚠ **DEPLOY STATE IS A MEASUREMENT, NOT A CLAIM.** Re-derive with
-- `supabase migration list` (or the MCP `list_migrations`) and **JOIN ON THE
-- NAME**, never on the filename prefix (INVARIANTS §12, F-304).
--
-- ⚠ **DEPLOY ORDER: THIS FILE FIRST, THE SERVER SECOND.** The Max wave's Stripe
-- webhook writes `plan = 'max'` when a personal Max subscription lands. Against
-- the four-value CHECK that write raises `23514` inside the webhook handler, so
-- Stripe retries a `checkout.session.completed` the database will never accept:
-- the customer is charged and the container never flips. Apply this file,
-- verify by NAME, THEN deploy.
--
-- ── WHAT CHANGED ───────────────────────────────────────────────────────────
--
-- Exactly what `20260930130000_workspace_billing_plan_pro.sql` did for `pro`,
-- one value further: drop `workspace_billing_plan_check`, re-add it under the
-- SAME name with a fifth value, re-comment the column. Three statements.
-- Re-derive rather than trust: `grep -v '^--' <file> | grep -c ';'`.
-- Max is billed on the home container's own `workspace_billing` row exactly as
-- Pro is, so no column, table or backfill is owed. A pending Max → Pro
-- downgrade lives in STRIPE (a subscription schedule), not in a column here.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--
-- ⚠ **THE ROLLBACK IS SAFE ONLY WHILE NO `max` ROW EXISTS.** ADD CONSTRAINT
-- validates the whole table, so the four-value CHECK fails with `23514` the
-- moment one container is on Max — correct (it refuses to strand a paying
-- customer's row). Check first; a non-zero count makes the rollback a product
-- decision (refund/downgrade those subscriptions) before it is a SQL one.
--
--   SELECT count(*) FROM public.workspace_billing WHERE plan = 'max';  -- must be 0
--
--   ALTER TABLE public.workspace_billing
--     DROP CONSTRAINT IF EXISTS workspace_billing_plan_check;
--   ALTER TABLE public.workspace_billing ADD CONSTRAINT workspace_billing_plan_check
--     CHECK (plan IN ('free', 'solo', 'team', 'pro'));
--
-- ── VERIFY ─────────────────────────────────────────────────────────────────
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'workspace_billing_plan_check';
--   -- expect: CHECK ((plan = ANY (ARRAY['free'::text, 'solo'::text, 'team'::text, 'pro'::text, 'max'::text])))

ALTER TABLE public.workspace_billing
  DROP CONSTRAINT IF EXISTS workspace_billing_plan_check;

ALTER TABLE public.workspace_billing ADD CONSTRAINT workspace_billing_plan_check
  CHECK (plan IN ('free', 'solo', 'team', 'pro', 'max'));

COMMENT ON COLUMN public.workspace_billing.plan IS
  'Billing plan for THIS container. free = no live subscription. team = per active seat, standard workspaces only. pro and max = flat monthly personal tiers on a kind=''home'' container (pro added 2026-09-08, max 2026-10-22). solo = legacy flat single-member standard workspace, RETIRED FROM SALE 2026-09-07, live rows honoured. Prices live in src/features/billing/prices.ts and Stripe. Entitlement is the VERDICT (src/features/billing/server/entitlements.ts > entitledPlanFor), never this column raw.';
