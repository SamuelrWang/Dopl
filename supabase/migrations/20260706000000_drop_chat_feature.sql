-- Drop the in-app chat feature.
--
-- The product is MCP-first: the user's own agent drives the workspace via
-- packages/mcp-server + /api/mcp. The in-app chat (Anthropic-key-backed
-- chat panels, conversations, attachments) has been removed from the app;
-- this migration removes its database footprint.
--
-- 1. Remove chat panels from every canvas.
-- 2. Redefine the canvas_panels panel_type CHECK without 'chat'
--    (mirrors src/features/canvas/types.ts and the VALID_PANEL_TYPES
--    allow-list in src/app/api/canvas/panels/route.ts).
-- 3. Drop the conversations + chat_attachments tables (their RLS
--    policies drop with them).
-- 4. Remove the chat-attachments storage bucket, its objects, and any
--    storage.objects policies scoped to it.

-- 1. Chat panels off the canvas.
DELETE FROM canvas_panels WHERE panel_type = 'chat';

-- 2. panel_type allow-list without 'chat'.
ALTER TABLE canvas_panels DROP CONSTRAINT IF EXISTS canvas_panels_panel_type_check;
ALTER TABLE canvas_panels ADD CONSTRAINT canvas_panels_panel_type_check
  CHECK (panel_type = ANY (ARRAY[
    'connection','knowledge','skills','knowledge-base','skill',
    'artifact','node','workflow'
  ]::text[]));

-- 3. Chat tables (policies, indexes, and FKs drop with the tables).
DROP TABLE IF EXISTS chat_attachments CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;

-- 4. Storage: the chat-attachments bucket never existed in this project
--    (verified when this was applied, 2026-07-07), and Supabase's
--    storage.protect_delete() forbids direct table deletes anyway.
--    Sweep any stray bucket-scoped policies only.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') LIKE '%chat-attachments%'
        OR COALESCE(with_check, '') LIKE '%chat-attachments%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- The bucket row delete has to opt out of storage.protect_delete, the
-- very guard named four lines up: it is a BEFORE DELETE ... FOR EACH
-- STATEMENT trigger, so it fires and aborts even when the DELETE matches
-- zero rows — which is always, per that note. Left unguarded, this line
-- makes a from-scratch `supabase db reset` impossible on any current
-- storage-api image (SQLSTATE 42501). set_config's third argument scopes
-- the opt-out to this DO block's transaction; the guard is untouched
-- everywhere else. Behaviour in production is unchanged (still 0 rows).
DO $$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.buckets WHERE id = 'chat-attachments';
END $$;
