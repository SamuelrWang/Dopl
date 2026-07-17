-- Publish the ontology, chats, and skill-versions tables to
-- supabase_realtime so an MCP agent's writes surface live in the web UI
-- (mirroring how knowledge_* / skills / workflow_* already stream).
--
-- Realtime postgres_changes runs under the subscriber's auth and respects
-- RLS, so each of these tables already carries a member/owner SELECT
-- policy that scopes events to rows the user may read:
--   ontology_*      -> *_member_select (is_workspace_member .. 'viewer')
--   chats           -> chats_owner_select + chats_member_select (team-aware)
--   chat_messages   -> chat_messages_select (via parent chat visibility)
--   chat_folders    -> chat_folders_owner_select (folders are personal;
--                      non-owners never see them — the correct scope)
--   skill_versions  -> skill_versions_member_select (.. 'viewer')
--
-- No REPLICA IDENTITY change: like the knowledge_* / skills / workflow_*
-- publications, the client re-fetches through its filtered service on any
-- change rather than consuming the row payload, so DELETE events only need
-- to signal "something changed" (the canvas_panels precedent set FULL only
-- because that client keyed rows off the DELETE payload).
--
-- Publications don't support `IF NOT EXISTS` on ADD TABLE, so guard each
-- table with the pg_publication_tables check (same idempotent pattern as
-- 20260716220000_drop_canvas_tables); to_regclass keeps it safe to run in
-- an environment where a table was renamed/removed.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ontology_clusters',
    'ontology_objects',
    'ontology_memberships',
    'ontology_relationships',
    'chats',
    'chat_messages',
    'chat_folders',
    'skill_versions'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = tbl
       ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl
      );
    END IF;
  END LOOP;
END
$$;
