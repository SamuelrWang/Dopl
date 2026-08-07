-- Trim `supabase_realtime` down to the tables something actually subscribes to.
--
-- WHY A PUBLICATION IS NOT FREE. Every published table is decoded out of the WAL
-- and RLS-evaluated by `realtime.list_changes` on every write, whether or not a
-- single client has ever subscribed to it. F-094 Residual 3 measured the shape on
-- prod `pg_stat_statements`: `realtime.list_changes` at 2,968,450 calls / 386.6 min
-- and the subscription-lookup query at 1,830,653 calls / 56.3 min. That poller runs
-- whenever ANY subscription is open, over whatever the publication happens to list —
-- so an unsubscribed table is pure amplification with no reader on the other end.
--
-- WHAT WAS AUDITED (2026-08-07). There are exactly three postgres_changes consumers
-- in the tree, and between them they name 22 tables:
--   1. THE FEATURE HOOKS — the 8 `useWorkspaceTablesRealtime` call sites
--      (CHANNEL_TABLES / CONSENT_TABLES / PRESENCE_TABLES in
--      `src/features/channels/constants.ts`, plus KNOWLEDGE_TABLES, ONTOLOGY_TABLES,
--      WORKFLOW_TABLES, SKILL_TABLES, CHAT_TABLES in each feature's
--      `client/realtime.ts`). These serve the web AND the bundled SPA, which imports
--      the same hooks and lets them no-op behind the desktop bridge.
--   2. `dopl-desktop-app/main/ui-sync.js` SYNC_TABLES — the desktop's live UI feed.
--      It is the UNION of (1) by construction, and `test/ui-sync-tables.test.mjs`
--      re-derives (1) from source on every run to keep it that way.
--   3. `dopl-desktop-app/main/realtime.js:303` — INSERTs on `channel_messages`,
--      which is already inside that union.
-- The publication held 24. The two names below are in none of the three.
--
-- ── `public.channel_agents` — WRITE-DEAD ────────────────────────────────────────
-- Published by `20260731120000_channel_agents.sql` so the web's agent chips could
-- render summon / rename / status live. The channels rollback (§1) deleted named
-- agents outright: `useChannelAgentsRealtime` is gone, `main/realtime-agents.js` is
-- gone, and `repository-agents.ts` is now ONE read and no writes at all. Nothing has
-- written the table since, so the publication entry cannot fire even in principle.
-- The binding left `SYNC_TABLES` on 2026-08-06; this is the server half of that.
-- THE TABLE STAYS — stored messages carry `metadata.author_agent_id` and resolve the
-- author's display name through it, so dropping the table is what would finally make
-- an old agent-authored message anonymous. That is a separate, later, and much
-- heavier decision (F-141 later-cleanup list, item (e)); this migration is item (c).
--
-- ── `public.clusters` — ALIVE BUT UNWATCHED ─────────────────────────────────────
-- Published by `20260419000000_realtime_canvas_brain.sql` "for canvas live updates".
-- The legacy canvas feature was deleted wholesale (ENGINEERING §2), and what is left
-- of `src/features/clusters/` is a schema, a slug helper and a server service — no
-- `client/` directory, no components, no hook. The table is genuinely live (cluster
-- CRUD writes it; `workflows/server/service-shared.ts:129` reads it), which is
-- exactly why this is worth stating: "in use" and "subscribed to" are different
-- questions, and only the second one justifies a publication entry. Churn is low
-- (F-094 measured 7 rows), so expect hygiene, not a step change.
--
-- ── WHAT BREAKS IF THIS IS WRONG, AND WHY IT BREAKS QUIETLY ─────────────────────
-- Un-publishing is NOT the same failure as dropping a table, and the difference is
-- the whole risk here. A postgres_changes binding on a table that does not EXIST is
-- refused at join, and Realtime refuses the WHOLE channel with it — one bad name
-- costs every other table's live updates, loudly, immediately (that is the
-- `skill_files` incident recorded in `main/ui-sync.js`). A binding on a table that
-- exists but is UNPUBLISHED is accepted: the channel goes SUBSCRIBED, the client
-- looks healthy, and no event ever arrives. So if either judgement above is wrong,
-- the symptom is not an error — it is a surface that silently stops updating until
-- someone reloads. `test/ui-sync-tables.test.mjs` therefore pins both names against
-- the bound set, so re-introducing a subscriber without re-publishing fails a test
-- rather than shipping.
--
-- ── WHAT RE-ADDING COSTS ────────────────────────────────────────────────────────
-- The SQL is a one-liner per table — an `ALTER PUBLICATION` ADD naming
-- `public.channel_agents` / `public.clusters`, in a NEW migration. The EFFECT is not
-- symmetric: postgres_changes has no replay, so every write that lands while a table
-- is out of the publication is unrecoverable — it is never decoded, never queued,
-- and cannot be backfilled by re-adding the table later. A subscriber that ships
-- after a re-add starts from the moment of the re-add and must reconcile the gap by
-- refetching (the desktop feed already does exactly this: a fresh SUBSCRIBED emits
-- one empty-table catch-up event meaning "you may have missed anything"). Re-adding
-- also does not restore anything about the table itself, because nothing about the
-- table is being changed here. Treat a re-add as "a subscriber is shipping now",
-- never as "undo".
--
-- ── NOT A TABLE DROP ────────────────────────────────────────────────────────────
-- Rows, columns, indexes, RLS policies, grants, triggers and replica identity on
-- both tables are untouched. No application code lands with this migration; nothing
-- in the tree reads the publication at runtime. Guarded + `IF EXISTS`-shaped so a
-- re-run, or an environment where one of these was never published, is a clean
-- no-op (house style, `20260419000000_realtime_canvas_brain.sql`).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'channel_agents'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.channel_agents;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'clusters'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.clusters;
  END IF;
END $$;

-- Verify after applying:
--   -- 22 rows, and neither `channel_agents` nor `clusters` is among them.
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' ORDER BY 1;
--
--   -- Live subscriptions must be IDENTICAL before and after: nothing ever
--   -- subscribed to either table, so a difference here means the audit was wrong.
--   SELECT entity::text, count(*) FROM realtime.subscription GROUP BY 1 ORDER BY 2 DESC;
--
-- THE ROLLBACK STATEMENTS ARE DELIBERATELY NOT WRITTEN OUT HERE, and that is not
-- tidiness. `test/ui-sync-tables.test.mjs` derives the publication by regexing every
-- file in this directory and it does NOT strip comments, so a commented-out
-- `ALTER PUBLICATION … ADD TABLE public.channel_agents` would read to that parser as
-- a real re-publish and quietly weaken the assertion that these two are out. The
-- precedent migration (`20260728010000_drop_channel_tasks_from_realtime.sql`) also
-- carries no rollback SQL, though it does not say why.
-- Rollback is the ADD form described above, in a new file,
-- and per that section it should only ever be written because a subscriber is
-- shipping — never as an undo.
