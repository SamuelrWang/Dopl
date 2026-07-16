-- Collapse the single-row-per-skill `skill_files` table into `skills` (F-029).
--
-- Skills went single-file in 20260711000000: every skill carries exactly
-- ONE active file (its SKILL.md), enforced by the `skill_files_single_active`
-- partial unique index. Keeping a whole table + a join for one text blob per
-- skill is dead weight, so the body now lives on the `skills` row directly.
--
-- New columns mirror ONLY the SKILL.md fields the app actually reads off the
-- file row (see server/dto.ts): its body, the CAS clock, and the last-editor
-- attribution. Everything else the old SkillFile shape carried (id, name,
-- position, skill_id, created_by, created_at, deleted_at) is derivable from
-- the skill row, so the app synthesizes it in the DTO.
--
--   body               — the SKILL.md markdown.
--   body_updated_at    — the optimistic-concurrency clock. DELIBERATELY
--                        separate from skills.updated_at so metadata edits
--                        (which bump updated_at) don't produce false 412s on
--                        a body write, and vice versa.
--   body_edited_by     — last author of the body.
--   body_edited_source — 'user' | 'agent'.
--
-- History preservation is the delicate part: skill_file_versions.file_id is a
-- NOT NULL FK → skill_files ON DELETE CASCADE, so dropping skill_files naively
-- would cascade-delete ALL version history. This migration first severs that
-- link (drop the FK + file_id/file_name columns) and RENAMES the table to
-- `skill_versions` before the table drop, so every historic snapshot survives
-- keyed on skill_id alone. skill_events.file_id (nullable FK) is likewise
-- dropped; its `type` CHECK is left untouched so historic `file.*` events stay
-- readable even though the app stops emitting them.
--
-- Fully IDEMPOTENT (IF EXISTS / IF NOT EXISTS / pg_constraint + pg_policies
-- guards throughout) and SQL-only — never run against a remote project.

-- ── a. Body columns on `skills` ───────────────────────────────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '';
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS body_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS body_edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS body_edited_source TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skills_body_edited_source_chk'
  ) THEN
    ALTER TABLE skills
      ADD CONSTRAINT skills_body_edited_source_chk
      CHECK (body_edited_source IN ('user', 'agent'));
  END IF;
END $$;

-- ── b. Backfill from the single active SKILL.md row ───────────────────────
-- Skills with no active file (shouldn't exist post-20260711000000) keep the
-- column defaults. Guarded so a re-run after the table drop is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'skill_files'
  ) THEN
    UPDATE skills s
    SET body               = COALESCE(f.body, ''),
        body_updated_at    = f.updated_at,
        body_edited_by     = f.last_edited_by,
        body_edited_source = f.last_edited_source
    FROM skill_files f
    WHERE f.skill_id = s.id
      AND f.deleted_at IS NULL
      AND f.name = 'SKILL.md';
  END IF;
END $$;

-- ── c. Preserve history: skill_file_versions → skill_versions ─────────────
-- Sever the file linkage BEFORE the skill_files drop so the ON DELETE CASCADE
-- can't take the snapshots down with it, then rename the table.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'skill_file_versions'
  ) THEN
    ALTER TABLE skill_file_versions
      DROP CONSTRAINT IF EXISTS skill_file_versions_file_id_fkey;
    ALTER TABLE skill_file_versions DROP COLUMN IF EXISTS file_id;
    ALTER TABLE skill_file_versions DROP COLUMN IF EXISTS file_name;
    ALTER TABLE skill_file_versions RENAME TO skill_versions;
  END IF;
END $$;

-- A bare table rename does NOT rename constraints — do it explicitly so the
-- live names match the generated types (typed PostgREST embeds address FKs
-- by constraint name).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_file_versions_pkey'
  ) THEN
    ALTER TABLE skill_versions
      RENAME CONSTRAINT skill_file_versions_pkey TO skill_versions_pkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_file_versions_skill_id_fkey'
  ) THEN
    ALTER TABLE skill_versions
      RENAME CONSTRAINT skill_file_versions_skill_id_fkey TO skill_versions_skill_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_file_versions_workspace_id_fkey'
  ) THEN
    ALTER TABLE skill_versions
      RENAME CONSTRAINT skill_file_versions_workspace_id_fkey TO skill_versions_workspace_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_file_versions_author_id_fkey'
  ) THEN
    ALTER TABLE skill_versions
      RENAME CONSTRAINT skill_file_versions_author_id_fkey TO skill_versions_author_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_file_versions_source_check'
  ) THEN
    ALTER TABLE skill_versions
      RENAME CONSTRAINT skill_file_versions_source_check TO skill_versions_source_check;
  END IF;
END $$;

-- The (file_id, created_at) index went with the file_id column. Rename the
-- survivors onto the new table name.
ALTER INDEX IF EXISTS skill_file_versions_skill_idx
  RENAME TO skill_versions_skill_idx;
ALTER INDEX IF EXISTS skill_file_versions_workspace_idx
  RENAME TO skill_versions_workspace_idx;

-- RLS policy survives the rename attached to skill_versions under its old
-- name; recreate it with the new name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'skill_versions'
  ) THEN
    DROP POLICY IF EXISTS skill_file_versions_member_select ON skill_versions;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'skill_versions'
        AND policyname = 'skill_versions_member_select'
    ) THEN
      CREATE POLICY skill_versions_member_select ON skill_versions
        FOR SELECT
        USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
    END IF;
  END IF;
END $$;

-- ── d. Drop the file linkage on skill_events (keep the type CHECK) ────────

ALTER TABLE skill_events DROP CONSTRAINT IF EXISTS skill_events_file_id_fkey;
ALTER TABLE skill_events DROP COLUMN IF EXISTS file_id;

-- ── e. Drop skill_files ───────────────────────────────────────────────────
-- CASCADE takes its triggers + RLS policies + realtime-publication membership.
-- The workspace-match trigger's function is now orphaned — drop it too.

DROP TABLE IF EXISTS skill_files CASCADE;
DROP FUNCTION IF EXISTS enforce_skill_files_workspace_match() CASCADE;
