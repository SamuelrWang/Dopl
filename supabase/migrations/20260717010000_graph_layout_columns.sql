-- Persisted node positions for the interactive graph substrate.
-- The ontology (Canvas) graph and the Workflows graph both let a user drag
-- node cards; the chosen positions are stored as a JSONB map keyed by node
-- id (ontology object id / workflow step id) → { x, y } world coordinates.
-- Hybrid layout: a stored position wins per node, auto-layout fills the
-- rest, so `{}` (the default) means "pure auto-layout".
--
-- Additive + idempotent. No RLS change: the new column rides each table's
-- existing row policies (ontology_clusters_*_select/update, workflows_*).
-- Realtime already publishes both tables, so a drag PATCH streams to other
-- tabs like any other row edit (client re-fetches through its service).

ALTER TABLE ontology_clusters
  ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::jsonb;
