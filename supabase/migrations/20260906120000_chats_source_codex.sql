-- =============================================================================
-- CHATS.SOURCE GAINS 'codex' — the runtime-adapter port's step 2.
--
-- ✅ APPLIED 2026-09-01 (linked project). ⚠ RE-DERIVE RATHER THAN TRUSTING THIS
-- LINE, and JOIN ON THE NAME (`chats_source_codex`), not the filename prefix —
-- it applied under a CLI-minted version stamp, the same F-304 pattern
-- `20260822150000_channel_sessions_telemetry.sql` records. The check is
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname='chats_source_check';
-- which returned the five-value ARRAY including 'codex' after applying.
--
-- ⚠ THIS COLUMN IS IMPORTED-CHAT PROVENANCE, NOT THE RUNTIME DRIVING A SESSION,
-- and the two are different concepts that a reader will otherwise fuse. `source`
-- says which client an ARCHIVED conversation was exported FROM (a chat somebody
-- ran in Claude Code, Claude Desktop, Cursor, or anywhere else and pushed into
-- the archive). WHICH RUNTIME IS DRIVING A LIVE DOPL SESSION is the desktop's
-- own `X-Dopl-Vendor` custody dimension and never crosses this table.
-- `cursor` has been a legal value here since the table shipped, for exactly that
-- reason: it named an export source long before any adapter existed. So this is
-- a chore that should ship anyway, not an adapter seam.
--
-- ⚠ ADDITIVE ONLY. The CHECK widens; no row changes and no default moves. The
-- five source declarations that restate this enum in TypeScript
-- (packages/mcp-server/src/tools/chats.ts, packages/dopl-client/src/chat-types.ts,
-- src/features/chats/{types,constants,schema}.ts) widen in the same change —
-- a value the database accepts and the SDK rejects is the drift this migration
-- would otherwise create.
-- =============================================================================

ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_source_check;

ALTER TABLE chats
  ADD CONSTRAINT chats_source_check
  CHECK (source IN ('claude-code', 'claude-desktop', 'codex', 'cursor', 'other'));
