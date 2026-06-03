-- Workspace icon image: lets a workspace carry an uploaded avatar that
-- replaces the default brand mark in the sidebar switcher, the dropdown
-- header, and every workspace row. Two parts:
--   1. An `icon_url` column on `workspaces` holding the public URL of the
--      uploaded image (NULL = fall back to a generated letter avatar).
--   2. A public-read storage bucket `workspace-icons` that holds the
--      actual files. Uploads/cleanup run server-side through the service
--      role (admin client), gated by the workspace admin-role check in the
--      route. The bucket's `public` flag is enough to serve object URLs to
--      the browser — no `storage.objects` SELECT policy is added (a broad
--      one would let clients list every file; see Supabase linter 0025).

-- 1. Column
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS icon_url text;

-- 2. Storage bucket (public read of object URLs; all writes via service role)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-icons',
  'workspace-icons',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;
