-- Workflow soft-delete (audit F-11, workflow half).
--
-- Why: `delete_workflow` was a HARD physical DELETE — the row plus its
-- steps/edges/junctions vanished via ON DELETE CASCADE with no recovery.
-- Bring workflows in line with knowledge_bases / skills / ontology_clusters,
-- which all soft-delete (a nullable `deleted_at`) and expose trash + restore.
--
-- Steps (workflow_steps) and edges (workflow_step_edges) are ALWAYS fetched
-- via their parent workflow, so filtering reads on `workflows.deleted_at`
-- is sufficient — those tables do NOT get their own `deleted_at`. Restore
-- simply clears the workflow's timestamp and its steps/edges reappear.

-- 1. The soft-delete tombstone (NULL = live, timestamp = trashed).
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. Active-row browse index (mirrors knowledge_bases_workspace_active_idx):
--    the common `list` path filters `workspace_id` + `deleted_at IS NULL`.
CREATE INDEX IF NOT EXISTS workflows_workspace_active_idx
  ON workflows (workspace_id) WHERE deleted_at IS NULL;

-- 3. Slug uniqueness must apply to LIVE rows only, so a trashed workflow's
--    slug is immediately recyclable (a user who deletes "pipeline" then
--    re-creates it should get "pipeline", not "pipeline-2"). Same conversion
--    knowledge_bases got in 20260501070000: partial-unique-on-active
--    replaces the full-table unique index. Order matters — create the new
--    index before dropping the old one so any in-flight INSERT serializes
--    against either.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_workspace_slug_active
  ON workflows (workspace_id, slug) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_workflows_workspace_slug;
