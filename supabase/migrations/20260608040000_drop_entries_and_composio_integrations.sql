-- ============================================================================
-- Drop the entries / setups library + ingestion, and the Composio integrations
-- ============================================================================
-- Removes the entire ingested-setups feature (entries + browse/search + builder
-- + community) and the Composio third-party integration subsystem.
--
-- PRESERVED (do not touch): the MCP-server OAuth provider tables
--   oauth_clients, oauth_authorization_codes, mcp_tokens, rate_limit_events.
--
-- A backup that recreates everything dropped here lives in
--   ~/Desktop/dopl-artifacts/{entries-ingestion,composio-integrations}/schema/reinstate.sql
-- ============================================================================

-- ── 1. Entries + dependents (FK graph rooted at entries) ────────────────────
DROP TABLE IF EXISTS published_cluster_panels CASCADE;
DROP TABLE IF EXISTS cluster_forks            CASCADE;
DROP TABLE IF EXISTS published_clusters       CASCADE;
DROP TABLE IF EXISTS cluster_panels           CASCADE;
DROP TABLE IF EXISTS writeback_audits         CASCADE;
DROP TABLE IF EXISTS ingestion_logs           CASCADE;
DROP TABLE IF EXISTS sources                  CASCADE;
DROP TABLE IF EXISTS tags                     CASCADE;
DROP TABLE IF EXISTS chunks                   CASCADE;
DROP TABLE IF EXISTS entries                  CASCADE;

-- ── 2. canvas_panels: drop the entry column + 'entry'/'browse' panel types ──
DELETE FROM canvas_panels WHERE panel_type IN ('entry', 'browse');
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_entry_id_fkey;
ALTER TABLE canvas_panels DROP COLUMN IF EXISTS entry_id;
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;
ALTER TABLE canvas_panels ADD CONSTRAINT canvas_panels_panel_type_check
  CHECK (panel_type = ANY (ARRAY[
    'chat'::text, 'connection'::text, 'knowledge'::text, 'skills'::text,
    'knowledge-base'::text, 'skill'::text, 'artifact'::text
  ]));

-- ── 3. Entries / community RPCs + the ingestion_tier enum ───────────────────
DROP FUNCTION IF EXISTS search_entries(vector, double precision, integer, text[], text, text, uuid[], uuid);
DROP FUNCTION IF EXISTS search_published_clusters(vector, double precision, integer, text);
DROP FUNCTION IF EXISTS create_cluster_with_entries(uuid, uuid, text, text, uuid[]);
DROP TYPE IF EXISTS ingestion_tier;

-- ── 4. Composio third-party integrations ────────────────────────────────────
DROP TABLE IF EXISTS oauth_connection_grants CASCADE;
DROP TABLE IF EXISTS oauth_connections       CASCADE;
