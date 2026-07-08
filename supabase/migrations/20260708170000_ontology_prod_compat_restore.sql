-- HOTFIX (2026-07-08): the deployed app still selected object_type and
-- read method.requires when the retirement migrations hit the live DB,
-- 500ing /api/ontology. Restore both shapes for compatibility until the
-- new code deploys; a follow-up migration re-drops them AFTER deploy.
-- 1) Re-add the column the old code selects (values are vestigial).
ALTER TABLE ontology_objects
  ADD COLUMN IF NOT EXISTS object_type text NOT NULL DEFAULT 'person';

-- 2) Old code reads m.requires (array) on every method; re-add it
--    empty alongside the new outcome field.
UPDATE ontology_objects
SET methods = (
  SELECT jsonb_agg(
    CASE WHEN m ? 'requires' THEN m ELSE m || '{"requires": []}'::jsonb END
  )
  FROM jsonb_array_elements(methods) AS m
)
WHERE methods IS NOT NULL AND methods <> '[]'::jsonb;
