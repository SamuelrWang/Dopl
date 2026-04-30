-- canvases → workspaces overhaul.
--
-- The "canvas" concept introduced in 20260429000000 is being split:
--   - workspaces  — the team / share / billing container (members,
--                   invitations live here). Replaces the old canvases
--                   table 1:1 in role; only the name changes.
--   - canvases    — a page/view inside a workspace. New, lightweight.
--                   Exactly one canvas per workspace for now (slug='main').
--
-- This migration wipes user data (clusters, panels, conversations,
-- cluster brains and brain memories). The user has authorized data loss
-- — we're pre-launch and the test data is disposable.

-- ════════════════════════════════════════════════════════════════════
-- 1. Wipe user data that hangs off the canvas concept
-- ════════════════════════════════════════════════════════════════════
--
-- TRUNCATE … CASCADE handles dependent rows transparently. We're
-- intentionally including the cluster_* trio so the FK sweep can't
-- leave orphans behind.

TRUNCATE TABLE
  cluster_brain_memories,
  cluster_brains,
  cluster_panels,
  clusters,
  canvas_panels,
  canvas_state,
  conversations
CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 2. Drop the cluster RPC (its parameter list still names canvas_id)
-- ════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]);

-- ════════════════════════════════════════════════════════════════════
-- 3. Drop canvas_id columns (and their FKs/indexes via the column drop)
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE clusters               DROP COLUMN IF EXISTS canvas_id;
ALTER TABLE canvas_panels          DROP COLUMN IF EXISTS canvas_id;
ALTER TABLE canvas_state           DROP COLUMN IF EXISTS canvas_id;
ALTER TABLE conversations          DROP COLUMN IF EXISTS canvas_id;
ALTER TABLE cluster_brains         DROP COLUMN IF EXISTS canvas_id;
ALTER TABLE cluster_brain_memories DROP COLUMN IF EXISTS canvas_id;

-- ════════════════════════════════════════════════════════════════════
-- 4. Drop legacy canvas tables (canvas_members + canvas_invitations
--    cascade off canvases via their FKs, but be explicit anyway)
-- ════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS canvas_invitations CASCADE;
DROP TABLE IF EXISTS canvas_members     CASCADE;
DROP TABLE IF EXISTS canvases           CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 5. Workspaces — the team / share unit
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_owner_slug_unique UNIQUE (owner_id, slug)
);

CREATE INDEX workspaces_owner_id_idx ON workspaces (owner_id);

CREATE TABLE workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','revoked')),
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at   TIMESTAMPTZ,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_workspace_user_unique UNIQUE (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_status_idx
  ON workspace_members (user_id, status);
CREATE INDEX workspace_members_workspace_id_idx
  ON workspace_members (workspace_id);

CREATE TABLE workspace_invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  invited_role  TEXT NOT NULL CHECK (invited_role IN ('admin','editor','viewer')),
  invited_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  accepted_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workspace_invitations_workspace_email_idx
  ON workspace_invitations (workspace_id, email);
CREATE INDEX workspace_invitations_email_idx
  ON workspace_invitations (email);

-- ════════════════════════════════════════════════════════════════════
-- 6. Canvases — the new lightweight page entity inside a workspace
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE canvases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canvases_workspace_slug_unique UNIQUE (workspace_id, slug)
);

CREATE INDEX canvases_workspace_id_idx ON canvases (workspace_id);

-- ════════════════════════════════════════════════════════════════════
-- 7. Re-attach data tables to workspaces
-- ════════════════════════════════════════════════════════════════════
--
-- All rows were truncated above so a NOT NULL workspace_id is safe to
-- add directly without a backfill phase.

ALTER TABLE clusters
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE canvas_panels
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE canvas_state
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE conversations
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE cluster_brains
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE cluster_brain_memories
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX clusters_workspace_id_idx               ON clusters (workspace_id);
CREATE INDEX canvas_panels_workspace_id_idx          ON canvas_panels (workspace_id);
CREATE INDEX conversations_workspace_id_idx          ON conversations (workspace_id);
CREATE INDEX cluster_brains_workspace_id_idx         ON cluster_brains (workspace_id);
CREATE INDEX cluster_brain_memories_workspace_id_idx ON cluster_brain_memories (workspace_id);

ALTER TABLE canvas_state
  ADD CONSTRAINT canvas_state_workspace_id_key UNIQUE (workspace_id);
ALTER TABLE canvas_panels
  ADD CONSTRAINT canvas_panels_workspace_panel_unique UNIQUE (workspace_id, panel_id);
ALTER TABLE conversations
  ADD CONSTRAINT conversations_workspace_panel_unique UNIQUE (workspace_id, panel_id);

-- ════════════════════════════════════════════════════════════════════
-- 8. Row-Level Security
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE workspaces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvases               ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_member_select ON workspaces
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = workspaces.id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

CREATE POLICY workspace_members_self_select ON workspace_members
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY workspace_invitations_admin_select ON workspace_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = workspace_invitations.workspace_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.role IN ('owner','admin')
    )
  );

CREATE POLICY canvases_member_select ON canvases
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = canvases.workspace_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- 9. Recreate create_cluster_with_entries with workspace_id parameter
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_cluster_with_entries(
  p_workspace_id UUID,
  p_user_id UUID,
  p_name TEXT,
  p_slug TEXT,
  p_entry_ids UUID[]
)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_cluster_id UUID;
  new_cluster_row RECORD;
BEGIN
  INSERT INTO clusters (workspace_id, user_id, name, slug)
  VALUES (p_workspace_id, p_user_id, p_name, p_slug)
  RETURNING clusters.id INTO new_cluster_id;

  IF p_entry_ids IS NOT NULL AND array_length(p_entry_ids, 1) > 0 THEN
    INSERT INTO cluster_panels (cluster_id, entry_id)
    SELECT new_cluster_id, unnest(p_entry_ids);
  END IF;

  SELECT
    c.id,
    c.slug,
    c.name,
    c.created_at,
    c.updated_at
  INTO new_cluster_row
  FROM clusters c
  WHERE c.id = new_cluster_id;

  id := new_cluster_row.id;
  slug := new_cluster_row.slug;
  name := new_cluster_row.name;
  created_at := new_cluster_row.created_at;
  updated_at := new_cluster_row.updated_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 10. Backfill — every existing user gets a default workspace + canvas
-- ════════════════════════════════════════════════════════════════════
--
-- App-side provisioning (Phase 5 of the overhaul plan) will own this
-- going forward. The backfill keeps existing test users in a sane
-- state immediately after the migration.

INSERT INTO workspaces (owner_id, name, slug)
SELECT u.id, 'My Workspace', 'default'
FROM auth.users u
ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
SELECT w.id, w.owner_id, 'owner', 'active', w.created_at
FROM workspaces w
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO canvases (workspace_id, name, slug)
SELECT w.id, 'Main', 'main'
FROM workspaces w
ON CONFLICT (workspace_id, slug) DO NOTHING;
