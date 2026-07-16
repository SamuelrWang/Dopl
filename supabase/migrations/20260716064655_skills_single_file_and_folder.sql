-- Skills become SINGLE-FILE, plus a lightweight organizing `folder` label.
--
-- Product decision: a skill IS one markdown procedure (its SKILL.md) plus
-- metadata. The multi-file capability is removed from the product surface —
-- long reference material now belongs in knowledge bases (linked via
-- `dopl://kb/<slug>` refs), not in extra skill files. The direction is
-- "many small skills", so each skill also gains an optional plain-text
-- `folder` for organization.
--
-- Storage architecture (deliberate — the `skill_files` table STAYS as the
-- storage layer): every skill keeps exactly ONE active file (its SKILL.md),
-- enforced here by a partial unique index. History, export, duplicate, and
-- realtime keep working with minimal rework because the SKILL.md row still
-- versions exactly as before. A full collapse of skill_files into
-- skills.body is deferred (tracked as F-029).
--
-- This migration is IDEMPOTENT: after the merge no skill has >1 active file,
-- so re-running is a no-op (and the unique index guards against regressions).

-- ── a. `folder` column (nullable = unfiled), length-capped ────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS folder TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skills_folder_len'
  ) THEN
    ALTER TABLE skills
      ADD CONSTRAINT skills_folder_len
      CHECK (folder IS NULL OR char_length(folder) <= 80);
  END IF;
END $$;

-- ── b. Merge supplementary files into SKILL.md ────────────────────────────
--
-- For every skill that still has more than one active file:
--   1. Snapshot the current SKILL.md into skill_file_versions (mirrors the
--      columns the app's history.recordVersion writes: workspace_id,
--      skill_id, file_id, file_name, body, author_id, source). author_id
--      rides on the SKILL.md row's last_edited_by; source is 'user' (this is
--      a human/system-initiated migration, not an agent write).
--   2. Append each non-SKILL.md active file to SKILL.md's body, ordered by
--      position, as "\n\n---\n\n# <file name>\n\n<content>".
--   3. Soft-delete the non-SKILL.md rows (deleted_at = now()). The nightly
--      knowledge-trash-purge cron eventually hard-deletes these leftovers.

DO $$
DECLARE
  primary_file skill_files%ROWTYPE;
  appended     TEXT;
  merge_ts     TIMESTAMPTZ := now();
BEGIN
  -- Canonical file per multi-file skill: its active SKILL.md, or (defensive —
  -- the app never produces this shape) the earliest active file by position.
  -- Requiring an active SKILL.md here would skip such a skill and step (c)'s
  -- unique index would then fail to build.
  FOR primary_file IN
    SELECT DISTINCT ON (sf.skill_id) sf.*
    FROM skill_files sf
    WHERE sf.deleted_at IS NULL
      AND sf.skill_id IN (
        SELECT skill_id
        FROM skill_files
        WHERE deleted_at IS NULL
        GROUP BY skill_id
        HAVING count(*) > 1
      )
    ORDER BY sf.skill_id, (sf.name = 'SKILL.md') DESC, sf.position, sf.created_at
  LOOP
    -- 1. Snapshot the pre-merge SKILL.md body.
    INSERT INTO skill_file_versions
      (workspace_id, skill_id, file_id, file_name, body, author_id, source)
    VALUES
      (primary_file.workspace_id, primary_file.skill_id, primary_file.id,
       primary_file.name, primary_file.body, primary_file.last_edited_by,
       'user');

    -- 2. Build the appended tail from the sibling files (position order).
    SELECT string_agg(
             E'\n\n---\n\n# ' || f.name || E'\n\n' || f.body,
             '' ORDER BY f.position, f.created_at
           )
      INTO appended
      FROM skill_files f
      WHERE f.skill_id = primary_file.skill_id
        AND f.deleted_at IS NULL
        AND f.id <> primary_file.id;

    UPDATE skill_files
      SET body = primary_file.body || COALESCE(appended, ''),
          updated_at = merge_ts
      WHERE id = primary_file.id;

    -- 3. Soft-delete the merged-in siblings.
    UPDATE skill_files
      SET deleted_at = merge_ts
      WHERE skill_id = primary_file.skill_id
        AND deleted_at IS NULL
        AND id <> primary_file.id;
  END LOOP;

  -- Normalize: the app addresses a skill's body by name = 'SKILL.md'
  -- (service readBody/writeBody, workflow attachments). If a defensive
  -- canonical above wasn't named SKILL.md — or a single-file skill somehow
  -- carries another name — rename it. Safe under the (skill_id, name)
  -- active unique index because the row is its skill's only active file.
  UPDATE skill_files sf
    SET name = 'SKILL.md',
        updated_at = merge_ts
    WHERE sf.deleted_at IS NULL
      AND sf.name <> 'SKILL.md'
      AND NOT EXISTS (
        SELECT 1 FROM skill_files x
        WHERE x.skill_id = sf.skill_id
          AND x.deleted_at IS NULL
          AND x.id <> sf.id
      );
END $$;

-- ── c. Enforce a single active file per skill ─────────────────────────────
-- Runs AFTER the merge so it can't fail on pre-merge multi-file skills.

CREATE UNIQUE INDEX IF NOT EXISTS skill_files_single_active
  ON skill_files (skill_id) WHERE deleted_at IS NULL;
