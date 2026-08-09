-- Drop the five `workflow_*` tables from `supabase_realtime` — the server half of the
-- workflows feature retirement (docs/RETIREMENT-UNWIRING-PLAN.md Phase 5, decision D8).
--
-- WHY A PUBLICATION IS NOT FREE. Every published table is decoded out of the WAL and
-- RLS-evaluated by `realtime.list_changes` on every write, whether or not a single client
-- has ever subscribed to it. F-094 Residual 3 measured the shape on prod
-- `pg_stat_statements`: `realtime.list_changes` at 2,968,450 calls / 386.6 min and the
-- subscription-lookup query at 1,830,653 calls / 56.3 min. That poller runs whenever ANY
-- subscription is open, over whatever the publication happens to list — so an unsubscribed
-- table is pure amplification with no reader on the other end. This is the same argument
-- and the same measurement as `20260807000000_drop_unbound_tables_from_realtime.sql`; that
-- migration removed the tables nobody was bound to by accident, this one removes the five
-- a deliberate product decision just unbound.
--
-- WHAT CHANGED ON THE CLIENT SIDE, IN THIS SAME RELEASE. The workflows page is unrouted
-- (Phase 1 — the route rows, the sidebar entry and `WORKSPACE_HOME_PATH` all moved off it),
-- and Phase 5 took out the two subscribers that named these tables:
--   1. `src/features/workflows/client/realtime.ts` — `useWorkflowsRealtime` is now an inert
--      stub. The `WORKFLOW_TABLES` array literal is GONE, not emptied: it WAS the
--      subscription contract, and `dopl-desktop-app/test/ui-sync-tables.test.mjs` re-derives
--      the SPA's watched set by regexing these files, so a leftover literal would assert a
--      binding that no longer exists. Its only caller, `hooks/use-workflows.ts`, no longer
--      imports it — that hook is refetch-on-mount only now.
--   2. `dopl-desktop-app/main/ui-sync.js` SYNC_TABLES — the desktop's one live UI feed, the
--      UNION of (1) by construction. Five of its 22 bindings were these tables; it now
--      binds 17.
-- The third postgres_changes consumer, `dopl-desktop-app/main/realtime.js:303`, only ever
-- names `channel_messages`. So after this migration NOTHING in the tree subscribes to any
-- `workflow_*` table, and the publication is back in step with the bound set.
--
-- ── WHAT BREAKS IF THIS IS WRONG, AND WHY IT BREAKS QUIETLY ─────────────────────
-- Un-publishing is NOT the same failure as dropping a table, and the difference is the
-- whole risk here (R4 in the plan). A postgres_changes binding on a table that does not
-- EXIST is refused at join, and Realtime refuses the WHOLE channel with it — one bad name
-- costs every other table's live updates, loudly, immediately (the `skill_files` incident
-- recorded in `main/ui-sync.js`). A binding on a table that exists but is UNPUBLISHED is
-- accepted: the channel goes SUBSCRIBED, the client looks healthy, and no event ever
-- arrives. That is why this file and the two client edits above are ONE release and not
-- two — shipping the publication drop first would silently kill live updates on a page
-- that was still live, and shipping it never would leave five tables amplifying WAL for a
-- reader that no longer exists. `test/ui-sync-tables.test.mjs` pins both directions: it
-- fails if a `workflow_*` name comes back to a subscriber without a re-publish, and it
-- fails if anything published has no subscriber at all.
--
-- ── WHAT RE-ADDING COSTS (workflows are HIDDEN, not deleted) ────────────────────
-- The retirement is explicitly reversible on the code side — `src/features/workflows` stays
-- in the tree with three hard runtime importers (trash, seed-workspace, clusters) — so
-- unlike the two names in `20260807000000`, these five have a plausible route back. The SQL
-- for that is a one-liner per table — an `ALTER PUBLICATION` ADD naming `public.workflows`,
-- `public.workflow_steps`, `public.workflow_step_edges`, `public.workflow_knowledge_bases`
-- and `public.workflow_skills`, in a NEW migration — landing together with the restored
-- `WORKFLOW_TABLES` literal and the restored `SYNC_TABLES` entries.
-- The EFFECT is not symmetric, and calling a re-add an "undo" is the mistake to avoid:
-- postgres_changes has no replay, so every write that lands while a table is out of the
-- publication is unrecoverable — never decoded, never queued, not backfillable by re-adding
-- the table later. A subscriber that ships after a re-add starts from the moment of the
-- re-add and must reconcile the gap by refetching (the desktop feed already does exactly
-- this: a fresh SUBSCRIBED emits one empty-table catch-up event meaning "you may have
-- missed anything"). Treat a re-add as "a subscriber is shipping now", never as a revert.
--
-- ── NOT A TABLE DROP ────────────────────────────────────────────────────────────
-- Rows, columns, indexes, RLS policies, grants, triggers and replica identity on all five
-- tables are untouched, and the data stays per the plan's data decision (nothing FK-
-- references `workflows.id`; the join tables point outward). The server still reads and
-- writes every one of them — `workflows/server/repository.ts` for `workflows`,
-- `workflow_steps` and `workflow_step_edges`, `workflows/server/authoring-shared.ts` for
-- `workflow_knowledge_bases` and `workflow_skills` — through the API routes (left
-- functional, decision D3) and the trash/seed paths. Nothing in the tree reads the
-- publication at runtime. Guarded + `IF EXISTS`-shaped so a re-run, or an environment where
-- one of these was never published, is a clean no-op (house style,
-- `20260419000000_realtime_canvas_brain.sql`).
--
-- Published by `20260610200000_workflows.sql:133-135` (workflows,
-- workflow_knowledge_bases, workflow_skills — "realtime parity with the cluster junctions")
-- and `20260716210000_workflow_steps.sql:135-136` (workflow_steps, workflow_step_edges).

-- Five explicit guarded blocks rather than the FOREACH/`format('… %I')` loop the older
-- realtime migrations use: this file's whole job is to make five NAMES absent, and the
-- literal statements are what a `grep 'DROP TABLE'` over this directory — and the regex in
-- `test/ui-sync-tables.test.mjs` — reads without indirection. Same shape as the migration
-- this one is modelled on.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workflows'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflows;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workflow_steps'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflow_steps;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workflow_step_edges'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflow_step_edges;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workflow_knowledge_bases'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflow_knowledge_bases;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workflow_skills'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflow_skills;
  END IF;
END $$;

-- Verify after applying:
--   -- 17 rows, and no name starting with `workflow` is among them.
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' ORDER BY 1;
--
--   -- Live subscriptions: the workflow entities must be GONE, and every other entity's
--   -- count must be unchanged. A drop anywhere else means a client was sharing a channel
--   -- with these bindings and lost it — which would be this migration's only real blast
--   -- radius, and the client edits above are what rule it out.
--   SELECT entity::text, count(*) FROM realtime.subscription GROUP BY 1 ORDER BY 2 DESC;
--
--   -- The load claim, re-measured after a day: calls/time on the poller should fall
--   -- roughly in proportion to the write share these five tables carried.
--   SELECT calls, total_exec_time FROM pg_stat_statements
--   WHERE query LIKE '%realtime.list_changes%';
--
-- THE ROLLBACK STATEMENTS ARE DELIBERATELY NOT WRITTEN OUT HERE, and that is not tidiness.
-- `test/ui-sync-tables.test.mjs` derives the publication by regexing every file in this
-- directory and it does NOT strip comments, so a commented-out `ALTER PUBLICATION … ADD
-- TABLE public.workflows` would read to that parser as a real re-publish and quietly weaken
-- the assertion that these five are out. Same reasoning as `20260807000000`. Rollback is
-- the ADD form described above, in a new file, and per that section it should only ever be
-- written because a subscriber is shipping — never as an undo.
