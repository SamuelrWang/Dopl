-- `channel_launch_directives` — THE TEMPLATE PAIR (`template_id`, `template_name`)
-- and the SEVENTH REFUSAL WORD.
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ⚠ READ `20260822160000_channel_launch_directives.sql` FIRST. This file is an
-- ADDITIVE extension of that table and repeats none of its reasoning: the
-- mailbox shape, the owner-only SELECT with no write policy at all, the lazy
-- expiry, the claim CAS, and — loudest — the REPLICA IDENTITY rule are stated
-- there and still govern here.
--
-- ── ⚠ THE SEQUENCING FLAG THIS FILE EXISTS TO CLEAR ────────────────────────
--
-- The TypeScript half of the refusal vocabulary went to SEVEN on 2026-08-22
-- (agent templates) while the column CHECK stayed at SIX, and FOUR files say so
-- in as many words: `src/features/channels/types-launch.ts ›
-- LaunchRefusalReason`, `› schema-launch.ts › LaunchRefusalReasonSchema`,
-- `› server/service-launch.ts › LAUNCH_REFUSAL_REASONS` and
-- `dopl-desktop-app/main/launch-directive-wire.js › REFUSAL_REASONS`. Each of
-- them carries the same instruction: **do not ship a producer before this
-- migration**, because a `decide` carrying `'no-template'` passes zod, passes
-- the route, and is then refused AT REST by the CHECK — a 500 on the one write
-- whose whole job is to report an outcome honestly.
--
-- **The producer lands in the same change as this file.** `main/launch-
-- directives.js › spawn` now resolves `template_id` at CLAIM time and answers
-- `{ refused: 'no-template' }` when the OPERATOR cannot resolve it. So the
-- widening below is not speculative: without it, the feature this migration
-- accompanies writes a constraint violation on its first real refusal.
--
-- ⚠ **`'template-approval'` IS NOT ADDED AND MUST NEVER BE.** It is an IPC-only
-- word: the desktop answers it to its OWN renderer when a FOREIGN template's
-- first run on that machine needs one human click (`main/session-launch-op.js ›
-- launchFromButton`). There is no human at the keyboard on the directive lane
-- and `orchestratorLaunchEnabled` already stands in for the click there
-- (Samuel's OQ-3 ruling), so a directive can never produce it — and the column
-- must not be able to STORE it, or a future reader will conclude the lane has an
-- approval gate it does not have. Seven words, not eight.
--
-- ── ⚠ WHY TWO COLUMNS AND NOT ONE — SPEC E-4, AND IT IS THE POINT OF THE FILE
--
-- `template_id` alone cannot express what the desktop has to know. The FK is
-- `ON DELETE SET NULL` (mirroring `task_id`: a deleted template leaves the
-- directive STANDING rather than vanishing it), so a directive whose template was
-- deleted between CREATE and CLAIM arrives at the desktop with `template_id IS
-- NULL` — **byte-identical to a directive that never named a template at all.**
--
-- Those two must NOT be treated alike:
--   • no template requested   → launch a BLANK agent. Correct.
--   • template DELETED        → **REFUSE** (`no-template`). The orchestrator
--                               picked an IDENTITY; an agent silently wearing
--                               none is worse than nothing, and nobody notices
--                               for several turns (spec F-1).
--
-- `template_name TEXT`, SNAPSHOTTED AT CREATE, is what tells them apart: a
-- NULLED `template_id` beside a LIVE `template_name` is unambiguously a deletion.
-- ⚠ It is a SNAPSHOT, never an FK and never re-read — the same rule
-- `20260823130000_channel_sessions_template_name.sql` states at length for
-- `channel_sessions.template_name`, and for the same reason: the row must report
-- what was ASKED FOR after the template is renamed or deleted.
-- ⚠ NOTHING MAY LATER ADD AN FK ON IT "for integrity". The staleness IS the
-- signal here; an FK would null it in the same statement that nulls the id and
-- destroy the only evidence a deletion happened.
--
-- ⚠ THE PAIR IS WRITTEN TOGETHER OR NOT AT ALL. `service-launch.ts ›
-- createLaunchDirective` resolves the caller's `template` ref to a row it can
-- SEE and inserts both columns from that row. There is no path that writes one.
--
-- ── ⚠ VISIBILITY: TWO FENCES, TWO DIFFERENT PEOPLE, AND NEITHER IS HERE ─────
--
-- Nothing in this table decides who may name a template:
--   CREATE fence   the ORCHESTRATOR's credential, in `createLaunchDirective`,
--                  through `agent-templates/server › resolveTemplateRef` and the
--                  `canSeeTemplate` matrix. It cannot name what it cannot see.
--   RESOLVE fence  the OPERATOR's credential, on the desktop, at spawn, through
--                  `GET /api/agent-templates/{id}/resolve` (404-never-403).
-- A `team` template the orchestrator is in and the operator is not produces a
-- directive that is created and then REFUSED `no-template` on the machine. That
-- is a real, fail-closed state and not a bug — see `channel-ops-launch.ts ›
-- REFUSAL_SENTENCES['no-template']`, which is where it is explained to the agent.
--
-- ── ⚠ WHAT THIS FILE DELIBERATELY DOES NOT TOUCH ───────────────────────────
--
--   • **THE REPLICA IDENTITY.** `channel_launch_directives_replica_identity_idx`
--     is the table's REPLICA IDENTITY USING INDEX. Adding a column is safe and
--     changes nothing about it; DROPPING that index would leave the table at
--     replica identity NOTHING and every UPDATE on a published table would then
--     FAIL — which here means claim and decide both stop working. It is not
--     named below and must not be.
--   • **RLS.** The single owner-only SELECT policy already covers every column;
--     a new column inherits it. There is no write policy to widen.
--   • **COLUMN GRANTS.** This table GRANTs no column list — `authenticated`/`anon`
--     read whole rows through the owner-only policy and every server read is
--     service-role. Adding a per-column belt here would be a second, weaker
--     statement of a fence that is already whole-row.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The two columns, nullable, no default:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='channel_launch_directives'
--      and column_name in ('template_id','template_name');
--
--   -- 2. The FK is SET NULL, and it is covered by an index:
--   select conname, confdeltype from pg_constraint
--    where conrelid = 'public.channel_launch_directives'::regclass
--      and contype = 'f';
--   -- expect 'n' (SET NULL) for the agent_templates one
--   select indexname from pg_indexes
--    where tablename='channel_launch_directives'
--      and indexdef like '%(template_id)%';
--
--   -- 3. The CHECK admits SEVEN words and NOT 'template-approval':
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'channel_launch_directives_refusal_reason_check';
--
--   -- 4. THE BEHAVIOUR, which the catalog cannot confirm: an MCP
--   --    op="launch_agent" naming a template the OPERATOR cannot see comes back
--   --    REFUSED with the no-template sentence; naming an ambiguous NAME is
--   --    refused BEFORE any row is written, listing every match.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   -- In a NEW migration, and the CHECK must be narrowed BEFORE the desktop
--   -- producer is reverted, never after — the reverse order strands rows nothing
--   -- can write. Drop the two columns and re-add the six-word column check under
--   -- its original name. Written as PROSE rather than as commented-out SQL
--   -- because `dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes
--   -- this directory WITHOUT stripping comments, and a commented-out DDL
--   -- statement reads to that parser as a real one.

-- ===========================================================================
-- 1. THE PAIR. Additive, nullable, no default.
-- ===========================================================================

-- ⚠ `ON DELETE SET NULL`, mirroring `task_id`: a deleted template leaves the
-- directive STANDING and template-less. `template_name` beside it is what makes
-- that state legible (E-4, see the header).
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS template_id UUID
    REFERENCES public.agent_templates(id) ON DELETE SET NULL;

-- ⚠ A SNAPSHOT OF THE NAME AT CREATE TIME. Never joined, never refreshed. NULL
-- here means "no template was named"; NON-NULL beside a NULL `template_id` means
-- "the template was deleted after this directive was filed" and the desktop
-- REFUSES rather than launching blank.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS template_name TEXT;

-- ⚠ SHAPE ONLY, NEVER A REFERENCE — the same four clauses as
-- `agent_templates_name_charset_check` at the same length, and the mirror is
-- load-bearing for the same reason `channel_sessions.template_name`'s is: a name
-- that is LEGAL on a template must never be refusable into this row, or a
-- legitimate launch 500s the orchestrator instead of running.
-- ⚠ It is bounded at all because the name is OPERATOR-AUTHORED FREE TEXT that
-- reaches an MCP result (the ambiguity list) and a desktop prompt. A newline in
-- your own result can forge a line in your own result.
ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_template_name_charset_check
  CHECK (
    template_name IS NULL OR (
      char_length(template_name) BETWEEN 1 AND 120
      AND template_name = btrim(template_name)
      AND template_name !~ '[[:cntrl:]]'
      AND template_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

COMMENT ON COLUMN public.channel_launch_directives.template_id IS
  'The agent template this directive asks to run as, resolved under the ORCHESTRATOR''s visibility at create. SET NULL on template delete — read it beside template_name: a NULL id with a live name is a DELETION and the desktop refuses (no-template), not a blank launch.';

COMMENT ON COLUMN public.channel_launch_directives.template_name IS
  'Name of the named template, SNAPSHOTTED AT CREATE. Deliberately not an FK and never re-read — it is the only signal that survives ON DELETE SET NULL on template_id (spec E-4).';

-- ===========================================================================
-- 2. THE FK COVER. Not optional.
-- ===========================================================================
-- The table's own rule (`20260805120000`): an index exists only if a statement
-- uses it — AND AN FK CASCADE COUNTS AS ONE. `20260802180000_add_missing_fk_
-- indexes.sql` exists to keep the uncovered-FK count at ZERO; without this, a
-- template DELETE would sequential-scan the whole directive table to null out
-- its references.
CREATE INDEX IF NOT EXISTS channel_launch_directives_template_idx
  ON public.channel_launch_directives (template_id);

-- ===========================================================================
-- 3. THE SEVENTH WORD. Widen the refusal CHECK — and ONLY by one word.
-- ===========================================================================
-- ⚠ A column CHECK is named `<table>_<column>_check` by Postgres, so the drop
-- and the re-add below use the ONE name the four TypeScript files already cite.
-- Re-added under the same name so `pg_get_constraintdef` stays the thing to read.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_refusal_reason_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_refusal_reason_check
  CHECK (
    refusal_reason IS NULL OR refusal_reason IN (
      'cap', 'busy', 'no-sdk', 'auth-hold', 'no-bridge', 'no-counterparty',
      -- ⚠ THE SEVENTH, 2026-08-22 (agent templates). The directive named a
      -- template the OPERATOR's machine could not resolve: DELETED, or not
      -- visible to THEM though visible to the orchestrator that named it. ONE
      -- answer for both, deliberately — the resolve endpoint is 404-never-403
      -- so the difference is not observable, and a vocabulary that split them
      -- would rebuild the existence oracle the whole design closes.
      'no-template'
    )
  );

-- ===========================================================================
-- 4. Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_refusal_reason_check';

  IF def IS NULL THEN
    RAISE EXCEPTION
      'ABORT: the refusal_reason CHECK is gone — an unknown word could then be stored and rendered into an MCP result as itself';
  END IF;

  IF position('no-template' IN def) = 0 THEN
    RAISE EXCEPTION
      'ABORT: the refusal_reason CHECK does not admit no-template — the desktop resolve-at-claim producer shipped in this same wave and its first refusal would be a constraint violation';
  END IF;

  -- ⚠ THE NEGATIVE PIN, and it is the sharper of the two. `template-approval` is
  -- IPC-only (the renderer's first-use click on a FOREIGN template); the
  -- directive lane has no human, so it can never be produced here and must never
  -- be storable here.
  IF position('template-approval' IN def) > 0 THEN
    RAISE EXCEPTION
      'ABORT: template-approval reached the DIRECTIVE refusal vocabulary — it is the desktop-to-renderer word for a first-use approval click, and this lane has no human at the keyboard';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'channel_launch_directives'
       AND indexdef LIKE '%(template_id)%'
  ) THEN
    RAISE EXCEPTION
      'ABORT: template_id has no covering index — a template DELETE would scan the whole directive table to null its references';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_launch_directives'
       AND column_name IN ('template_id', 'template_name')
       AND (column_default IS NOT NULL OR is_nullable = 'NO')
  ) THEN
    RAISE EXCEPTION
      'ABORT: a template column carries a DEFAULT or NOT NULL — a directive that names no template must be able to say so as NULL on BOTH columns';
  END IF;

  -- The replica identity is not touched by this file; assert it survived anyway,
  -- because losing it makes every claim and every decide fail outright.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
     WHERE c.relname = 'channel_launch_directives' AND ix.indisreplident
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_launch_directives lost its REPLICA IDENTITY index — every UPDATE on a published table now fails, which is claim and decide';
  END IF;

  RAISE NOTICE
    'channel_launch_directives: template_id (FK, SET NULL) + template_name (snapshot) added, FK covered, refusal_reason CHECK widened to SEVEN words. template-approval is NOT one of them.';
END
$$;
