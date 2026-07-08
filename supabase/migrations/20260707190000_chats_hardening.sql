-- Chats hardening (review follow-ups to 20260707170000_chats.sql).
--
-- 1. Case-insensitive folder uniqueness. Folder resolution is
--    case-insensitive (agents pass names), so the unique constraint
--    must be too — otherwise "Notes" + "notes" can coexist and the
--    ilike lookup errors on multiple rows, 500ing every export that
--    names the folder.
-- 2. Atomic transcript writes. Replace was delete-then-insert and
--    append was read-max-then-insert — both non-atomic across requests:
--    a failure mid-replace destroyed the transcript, and concurrent
--    appends raced to a unique violation. Both now run inside one
--    function (single transaction) serialized per chat via FOR UPDATE
--    on the chats row.
--
-- Functions are called by the service layer as service_role only.

ALTER TABLE chat_folders
  DROP CONSTRAINT chat_folders_workspace_id_user_id_name_key;

CREATE UNIQUE INDEX chat_folders_ci_name_key
  ON chat_folders (workspace_id, user_id, lower(name));

CREATE OR REPLACE FUNCTION chat_replace_messages(
  p_chat_id UUID,
  p_workspace_id UUID,
  p_messages JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  added INTEGER;
BEGIN
  PERFORM 1 FROM chats WHERE id = p_chat_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat % not found in workspace %', p_chat_id, p_workspace_id;
  END IF;

  DELETE FROM chat_messages WHERE chat_id = p_chat_id;

  INSERT INTO chat_messages (chat_id, workspace_id, position, role, summary, verbatim)
  SELECT p_chat_id, p_workspace_id, t.ord::INTEGER, t.msg->>'role', t.msg->>'summary', t.msg->>'verbatim'
  FROM jsonb_array_elements(p_messages) WITH ORDINALITY AS t(msg, ord);
  GET DIAGNOSTICS added = ROW_COUNT;

  UPDATE chats SET updated_at = now() WHERE id = p_chat_id;
  RETURN added;
END;
$$;

CREATE OR REPLACE FUNCTION chat_append_messages(
  p_chat_id UUID,
  p_workspace_id UUID,
  p_messages JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  base INTEGER;
  added INTEGER;
BEGIN
  PERFORM 1 FROM chats WHERE id = p_chat_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat % not found in workspace %', p_chat_id, p_workspace_id;
  END IF;

  SELECT COALESCE(MAX(position), 0) INTO base FROM chat_messages WHERE chat_id = p_chat_id;

  INSERT INTO chat_messages (chat_id, workspace_id, position, role, summary, verbatim)
  SELECT p_chat_id, p_workspace_id, base + t.ord::INTEGER, t.msg->>'role', t.msg->>'summary', t.msg->>'verbatim'
  FROM jsonb_array_elements(p_messages) WITH ORDINALITY AS t(msg, ord);
  GET DIAGNOSTICS added = ROW_COUNT;

  UPDATE chats SET updated_at = now() WHERE id = p_chat_id;
  RETURN base + added;
END;
$$;

REVOKE EXECUTE ON FUNCTION chat_replace_messages(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION chat_append_messages(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
