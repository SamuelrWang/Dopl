-- Cover the unindexed FK columns on knowledge_* tables.
-- Audit slug-finding S-19; supabase advisor `unindexed_foreign_keys`
-- flagged 6 columns. Without covering indexes:
--   - cascade-deletes on auth.users / knowledge_folders / knowledge_bases
--     fall back to a sequential scan
--   - JOINs / filters by these FKs (e.g. "everything created_by user X")
--     can't use an index lookup
--
-- All six are CREATE INDEX IF NOT EXISTS so this migration is idempotent
-- and a re-run on a fresh environment is harmless. None are partial —
-- the FK columns are nullable but the active-row partial-index gain is
-- minor relative to FK-cascade scans which need every row.

CREATE INDEX IF NOT EXISTS knowledge_bases_created_by_idx
  ON knowledge_bases (created_by);

CREATE INDEX IF NOT EXISTS knowledge_folders_created_by_idx
  ON knowledge_folders (created_by);

CREATE INDEX IF NOT EXISTS knowledge_folders_parent_id_idx
  ON knowledge_folders (parent_id);

CREATE INDEX IF NOT EXISTS knowledge_entries_created_by_idx
  ON knowledge_entries (created_by);

CREATE INDEX IF NOT EXISTS knowledge_entries_last_edited_by_idx
  ON knowledge_entries (last_edited_by);

CREATE INDEX IF NOT EXISTS knowledge_entries_folder_id_idx
  ON knowledge_entries (folder_id);
