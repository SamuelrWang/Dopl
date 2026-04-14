-- 022_community_thumbnails_bucket.sql — Storage bucket for community thumbnails

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'community-thumbnails',
  'community-thumbnails',
  true,
  5242880,  -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "thumbnails_upload_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'community-thumbnails'
    AND auth.uid() IS NOT NULL
  );

-- Public read for all thumbnails
CREATE POLICY "thumbnails_read_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'community-thumbnails');

-- Owners can update/delete their uploads
CREATE POLICY "thumbnails_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'community-thumbnails'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "thumbnails_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'community-thumbnails'
    AND auth.uid() IS NOT NULL
  );
