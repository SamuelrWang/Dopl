-- ONE ATOMIC WRITE — THE COUNTER AND THE LEDGER ROW MOVE TOGETHER OR NEITHER
-- DOES (2026-09-13, Samuel's ruling; spec `docs/specs/credit-model-v2.md` §3A,
-- finding F-693).
--
--   > "There's a disconnect between the two charts. We need to nail this down."
--   > **The histogram must equal the wallet, always.**
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY HAS NOT RUN** (Docker is unavailable on this
-- machine, so `supabase db reset` cannot start). This directory's standing gate
-- is recorded rather than glossed.
--
-- ⚠ **DEPLOY STATE IS A MEASUREMENT, NOT A CLAIM.** Re-derive with
-- `supabase migration list` (or the MCP `list_migrations`) and **JOIN ON THE
-- NAME**, never on the filename prefix: `20260823150000` applied as
-- `20260823205007`, `credit_usage_events` as `20260901193049`
-- (INVARIANTS §12, F-304). "Is `20261004120000` applied?" is not a question the
-- version column can answer.
--
-- ⚠ **APPLY ORDER: AFTER `20261003120000_credit_events_channel.sql`**, which is
-- the file that gives the ledger its `channel_id` — a column this file's INSERT
-- names. It also needs `wallet` and `payer_user_id` from `20260930120000`, which
-- that file already depends on. Filename order decides, as always.
-- ⚠ **THIS FILE IS NOT ADDITIVE, AND IT IS THE FIRST ONE IN THIS WAVE THAT IS
-- NOT.** It DROPS both wallet RPCs and re-creates them with a wider signature,
-- because the argument list changes and `CREATE OR REPLACE` would leave the old
-- four-argument function standing as an OVERLOAD — i.e. a second, silent path
-- that still moves a counter with no ledger row, which is the exact defect this
-- file closes. No table, column, index or policy is touched.
--
-- ⚠ **DEPLOY ORDER: THIS FILE FIRST, THE SERVER SECOND, AND BOTH WRONG ORDERS
-- FAIL OPEN AND SILENT** (the same shape `20260930120000`'s header records).
-- Either the new server calls a signature the database does not have, or the old
-- server calls one this file removed; both answer PGRST202, `credit-wallets.ts`
-- throws, and `POST /api/mcp/credits/consume` fails OPEN by design — so every
-- tool call runs FREE and UNMETERED, one log line each, with no user-visible
-- symptom. Apply this file, verify by NAME, THEN deploy.
--
-- ══ THE INCIDENT (measured 2026-09-13) ═════════════════════════════════════
--
-- Samuel's personal wallet counter read `used = 8`. The ledger
-- (`credit_usage_events`, `wallet='personal'`, `payer_user_id` = him, same
-- period) held FIVE rows. The /home Overview prints the COUNTER on its bar and
-- the LEDGER on its histogram, so the two charts on one card disagreed by three.
--
-- Cause, exactly: `billing/server/credit-ledger.ts › recordCreditUsageEvent` was
-- FIRE-AND-FORGET, fired AFTER the counter RPC had already committed. For the
-- minutes between the server naming `channel_id` and `20261003120000` being
-- applied, every insert answered `42703 column channel_id does not exist`; the
-- writer `console.warn`ed and returned, and the counter had already moved. The
-- three rows were reconciled by hand the same day — **that is not the fix**. Any
-- future insert failure (an RLS change, a bad FK, a network blip, the next
-- column added ahead of its migration) reopens the same gap in the same way.
--
-- ══ WHY THE FIX IS HERE AND NOT IN TYPESCRIPT ══════════════════════════════
--
-- The two writes are one fact — "this wallet was charged, for this, by this
-- caller, in this channel" — and nothing in the application can make two
-- PostgREST round trips atomic. Awaiting the ledger insert and rolling the
-- counter back by hand is a compensating write that can itself fail, on the
-- hottest path in the product. Inside one plpgsql function they share ONE
-- transaction: the counter UPDATE and the ledger INSERT commit together or
-- neither does.
--
-- 🔒 **WHAT THE SHAPE BELOW GUARANTEES, IN THE ORDER IT GUARANTEES IT:**
--   1. A REFUSED consume (over allowance) inserts NOTHING — the INSERT sits
--      inside the branch that has already proved `v_used IS NOT NULL`, which is
--      the CAS's own "the counter moved" answer. Attribution for credits nobody
--      was charged is what would put phantom spend in the histogram.
--   2. A FAILED ledger insert ROLLS BACK the counter. The exception is unhandled
--      on purpose: it aborts the function's transaction, the RPC answers an
--      error, `credit-wallets.ts` throws and the route fails OPEN — the call is
--      free and logged, which is the posture this path already has for a DB
--      failure. ⚠ **THIS IS WHY THE OLD WRITER'S `amount > 0` GUARD IS GONE
--      RATHER THAN COPIED**: it existed to turn the table's own
--      `CHECK (amount > 0)` into a swallowed no-op. With one transaction that
--      CHECK is load-bearing — a bad amount now refuses the whole spend instead
--      of skewing the ledger against the counter.
--   3. The CAS/allowance semantics are UNCHANGED, statement for statement, from
--      `20260930120000` §3. Both insert paths stay guarded (the
--      `ON CONFLICT … WHERE` predicate covers the UPDATE, the `IF p_amount <=
--      p_limit` covers the fresh INSERT — a zero limit is reachable), every
--      column reference stays table-qualified, and the refusal still returns the
--      current counter so `used/limit` renders without a second read.
--
-- ⚠ **THE LEDGER IS STILL NOT THE COUNTER.** Nothing here reads
-- `credit_usage_events` to decide `allowed`; the counter remains the sole
-- authority, exactly as `20260811130000`'s header requires. What changed is that
-- the ledger can no longer be BEHIND it.
--
-- ⚠ **`workspace_id` AND `origin_workspace_id` ARE BOTH `p_origin_workspace_id`,
-- WHICH IS WHAT THE TYPESCRIPT WRITER ALREADY DID.** Column semantics are
-- untouched by this file: `workspace_id` is the ADDRESSED container (`NOT NULL`,
-- so the argument may not be null), and the CHARGED container is
-- `p_workspace_id` on the seat arm and nowhere on the personal one. Moving that
-- meaning is a separate change with its own RLS argument, and this file does not
-- make it.
--
-- ══ ROLLBACK (PROSE — applying this file must never run it) ═════════════════
--
-- ⚠ **DEPLOY THE PRE-WAVE SERVER FIRST, THEN RUN THIS**, for the reason the
-- deploy-order note above gives: the running server's argument list must match
-- the functions that exist. Nothing below loses a credit or a ledger row — the
-- counters and the ledger table are not touched — but between the two steps
-- every tool call is free and unmetered.
--
--     DROP FUNCTION IF EXISTS public.credit_ledger_sum(UUID, TEXT, TIMESTAMPTZ);
--     DROP FUNCTION IF EXISTS public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID);
--     DROP FUNCTION IF EXISTS public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID);
--     -- then re-apply §3 of 20260930120000_credit_wallets.sql verbatim, which
--     -- re-creates the four/five-argument forms and their grants.
--
-- ⚠ **A COMMENT IS NOT A FENCE.** What stops a rolled-back server writing the
-- ledger from TypeScript is that `credit-ledger.ts` no longer exports a writer
-- (`recordCreditUsageEvent` is DELETED, not deprecated) — a code fact, pinned by
-- `src/features/billing/server/credits-channel-attribution.test.ts`.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The old signatures go, so no overload can move a counter silently
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ THE ARGUMENT LIST IS PART OF THE IDENTITY: these two DROPs name the exact
-- signatures `20260930120000` §3 created, and a `CREATE OR REPLACE` without them
-- would ADD a function rather than replace one.

DROP FUNCTION IF EXISTS public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT);
DROP FUNCTION IF EXISTS public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. consume_user_credits — the PERSONAL wallet, counter + ledger in one
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The first four arguments are `20260930120000` §3's, unchanged and in order.
-- The three new ones are the ledger's own dimensions, the ones the counter's key
-- cannot carry:
--   * `p_origin_workspace_id` — the ADDRESSED container. Fills both
--     `workspace_id` (NOT NULL) and `origin_workspace_id`, as the TypeScript
--     writer did.
--   * `p_caller_user_id`      — WHO called. Differs from `p_user_id` (the PAYER)
--     exactly on the guest path, which is the pair the ledger exists to keep
--     apart.
--   * `p_channel_id`          — rule B's calling channel, or NULL for
--     "Desktop agent" (`20261003120000`).
-- `wallet` is the LITERAL `'personal'`: this function writes one counter, so the
-- label is a fact about the function and not an argument a caller can get wrong.

CREATE FUNCTION public.consume_user_credits(
  p_user_id              UUID,
  p_period_start         TIMESTAMPTZ,
  p_amount               INT,
  p_limit                INT,
  p_origin_workspace_id  UUID,
  p_caller_user_id       UUID,
  p_channel_id           UUID
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
      -- 🔒 THE SAME TRANSACTION AS THE COUNTER ABOVE. Reached ONLY when the CAS
      -- moved the counter, and its failure aborts that move with it.
      INSERT INTO credit_usage_events (
        workspace_id, origin_workspace_id, user_id, channel_id,
        wallet, payer_user_id, amount, period_start
      )
      VALUES (
        p_origin_workspace_id, p_origin_workspace_id, p_caller_user_id, p_channel_id,
        'personal', p_user_id, p_amount, p_period_start
      );

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. consume_member_credits — the SEAT wallet, same shape one key wider
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ `p_workspace_id` IS THE CHARGED CONTAINER AND `p_origin_workspace_id` IS THE
-- ADDRESSED ONE, AND UNDER RULE B THEY DIFFER — a workspace-channel agent
-- reaching into a personal KB charges the seat in the workspace while addressing
-- the shelf. The counter takes the first, the ledger row the second; collapsing
-- them is the bug this wave's predecessor already paid for.

CREATE FUNCTION public.consume_member_credits(
  p_workspace_id         UUID,
  p_user_id              UUID,
  p_period_start         TIMESTAMPTZ,
  p_amount               INT,
  p_limit                INT,
  p_origin_workspace_id  UUID,
  p_caller_user_id       UUID,
  p_channel_id           UUID
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
      INSERT INTO credit_usage_events (
        workspace_id, origin_workspace_id, user_id, channel_id,
        wallet, payer_user_id, amount, period_start
      )
      VALUES (
        p_origin_workspace_id, p_origin_workspace_id, p_caller_user_id, p_channel_id,
        'seat', p_user_id, p_amount, p_period_start
      );

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. credit_ledger_sum — the RECONCILIATION GUARD's read side
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The atomic write makes divergence unreachable going forward; it does not prove
-- the rows already there agree, and "always" is a claim somebody has to be able
-- to CHECK. `billing/server/credits-audit.ts › walletMatchesLedger` compares one
-- wallet's counter against this sum and `GET /api/billing/status` publishes the
-- difference as `credits.ledgerDrift`.
--
-- ⚠ **A FUNCTION BECAUSE POSTGREST CANNOT AGGREGATE** (the same constraint
-- `home/server/repository-overview.ts › scanCreditEvents` records, where the fix
-- was to haul the rows and tally them in the service). That haul is capped, so
-- its answer is a FLOOR — and a floor cannot measure a DIFFERENCE: a clipped
-- scan would report drift that is really the cap. One `SUM` in Postgres is
-- exact, is one round trip, and reads the
-- `(payer_user_id, wallet, channel_id, created_at DESC)` index by its first two
-- columns (`20261003120000`).
--
-- ⚠ **KEYED `(payer, wallet, period)` — THE COUNTER'S OWN KEY ON THE PERSONAL
-- WALLET, AND THE PAYER'S WHOLE SEAT SPEND FOR THAT PERIOD ON THE SEAT ONE.**
-- It deliberately does NOT narrow by workspace: the ledger row records the
-- ADDRESSED container, not the charged one, so narrowing there would drop every
-- cross-container seat burn and read as drift. The TypeScript side sums the
-- payer's `workspace_member_credit_usage` rows for the same period, so both
-- sides answer the same question.
--
-- ⚠ **NO `SECURITY INVOKER` READ HERE.** Like the consume functions it is
-- service-role only, called through `supabaseAdmin()`; the RLS policy on
-- `credit_usage_events` fences the CLIENT read and is unaffected.

CREATE OR REPLACE FUNCTION public.credit_ledger_sum(
  p_payer_user_id UUID,
  p_wallet        TEXT,
  p_period_start  TIMESTAMPTZ
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(e.amount), 0)::INT
    FROM credit_usage_events e
   WHERE e.payer_user_id = p_payer_user_id
     AND e.wallet = p_wallet
     AND e.period_start = p_period_start;
$$;

COMMENT ON FUNCTION public.credit_ledger_sum(UUID, TEXT, TIMESTAMPTZ) IS
  'THE RECONCILIATION GUARD''s read side (2026-09-13, F-693): one wallet''s attribution total for a period, keyed exactly as the counter is. Compared against the counter by billing/server/credits-audit.ts and published as GET /api/billing/status -> credits.ledgerDrift. Reads nothing to decide a charge.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Grants — service-role only, exactly as the superseded signatures had
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ A DROPPED FUNCTION TAKES ITS GRANTS WITH IT, so these are not a tidy-up:
-- without them the new signatures are EXECUTE-able by PUBLIC (the default) and
-- unreachable by the service role that calls them.

REVOKE ALL ON FUNCTION public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.credit_ledger_sum(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_ledger_sum(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
