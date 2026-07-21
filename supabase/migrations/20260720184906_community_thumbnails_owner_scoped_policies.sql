-- Scope the public 'community-thumbnails' storage bucket to owner paths (M-3).
--
-- These four storage.objects policies exist in NO migration (dashboard drift).
-- Their write policies gate only on `auth.uid() IS NOT NULL`, so ANY authenticated
-- user can insert to / overwrite / delete ANY object in the bucket, including
-- another user's thumbnails. Uploads are stored under `{user_id}/{file}` (see the
-- account-deletion cleanup in src/app/api/user/delete/route.ts, which lists
-- `user.id` and removes `${user.id}/${f.name}`), so the owner is the first path
-- segment. Recreate the write policies scoped to that segment; keep SELECT public
-- because community thumbnails are meant to be publicly readable.
--
-- Purely a security tightening (no schema/data change, no backfill). The
-- 'workspace-icons' bucket was inspected and has NO storage.objects policies at
-- all (its icon.ts writes go through the service-role admin client, which bypasses
-- RLS), so it has no equivalent drift and is intentionally left untouched.

DROP POLICY IF EXISTS thumbnails_read_public ON storage.objects;
DROP POLICY IF EXISTS thumbnails_upload_own  ON storage.objects;
DROP POLICY IF EXISTS thumbnails_update_own  ON storage.objects;
DROP POLICY IF EXISTS thumbnails_delete_own  ON storage.objects;

-- Public read: community thumbnails are publicly viewable.
CREATE POLICY thumbnails_read_public ON storage.objects
  FOR SELECT
  USING (bucket_id = 'community-thumbnails');

-- Write only within your own `{auth.uid()}/...` prefix.
CREATE POLICY thumbnails_upload_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'community-thumbnails'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY thumbnails_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'community-thumbnails'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'community-thumbnails'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY thumbnails_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-thumbnails'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
