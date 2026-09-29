-- DROP `home_scoped` — THE HOME SHELF IS A TENANCY, NOT A COLUMN
-- (2026-09-02, wave B slice B15, Samuel's rulings B10 + B11).
--
-- Released 2026-09-29 (Samuel: apply the safe drops).
--
-- Written as 20260923120000; re-stamped after 20261023120000_home_vocabulary_rename.sql
-- because §1 asserts kind 'home'. §1 RAISEs while any home_scoped row sits outside
-- a kind='home' container: dropping the column there would publish that row to
-- its whole workspace, with no marker left to notice.
--
-- ═══ ROLLBACK ═══════════════════════════════════════════════════════════════
--
--   ALTER TABLE public.knowledge_bases ADD COLUMN IF NOT EXISTS home_scoped BOOLEAN NOT NULL DEFAULT false;
--   ALTER TABLE public.agent_identities ADD COLUMN IF NOT EXISTS home_scoped BOOLEAN NOT NULL DEFAULT false;
--   UPDATE public.knowledge_bases k SET home_scoped = true
--     FROM public.workspaces p WHERE p.id = k.workspace_id AND p.kind = 'home';
--   UPDATE public.agent_identities t SET home_scoped = true
--     FROM public.workspaces p WHERE p.id = t.workspace_id AND p.kind = 'home';
--
-- ⚠ **THE ROLLBACK IS LOSSLESS ONLY BECAUSE THE CONTAINER CARRIES THE FACT.**
-- "home" IS "lives in a `kind='home'` container" (20260920120000 §5), so the
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
  tbl TEXT;
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
            WHERE p.id = k.workspace_id AND p.kind = 'home'
         )
    $q$ INTO stranded;
    IF stranded > 0 THEN
      RAISE EXCEPTION
        'drop_home_scoped: % knowledge_bases still carry home_scoped=true outside a home space. Dropping the column would publish them to their workspace. Run 20260920120000 section 5 again, and check TENANCY_HOME_SPACE has been on long enough that no newer personal write landed in a shared workspace.',
        stranded;
    END IF;
  END IF;

  -- Either name: this file sorts before 20261019's agent_templates -> agent_identities rename.
  FOREACH tbl IN ARRAY ARRAY['agent_templates', 'agent_identities'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = tbl
         AND column_name = 'home_scoped'
    ) THEN
      EXECUTE format($q$
        SELECT count(*) FROM public.%I t
         WHERE t.home_scoped IS TRUE
           AND NOT EXISTS (
             SELECT 1 FROM public.workspaces p
              WHERE p.id = t.workspace_id AND p.kind = 'home'
           )
      $q$, tbl) INTO stranded;
      IF stranded > 0 THEN
        RAISE EXCEPTION
          'drop_home_scoped: % % rows still carry home_scoped=true outside a home space. See the knowledge_bases branch above for the remedy.',
          stranded, tbl;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ── 2. The column ───────────────────────────────────────────────────────────
--
-- ⚠ NO INDEX TO DROP, and that is a fact re-read out of the two migrations that
-- added the column rather than assumed: both say "NO INDEX, AND THE REASON IS
-- THE READ SHAPE" in as many words. A `DROP COLUMN` cascade would have taken one
-- silently, which is why this is stated instead of left to the reader.
ALTER TABLE IF EXISTS public.knowledge_bases DROP COLUMN IF EXISTS home_scoped;
ALTER TABLE IF EXISTS public.agent_templates DROP COLUMN IF EXISTS home_scoped;
ALTER TABLE IF EXISTS public.agent_identities DROP COLUMN IF EXISTS home_scoped;
