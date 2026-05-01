-- Convert knowledge_bases (workspace_id, slug) UNIQUE from full-table to
-- partial-on-active. Audit slug-finding S-6 (= original audit #16).
--
-- Why: today the constraint is full-table UNIQUE, so a soft-deleted base
-- holds its slug for the entire 30-day trash window. A user who deletes
-- "notes" then creates a new one with the same name gets `notes-2` until
-- the cron purge runs. Knowledge folders + entries already use partial
-- unique indexes filtered on `deleted_at IS NULL` (migration
-- 20260501010000) — bring bases in line.
--
-- Effect: a trashed base's slug becomes immediately recyclable. The
-- service-layer slug check in `listBaseSlugsForWorkspace` is updated in
-- the same commit to filter `deleted_at IS NULL` so JS dedupe matches
-- the new DB rule.
--
-- Verified: zero active-row (workspace_id, slug) duplicates before the
-- partial-unique index is created.

-- 1. New partial-unique index on active rows.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_bases_workspace_slug_active_unique
  ON knowledge_bases (workspace_id, slug)
  WHERE deleted_at IS NULL;

-- 2. Drop the old full-table unique constraint. Order matters — keep
--    the new index live before dropping the old one so any in-flight
--    INSERT serializes against either.
ALTER TABLE knowledge_bases
  DROP CONSTRAINT IF EXISTS knowledge_bases_workspace_slug_unique;
