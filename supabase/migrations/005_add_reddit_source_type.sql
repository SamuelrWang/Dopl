-- Add 'reddit_post' to the sources.source_type CHECK constraint.
-- Drop the existing constraint and recreate with the new value.

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_source_type_check;

ALTER TABLE sources ADD CONSTRAINT sources_source_type_check
  CHECK (source_type IN (
    'tweet_text', 'tweet_thread', 'image', 'code_screenshot',
    'architecture_diagram', 'blog_post', 'github_repo',
    'github_file', 'video_transcript', 'instagram_post',
    'reddit_post', 'other'
  ));
