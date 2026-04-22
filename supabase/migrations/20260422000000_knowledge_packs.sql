-- Knowledge Packs — specialist verticals (Rokid AR, Unity VR, etc.) backed
-- by public GitHub repos. The repo is the source of truth; this DB is a
-- derived index that the MCP server queries at request time. Sync is
-- triggered by a webhook from each pack's repo on push to main, with a
-- nightly cron as a safety net.
--
-- knowledge_packs holds one row per installed vertical.
-- knowledge_pack_files holds the parsed markdown files (path-addressed),
-- with frontmatter pulled out into queryable columns + a jsonb blob for
-- arbitrary keys.

CREATE TABLE knowledge_packs (
  id            text PRIMARY KEY,                -- 'rokid', 'unity-vr', ...
  name          text NOT NULL,
  description   text,
  sdk_version   text,
  repo_url      text NOT NULL,                   -- e.g. 'https://github.com/dopl/rokid-knowledge'
  repo_owner    text NOT NULL,                   -- 'dopl'
  repo_name     text NOT NULL,                   -- 'rokid-knowledge'
  default_branch text NOT NULL DEFAULT 'main',
  manifest      jsonb,                           -- raw manifest.json from the repo
  last_synced_at timestamptz,
  last_commit_sha text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_pack_files (
  pack_id       text NOT NULL REFERENCES knowledge_packs(id) ON DELETE CASCADE,
  path          text NOT NULL,                   -- 'docs/sdk/camera.md'
  title         text,
  summary       text,
  body          text NOT NULL,                   -- raw markdown body (post-frontmatter)
  frontmatter   jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags          text[] NOT NULL DEFAULT '{}',
  category      text,                            -- first path segment under /docs (e.g. 'sdk', 'hardware')
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, path)
);

-- Cheap browse index — `kb_list({ pack, category })` is the common path.
CREATE INDEX knowledge_pack_files_pack_category_idx
  ON knowledge_pack_files (pack_id, category);

-- Tag filter index for future tag-scoped queries.
CREATE INDEX knowledge_pack_files_tags_idx
  ON knowledge_pack_files USING gin (tags);
