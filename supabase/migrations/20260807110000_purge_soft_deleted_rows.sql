-- ONE-TIME CLEANUP: hard-delete every soft-deleted row (soft-delete removal, §2b).
--
-- Why: deleting is now PERMANENT and IMMEDIATE (product decision 2026-08-07,
-- RETIREMENT-UNWIRING-PLAN §2b / D6). The Workspace Trash UI, the restore
-- affordances and the daily `/api/cron/purge-trash` retention sweep are all
-- gone from the codebase (`vercel.json` now carries three crons and none of
-- them is a purge), so for every table below EXCEPT `workflows` nothing will
-- ever produce a new tombstone and nothing is left that could reach an old one.
-- Those rows are unreachable garbage that would sit in the tables (and in every
-- index) forever. This sweeps them once.
--
-- ⚠ `workflows` IS THE ONE EXCEPTION, AND THIS MIGRATION IS DESTRUCTIVE THERE.
-- Workflows were deliberately left soft-deleting (D3: the `/api/workflows/**`
-- route handlers stay open because the MCP server reaches them over loopback),
-- so `GET /api/workflows/trash` and `POST /api/workflows/[id]/restore` are
-- still exported, still workspace-authed, and `packages/dopl-client` still
-- calls both. CONSEQUENCE, stated plainly: applying this empties that trash
-- listing and turns any pre-existing restore into a 404. That is accepted —
-- the workflows feature is retired from every user-facing AND agent-facing
-- surface (no page, no nav row, no registered MCP tool), so no user and no
-- agent can reach either endpoint; the only caller is a client method nothing
-- invokes. It is a live code path with no live caller, not a live feature.
-- If workflows are ever UN-retired, this is the paragraph to re-read first.
--
-- The `deleted_at` COLUMNS STAY. This is a data cleanup, not a schema teardown
-- — the read paths still carry their `deleted_at IS NULL` filters, which become
-- permanent no-ops once this runs but cost nothing and keep the diff small. A
-- later, separate migration may drop the columns, the partial indexes keyed on
-- them, and the now-unreferenced soft-delete/restore/purge RPCs.
--
-- IDEMPOTENT: every statement is `DELETE ... WHERE deleted_at IS NOT NULL`, so a
-- second run matches nothing and deletes nothing. Safe to re-apply.
--
-- ── Scope ───────────────────────────────────────────────────────────────────
--
-- INCLUDED: knowledge_entries, knowledge_folders, knowledge_bases,
-- ontology_objects, ontology_clusters, skills, workflows, chats.
--
-- `workflows` IS included deliberately, and it is the ONLY table here whose
-- trash still has code behind it — see the ⚠ paragraph at the top for the
-- consequence. Its tombstones are unreachable by any USER or AGENT (no page,
-- no nav row, no registered MCP tool) rather than by absence of an endpoint:
-- `src/app/api/workflows/trash/route.ts` and `[id]/restore/route.ts` are still
-- exported and still workspace-authed. The old plan's "keep purge-trash for
-- workflows" was written when MCP could still soft-delete them; MCP deletes
-- are now blocked outright, so nothing new lands in that trash either.
--
-- `channels` IS DELIBERATELY EXCLUDED, even though it has a `deleted_at`
-- column. That column is NOT a trash: it is the DM close/reopen mechanic
-- (`reviveChannel` / `reopenDirectChannel` in
-- `src/features/channels/server/service-writes.ts`) — closing a DM hides it,
-- and either side's next open revives the SAME row with its full history.
-- A tombstoned channel is therefore LIVE PRODUCT STATE, not garbage; purging
-- one would silently destroy a closed conversation's transcript for both
-- members. It has no trash listing, no restore endpoint, and was never in the
-- retention cron's table list either.
--
-- ── Ordering (FK-safe) ──────────────────────────────────────────────────────
--
-- Children before parents. Every child FK into these tables is ON DELETE
-- CASCADE except `knowledge_entries.folder_id -> knowledge_folders`, which is
-- ON DELETE SET NULL — that one is the trap, and step 1b handles it: deleting a
-- tombstoned folder would NULL its entries' `folder_id` instead of removing
-- them, RESURRECTING them at the base root. So every entry anywhere in a
-- tombstoned folder's subtree is deleted first, whatever its own `deleted_at`.
-- (Under the old cascade a trashed folder's descendants were all trashed too,
-- so this should be a no-op; it is written to be correct anyway rather than to
-- trust an invariant nothing enforces any more.)

DO $$
DECLARE
  v_entries          INTEGER;
  v_subtree_entries  INTEGER;
  v_folders          INTEGER;
  v_bases            INTEGER;
  v_objects          INTEGER;
  v_clusters         INTEGER;
  v_skills           INTEGER;
  v_workflows        INTEGER;
  v_chats            INTEGER;
BEGIN
  -- ── 1a. Knowledge entries: the tombstoned ones ────────────────────────────
  DELETE FROM knowledge_entries WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_entries = ROW_COUNT;

  -- ── 1b. Knowledge entries: anything under a tombstoned folder's subtree ───
  -- Recursive walk down `parent_id` from every tombstoned folder. `UNION` (not
  -- `UNION ALL`) dedupes and doubles as the cycle guard. Without this a live
  -- entry under a tombstoned ancestor would survive step 2 with a NULL
  -- `folder_id` and reappear at the base root.
  WITH RECURSIVE doomed_folders AS (
    SELECT id FROM knowledge_folders WHERE deleted_at IS NOT NULL
    UNION
    SELECT f.id
      FROM knowledge_folders f
      INNER JOIN doomed_folders d ON f.parent_id = d.id
  )
  DELETE FROM knowledge_entries e
   WHERE e.folder_id IN (SELECT id FROM doomed_folders);
  GET DIAGNOSTICS v_subtree_entries = ROW_COUNT;

  -- ── 2. Knowledge folders ──────────────────────────────────────────────────
  -- Descendant folders cascade via the self-referential
  -- `parent_id ... ON DELETE CASCADE` FK.
  DELETE FROM knowledge_folders WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_folders = ROW_COUNT;

  -- ── 3. Knowledge bases ────────────────────────────────────────────────────
  -- Remaining folders/entries (and embeddings + cluster links) cascade via
  -- `knowledge_base_id ... ON DELETE CASCADE`.
  DELETE FROM knowledge_bases WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_bases = ROW_COUNT;

  -- ── 4. Ontology objects ───────────────────────────────────────────────────
  -- `ontology_memberships` (parent + child) and `ontology_relationships`
  -- (source + target) all cascade.
  DELETE FROM ontology_objects WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_objects = ROW_COUNT;

  -- ── 5. Ontology clusters ──────────────────────────────────────────────────
  -- Objects first (step 4) because `ontology_memberships.cluster_id` cascades:
  -- dropping the cluster first would take the membership rows with it.
  DELETE FROM ontology_clusters WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_clusters = ROW_COUNT;

  -- ── 6. Skills ─────────────────────────────────────────────────────────────
  -- The SKILL.md body lives in columns on this row (F-029); `skill_versions`,
  -- `skill_events` and `workflow_skills` cascade.
  DELETE FROM skills WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_skills = ROW_COUNT;

  -- ── 7. Workflows ──────────────────────────────────────────────────────────
  -- `workflow_steps`, `workflow_step_edges`, `workflow_knowledge_bases` and
  -- `workflow_skills` cascade. Nothing FK-references `workflows.id` inward.
  DELETE FROM workflows WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_workflows = ROW_COUNT;

  -- ── 8. Chats ──────────────────────────────────────────────────────────────
  -- `chat_messages` cascade; the `chat_grants_cleanup` trigger drops team
  -- grants.
  DELETE FROM chats WHERE deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_chats = ROW_COUNT;

  RAISE NOTICE 'purge_soft_deleted_rows: knowledge_entries=% (+% under trashed folders), knowledge_folders=%, knowledge_bases=%, ontology_objects=%, ontology_clusters=%, skills=%, workflows=%, chats=% (channels deliberately untouched — DM close/reopen, not trash)',
    v_entries, v_subtree_entries, v_folders, v_bases,
    v_objects, v_clusters, v_skills, v_workflows, v_chats;
END
$$;
