-- Cluster brains: persistent "brain" for each cluster containing
-- synthesized instructions and user-created memories/overrides.

CREATE TABLE cluster_brains (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cluster_id)
);

CREATE TABLE cluster_brain_memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_brain_id UUID NOT NULL REFERENCES cluster_brains(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cluster_brains_cluster ON cluster_brains(cluster_id);
CREATE INDEX idx_cluster_brain_memories_brain ON cluster_brain_memories(cluster_brain_id);
