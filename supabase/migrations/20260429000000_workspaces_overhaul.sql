-- Workspaces overhaul — consolidated migration.
--
-- Bundles every schema change introduced by the canvas-as-workspace
-- pivot (Phases 0–6) into one ordered apply. The split-file history
-- was useful while developing in stages; for a fresh deploy it's
-- cleaner to land the schema as a single transaction so a partial
-- failure doesn't leave the DB half-migrated.
--
-- Sections (ordering matters — each step assumes the previous one):
--   1. Canvas tables (canvases, canvas_members, canvas_invitations)
--      + RLS policies
--   2. Add nullable canvas_id columns to every user-scoped table
--   3. Backfill: one default canvas per auth.users row, fill canvas_id
--   4. SET NOT NULL + indexes + new (canvas_id, ...) UNIQUE constraints
--   5. Drop the legacy (user_id, ...) UNIQUE constraints
--   6. Memory scope (workspace | personal) + author_id on memories
--   7. brain_version column + auto-increment trigger
--   8. canvas_state version column + auto-increment trigger
--   9. create_cluster_with_entries RPC (transactional cluster create)
--
-- Idempotent everywhere — IF NOT EXISTS / IF EXISTS / DO blocks guard
-- every CREATE / ALTER / INSERT.

-- ════════════════════════════════════════════════════════════════════
-- 1. Canvas tables
-- ════════════════════════════════════════════════════════════════════

-- canvases — the unit of sharing. One row per workspace. `slug` is
-- unique per owner (so two users can each have a canvas slug 'default')
-- and used in URLs.
CREATE TABLE IF NOT EXISTS canvases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canvases_owner_slug_unique UNIQUE (owner_id, slug)
);

CREATE INDEX IF NOT EXISTS canvases_owner_id_idx ON canvases (owner_id);

-- canvas_members — membership row per (canvas, user). The owner has
-- a row here too (role='owner', status='active') — keeping a single
-- source of truth for "who can read this canvas" simplifies query
-- joins.
CREATE TABLE IF NOT EXISTS canvas_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id   UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','revoked')),
  invited_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at  TIMESTAMPTZ,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canvas_members_canvas_user_unique UNIQUE (canvas_id, user_id)
);

CREATE INDEX IF NOT EXISTS canvas_members_user_status_idx
  ON canvas_members (user_id, status);
CREATE INDEX IF NOT EXISTS canvas_members_canvas_id_idx
  ON canvas_members (canvas_id);

-- canvas_invitations — token-based invite rows. Email is stored as
-- text — we don't require the invitee to have an account at invite
-- time. Token is the URL-safe accept link.
CREATE TABLE IF NOT EXISTS canvas_invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id     UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS canvas_invitations_canvas_email_idx
  ON canvas_invitations (canvas_id, email);
CREATE INDEX IF NOT EXISTS canvas_invitations_email_idx
  ON canvas_invitations (email);

-- RLS — service-role writes bypass these; they only matter for
-- realtime subscriptions and any future direct-from-client reads.
-- Members can read their canvases + own membership row. Cross-member
-- reads (listing OTHER members of a canvas) go through the API
-- (service role) to avoid recursive policy evaluation against
-- canvas_members.
ALTER TABLE canvases ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canvases_member_select ON canvases;
CREATE POLICY canvases_member_select ON canvases
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM canvas_members m
      WHERE m.canvas_id = canvases.id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS canvas_members_self_select ON canvas_members;
CREATE POLICY canvas_members_self_select ON canvas_members
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS canvas_invitations_member_select ON canvas_invitations;
CREATE POLICY canvas_invitations_member_select ON canvas_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM canvas_members m
      WHERE m.canvas_id = canvas_invitations.canvas_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.role IN ('owner','admin')
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- 2. Add nullable canvas_id columns
-- ════════════════════════════════════════════════════════════════════
--
-- `cluster_panels` (the cluster→entry junction) inherits scope through
-- its `cluster_id` FK and does not need its own canvas_id.

ALTER TABLE clusters
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE canvas_panels
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE canvas_state
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE cluster_brains
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 3. Backfill canvases + memberships + canvas_id
-- ════════════════════════════════════════════════════════════════════
--
-- Invariant after this section:
--   - Every auth.users row has at least one canvas (slug='default').
--   - Every such canvas has the owner as an active 'owner' member.
--   - Every existing row in clusters / canvas_panels / canvas_state /
--     conversations / cluster_brains / cluster_brain_memories has a
--     canvas_id pointing at its owner's default canvas.

INSERT INTO canvases (owner_id, name, slug)
SELECT u.id, 'My Canvas', 'default'
FROM auth.users u
ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO canvas_members (canvas_id, user_id, role, status, joined_at)
SELECT c.id, c.owner_id, 'owner', 'active', c.created_at
FROM canvases c
ON CONFLICT (canvas_id, user_id) DO NOTHING;

UPDATE clusters AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE canvas_panels AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE canvas_state AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE conversations AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE cluster_brains AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

UPDATE cluster_brain_memories AS t SET canvas_id = c.id
FROM canvases c
WHERE c.owner_id = t.user_id AND c.slug = 'default' AND t.canvas_id IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- 3.5. Orphan cleanup — delete rows the backfill couldn't reach
-- ════════════════════════════════════════════════════════════════════
--
-- Any row left with canvas_id = NULL after Section 3 has a user_id
-- that's NULL or points at a deleted auth.users row, so no canvas
-- exists to attach it to. There's no honest way to recover ownership
-- for these — they're orphan data from before the overhaul. Delete
-- them so the NOT NULL transition below succeeds.
--
-- Order matters: child tables first (they FK back to clusters /
-- cluster_brains), then parents.

DELETE FROM cluster_brain_memories WHERE canvas_id IS NULL;
DELETE FROM cluster_brains         WHERE canvas_id IS NULL;
DELETE FROM cluster_panels
  WHERE cluster_id IN (SELECT id FROM clusters WHERE canvas_id IS NULL);
DELETE FROM clusters       WHERE canvas_id IS NULL;
DELETE FROM canvas_panels  WHERE canvas_id IS NULL;
DELETE FROM canvas_state   WHERE canvas_id IS NULL;
DELETE FROM conversations  WHERE canvas_id IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- 4. Lock canvas_id columns down + new UNIQUE constraints
-- ════════════════════════════════════════════════════════════════════
--
-- SET NOT NULL fails loudly on any orphan row (user deleted but data
-- not cascaded) — that's the signal to clean up before re-running.

ALTER TABLE clusters                 ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE canvas_panels            ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE canvas_state             ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE conversations            ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE cluster_brains           ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE cluster_brain_memories   ALTER COLUMN canvas_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS clusters_canvas_id_idx              ON clusters (canvas_id);
CREATE INDEX IF NOT EXISTS canvas_panels_canvas_id_idx         ON canvas_panels (canvas_id);
CREATE INDEX IF NOT EXISTS conversations_canvas_id_idx         ON conversations (canvas_id);
CREATE INDEX IF NOT EXISTS cluster_brains_canvas_id_idx        ON cluster_brains (canvas_id);
CREATE INDEX IF NOT EXISTS cluster_brain_memories_canvas_id_idx
  ON cluster_brain_memories (canvas_id);

-- canvas_state's canvas_id is enforced UNIQUE below — that already
-- creates a backing index, so no separate idx for it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_state_canvas_id_key'
  ) THEN
    ALTER TABLE canvas_state
      ADD CONSTRAINT canvas_state_canvas_id_key UNIQUE (canvas_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_panels_canvas_panel_unique'
  ) THEN
    ALTER TABLE canvas_panels
      ADD CONSTRAINT canvas_panels_canvas_panel_unique UNIQUE (canvas_id, panel_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_canvas_panel_unique'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_canvas_panel_unique UNIQUE (canvas_id, panel_id);
  END IF;
END $$;

-- cluster_brains keeps its existing UNIQUE(cluster_id) — one brain per
-- cluster, regardless of which canvas the cluster belongs to.

-- ════════════════════════════════════════════════════════════════════
-- 5. Drop legacy (user_id, ...) UNIQUE constraints
-- ════════════════════════════════════════════════════════════════════
--
-- Pre-overhaul, canvas_state had UNIQUE(user_id), and canvas_panels +
-- conversations had UNIQUE(user_id, panel_id). Those constraints
-- enforced the right invariant under the single-canvas world but
-- break the moment a user owns a second canvas: the new canvas's
-- first write hits the legacy constraint because the user already
-- has a row pointing at their first canvas.
--
-- Introspect pg_constraint and drop any UNIQUE on the legacy column
-- sets, regardless of constraint name (Postgres-default `_key` suffix
-- vs custom — both are caught).

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.canvas_state'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attnum)
        FROM pg_attribute att
        WHERE att.attrelid = pg_constraint.conrelid
          AND att.attnum = ANY (pg_constraint.conkey)
      ) = ARRAY['user_id']
  LOOP
    EXECUTE format('ALTER TABLE canvas_state DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.canvas_panels'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attnum)
        FROM pg_attribute att
        WHERE att.attrelid = pg_constraint.conrelid
          AND att.attnum = ANY (pg_constraint.conkey)
      ) = ARRAY['user_id', 'panel_id']
  LOOP
    EXECUTE format('ALTER TABLE canvas_panels DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.conversations'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attnum)
        FROM pg_attribute att
        WHERE att.attrelid = pg_constraint.conrelid
          AND att.attnum = ANY (pg_constraint.conkey)
      ) = ARRAY['user_id', 'panel_id']
  LOOP
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 6. Memory scope (workspace | personal) + author_id
-- ════════════════════════════════════════════════════════════════════
--
-- Visibility rule: workspace memories visible to every active member;
-- personal memories visible only to their author. The auth gate
-- already filters by canvas membership; these columns add the
-- per-row author + scope so the API can apply the second filter.

ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE cluster_brain_memories SET author_id = user_id WHERE author_id IS NULL;
UPDATE cluster_brain_memories SET scope = 'workspace' WHERE scope IS NULL;

ALTER TABLE cluster_brain_memories ALTER COLUMN author_id SET NOT NULL;
ALTER TABLE cluster_brain_memories ALTER COLUMN scope SET NOT NULL;
ALTER TABLE cluster_brain_memories ALTER COLUMN scope SET DEFAULT 'workspace';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cluster_brain_memories_scope_check'
  ) THEN
    ALTER TABLE cluster_brain_memories
      ADD CONSTRAINT cluster_brain_memories_scope_check
        CHECK (scope IN ('workspace', 'personal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cluster_brain_memories_brain_scope_idx
  ON cluster_brain_memories (cluster_brain_id, scope);
CREATE INDEX IF NOT EXISTS cluster_brain_memories_author_id_idx
  ON cluster_brain_memories (author_id);

-- ════════════════════════════════════════════════════════════════════
-- 7. brain_version + auto-increment trigger
-- ════════════════════════════════════════════════════════════════════
--
-- sync_skills decides "is this skill file up to date?" by version
-- match. The trigger uses IS DISTINCT FROM so a no-op write doesn't
-- invalidate every agent's cache.

ALTER TABLE cluster_brains
  ADD COLUMN IF NOT EXISTS brain_version BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_cluster_brain_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.instructions IS DISTINCT FROM OLD.instructions THEN
    NEW.brain_version := COALESCE(OLD.brain_version, 0) + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cluster_brains_version_bump'
  ) THEN
    CREATE TRIGGER cluster_brains_version_bump
      BEFORE UPDATE ON cluster_brains
      FOR EACH ROW
      EXECUTE FUNCTION bump_cluster_brain_version();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 8. canvas_state version + auto-increment trigger
-- ════════════════════════════════════════════════════════════════════
--
-- Optimistic locking: any UPDATE bumps the version, so two-tab races
-- resolve as 409 + refetch instead of silent overwrites.

ALTER TABLE canvas_state
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_canvas_state_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'canvas_state_version_bump'
  ) THEN
    CREATE TRIGGER canvas_state_version_bump
      BEFORE UPDATE ON canvas_state
      FOR EACH ROW
      EXECUTE FUNCTION bump_canvas_state_version();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 9. create_cluster_with_entries RPC
-- ════════════════════════════════════════════════════════════════════
--
-- The old createCluster service did two writes back-to-back: insert
-- the cluster row, then insert the cluster_panels junction rows. If
-- the second one fails the first is already committed and we get an
-- orphan cluster. The RPC wraps both writes in a Postgres function,
-- which Supabase runs atomically — either both inserts land or
-- neither does.
--
-- The TS service layer keeps the canvas-side-effects (brain panel +
-- canvas_state hydration) outside the RPC because they're already
-- non-fatal and tolerant of partial success.

CREATE OR REPLACE FUNCTION create_cluster_with_entries(
  p_canvas_id UUID,
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
  INSERT INTO clusters (canvas_id, user_id, name, slug)
  VALUES (p_canvas_id, p_user_id, p_name, p_slug)
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

-- The RPC is invoked exclusively from server-side code via the
-- service role. By default Postgres grants EXECUTE on functions to
-- PUBLIC, which means anon + authenticated roles can call the RPC
-- via Supabase's PostgREST RPC endpoint as if they were service role
-- (because of SECURITY DEFINER). Revoke that — only service role can
-- call this. The TS service layer's `resolveActiveCanvas` gates
-- access before the function is ever touched on the server side.

REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_cluster_with_entries(UUID, UUID, TEXT, TEXT, UUID[]) TO service_role;
