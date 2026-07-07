-- Ontology — workspace-scoped object graphs agents route through.
-- A cluster is one ontology board (URL-addressed by slug, like
-- knowledge bases). Objects are typed nodes; columns are ordinary
-- objects referenced from ontology_memberships with cluster_id set,
-- and their cards are objects referenced with parent_object_id set —
-- one object can sit under several parents (shared across clusters).
-- Attributes and methods (action recipes) are display-shaped JSONB;
-- relationships are relational rows so reverse lookups and integrity
-- work for the MCP resolve path.
--
-- RLS mirrors skills; service-role bypasses RLS today, so enforcement
-- also lives in the service layer until the RLS migration plan lands.

CREATE TABLE IF NOT EXISTS ontology_clusters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  purpose       TEXT NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ontology_clusters_workspace_slug_active_idx
  ON ontology_clusters (workspace_id, slug) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ontology_clusters_workspace_active_idx
  ON ontology_clusters (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ontology_objects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_type   TEXT NOT NULL DEFAULT 'person'
                CHECK (object_type IN ('person', 'team', 'client', 'policy', 'document')),
  name          TEXT NOT NULL,
  subtitle      TEXT NOT NULL DEFAULT '',
  attributes    JSONB NOT NULL DEFAULT '[]'::jsonb,
  methods       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Identity anchor: the workspace member this object represents, when
  -- it represents one. Lets the MCP layer resolve caller -> object.
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ontology_objects_workspace_active_idx
  ON ontology_objects (workspace_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ontology_objects_user_idx
  ON ontology_objects (workspace_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- Containment. Exactly one parent kind per row: cluster_id set = the
-- child is a COLUMN of that cluster; parent_object_id set = the child
-- is a card inside that object.
CREATE TABLE IF NOT EXISTS ontology_memberships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cluster_id        UUID REFERENCES ontology_clusters(id) ON DELETE CASCADE,
  parent_object_id  UUID REFERENCES ontology_objects(id) ON DELETE CASCADE,
  child_object_id   UUID NOT NULL REFERENCES ontology_objects(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((cluster_id IS NULL) <> (parent_object_id IS NULL)),
  CHECK (parent_object_id IS NULL OR parent_object_id <> child_object_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ontology_memberships_cluster_child_idx
  ON ontology_memberships (cluster_id, child_object_id) WHERE cluster_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ontology_memberships_parent_child_idx
  ON ontology_memberships (parent_object_id, child_object_id) WHERE parent_object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ontology_memberships_child_idx
  ON ontology_memberships (child_object_id);

CREATE INDEX IF NOT EXISTS ontology_memberships_workspace_idx
  ON ontology_memberships (workspace_id);

CREATE TABLE IF NOT EXISTS ontology_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_object_id  UUID NOT NULL REFERENCES ontology_objects(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  target_object_id  UUID NOT NULL REFERENCES ontology_objects(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_object_id <> target_object_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ontology_relationships_edge_idx
  ON ontology_relationships (source_object_id, label, target_object_id);

CREATE INDEX IF NOT EXISTS ontology_relationships_source_idx
  ON ontology_relationships (source_object_id);

CREATE INDEX IF NOT EXISTS ontology_relationships_target_idx
  ON ontology_relationships (target_object_id);

CREATE INDEX IF NOT EXISTS ontology_relationships_workspace_idx
  ON ontology_relationships (workspace_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'ontology_clusters_touch_updated_at'
  ) THEN
    CREATE TRIGGER ontology_clusters_touch_updated_at
      BEFORE UPDATE ON ontology_clusters
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'ontology_objects_touch_updated_at'
  ) THEN
    CREATE TRIGGER ontology_objects_touch_updated_at
      BEFORE UPDATE ON ontology_objects
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;
END $$;

ALTER TABLE ontology_clusters       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_objects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_relationships  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ontology_clusters_member_select ON ontology_clusters;
CREATE POLICY ontology_clusters_member_select ON ontology_clusters
  FOR SELECT USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
DROP POLICY IF EXISTS ontology_clusters_editor_insert ON ontology_clusters;
CREATE POLICY ontology_clusters_editor_insert ON ontology_clusters
  FOR INSERT WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND created_by = auth.uid()
  );
DROP POLICY IF EXISTS ontology_clusters_editor_update ON ontology_clusters;
CREATE POLICY ontology_clusters_editor_update ON ontology_clusters
  FOR UPDATE USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
DROP POLICY IF EXISTS ontology_clusters_editor_delete ON ontology_clusters;
CREATE POLICY ontology_clusters_editor_delete ON ontology_clusters
  FOR DELETE USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

DROP POLICY IF EXISTS ontology_objects_member_select ON ontology_objects;
CREATE POLICY ontology_objects_member_select ON ontology_objects
  FOR SELECT USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
DROP POLICY IF EXISTS ontology_objects_editor_insert ON ontology_objects;
CREATE POLICY ontology_objects_editor_insert ON ontology_objects
  FOR INSERT WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND created_by = auth.uid()
  );
DROP POLICY IF EXISTS ontology_objects_editor_update ON ontology_objects;
CREATE POLICY ontology_objects_editor_update ON ontology_objects
  FOR UPDATE USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));
DROP POLICY IF EXISTS ontology_objects_editor_delete ON ontology_objects;
CREATE POLICY ontology_objects_editor_delete ON ontology_objects
  FOR DELETE USING (is_workspace_member(workspace_id, auth.uid(), 'editor'));

DROP POLICY IF EXISTS ontology_memberships_member_select ON ontology_memberships;
CREATE POLICY ontology_memberships_member_select ON ontology_memberships
  FOR SELECT USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
DROP POLICY IF EXISTS ontology_memberships_editor_write ON ontology_memberships;
CREATE POLICY ontology_memberships_editor_write ON ontology_memberships
  FOR ALL USING (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));

DROP POLICY IF EXISTS ontology_relationships_member_select ON ontology_relationships;
CREATE POLICY ontology_relationships_member_select ON ontology_relationships
  FOR SELECT USING (is_workspace_member(workspace_id, auth.uid(), 'viewer'));
DROP POLICY IF EXISTS ontology_relationships_editor_write ON ontology_relationships;
CREATE POLICY ontology_relationships_editor_write ON ontology_relationships
  FOR ALL USING (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));
