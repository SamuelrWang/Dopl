-- Move clusters' unique slug index from (user_id, slug) → (workspace_id, slug).
-- Audit slug-finding S-2.
--
-- Background: the JS service in `features/clusters/server/service.ts`
-- dedupes new cluster slugs against the workspace's existing slugs
-- (`.eq("workspace_id", scope.workspaceId)`). The DB index, however,
-- lives on `(user_id, slug)` from before the workspace overhaul. Mismatch
-- means a user with two workspaces creating clusters with the same name
-- in each passes the JS dedupe and 23505s at INSERT.
--
-- This brings clusters in line with every other workspace-scoped
-- resource (canvases, knowledge_bases) and matches what the JS already
-- assumes. Verified zero existing collisions on (workspace_id, slug)
-- before applying.

-- 1. Create the new workspace-scoped unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clusters_workspace_slug
  ON clusters (workspace_id, slug);

-- 2. Drop the old user-scoped one. A non-unique (user_id) index is kept
--    by the existing FK on user_id (Supabase auto-indexes FKs), so
--    cluster lookups by owner stay fast.
DROP INDEX IF EXISTS idx_clusters_user_slug;
