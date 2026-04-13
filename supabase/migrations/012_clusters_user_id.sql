-- Add user_id to clusters for per-user scoping.
-- Existing clusters keep NULL user_id (globally visible).
-- New MCP-created clusters get user_id for per-user isolation.

ALTER TABLE clusters ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_clusters_user_id ON clusters(user_id);

-- Replace global unique slug with per-user unique slug
DROP INDEX idx_clusters_slug;
CREATE UNIQUE INDEX idx_clusters_user_slug ON clusters(user_id, slug);
