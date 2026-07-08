-- Ontology: column objects can define a template — the default fields
-- (label + kind, no values) that new child objects are born with.
-- Empty array for non-columns and columns without a template.
ALTER TABLE ontology_objects
  ADD COLUMN IF NOT EXISTS template jsonb NOT NULL DEFAULT '[]'::jsonb;
