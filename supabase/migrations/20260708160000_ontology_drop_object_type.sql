-- Retire the fixed object-type enum. An object "is" whatever its
-- column is named; the stored type was vestigial after the UI and MCP
-- stopped surfacing it.
ALTER TABLE ontology_objects DROP COLUMN IF EXISTS object_type;
