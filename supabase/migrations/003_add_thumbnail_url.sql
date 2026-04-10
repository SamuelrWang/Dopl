-- Add thumbnail_url column to entries for visual browse cards.
-- Populated during ingestion from tweet images, Instagram display images, or OG images.

ALTER TABLE entries ADD COLUMN thumbnail_url TEXT;
