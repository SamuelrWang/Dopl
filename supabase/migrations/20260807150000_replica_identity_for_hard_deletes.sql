-- Make HARD deletes propagate over Realtime — by putting `workspace_id` into the
-- DELETE's replica identity, at 32 bytes per row instead of the whole row.
--
-- ── THE BUG, AND WHY THIS RELEASE IS WHAT EXPOSED IT ────────────────────────────
-- Both postgres_changes consumers bind the same shape, for every content table:
--   { event: '*', schema: 'public', table, filter: `workspace_id=eq.${wsId}` }
-- (`src/shared/realtime/shared-channel-registry.ts` for the web + SPA hooks,
-- `dopl-desktop-app/main/ui-sync.js` for the desktop's one UI feed.)
--
-- A subscription `filter` is evaluated against the columns Postgres put in the WAL
-- record. For an INSERT or an UPDATE that is the new tuple — every column — so
-- `workspace_id` is there and the filter matches. For a DELETE there is no new
-- tuple: the only columns in the record are the table's REPLICA IDENTITY, and under
-- `DEFAULT` that is the primary key alone. `knowledge_entries` and friends are all
-- `DEFAULT` (verified below), so a DELETE's record is `{id}`, the filter names a
-- column that is not in it, and the frame is dropped server-side. **No filtered
-- subscriber has ever received a DELETE on any of these tables.**
--
-- That was invisible until now because nothing produced real DELETEs. Every
-- user-facing delete was an UPDATE stamping `deleted_at`, which ships a full new
-- tuple and matches the filter — so the doorbell rang and the client refetched.
-- `20260717000000_realtime_ontology_chats_skill_versions.sql:15-20` reasoned
-- explicitly that no REPLICA IDENTITY change was needed because "DELETE events only
-- need to signal 'something changed'". That was TRUE and is now FALSE: the
-- soft-delete/trash retirement in this same release turns every one of those
-- UPDATEs into a real `DELETE FROM`. Net effect without this migration: the channel
-- SOFT delete still propagates live, and every HARD delete does not. Two windows on
-- one workspace, delete a KB / entry / skill / chat in one — the other keeps showing
-- it until a manual refetch, then 404s on click.
--
-- ── VERIFIED, NOT INFERRED (2026-08-07, against prod) ───────────────────────────
-- This repo has been wrong about Realtime delivery semantics before, so the two
-- load-bearing claims were checked against the DEPLOYED code rather than upstream
-- docs — which matters, because upstream `walrus` master and what is deployed here
-- (`realtime.schema_migrations` max = 20260709120000) DO NOT AGREE on this function.
--
--   1. The deployed `realtime.is_visible_through_filters` returns FALSE, not true,
--      when the filter column is absent from the record. Called directly:
--        select realtime.is_visible_through_filters(
--          null::realtime.wal_column[],   -- the DELETE shape: no new tuple
--          array[row('workspace_id','eq','<uuid>',false)::realtime.user_defined_filter]
--        );                                          -- => f
--      (Upstream master `coalesce(..., true)`s that same case to TRUE. Reading the
--      public source instead of this database would have produced the opposite
--      diagnosis and no fix at all.)
--
--   2. The deployed `realtime.apply_rls` DOES give DELETE a second chance against
--      the identity columns — this is exactly the seam this migration widens:
--        and (
--            realtime.is_visible_through_filters(columns, subs.filters)
--            or ( action = 'DELETE'
--                 and realtime.is_visible_through_filters(old_columns, subs.filters) )
--        )
--      `old_columns` is built from `wal -> 'identity'`, i.e. the replica identity.
--      Put `workspace_id` in there and the DELETE is delivered, correctly scoped.
--
-- Replica identity of the 17 published tables at time of writing: every one is `d`
-- (DEFAULT) except `channel_consent_requests`, which is `f` — set by
-- `20260727130000_consent_replica_identity_full.sql` for its own reason (live UPDATE
-- delivery of the consent card). The three tables this repo previously set to FULL
-- for DELETE payloads — `canvas_panels`, `canvas_edges`, `cluster_brains` — have all
-- since been dropped, so that precedent survives only in the migration history.
--
-- ── WHY `USING INDEX` AND NOT `FULL` ────────────────────────────────────────────
-- `REPLICA IDENTITY FULL` would also work, and it is what this repo reached for
-- twice before. It is the wrong instrument here, and the reason is that its cost
-- lands on the wrong operation entirely: FULL logs the ENTIRE OLD ROW on every
-- UPDATE as well as every DELETE. We need two columns, on deletes, and would be
-- paying for every column, on writes that were never broken.
--
-- The tables where users most need delete-propagation are also the widest and the
-- most UPDATE-heavy in the system, so this is not a hypothetical:
--   • `knowledge_entries` — 1303 B/row in heap plus a TOASTed `body`, plus a STORED
--     `search_tsv tsvector` that would ride in the old image too. The doc editor
--     autosaves every 1500 ms (`components/doc-pane.tsx:20`), and
--     `ExtractReplicaIdentity` must DETOAST external attributes to build a FULL old
--     image — so FULL turns each autosave into a detoast plus a full-body WAL write.
--   • `skills` — 3397 B/row, the widest of the 17, and UPDATE-heavy (the SKILL.md
--     body is columns on this row).
-- It compounds inside the poller as well: `apply_rls` runs
-- `has_column_privilege(role, entity, c.name, 'SELECT')` once per column per role
-- over `old_columns`. FULL takes that loop from 1 column to ~15 on the hottest
-- table in the publication — and `realtime.list_changes` is the function F-094
-- Residual 3 measured at 2,968,450 calls / 386.6 min of prod exec time. The two
-- migrations dated YESTERDAY (`20260807000000`, `20260807100000`) trimmed the
-- publication 24 -> 17 tables on precisely that argument. Shipping a WAL and decode
-- amplification on every autosave, one day later, to fix a delete bug, would undo
-- more than it repairs.
--
-- `REPLICA IDENTITY USING INDEX` puts EXACTLY the columns we need in the WAL and
-- nothing else: `(workspace_id, id)`, two uuids, 32 bytes. Versus DEFAULT's 16
-- (`id` alone) that is +16 bytes per UPDATE/DELETE and one extra column in the
-- privilege loop. No detoast. No row body. Nothing changes for INSERTs, which
-- replica identity does not affect at all.
--
-- A THIRD OPTION WAS REJECTED and is worth recording, because it looks cheaper than
-- it is: bind DELETE separately with NO filter and discriminate client-side. It
-- needs no DDL, but (a) it cannot work — `apply_rls` redacts a DELETE's `old_record`
-- to primary keys whenever RLS is enabled (`and ( not is_rls_enabled or (c).is_pkey )
-- -- if RLS enabled, we can't secure deletes so filter to pkey`), so the client
-- receives `{id}` and has nothing to discriminate ON; and (b) RLS is not evaluated
-- for DELETE at all (`if not is_rls_enabled or action = 'DELETE' then` — the
-- subscription is admitted unconditionally), so an unfiltered DELETE binding would
-- deliver every workspace's deletions to every subscriber in the project. That is a
-- refetch storm and a cross-tenant disclosure of row ids and deletion timing. It is
-- not a cheaper version of this migration; it is a different, worse product.
--
-- ── WHICH TABLES, AND WHY THE OTHER SIX ARE DELIBERATELY LEFT ALONE ─────────────
-- A table needs its own DELETE doorbell only when a user-visible delete produces NO
-- other filtered event a subscriber would already see. Eleven do. Six do not, and
-- staying lean on them is the same discipline as the publication trim:
--   • `skill_versions`  — cascades from `skills` (covered), and its OTHER delete is
--     the 200-version retention trim that runs INLINE AFTER EVERY VERSION INSERT
--     (`skills/server/history.ts:150`). That is the highest-frequency delete of the
--     17 by a wide margin and no user ever observes it. Publishing it would be pure
--     churn — the exact trade this migration exists to avoid.
--   • `chat_messages`   — cascade from `chats` only (the live merge path is a pure
--     upsert); the `chats` delete is the doorbell. Wide rows, INSERT-heavy.
--   • `channel_messages`— cascade from `channels` / `workspaces` only.
--   • `agent_presence`  — never deleted; heartbeat-UPDATEd every 30 s per client.
--   • `channels`        — still SOFT-deletes (`repository.ts:246`), so its delete is
--     an UPDATE and already propagates. Revisit WITH that table's hard-delete.
--   • `channel_consent_requests` — cascade-only, and already FULL, so it already
--     satisfies the invariant below by the other route.
--
-- ── COST OF THE INDEXES, STATED PLAINLY ────────────────────────────────────────
-- Eleven new unique btrees on two uuids. They are not dead weight: `(workspace_id,
-- id)` is a prefix-superset of the plain `(workspace_id)` index four of these tables
-- already carry (`knowledge_entries_workspace_idx`,
-- `knowledge_folders_workspace_idx`, `ontology_memberships_workspace_idx`,
-- `ontology_relationships_workspace_idx`), which serve the ubiquitous
-- `where workspace_id = $1` scan and become droppable as a follow-up — deliberately
-- NOT dropped here, because dropping an index is a separate decision with its own
-- rollback and this file should be revertible in one line per table.
-- HOT updates are preserved: neither `workspace_id` nor `id` is ever modified, and
-- an index is only de-optimising for HOT when an indexed column changes.
-- Built non-CONCURRENTLY on purpose — Supabase runs migrations in a transaction and
-- CONCURRENTLY cannot, and the largest of these tables holds 396 rows, so the brief
-- write lock is measured in microseconds. Re-check that before reusing this shape on
-- a table that has since grown.
--
-- ── THIS FILE MUST STAY AFTER 20260807110000, AND THAT IS NOT COSMETIC ─────────
-- `20260807110000_purge_soft_deleted_rows.sql` hard-deletes every tombstone left by
-- the soft-delete retirement — one DELETE per soft-deleted row, across most of these
-- tables, in a single sweep. It sorts BEFORE this file, so that sweep runs while the
-- tables are still at DEFAULT and emits no deliverable frames. Reorder the two (or
-- re-run the purge after this lands) and every connected client takes the whole
-- backlog as doorbells and refetches once per table per 250 ms coalescing window.
-- Nothing breaks permanently, but it is a self-inflicted thundering herd on the
-- exact database this workstream is trying to unload.
--
-- ── WHAT BREAKS IF THIS IS WRONG, AND HOW LOUD IT IS ────────────────────────────
-- Every statement is metadata: no rows, columns, policies, grants or triggers are
-- touched, and publication membership is untouched (all eleven are already
-- published — this migration neither adds nor removes anything there).
-- Two failure modes, and they are not equally loud:
--   • QUIET — if `wal2json` did not emit the index columns under `identity`, deletes
--     would simply keep not propagating: the same symptom as today, no error. The
--     "Verify after applying" block below is not optional for that reason.
--   • LOUD — `REPLICA IDENTITY USING INDEX` REQUIRES the index to keep existing.
--     Dropping one leaves the table at replica identity NOTHING, and every UPDATE
--     and DELETE on a published table then FAILS outright. That is why the indexes
--     are named `*_replica_identity_idx`: the name is the warning. A future
--     migration that needs to replace one must set the table back to DEFAULT first,
--     drop, recreate, and re-point — in that order.
-- `dopl-desktop-app/test/ui-sync-tables.test.mjs` pins the INVARIANT rather than the
-- mechanism — "a table bound with a `workspace_id` filter that must deliver DELETEs
-- has a replica identity carrying `workspace_id`" — so FULL and USING INDEX both
-- satisfy it and a future migration cannot quietly return one of these to DEFAULT.
--
-- No client change ships with this. Both subscribers already treat an event as a
-- pure doorbell and already forward a DELETE whose payload names no workspace (the
-- `old_record` stays PK-only under RLS even now — see the rejected option above);
-- `ui-sync.js:140` `shouldForward` and its test at `test/ui-sync.test.mjs:198-202`
-- were written for exactly this frame and have simply never received one.

-- ── knowledge ──────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_bases_replica_identity_idx
  ON public.knowledge_bases (workspace_id, id);
ALTER TABLE public.knowledge_bases
  REPLICA IDENTITY USING INDEX knowledge_bases_replica_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_folders_replica_identity_idx
  ON public.knowledge_folders (workspace_id, id);
ALTER TABLE public.knowledge_folders
  REPLICA IDENTITY USING INDEX knowledge_folders_replica_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_entries_replica_identity_idx
  ON public.knowledge_entries (workspace_id, id);
ALTER TABLE public.knowledge_entries
  REPLICA IDENTITY USING INDEX knowledge_entries_replica_identity_idx;

-- ── skills (the `skills` row itself; `skill_versions` stays DEFAULT — see above) ─
CREATE UNIQUE INDEX IF NOT EXISTS skills_replica_identity_idx
  ON public.skills (workspace_id, id);
ALTER TABLE public.skills
  REPLICA IDENTITY USING INDEX skills_replica_identity_idx;

-- ── ontology ───────────────────────────────────────────────────────────────────
-- All four: a cluster or object delete goes through `cascade_hard_delete_cluster` /
-- `cascade_hard_delete_object`, and `replaceRelationshipsForSource` deletes and
-- reinserts edges. The reinsert covers most relationship edits, but removing the
-- LAST edge from a source is a delete with no accompanying insert — and memberships
-- are how an object leaves a cluster without being deleted. Both rows are narrow.
CREATE UNIQUE INDEX IF NOT EXISTS ontology_clusters_replica_identity_idx
  ON public.ontology_clusters (workspace_id, id);
ALTER TABLE public.ontology_clusters
  REPLICA IDENTITY USING INDEX ontology_clusters_replica_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ontology_objects_replica_identity_idx
  ON public.ontology_objects (workspace_id, id);
ALTER TABLE public.ontology_objects
  REPLICA IDENTITY USING INDEX ontology_objects_replica_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ontology_memberships_replica_identity_idx
  ON public.ontology_memberships (workspace_id, id);
ALTER TABLE public.ontology_memberships
  REPLICA IDENTITY USING INDEX ontology_memberships_replica_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ontology_relationships_replica_identity_idx
  ON public.ontology_relationships (workspace_id, id);
ALTER TABLE public.ontology_relationships
  REPLICA IDENTITY USING INDEX ontology_relationships_replica_identity_idx;

-- ── chats ──────────────────────────────────────────────────────────────────────
-- `chat_messages` is deliberately absent: it only loses rows by cascade from
-- `chats`, and this `chats` entry is that cascade's doorbell.
CREATE UNIQUE INDEX IF NOT EXISTS chats_replica_identity_idx
  ON public.chats (workspace_id, id);
ALTER TABLE public.chats
  REPLICA IDENTITY USING INDEX chats_replica_identity_idx;

CREATE UNIQUE INDEX IF NOT EXISTS chat_folders_replica_identity_idx
  ON public.chat_folders (workspace_id, id);
ALTER TABLE public.chat_folders
  REPLICA IDENTITY USING INDEX chat_folders_replica_identity_idx;

-- ── channels ───────────────────────────────────────────────────────────────────
-- Members only. `channel_members` has a COMPOSITE primary key (channel_id, user_id)
-- and no `id` column of its own, so its identity index is (workspace_id, channel_id,
-- user_id) — the same rule, spelled for this table's key.
CREATE UNIQUE INDEX IF NOT EXISTS channel_members_replica_identity_idx
  ON public.channel_members (workspace_id, channel_id, user_id);
ALTER TABLE public.channel_members
  REPLICA IDENTITY USING INDEX channel_members_replica_identity_idx;

-- Verify after applying:
--   -- Eleven rows read 'i'; channel_consent_requests still 'f'; the other five
--   -- published tables still 'd'.
--   SELECT c.relname, c.relreplident
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname IN (
--     SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime')
--   ORDER BY 2, 1;
--
--   -- The identity really is the pair (this is what the filter reads on DELETE).
--   SELECT c.relname, i.relname AS identity_index,
--          (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
--             FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord)
--             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum) AS identity_cols
--   FROM pg_index ix
--   JOIN pg_class c ON c.oid = ix.indrelid
--   JOIN pg_class i ON i.oid = ix.indexrelid
--   WHERE ix.indisreplident ORDER BY 1;
--
--   -- THE ACTUAL BEHAVIOUR, which the catalog cannot confirm: open two windows on
--   -- one workspace, delete a knowledge entry in one, and watch the other drop it
--   -- without a reload. If it does not, the quiet failure mode above is the one
--   -- that happened and this migration should be reverted, not iterated on blind.
--
--   -- Cost check, a day later: the poller's call/time should be flat, not up.
--   SELECT calls, total_exec_time FROM pg_stat_statements
--   WHERE query LIKE '%realtime.list_changes%';
--
-- ROLLBACK is one line per table — `ALTER TABLE public.<t> REPLICA IDENTITY DEFAULT;`
-- — in a NEW migration, and it must come BEFORE any drop of the matching index (see
-- the LOUD failure above). Reverting restores today's behaviour exactly: hard deletes
-- stop propagating and every other event keeps working, which is precisely the state
-- this file was written to end. The statements are described rather than written out
-- because `test/ui-sync-tables.test.mjs` regexes this directory WITHOUT stripping
-- comments, and a commented-out `ALTER TABLE ... REPLICA IDENTITY DEFAULT` would read
-- to that parser as a real revert and silently defeat the invariant it pins — the
-- same hazard `20260807000000` and `20260807100000` record for their own rollbacks.
