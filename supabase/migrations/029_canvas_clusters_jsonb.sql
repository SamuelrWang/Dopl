-- Store canvas clusters (visual panel groupings) as a JSONB column
-- on the existing canvas_state table. Previously clusters only lived
-- in localStorage and were lost on incognito / cross-device usage.

ALTER TABLE canvas_state
  ADD COLUMN clusters JSONB NOT NULL DEFAULT '[]'::jsonb;
