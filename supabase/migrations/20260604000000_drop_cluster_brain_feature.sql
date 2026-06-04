-- Drop the cluster "brain" feature.
--
-- The cluster brain (a per-cluster synthesized instruction body +
-- memory store) has been removed from the application. Clusters remain
-- as pure groupings of entries; they no longer carry a synthesized
-- brain/skill body or memories.
--
-- This drops the three brain tables, their trigger/function, RLS
-- policies (via CASCADE), realtime publication membership, and reverts
-- the canvas_panels.panel_type CHECK to drop 'cluster-brain'.
--
-- A reverse migration that recreates everything at its final shape is
-- archived at ~/Desktop/dopl-artifacts/brain/schema/reinstate.sql.
--
-- Every statement is guarded (IF EXISTS / conditional DO) so the
-- migration is safe across environments — including the prod DB where
-- `published_cluster_brains` exists with no source migration.

-- ── 1. Realtime: drop ONLY the two brain tables from the publication ──
-- `clusters` was added to supabase_realtime by 20260419 and is
-- load-bearing for cluster-grouping realtime (rename/delete). Leave it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname='supabase_realtime' AND tablename='cluster_brain_memories')
  THEN ALTER PUBLICATION supabase_realtime DROP TABLE cluster_brain_memories; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname='supabase_realtime' AND tablename='cluster_brains')
  THEN ALTER PUBLICATION supabase_realtime DROP TABLE cluster_brains; END IF;
END $$;

-- ── 2. Trigger + function ──────────────────────────────────────────
DROP TRIGGER  IF EXISTS cluster_brains_version_bump ON cluster_brains;
DROP FUNCTION IF EXISTS bump_cluster_brain_version();

-- ── 3. Delete orphan brain panels BEFORE reverting the CHECK ───────
-- Existing 'cluster-brain' rows would fail validation when the new
-- constraint (which excludes 'cluster-brain') is added.
DELETE FROM canvas_panels WHERE panel_type = 'cluster-brain';

-- ── 4. Drop the tables (CASCADE removes RLS, indexes, FKs, replica) ─
-- published_cluster_brains first (FK to published_clusters only);
-- memories before brains (memories FK -> brains).
DROP TABLE IF EXISTS published_cluster_brains CASCADE;
DROP TABLE IF EXISTS cluster_brain_memories   CASCADE;
DROP TABLE IF EXISTS cluster_brains           CASCADE;

-- ── 5. Revert canvas_panels.panel_type CHECK (drop 'cluster-brain') ─
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;
ALTER TABLE canvas_panels ADD CONSTRAINT canvas_panels_panel_type_check
  CHECK (panel_type IN (
    'entry','chat','connection','browse',
    'knowledge','skills','knowledge-base','skill','artifact'
  ));
