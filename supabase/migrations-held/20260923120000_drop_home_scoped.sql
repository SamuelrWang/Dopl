-- DROP `home_scoped` — THE PERSONAL SHELF IS A TENANCY, NOT A COLUMN
-- (2026-09-02, wave B slice B15, Samuel's rulings B10 + B11).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY HAS NEVER RUN** (Docker was down for all of
-- wave A and all of wave B). Deploy state is a MEASUREMENT: re-derive with
-- `supabase migration list` / the MCP `list_migrations`, and **JOIN ON THE
-- NAME** — `20260823150000` applied as `20260823205007`, so a filename prefix is
-- not an applied version (INVARIANTS §12, F-304). Every batch-1 and batch-2
-- migration is pending ahead of this one; apply them in filename order.
--
-- ═══ 🔒 TWO PRECONDITIONS, AND NEITHER IS OPTIONAL ══════════════════════════
--
-- **P1 — `20260920120000_workspace_kind_personal.sql` HAS RUN.** Its §5 is a
-- ONE-TIME move of every `home_scoped` row into its author's `kind='personal'`
-- container. This file's §1 RAISEs rather than trusting that, and the assertion
-- is the whole reason the drop is safe: after the column goes there is no marker
-- left, so a row still sitting on a shared workspace's shelf would become an
-- ordinary workspace row — visible to every member of a workspace its author
-- filed as private, with nothing anywhere that could notice.
--
-- **P2 — `TENANCY_PERSONAL_CONTAINER` HAS BEEN DEFAULT-ON FOR A FULL RELEASE,
-- AND THE CODE OF THIS SLICE IS DEPLOYED.** ⚠ **THIS IS THE ORDERING TRAP AND IT
-- IS NOT THE SAME AS P1.** §5's move ran ONCE; the flag is what decided where
-- personal writes LAND afterwards. There is therefore a window — containers
-- minted, flag still off — in which every new personal write went to the shared
-- workspace with `home_scoped = true`, and §1 below is exactly what refuses to
-- drop the column while any of those exist. **Turn the flag on, let it run one
-- release, then apply this file.** Once it is applied the flag has nothing left
-- to decide: `shared/tenancy/personal-container.ts` no longer reads it, a
-- personal write lands in the container or REFUSES, and `personalWriteWorkspaceId`
-- has no fallback to strand a row in.
--
-- ⚠ **P1's OWN PRECONDITION (F-564) IS SEPARATE AND STILL APPLIES.** The gate is
-- `npx vitest run src/features/workspaces/home-channel-derivation.test.ts`;
-- `copy-target.ts` left that map in this slice, and `service-resolve-ref.ts ›
-- tenancyLabel` — never on it, because the boolean hid the defect — is fixed in
-- the same commit.
--
-- ═══ ROLLBACK ═══════════════════════════════════════════════════════════════
--
--   ALTER TABLE public.knowledge_bases ADD COLUMN IF NOT EXISTS home_scoped BOOLEAN NOT NULL DEFAULT false;
--   ALTER TABLE public.agent_templates ADD COLUMN IF NOT EXISTS home_scoped BOOLEAN NOT NULL DEFAULT false;
--   UPDATE public.knowledge_bases k SET home_scoped = true
--     FROM public.workspaces p WHERE p.id = k.workspace_id AND p.kind = 'personal';
--   UPDATE public.agent_templates t SET home_scoped = true
--     FROM public.workspaces p WHERE p.id = t.workspace_id AND p.kind = 'personal';
--
-- ⚠ **THE ROLLBACK IS LOSSLESS ONLY BECAUSE THE CONTAINER CARRIES THE FACT.**
-- After P1 and P2 "personal" IS "lives in a `kind='personal'` container", so the
-- boolean can be recomputed exactly. That equivalence is what this file is
-- deleting a redundant copy of — and it is why §1 must hold before the drop,
-- not after.
--
-- Idempotent: `DROP COLUMN IF EXISTS`, and §1's assertion passes trivially once
-- the columns are gone (`to_regclass`-style guards on the column itself).

-- ── 1. 🔒 THE ASSERTION — no personal row is left outside a container ────────
--
-- ⚠ It runs against the COLUMN, so it is skipped once the drop has happened;
-- a re-run of this file is a no-op rather than a failure.
DO $$
DECLARE
  stranded BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'knowledge_bases'
       AND column_name = 'home_scoped'
  ) THEN
    EXECUTE $q$
      SELECT count(*) FROM public.knowledge_bases k
       WHERE k.home_scoped IS TRUE
         AND NOT EXISTS (
           SELECT 1 FROM public.workspaces p
            WHERE p.id = k.workspace_id AND p.kind = 'personal'
         )
    $q$ INTO stranded;
    IF stranded > 0 THEN
      RAISE EXCEPTION
        'drop_home_scoped: % knowledge_bases still carry home_scoped=true outside a personal container. Dropping the column would publish them to their workspace. Run 20260920120000 section 5 again, and check TENANCY_PERSONAL_CONTAINER has been on long enough that no newer personal write landed in a shared workspace.',
        stranded;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'agent_templates'
       AND column_name = 'home_scoped'
  ) THEN
    EXECUTE $q$
      SELECT count(*) FROM public.agent_templates t
       WHERE t.home_scoped IS TRUE
         AND NOT EXISTS (
           SELECT 1 FROM public.workspaces p
            WHERE p.id = t.workspace_id AND p.kind = 'personal'
         )
    $q$ INTO stranded;
    IF stranded > 0 THEN
      RAISE EXCEPTION
        'drop_home_scoped: % agent_templates still carry home_scoped=true outside a personal container. See the knowledge_bases branch above for the remedy.',
        stranded;
    END IF;
  END IF;
END $$;

-- ── 2. The column ───────────────────────────────────────────────────────────
--
-- ⚠ NO INDEX TO DROP, and that is a fact re-read out of the two migrations that
-- added the column rather than assumed: both say "NO INDEX, AND THE REASON IS
-- THE READ SHAPE" in as many words. A `DROP COLUMN` cascade would have taken one
-- silently, which is why this is stated instead of left to the reader.
ALTER TABLE public.knowledge_bases DROP COLUMN IF EXISTS home_scoped;
ALTER TABLE public.agent_templates DROP COLUMN IF EXISTS home_scoped;
