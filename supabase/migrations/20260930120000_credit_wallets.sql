-- CREDIT WALLETS — the PERSONAL counter and the PER-SEAT counter (2026-09-07,
-- Samuel's ruling; spec `docs/specs/credit-model-v2.md` §4).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY HAS NOT RUN** (Docker is unavailable on this
-- machine, so `supabase db reset` cannot start). This directory's standing gate
-- is recorded rather than glossed.
--
-- ⚠ **DEPLOY STATE IS A MEASUREMENT, NOT A CLAIM.** Re-derive with
-- `supabase migration list` (or the MCP `list_migrations`) and **JOIN ON THE
-- NAME**, never on the filename prefix: `20260823150000` applied as
-- `20260823205007`, `credit_usage_events` as `20260901193049`
-- (INVARIANTS §12, F-304). "Is `20260930120000` applied?" is not a question the
-- version column can answer.
--
-- ⚠ **APPLY ORDER: SECOND-TO-LAST.** Every other pending file in
-- `supabase/migrations` goes first, in FILENAME order — this one sorts after
-- all of them and depends on two of their subjects (`workspaces.kind =
-- 'personal'` from `20260920120000_workspace_kind_personal.sql`, and
-- `credit_usage_events` from `20260901130000_credit_usage_events.sql`).
-- ⚠ **THIS LINE READ "LAST" UNTIL 2026-09-08**, and it was true for one day:
-- `20260930130000_workspace_billing_plan_pro.sql` (the v2.1 plan CHECK) sorts
-- after it and ships in the same wave. Filename order still decides; only the
-- superlative was wrong. ADDITIVE ONLY: it edits no applied file, drops no
-- table, and drops no function.
--
-- ⚠ **DEPLOY ORDER: THIS FILE FIRST, THE SERVER SECOND — AND BOTH FAILURE
-- MODES OF GETTING IT WRONG ARE SILENT.** The wave's server calls
-- `consume_user_credits` / `consume_member_credits` on every MCP tool call and
-- names `wallet` / `payer_user_id` on every ledger insert. Ship it against a
-- database without them and:
--   * the RPC answers PGRST202, `credit-wallets.ts` throws, and
--     `POST /api/mcp/credits/consume` FAILS OPEN by design — so every tool call
--     in the product runs FREE and UNMETERED, logging one line each, with no
--     user-visible symptom at all;
--   * the ledger insert is a 42703 that `credit-ledger.ts` swallows
--     (fire-and-forget), so /home's per-channel and per-person rails go quietly
--     empty rather than erroring.
-- Neither state announces itself. Apply this file, verify with
-- `supabase migration list` joined ON THE NAME, THEN deploy.
--
-- ── WHAT CHANGED, AND WHY THERE ARE NOW TWO COUNTERS ───────────────────────
--
-- Samuel's ruling, 2026-09-07, close paraphrase:
--
--   > In the HOME SPACE a user is charged for what THEIR OWN agent spent in MCP
--   > calls. WORKSPACES bill separately, like Slack: one person pays, BY SEATS.
--   > Creating a workspace is free and members are unlimited, but each member
--   > gets a FIXED, NON-POOLED allocation — 100 on Free, 5,000 on the $8/seat
--   > paid tier.
--
-- `workspace_credit_usage` (20260811130000) is a POOLED, per-(workspace,
-- period) counter, and no amount of arithmetic on one row can express "each
-- member has their own 5,000". Non-pooled means one counter row per PAYER, so
-- the payer has to be part of the key. That is two new tables, because the two
-- payers are different things:
--
--   * `user_credit_usage`             — keyed (user, period). THE PERSONAL
--     WALLET: one per human, spent by every MCP call made in that person's home
--     space (their `kind='personal'` container and every `kind='link'`
--     container they OWN). A guest's call inside somebody's link container
--     lands here, on the OWNER's row — Samuel, 2026-08-26, "charge MCP calls
--     from a guest to the user"; the ruling is unchanged, only the wallet moved.
--   * `workspace_member_credit_usage` — keyed (workspace, user, period). THE
--     SEAT WALLET: one per (standard workspace, member). The workspace owner
--     pays Stripe for the seat; the member spends the seat's own allocation.
--
-- ⚠ **THE LIMIT IS STILL PASSED IN (`p_limit`) AND STILL LIVES IN TYPESCRIPT.**
-- `src/features/billing/credits.ts` is the one retune spot
-- (`SEAT_MONTHLY_CREDITS`, `PERSONAL_MONTHLY_CREDITS`); this file owns the
-- storage and the concurrency and never a number. Retuning a plan stays a
-- TypeScript edit, exactly as 20260811130000's header requires.
--
-- ⚠ **NO RESET CRON, SAME AS THE POOLED COUNTER.** The resolved `period_start`
-- is STAMPED on the row, so the counter self-rolls: the first consume of a new
-- period inserts a fresh row and the old one is never touched again.
--
-- ── ROLLBACK — COMPLETE, AND IN THIS ORDER ─────────────────────────────────
--
-- ⚠ The two counters hold live spend. Dropping them RESETS every wallet to zero
-- for the current period, which is a free re-spend of everyone's allowance, not
-- a data loss — state that when deciding, do not discover it.
-- ⚠ Reverting the ledger columns is safe only once nothing writes them: deploy
-- the pre-wave server FIRST, then run this. An `INSERT` naming `wallet` against
-- a table without the column is a 42703 on the hottest write path in the
-- product (it is swallowed — `credit-ledger.ts` is fire-and-forget — so the
-- symptom is a silently empty ledger, not an error anyone sees).
--
--     DROP FUNCTION IF EXISTS public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT);
--     DROP FUNCTION IF EXISTS public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT);
--     DROP INDEX IF EXISTS public.credit_usage_events_payer_period_idx;
--     ALTER TABLE public.credit_usage_events DROP COLUMN IF EXISTS payer_user_id;
--     ALTER TABLE public.credit_usage_events DROP COLUMN IF EXISTS wallet;
--     DROP TABLE IF EXISTS public.workspace_member_credit_usage;
--     DROP TABLE IF EXISTS public.user_credit_usage;
--     COMMENT ON TABLE public.workspace_credit_usage IS NULL;
--     COMMENT ON FUNCTION public.consume_workspace_credits(UUID, TIMESTAMPTZ, INT, INT) IS NULL;
--
-- ⚠ **THE ROLLBACK RESTORES A WORKING SYSTEM BECAUSE NOTHING IS DROPPED HERE.**
-- `workspace_credit_usage` and `consume_workspace_credits` are left standing
-- and intact (§5 below): the pre-wave server finds its pooled counter exactly
-- where it left it, with the balances it had.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. user_credit_usage — the PERSONAL wallet counter
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The PK leads with `user_id`, which covers the FK cascade (INVARIANTS §12) and
-- every read this table has — there is no second index to add.
--
-- `updated_at` is stamped by the WRITER (the CAS below, service role) rather
-- than by a trigger: nothing orders by the column, and a trigger would fire on
-- the hottest write in the product. Same call as 20260811130000.
--
-- ⚠ ON DELETE CASCADE from `auth.users`: a deleted account's counter is not
-- billing history — the ledger (`credit_usage_events`) is, and it keeps its row
-- with a nulled user. A counter row for a user who cannot make a call again has
-- no reader.

CREATE TABLE IF NOT EXISTS public.user_credit_usage (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  used         INTEGER     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start)
);

COMMENT ON TABLE public.user_credit_usage IS
  'THE PERSONAL WALLET counter: one row per (user, period). Pays for every MCP call made in that user''s HOME SPACE — their kind=''personal'' container and every kind=''link'' container they OWN, whoever made the call. Allowance lives in src/features/billing/credits.ts (PERSONAL_MONTHLY_CREDITS), never here. Written ONLY by consume_user_credits.';

ALTER TABLE public.user_credit_usage ENABLE ROW LEVEL SECURITY;

-- Same posture as `workspace_credit_usage`: no client write policy AT ALL, base
-- DML revoked, every write service-role through the RPC below.
REVOKE INSERT, UPDATE, DELETE ON public.user_credit_usage FROM authenticated, anon;

-- 🔒 A PERSONAL WALLET IS READABLE BY EXACTLY ONE PERSON. There is no member
-- arm and there must not be one: this counter spans the owner's whole home
-- space, so a peer inside one link container would otherwise read the
-- operator's total spend across every OTHER relationship they have.
-- `(SELECT auth.uid())` is the initplan form (20260720211005 PART 2).
DROP POLICY IF EXISTS user_credit_usage_self_select ON public.user_credit_usage;
CREATE POLICY user_credit_usage_self_select ON public.user_credit_usage
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. workspace_member_credit_usage — the SEAT wallet counter
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The PK leads with `workspace_id`, covering that FK's cascade; the `user_id`
-- cascade is covered by no index and needs none — a user delete is a
-- once-in-an-account-lifetime statement, and the alternative is a second index
-- paid for on every tool call (INVARIANTS §12: an index needs a named
-- statement behind it).

CREATE TABLE IF NOT EXISTS public.workspace_member_credit_usage (
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  used         INTEGER     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, period_start)
);

COMMENT ON TABLE public.workspace_member_credit_usage IS
  'THE SEAT WALLET counter: one row per (standard workspace, member, period). Each member of a workspace has their OWN fixed allocation — NOT a pool (Samuel, 2026-09-07). Allowance lives in src/features/billing/credits.ts (SEAT_MONTHLY_CREDITS, keyed by the ENTITLED plan), never here. Written ONLY by consume_member_credits.';

ALTER TABLE public.workspace_member_credit_usage ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.workspace_member_credit_usage FROM authenticated, anon;

-- A member reads their OWN seat; an ADMIN reads the whole workspace's seats,
-- because the person paying for the seats is entitled to see what each one
-- spent. ⚠ NOT a `viewer` floor: `workspace_credit_usage`'s policy is
-- viewer-wide because a POOLED number tells you nothing about a person, and
-- this one is per-person.
-- ⚠ `is_current_workspace_member(uuid, text)` is the caller-pinned form
-- (20260720211005): the subject is hard-coded to `auth.uid()` inside the
-- function, so there is no user-id argument for a caller to choose.
DROP POLICY IF EXISTS workspace_member_credit_usage_select ON public.workspace_member_credit_usage;
CREATE POLICY workspace_member_credit_usage_select ON public.workspace_member_credit_usage
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR is_current_workspace_member(workspace_id, 'admin'::text)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The two CAS functions — same shape as consume_workspace_credits
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Both are a copy of `consume_workspace_credits` (20260811130000 §3) with the
-- key widened, and every reason in that header applies here unchanged:
--
--   * ONE `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING` statement:
--     a true cross-instance compare-and-set with no advisory lock to leak
--     through PgBouncer transaction pooling.
--   * BOTH paths guarded — the UPDATE path by the `ON CONFLICT ... WHERE
--     u.used + p_amount <= p_limit` predicate, the fresh-INSERT path by
--     `IF p_amount <= p_limit` in the body. ⚠ **THE `IF` IS NOT REDUNDANT AND
--     IT MATTERS MORE NOW THAN IT DID**: the ON CONFLICT WHERE guards only the
--     update, so without it a zero-credit wallet is granted its first call
--     free — and a zero limit is now REACHABLE, because an unmetered verdict
--     and a retired plan both resolve to one.
--   * EVERY column reference is table-qualified (`u.used`). `used` is also an
--     OUT parameter name, and an unqualified `used` inside SQL is an
--     ambiguous-reference error under plpgsql's default `variable_conflict`.
--   * SECURITY DEFINER with a pinned `search_path` (the tables have no client
--     write policy at all, so the function must not run as the caller), and
--     EXECUTE revoked from PUBLIC/anon/authenticated per 20260619040000.
--
-- Returns (allowed, used): `used` is the counter AFTER the attempt (unchanged
-- when refused), so a refusal renders "100 / 100" without a second read.

CREATE OR REPLACE FUNCTION public.consume_user_credits(
  p_user_id      UUID,
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
    INSERT INTO user_credit_usage AS u (user_id, period_start, used, updated_at)
    VALUES (p_user_id, p_period_start, p_amount, now())
    ON CONFLICT (user_id, period_start) DO UPDATE
      SET used = u.used + p_amount, updated_at = now()
      WHERE u.used + p_amount <= p_limit
    RETURNING u.used INTO v_used;

    IF v_used IS NOT NULL THEN
      RETURN QUERY SELECT TRUE, v_used;
      RETURN;
    END IF;
  END IF;

  -- Refused. Read the current counter so the caller can say how much of the
  -- allowance is gone; a wallet with no row yet has spent nothing.
  SELECT u.used INTO v_used
    FROM user_credit_usage u
   WHERE u.user_id = p_user_id
     AND u.period_start = p_period_start;

  RETURN QUERY SELECT FALSE, COALESCE(v_used, 0);
END
$$;

CREATE OR REPLACE FUNCTION public.consume_member_credits(
  p_workspace_id UUID,
  p_user_id      UUID,
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
    INSERT INTO workspace_member_credit_usage AS u (workspace_id, user_id, period_start, used, updated_at)
    VALUES (p_workspace_id, p_user_id, p_period_start, p_amount, now())
    ON CONFLICT (workspace_id, user_id, period_start) DO UPDATE
      SET used = u.used + p_amount, updated_at = now()
      WHERE u.used + p_amount <= p_limit
    RETURNING u.used INTO v_used;

    IF v_used IS NOT NULL THEN
      RETURN QUERY SELECT TRUE, v_used;
      RETURN;
    END IF;
  END IF;

  SELECT u.used INTO v_used
    FROM workspace_member_credit_usage u
   WHERE u.workspace_id = p_workspace_id
     AND u.user_id = p_user_id
     AND u.period_start = p_period_start;

  RETURN QUERY SELECT FALSE, COALESCE(v_used, 0);
END
$$;

-- Grants — service-role only (called exclusively through supabaseAdmin).
REVOKE ALL ON FUNCTION public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT)
  TO service_role;

REVOKE ALL ON FUNCTION public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. credit_usage_events gains the WALLET dimension
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The ledger already carried WHERE a burn happened (`origin_workspace_id`) and
-- WHO made it (`user_id`). With two wallets it must also carry WHICH COUNTER
-- moved and WHOSE it was, or "credits by person" cannot distinguish a member
-- spending their own seat from a guest spending somebody else's personal
-- wallet — two different bills that look identical in the old shape.
--
-- ⚠ **`workspace_id` STAYS THE ADDRESSED CONTAINER FROM NOW ON, AND THAT IS A
-- SEMANTIC CHANGE TO AN EXISTING COLUMN.** Before this wave it was the PAYER,
-- which for a home burn was the owner's separate standard workspace. There is
-- no such workspace on the credit path any more — a personal burn's payer is a
-- PERSON — so the column holds the workspace row the caller was authorized
-- into (the link/personal container itself). The NOT NULL FK therefore still
-- holds, and `/home`'s `origin_workspace_id IN (…)` reads are unaffected because
-- origin is unchanged. The PAYER moves to `payer_user_id`.
--
-- ⚠ `DEFAULT 'workspace'` IS FOR THE ROWS ALREADY THERE, NOT FOR NEW ONES. Every
-- existing row was written by the pooled counter, and 'workspace' is the honest
-- label for it. The server names `'personal'` or `'seat'` on every insert it
-- makes from this wave on; a row arriving with the default is either legacy or a
-- rolled-back build, and both are readable as such.
--
-- ⚠ NOT NULL WITH A DEFAULT is what makes this a NO-BACKFILL change in BOTH
-- directions (the 20260907120000 `kind` precedent): existing rows take the
-- default in place, and an older server mid-rollout that inserts without naming
-- a wallet writes what it meant.

ALTER TABLE public.credit_usage_events
  ADD COLUMN IF NOT EXISTS wallet TEXT NOT NULL DEFAULT 'workspace';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'credit_usage_events_wallet_check'
       AND conrelid = 'public.credit_usage_events'::regclass
  ) THEN
    ALTER TABLE public.credit_usage_events
      ADD CONSTRAINT credit_usage_events_wallet_check
      CHECK (wallet IN ('workspace', 'personal', 'seat'));
  END IF;
END
$$;

-- SET NULL, never CASCADE, for the same reason `user_id` is: deleting an
-- account must not erase the billing history of what it spent.
ALTER TABLE public.credit_usage_events
  ADD COLUMN IF NOT EXISTS payer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.credit_usage_events.wallet IS
  'WHICH COUNTER MOVED: personal = user_credit_usage, seat = workspace_member_credit_usage, workspace = the RETIRED pooled workspace_credit_usage (legacy rows and rolled-back builds only).';
COMMENT ON COLUMN public.credit_usage_events.payer_user_id IS
  'THE PAYER — whose wallet moved. The container owner for a personal burn, the caller themself for a seat burn. NULL on legacy pooled rows, where the payer was a workspace and is in workspace_id.';
COMMENT ON COLUMN public.credit_usage_events.workspace_id IS
  'THE ADDRESSED CONTAINER — the workspace row the caller was authorized into. ⚠ This was the PAYER before 2026-09-07; the payer is payer_user_id now. Equal to origin_workspace_id on every row this build writes.';

-- The payer's own ledger read ("what did MY wallet go on this period"), and the
-- cover for the `payer_user_id` SET NULL scan. Named statement, per §12's rule
-- that an index must have one.
CREATE INDEX IF NOT EXISTS credit_usage_events_payer_period_idx
  ON public.credit_usage_events (payer_user_id, period_start);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. The pooled counter is RETIRED FROM WRITES — and NOT DROPPED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🔒 **NOTHING IS DROPPED IN THIS WAVE, DELIBERATELY.** `workspace_credit_usage`
-- holds the CURRENT period's real spend for every live workspace, and
-- `consume_workspace_credits` is what a rolled-back server calls. Dropping
-- either turns a rollback into an outage and a data loss in the same statement.
-- The rows are also the only record of pre-wave usage, and there is no
-- migration path for them: a pooled 8,000 cannot be split into per-member
-- allocations after the fact without inventing who spent what.
--
-- The DROP is its own later migration, gated on (a) this wave being live long
-- enough that a rollback is off the table, and (b) whatever retention Samuel
-- wants for the historical rows. ⚠ ITS FINDING ID IS ALLOCATED AT THE WAVE-2
-- INTEGRATION, NOT HERE: four branches share this directory, and each of them
-- reading "the next number" off its own tree is exactly the collision
-- `docs/REFACTOR-FINDINGS.md`'s header records (2026-09-01, six entries under
-- three ids). Re-derive across every live branch with the command at the top of
-- that file.
--
-- ⚠ A COMMENT IS NOT A FENCE, AND THIS FILE DOES NOT PRETEND OTHERWISE. What
-- actually stops a write is that `credits-service.ts` no longer calls it and
-- `workspace-billing.ts` no longer exports a wrapper for it — a code fact,
-- pinned by `src/features/billing/server/credits-service.test.ts`. The comment
-- is for the person reading the catalog, who has neither file open.

COMMENT ON TABLE public.workspace_credit_usage IS
  'RETIRED FROM WRITES 2026-09-07 (credit model v2). The POOLED per-(workspace, period) counter. Superseded by user_credit_usage (personal wallet) and workspace_member_credit_usage (per-seat), because a fixed non-pooled per-member allocation cannot be expressed on one row per workspace. KEPT, not dropped: it holds the current period''s real spend and is what a rolled-back build reads. No live code path writes it. Drop is a later migration.';

COMMENT ON FUNCTION public.consume_workspace_credits(UUID, TIMESTAMPTZ, INT, INT) IS
  'RETIRED FROM WRITES 2026-09-07 (credit model v2). Superseded by consume_user_credits and consume_member_credits. KEPT so a rolled-back build still has its counter. Nothing in the live tree calls it.';
