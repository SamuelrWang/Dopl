-- Drop the deprecated Knowledge Packs feature.
--
-- The knowledge-packs surface (the single 'rokid' pack) was a browse-only,
-- GitHub-synced index that never graduated past a proof of concept. The
-- whole feature is removed (removed 2026-07-18): the web-app API routes
-- (src/app/api/knowledge/packs), the sync engine (src/features/knowledge-packs),
-- the seed/verify scripts, and the MCP-server packs tool are all gone.
--
-- Tables removed:
--   knowledge_pack_files — parsed markdown files (FK → knowledge_packs, ON DELETE CASCADE)
--   knowledge_packs      — one row per installed vertical
--
-- knowledge_pack_files references knowledge_packs(id), so drop the child
-- table first. CASCADE + IF EXISTS keeps this teardown clean and re-runnable
-- (auto-removes RLS policies, indexes, and constraints). Neither table was
-- in the supabase_realtime publication, so no ALTER PUBLICATION is needed.

DROP TABLE IF EXISTS public.knowledge_pack_files CASCADE;
DROP TABLE IF EXISTS public.knowledge_packs      CASCADE;
