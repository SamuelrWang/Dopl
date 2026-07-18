-- Chats soft-delete + export write-path hardening (audit follow-ups).
--
-- Bundles the chat write-path fixes from the 2026-07-17 MCP audit, in the
-- same spirit as 20260707190000_chats_hardening.sql (which bundled folder
-- uniqueness + the atomic transcript RPCs):
--
-- 1. Soft delete (F-11). `chats.deleted_at` turns the destructive delete
--    into a recoverable one, mirroring knowledge_bases. Deleted chats stop
--    appearing in active reads (the service filters `deleted_at IS NULL`)
--    but stay restorable from trash. Messages are reached THROUGH their
--    chat, so filtering on `chats.deleted_at` is sufficient — chat_messages
--    gets no deleted_at column. A partial index keeps the common
--    active-only scans off the trashed rows.
-- 2. Atomic export create (F-12). The create path was a header INSERT
--    followed by a separate messages INSERT: a mid-write failure (e.g. a
--    stray null byte) left an orphan header row with 0 messages.
--    chat_create_with_messages does both in ONE function body (one
--    transaction) so a failed transcript write rolls the header back — no
--    orphans. Re-export (the row already exists) reconciles messages
--    non-destructively in the service (upsert by position), so it needs no
--    orphan guard.
--
-- Functions are called by the service layer as service_role only.

ALTER TABLE chats ADD COLUMN deleted_at TIMESTAMPTZ;

-- Active-chat scans (list, folder counts, ownership lookups) only ever want
-- the live rows; a partial index keeps trash out of the hot path.
CREATE INDEX chats_active_workspace_idx
  ON chats (workspace_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION chat_create_with_messages(
  p_chat JSONB,
  p_messages JSONB
) RETURNS chats
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_chat chats;
BEGIN
  -- Header + transcript in one transaction: if the message insert raises
  -- (bad payload, constraint, connection loss) the header insert unwinds
  -- with it, so a failed export never leaves a 0-message orphan.
  INSERT INTO chats (
    workspace_id, owner_id, folder_id, client_session_id,
    visibility, access_mode, title, overview, source, project,
    format, session_date, deliverables, learnings, exported_at
  ) VALUES (
    (p_chat->>'workspace_id')::UUID,
    (p_chat->>'owner_id')::UUID,
    (p_chat->>'folder_id')::UUID,
    p_chat->>'client_session_id',
    COALESCE(p_chat->>'visibility', 'private'),
    COALESCE(p_chat->>'access_mode', 'workspace'),
    p_chat->>'title',
    COALESCE(p_chat->>'overview', ''),
    COALESCE(p_chat->>'source', 'other'),
    p_chat->>'project',
    COALESCE(p_chat->>'format', 'summarized'),
    COALESCE((p_chat->>'session_date')::DATE, CURRENT_DATE),
    COALESCE(p_chat->'deliverables', '[]'::JSONB),
    COALESCE(p_chat->'learnings', '[]'::JSONB),
    COALESCE((p_chat->>'exported_at')::TIMESTAMPTZ, now())
  )
  RETURNING * INTO v_chat;

  INSERT INTO chat_messages (chat_id, workspace_id, position, role, summary, verbatim)
  SELECT v_chat.id, v_chat.workspace_id, t.ord::INTEGER,
         t.msg->>'role', t.msg->>'summary', t.msg->>'verbatim'
  FROM jsonb_array_elements(p_messages) WITH ORDINALITY AS t(msg, ord);

  RETURN v_chat;
END;
$$;

REVOKE EXECUTE ON FUNCTION chat_create_with_messages(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
