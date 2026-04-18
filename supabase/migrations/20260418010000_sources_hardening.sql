-- Source-level dedup, status tracking, and audit columns.
--
-- Motivation: the ingestion walkthrough on heygen-com/hyperframes surfaced
-- three structural bugs in how extractors populate `sources`:
--   1. Same URL stored multiple times (platform extractor at depth 0 +
--      text extractor inline + link-follower at depth 1+). In-code
--      `visitedUrls` Set didn't dedup because it keyed on un-normalized
--      URLs, and nothing enforced uniqueness at the DB level.
--   2. Crawl garbage (404-page HTML bodies, S3 AccessDenied XML from 403
--      responses with 200 status codes) got silently stored as if it were
--      real content, poisoning the downstream prompt pipeline.
--   3. No way to audit what the extractor attempted but couldn't retrieve
--      — failed fetches were swallowed by try/catch without a trace,
--      giving the agent no hint that a page was missing from the corpus.
--
-- Fix: promote `sources` to a first-class audit log. Every extraction
-- attempt lands here with a status. Dedup is enforced by the DB, not the
-- application. The prepare response builds its `fetch_warnings` directly
-- off `status='failed'` rows so the agent sees what didn't make it.

-- ── 1. New columns ────────────────────────────────────────────────────

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS normalized_url text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS fetch_status_code int;

-- Constrain `status` to the three values the extractor can legitimately
-- emit. Unknown values should fail loud at insert time rather than
-- silently poisoning downstream filters.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sources_status_check'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_status_check
      CHECK (status IN ('ok', 'failed', 'skipped'));
  END IF;
END$$;

-- ── 2. Backfill ────────────────────────────────────────────────────────
-- Existing rows predate the refactor. Treat them as 'ok' (they went
-- through the old pipeline which only stored successful extractions) and
-- compute a plain-lowercase normalized_url for dedup.
--
-- The real normalizer (src/lib/ingestion/url.ts) also strips utm_*
-- params and trailing slashes, so freshly-inserted rows will have richer
-- normalization than legacy rows. Close enough — the unique index below
-- catches future duplicates; the one-shot dedup below clears legacy ones.
UPDATE sources
SET normalized_url = lower(url)
WHERE normalized_url IS NULL
  AND url IS NOT NULL;

-- ── 3. Dedup legacy rows ──────────────────────────────────────────────
-- The pre-refactor pipeline could write the same (entry_id, url) multiple
-- times (see heygen-com/hyperframes: github_repo at depth 0 + tweet_text
-- inline + github_repo at depth 1, all with the same URL). Creating the
-- unique index below would fail on any such entry.
--
-- Strategy: for each (entry_id, normalized_url) group with 2+ rows, keep
-- the lowest-depth row (the one the new pipeline would have chosen
-- first), break ties by earliest created_at (preserves the canonical
-- first extraction). Delete the rest. This is irreversible but only
-- touches rows that are strict duplicates — no real content is lost
-- because the kept row has the same URL's content at the same or lower
-- depth.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY entry_id, normalized_url
      ORDER BY depth ASC, created_at ASC
    ) AS rn
  FROM sources
  WHERE status = 'ok'
    AND normalized_url IS NOT NULL
)
DELETE FROM sources
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 4. Dedup enforcement ──────────────────────────────────────────────
-- Partial unique index: only applies to rows where we have a URL AND the
-- extraction succeeded. Failed/skipped rows and image-only rows (where
-- url IS NULL because content lives in storage_path) are exempt — those
-- can legitimately repeat for audit purposes.
CREATE UNIQUE INDEX IF NOT EXISTS sources_entry_normalized_url_ok_idx
  ON sources (entry_id, normalized_url)
  WHERE status = 'ok' AND normalized_url IS NOT NULL;

-- Non-unique index for the prepare-response query that filters
-- `status='failed'` to build fetch_warnings. Keeps that query O(failed)
-- instead of full-scanning sources per prepare call.
CREATE INDEX IF NOT EXISTS sources_entry_status_idx
  ON sources (entry_id, status);
