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

-- 4. Storage: objects, bucket-scoped policies, then the bucket itself.
DELETE FROM storage.objects WHERE bucket_id = 'chat-attachments';

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

DELETE FROM storage.buckets WHERE id = 'chat-attachments';
