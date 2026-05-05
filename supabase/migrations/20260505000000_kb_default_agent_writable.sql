-- Default knowledge bases to agent-writable.
--
-- Context: the per-base `agent_write_enabled` column was originally the
-- write gate for agent-origin mutations. Real access is now governed by
-- the workspace member matrix (`requireResourceAccess` in
-- `src/features/knowledge/server/service.ts`); the column is no longer
-- consulted, but it still drives UI badges + MCP tool messaging. With
-- the column at `false`, every base shows up as "(read-only for agents)"
-- even though writes succeed — pure UX noise.
--
-- This migration:
--   1. Flips existing active rows to `true` so badges/messages reflect
--      the actual access state.
--   2. Changes the column default to `true` so any future direct insert
--      (e.g. a script or a path bypassing the service) matches the
--      service's new default (`createBase` already passes `true`).
--
-- Soft-deleted rows are left as-is — they're not surfaced anywhere.

ALTER TABLE knowledge_bases
  ALTER COLUMN agent_write_enabled SET DEFAULT true;

UPDATE knowledge_bases
   SET agent_write_enabled = true
 WHERE agent_write_enabled = false
   AND deleted_at IS NULL;
