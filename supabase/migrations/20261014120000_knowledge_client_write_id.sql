-- ════════════════════════════════════════════════════════════════════════════
-- AN IDEMPOTENCY KEY FOR KNOWLEDGE WRITES (S53, 2026-09-18)
--
-- The problem this closes, in one sentence: a `dopl_kb(op="write_file")` that
-- TIMED OUT left the agent with no way to ask whether the write landed, so the
-- documented recovery became "re-issue, and if it 412s pass force=true" — which
-- is a blind overwrite of whatever is there now, aimed by an agent that does not
-- know whether its own first write is the thing it is about to clobber.
--
-- Channels have had the answer since `20260725120000_channels.sql`: a caller-
-- supplied key, a PARTIAL UNIQUE INDEX, and a server-side probe that hands back
-- the FIRST result instead of writing a second row. Chats have `client_session_id`.
-- `dopl_kb` had neither. This is that contract, on the two knowledge writes an
-- agent can make: `write_file` (entries) and `create_base`.
--
-- ⚠ AUTHOR-SCOPED, AND THAT IS A VULNERABILITY FIX RATHER THAN A PREFERENCE —
-- the identical argument `20260822120000_channel_messages_author_scoped_idempotency.sql`
-- and `repository-artifacts.ts › findOwnArtifactByClientId` make. Scoped only to
-- the base, idempotency would be a contract with EVERYONE who can write there: a
-- member reusing a key another member's agent had just used would be handed back
-- THEIR entry, and told it was their own write converging.
--
-- ⚠ COLUMN ORDER IS DELIBERATE: (parent, client_write_id, client_write_by). The
-- probe always knows the parent and the key; the author is the narrowing. This is
-- the same order the channel indexes take, for the same reason.
--
-- ⚠ `client_write_by` NULL DEFEATS CONVERGENCE, AND THAT IS CORRECT. Postgres
-- treats NULLs as distinct in a unique index, so a write with no authenticated
-- user cannot converge on anything. Every MCP caller has one (`ctx.userId`); a
-- system write has no retry loop to protect.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Entries ──────────────────────────────────────────────────────────────
ALTER TABLE public.knowledge_entries
  ADD COLUMN IF NOT EXISTS client_write_id TEXT;
ALTER TABLE public.knowledge_entries
  ADD COLUMN IF NOT EXISTS client_write_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- ⚠ NOT `WHERE deleted_at IS NULL`: the soft delete is gone (`20261013120000`)
-- and app deletes are hard, so an active-row predicate would guard a state that
-- no longer exists.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_entries_client_write_idx
  ON public.knowledge_entries (knowledge_base_id, client_write_id, client_write_by)
  WHERE client_write_id IS NOT NULL;

COMMENT ON COLUMN public.knowledge_entries.client_write_id IS
  'Caller-supplied idempotency key for the LAST write to this row (S53). Scoped by (knowledge_base_id, client_write_by). A re-sent write converges on this row instead of upserting a second entry at the same path.';

-- ── 2. Bases ────────────────────────────────────────────────────────────────
ALTER TABLE public.knowledge_bases
  ADD COLUMN IF NOT EXISTS client_write_id TEXT;
ALTER TABLE public.knowledge_bases
  ADD COLUMN IF NOT EXISTS client_write_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- ⚠ SCOPED TO THE CONTAINER, not to a parent row: a base has no parent but its
-- workspace, and `create_base` is the call being made idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_bases_client_write_idx
  ON public.knowledge_bases (workspace_id, client_write_id, client_write_by)
  WHERE client_write_id IS NOT NULL;

COMMENT ON COLUMN public.knowledge_bases.client_write_id IS
  'Caller-supplied idempotency key for create_base (S53). Scoped by (workspace_id, client_write_by). A re-sent create returns the first base instead of minting a second.';
