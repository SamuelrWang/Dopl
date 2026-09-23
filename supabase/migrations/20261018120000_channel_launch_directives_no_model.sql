-- ============================================================================
-- THE REFUSAL VOCABULARY GAINS AN ELEVENTH WORD: `no-model` (2026-09-22)
-- ============================================================================
-- 🔒 **THE DEFECT.** A launch naming a model the operator's machine did not know
-- was NOT refused: the id fell through the precedence chain to the product
-- default (Sonnet), the agent started on that, and the launch echoed the id it
-- was asked for. Samuel's ask the same day — *"can we make sure the models
-- aren't hard coded? … if claude or codex add a new model, would dopl auto mark
-- those as options"* — made the Claude roster LIVE
-- (`dopl-desktop-app/main/runtime/claude/roster.js` reads the CLI's own
-- `supportedModels()`), and with a live roster to check against an unknown id is
-- REFUSED with a sentence rather than swapped
-- (`dopl-desktop-app/main/session-launch.js › refuseUnknownModel`).
--
-- ⚠ **NO MODEL-ID `CHECK` IS ADDED, AND NONE EXISTS TO LOOSEN.** Every model
-- column on this table and on `agent_templates` is GRAMMAR-only (length, trim,
-- no control characters) — the roster lives on the operator's machine and moves
-- with the vendor, so an enum here would refuse a model a machine already runs.
-- This migration touches ONLY the refusal-reason vocabulary.
--
-- ⚠ **RE-CREATED WHOLE**, `20260910120000` §3A's rule: a CHECK cannot be
-- ALTERed, and a partially rewritten one is how a word quietly disappears. Every
-- word that migration admitted is restated below.
--
-- ⚠ **ADDITIVE, AND AN OLDER DESKTOP KEEPS WORKING**: it never sends the word.
-- ⚠ **WRITTEN, NOT APPLIED** by the wave that wrote it — apply by NAME, and
-- verify with `list_migrations`, never with `db push`.

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_refusal_reason_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_refusal_reason_check
  CHECK (
    refusal_reason IS NULL OR refusal_reason IN (
      'cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
      'no-template', 'no-session', 'bad-name', 'no-chain',
      -- ⚠ THE ELEVENTH, 2026-09-22. Producer in the same wave:
      -- `dopl-desktop-app/main/session-launch.js › launch`.
      'no-model'
    )
  );

-- ⚠ THE REWRITE IS ASSERTED, NOT ASSUMED: re-creating a CHECK whole is exactly
-- the change that drops a word by accident, and `template-approval` (an IPC-only
-- word, never a directive refusal) must still be refused at rest.
DO $$
DECLARE
  def TEXT;
  word TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_refusal_reason_check'
     AND convalidated;
  IF def IS NULL THEN
    RAISE EXCEPTION 'ABORT: the refusal-reason CHECK is missing or NOT VALIDATED';
  END IF;
  FOREACH word IN ARRAY ARRAY['cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
                              'no-template', 'no-session', 'bad-name', 'no-chain', 'no-model'] LOOP
    IF position(quote_literal(word) IN def) = 0 THEN
      RAISE EXCEPTION 'ABORT: the refusal-reason CHECK lost %', word;
    END IF;
  END LOOP;
  IF position('template-approval' IN def) > 0 THEN
    RAISE EXCEPTION 'ABORT: template-approval is an IPC-only word and must never be storable';
  END IF;
END $$;
