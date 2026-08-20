-- MEMBERS V2 — THE WORKSPACE ACTIVITY FEED.
--
-- One row per thing a member did that another member may legitimately see. The
-- members console renders it per-actor ("what has this person touched"); the
-- shape is workspace-wide so a workspace feed costs no second table.
--
-- ── NO CLIENT READ. AT ALL. ────────────────────────────────────────────────
-- Visibility on this table is NOT expressible in RLS: a row is visible to a
-- caller iff the caller's EFFECTIVE ACCESS reaches the row's resource, and
-- effective access is a computation over teams x grants x role ceiling
-- (`features/teams/effective-access.ts`), not a predicate over this row.
-- A permissive SELECT policy — even `is_current_workspace_member(...)` — would
-- therefore hand any member the whole feed through PostgREST with the anon key,
-- which is precisely the leak the feature exists to prevent.
-- So SELECT is REVOKEd alongside the writes: service_role only, and
-- `GET /members/[userId]/activity` is the one reader. RLS is enabled with no
-- permissive policy so a future GRANT cannot quietly re-open it.
--
-- ── WORKSPACE-LEVEL EVENTS CARRY A NULL RESOURCE ───────────────────────────
-- `resource_type IS NULL` means "joined", "role changed", "invited" — roster
-- facts every member can already read off the members list, so the read route
-- shows them to everyone. Anything with a resource is filtered.
--
-- ── LABELS ARE DENORMALIZED, ON PURPOSE ────────────────────────────────────
-- `metadata.label` is the resource's name AS IT WAS. A feed is a historical
-- record: joining to the live row would rewrite last month's line when a KB is
-- renamed, and would lose the line entirely when it is deleted.
--
-- PUBLICATION: NO (INVARIANTS §7). Nothing subscribes — the console fetches the
-- feed when a member is opened — and a published table with no subscriber costs
-- WAL decode plus a per-subscription RLS evaluation on every write, forever.

CREATE TABLE public.workspace_activity_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  verb          TEXT NOT NULL,
  -- NULL = workspace-level. Otherwise one of the grantable resource types the
  -- access matrix knows, or 'team'.
  resource_type TEXT,
  resource_id   UUID,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_activity_events_verb_check CHECK (
    verb IN (
      'member.joined', 'member.role_changed', 'member.removed', 'member.invited',
      'team.created', 'team.member_added', 'team.member_removed'
    )
  ),
  -- A resource event needs both halves or neither: a type with no id cannot be
  -- filtered, and an id with no type cannot be named.
  CONSTRAINT workspace_activity_events_resource_check CHECK (
    (resource_type IS NULL AND resource_id IS NULL)
    OR (resource_type IS NOT NULL AND resource_id IS NOT NULL)
  ),
  CONSTRAINT workspace_activity_events_resource_type_check CHECK (
    resource_type IS NULL
    OR resource_type IN ('knowledge_base', 'skill', 'chat', 'chat_folder', 'team')
  )
);

-- THE read: one member's feed, newest first.
CREATE INDEX workspace_activity_events_actor_idx
  ON public.workspace_activity_events (workspace_id, actor_user_id, created_at DESC);

-- The workspace-wide feed, and the `workspace_id` FK cascade's cover.
CREATE INDEX workspace_activity_events_workspace_idx
  ON public.workspace_activity_events (workspace_id, created_at DESC);

-- `actor_user_id` cascades from auth.users and does not lead either index above
-- (INVARIANTS §12 — a cascade counts as a named statement).
CREATE INDEX workspace_activity_events_actor_fk_idx
  ON public.workspace_activity_events (actor_user_id);

ALTER TABLE public.workspace_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.workspace_activity_events
  FROM authenticated, anon;

COMMENT ON TABLE public.workspace_activity_events IS
  'Per-actor workspace activity. Service-role only in BOTH directions: the read filter is effective-access, which RLS cannot express, so GET /members/[userId]/activity is the only reader. Out of supabase_realtime.';
