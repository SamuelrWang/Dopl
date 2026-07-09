-- Post-deploy cleanup: the deployed code no longer reads object_type
-- or method.requires. Re-drop the compat column and strip the legacy
-- requires keys the hotfix restored.
ALTER TABLE ontology_objects DROP COLUMN IF EXISTS object_type;

UPDATE ontology_objects
SET methods = COALESCE(
  (SELECT jsonb_agg(m - 'requires') FROM jsonb_array_elements(methods) AS m),
  '[]'::jsonb
)
WHERE methods IS NOT NULL AND methods <> '[]'::jsonb;
