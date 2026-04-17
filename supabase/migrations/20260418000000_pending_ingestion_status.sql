-- Add the `pending_ingestion` entry status.
--
-- Site-chat URL pastes now create a skeleton row with
-- status='pending_ingestion' (amber tile on the canvas/entries list). The
-- user's connected MCP agent picks them up on its next tool call via the
-- _dopl_status footer the MCP server attaches to every tool response.
--
-- `entries.status` is a loose TEXT column (no enum, no CHECK), so nothing
-- schema-level has to change to accept the new value. We still want:
--   1. A partial index so the MCP footer's "count pending for this user"
--      query stays O(pending_rows_for_user) instead of O(entries).
--   2. `entries` in the supabase_realtime publication so the canvas amber
--      tile can flip live when the agent claims it.

-- ── 1. Partial index ─────────────────────────────────────────────────
-- Hit on every MCP tool response (per-user, cached 5s in the MCP
-- client). Partial keeps it tiny: only rows currently in the pending
-- state contribute.
CREATE INDEX IF NOT EXISTS entries_pending_ingestion_idx
  ON entries (ingested_by, created_at DESC)
  WHERE status = 'pending_ingestion';

-- ── 2. Realtime publication ──────────────────────────────────────────
-- Idempotent: pg_publication_tables already has the row if entries is
-- already published, so we only add it when missing. Protects against
-- the migration failing on existing DBs where the base schema already
-- enabled realtime for this table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE entries;
  END IF;
END$$;
