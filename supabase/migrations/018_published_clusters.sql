-- 018_published_clusters.sql — Community sharing: published clusters as posts

-- ── Published clusters (the "post" record) ──────────────────────────
CREATE TABLE published_clusters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id      UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  category        TEXT,
  thumbnail_url   TEXT,
  fork_count      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'published'
                    CHECK (status IN ('draft', 'published', 'archived')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_published_clusters_slug ON published_clusters(slug);
CREATE INDEX idx_published_clusters_user ON published_clusters(user_id);
CREATE INDEX idx_published_clusters_status ON published_clusters(status);
CREATE INDEX idx_published_clusters_category ON published_clusters(category);
CREATE INDEX idx_published_clusters_popular ON published_clusters(fork_count DESC);

-- ── Panels for the published canvas (separate from private canvas) ──
CREATE TABLE published_cluster_panels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_cluster_id  UUID NOT NULL REFERENCES published_clusters(id) ON DELETE CASCADE,
  entry_id              UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  title                 TEXT,
  summary               TEXT,
  source_url            TEXT,
  x                     FLOAT DEFAULT 0,
  y                     FLOAT DEFAULT 0,
  width                 FLOAT DEFAULT 520,
  height                FLOAT DEFAULT 700,
  UNIQUE(published_cluster_id, entry_id)
);

CREATE INDEX idx_published_panels_cluster ON published_cluster_panels(published_cluster_id);

-- ── Brain snapshot for published cluster ────────────────────────────
CREATE TABLE published_cluster_brains (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_cluster_id  UUID NOT NULL REFERENCES published_clusters(id) ON DELETE CASCADE,
  instructions          TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(published_cluster_id)
);

-- ── Fork tracking ───────────────────────────────────────────────────
CREATE TABLE cluster_forks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_published_cluster_id UUID NOT NULL REFERENCES published_clusters(id) ON DELETE CASCADE,
  forked_by_user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_cluster_id          UUID REFERENCES clusters(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_published_cluster_id, forked_by_user_id)
);

CREATE INDEX idx_cluster_forks_source ON cluster_forks(source_published_cluster_id);
CREATE INDEX idx_cluster_forks_user ON cluster_forks(forked_by_user_id);
