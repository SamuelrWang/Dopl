-- Add `post_text` to the allowed `sources.source_type` values.
--
-- The ingestion refactor renamed the body-text extractor's output from
-- `tweet_text` to `post_text`. The old name was misleading — text.ts
-- runs against any primary-URL body content (GitHub README text, blog
-- post bodies, tweet text, etc.), not just tweets. The rename landed
-- in the TypeScript union and the deployed backend, but missed the
-- parallel DB check constraint — so every ingest attempt with body
-- text now fails at the `sources` insert with a 23514 violation.
--
-- Fix: drop the constraint and recreate it with the full canonical
-- set including `post_text`. Keep `tweet_text` in the list so existing
-- rows written before the rename remain valid (they're just legacy
-- labels — no code reads them apart from rendering).

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_source_type_check;

ALTER TABLE sources ADD CONSTRAINT sources_source_type_check
  CHECK (source_type IN (
    'post_text',              -- body text extracted from primary source (all platforms)
    'tweet_text',              -- legacy: pre-refactor body-text rows
    'tweet_thread',
    'image',
    'code_screenshot',
    'architecture_diagram',
    'blog_post',
    'github_repo',
    'github_file',
    'instagram_post',
    'reddit_post',
    'other'
  ));
