-- 009_clusters.sql — Persist canvas clusters for MCP access

CREATE TABLE clusters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_clusters_slug ON clusters(slug);

CREATE TABLE cluster_panels (
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  entry_id   UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cluster_id, entry_id)
);

CREATE INDEX idx_cluster_panels_entry ON cluster_panels(entry_id);
