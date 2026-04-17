-- Add skeleton-tier ingestion support to entries.
--
-- Skeleton entries carry only a short natural-language descriptor + embedding,
-- no agents.md / README / manifest. They're the cheap mass-indexed supply
-- side of the new flow. Full-tier entries are upgraded on demand when a
-- user's Claude Code writes back a generated agents.md via the MCP.

-- The enum lives in a DO block so re-runs (or existing DBs where this type
-- has been created by hand) don't blow up.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_tier') THEN
    CREATE TYPE ingestion_tier AS ENUM ('skeleton', 'full');
  END IF;
END$$;

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS ingestion_tier   ingestion_tier NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS descriptor       TEXT,
  ADD COLUMN IF NOT EXISTS github_sha       TEXT,
  ADD COLUMN IF NOT EXISTS canonical_score  INTEGER,
  ADD COLUMN IF NOT EXISTS writeback_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS writeback_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS descriptor_prompt_version TEXT;

-- Filter searches by tier without scanning all rows.
CREATE INDEX IF NOT EXISTS entries_ingestion_tier_idx
  ON entries (ingestion_tier);

-- Nightly refresh cron walks skeleton entries ordered by staleness. A
-- partial index on the tier keeps that scan bounded even as the DB grows
-- into tens of thousands of rows.
CREATE INDEX IF NOT EXISTS entries_skeleton_updated_idx
  ON entries (updated_at)
  WHERE ingestion_tier = 'skeleton';

-- Scored write-back audit trail. Every submit_full_entry call writes one
-- row here regardless of whether the write-back was accepted, so we can
-- later tune the auditor threshold from real data.
CREATE TABLE IF NOT EXISTS writeback_audits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id           UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  submitted_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  prompt_version     TEXT,
  audit_score        INTEGER NOT NULL,
  audit_passed       BOOLEAN NOT NULL,
  audit_reasons      JSONB,
  accepted           BOOLEAN NOT NULL,
  rejection_reason   TEXT,
  incoming_byte_len  INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writeback_audits_entry_id_idx
  ON writeback_audits (entry_id, created_at DESC);
