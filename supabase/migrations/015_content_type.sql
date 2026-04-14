-- Add content_type column to entries table.
-- Supports 3 types: setup (replicable implementation), knowledge (conceptual/educational),
-- resource (post pointing to external tool/repo).
-- Defaults to 'setup' for backward compatibility with existing entries.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'setup'
  CHECK (content_type IN ('setup', 'knowledge', 'resource'));

CREATE INDEX IF NOT EXISTS idx_entries_content_type ON entries(content_type);
