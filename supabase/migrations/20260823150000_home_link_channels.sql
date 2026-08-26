-- HOME CHANNELS — account-level 1:1 channels between two people, carried by a
-- hidden `kind='link'` container workspace (Samuel's ruling, 2026-08-23).
--
-- ✅ APPLIED. ⚠ THIS HEADER SAID "WRITTEN, NOT APPLIED" FOR A DAY AFTER IT WAS
-- LIVE — corrected 2026-08-24. Deploy state is a measurement: re-derive with
-- `supabase migration list` (or the MCP `list_migrations`), and JOIN ON THE
-- NAME — this file applied under version `20260823205007`, not its filename
-- prefix, which is what made the stale claim look verified (INVARIANTS §12,
-- REFACTOR-FINDINGS F-304).
--
-- ⚠ SUPERSEDED IN PART by `20260824120000_home_channel_containers.sql`: a
-- container is minted by "New channel" with ONE member now, and the claim path
-- below is the LEGACY UNBOUND branch. It is still live — open unbound tokens
-- exist — so nothing here was rolled back.
--
-- ── WHAT IT IS ─────────────────────────────────────────────────────────────
-- One person mints a LINK. Whoever opens it and signs in CLAIMS it, and the
-- claim mints a two-member workspace holding exactly one direct channel. From
-- that point the pair talk over the ordinary channels surface — same routes,
-- same realtime, same MCP — because the container IS an ordinary workspace.
--
-- ── WHY A WORKSPACE AND NOT A NEW KIND OF CHANNEL ─────────────────────────
-- Every fence in this system is keyed on `workspace_id`: RLS
-- (`is_current_workspace_member`), the realtime subscription filter, the
-- channel-child workspace guard trigger, MCP workspace targeting, credits. A
-- channel with no workspace would need a second, parallel statement of each of
-- them, and the second copy is the one that drifts. `kind` is one column on the
-- table those fences already key on; a two-member container inherits all of it.
--
-- ⚠ THE CONSEQUENCE, stated so nobody re-derives it as a bug: link containers
-- are REAL ROWS in `workspaces` and in `workspace_members`. Every read that
-- enumerates "the caller's workspaces" — the switcher, resolution, seat billing
-- — must now say which kinds it means. That sweep is not in this file.
--
-- ── THE COLUMNS ────────────────────────────────────────────────────────────
--   channel_links.token       the unguessable half of the claim URL. Cleartext,
--                             like `workspace_invitations.token`: the table is
--                             service-role scoped and the token's whole job is
--                             to be pasted into a URL.
--   channel_links.max_uses    NULL = unlimited. Consumed by
--                             `consume_channel_link` and by nothing else.
--   channel_links.revoked_at  SOFT. The row is the audit trail of what was
--                             minted and who took it; a delete would take the
--                             claims with it (CASCADE) and erase the answer to
--                             "where did this relationship come from".
--   channel_link_claims       one row per successful claim, naming the container
--                             it minted.
--
-- ── THE ONE RACE, AND WHERE IT IS HELD ────────────────────────────────────
-- Two people (or one person twice) opening a SINGLE-USE link at the same instant
-- must not both get in. `consume_channel_link` is a single guarded UPDATE: under
-- READ COMMITTED the second statement blocks on the first's row lock and then
-- re-evaluates its own WHERE against the committed row, so `use_count <
-- max_uses` is re-checked after the increment it was racing. No advisory lock is
-- needed and none is taken — the row lock the UPDATE already holds is the
-- serialization point.
-- ⚠ The SECOND race is a pair claiming twice concurrently on a MULTI-use link,
-- which the use guard does not touch. `channel_link_claims_link_claimer_key` is
-- what makes that impossible to produce two containers for: the loser's INSERT
-- conflicts and the service converges on the winner's workspace.
--
-- ── NO INDEX ON `workspaces.kind`, DELIBERATELY ───────────────────────────
-- §12's rule is that an index exists only if a named statement uses it. Both
-- readers of `kind` — the relationships list here, and the resolution/billing
-- sweep elsewhere — enter through `workspace_members` on `user_id` and reach
-- `workspaces` by primary key; `kind` is a per-row filter on a handful of
-- already-fetched rows, never a leading column. A partial index would be write
-- cost on the hottest table in the schema buying nothing.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The column and its CHECK:
--   SELECT column_name, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'workspaces' AND column_name = 'kind';
--
--   -- 2. Policies are SELECT-only on both new tables:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('channel_links','channel_link_claims');
--
--   -- 3. THE BEHAVIOUR, which the catalog cannot confirm: mint a link with
--   --    max_uses = 1, claim it from two sessions at once, and exactly one
--   --    gets a container while the other reads 410.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
-- In a NEW migration: drop channel_link_claims, then channel_links, then
-- consume_channel_link, then the workspaces.kind column. ⚠ Dropping `kind`
-- while link containers exist turns every one of them into an ordinary
-- workspace in the switcher — delete the containers first or leave the column.
-- Written as prose rather than as commented-out SQL, per the precedent in
-- `20260822160000_channel_launch_directives.sql`.

-- ===========================================================================
-- workspaces.kind
-- ===========================================================================
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.workspaces'::regclass
       AND conname = 'workspaces_kind_check'
  ) THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('standard', 'link'));
  END IF;
END
$$;

COMMENT ON COLUMN public.workspaces.kind IS
  'standard = a real user-facing workspace. link = a hidden two-member container minted by a home-channel claim: never in the rail or the switcher, never a default-resolution candidate, bills to each side''s own plan.';

-- ===========================================================================
-- channel_links — the minted, not-yet-claimed invite
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.channel_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  label            TEXT,
  expires_at       TIMESTAMPTZ,
  -- NULL = unlimited. ⚠ Only `consume_channel_link` may move `use_count`.
  max_uses         INT CHECK (max_uses IS NULL OR max_uses > 0),
  use_count        INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE "MY PENDING LINKS" READ, and the FK cover for `auth.users` ON DELETE
-- CASCADE. One index, two named statements.
CREATE INDEX IF NOT EXISTS channel_links_creator_created_idx
  ON public.channel_links (creator_user_id, created_at DESC);

ALTER TABLE public.channel_links ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.channel_links FROM authenticated, anon;

-- CREATOR-ONLY READ. ⚠ A claimer never selects the link row: everything the
-- claim page may show is served by the API from the service role, deliberately
-- narrowed (`HomeLinkPublicInfo` — a display name and three booleans, never the
-- creator's email or id).
CREATE POLICY channel_links_creator_select
  ON public.channel_links
  FOR SELECT
  USING (creator_user_id = (SELECT auth.uid()));

-- ===========================================================================
-- channel_link_claims — one row per successful claim
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.channel_link_claims (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id      UUID NOT NULL REFERENCES public.channel_links(id) ON DELETE CASCADE,
  claimed_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The container this claim minted. CASCADE: a deleted container leaves no
  -- claim pointing at a workspace that is gone.
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ⚠ THE SECOND RACE'S GUARD (see the header). Also the FK cover for
  -- `channel_links` ON DELETE CASCADE, as a leading column.
  CONSTRAINT channel_link_claims_link_claimer_key UNIQUE (link_id, claimed_by)
);

-- FK cover: `workspaces(id) ON DELETE CASCADE`.
CREATE INDEX IF NOT EXISTS channel_link_claims_workspace_idx
  ON public.channel_link_claims (workspace_id);

-- FK cover: `auth.users(id) ON DELETE CASCADE`, and the claimer's own read.
CREATE INDEX IF NOT EXISTS channel_link_claims_claimer_idx
  ON public.channel_link_claims (claimed_by);

ALTER TABLE public.channel_link_claims ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.channel_link_claims FROM authenticated, anon;

-- BOTH PARTIES READ. ⚠ The EXISTS arm is evaluated under the CALLER's role, so
-- `channel_links_creator_select` applies inside it — which is exactly the fence
-- wanted here: it can only ever find a link the caller minted.
CREATE POLICY channel_link_claims_party_select
  ON public.channel_link_claims
  FOR SELECT
  USING (
    claimed_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.channel_links l
       WHERE l.id = channel_link_claims.link_id
         AND l.creator_user_id = (SELECT auth.uid())
    )
  );

-- ===========================================================================
-- consume_channel_link — the atomic use guard
-- ===========================================================================
-- Returns the post-increment `use_count` when the link was still available, and
-- NO ROW otherwise (revoked, expired, or exhausted). ⚠ The caller must treat an
-- empty result as 410 and must not re-read the row to decide — the whole point
-- is that the decision and the increment are one statement.
--
-- SECURITY INVOKER + service_role-only EXECUTE, matching
-- `channels_last_message`: an authenticated user must not be able to burn
-- someone's link over `/rest/v1/rpc`.
CREATE OR REPLACE FUNCTION public.consume_channel_link(p_link_id uuid)
  RETURNS TABLE (use_count int)
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
  UPDATE public.channel_links AS l
     SET use_count = l.use_count + 1
   WHERE l.id = p_link_id
     AND l.revoked_at IS NULL
     AND (l.expires_at IS NULL OR l.expires_at > now())
     AND (l.max_uses IS NULL OR l.use_count < l.max_uses)
  RETURNING l.use_count;
$function$;

REVOKE ALL ON FUNCTION public.consume_channel_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_channel_link(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.consume_channel_link(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_channel_link(uuid) TO service_role;

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('channel_links', 'channel_link_claims')
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION
      'ABORT: a non-SELECT policy exists on channel_links/channel_link_claims — every write must go through the service on the admin client, where the creator is stamped from the authenticated context and the use guard lives';
  END IF;

  -- Per-table, because a SELECT-only POLICY set proves nothing while the GRANT
  -- underneath it still allows the write (20260822200000_agent_templates.sql).
  FOREACH t IN ARRAY ARRAY['channel_links', 'channel_link_claims'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
       WHERE oid = ('public.' || t)::regclass AND relrowsecurity
    ) THEN
      RAISE EXCEPTION
        'ABORT: RLS is not enabled on % — the SELECT policies above would be decoration and every row would be readable by anyone with the anon key', t;
    END IF;

    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION
        'ABORT: authenticated/anon retain INSERT/DELETE on % — a link could be minted with a forged creator, or a claim erased to un-connect a pair the other side still sees', t;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE EXCEPTION
        'ABORT: % is published to supabase_realtime — this table has no subscriber by design (the home surface refetches on write); publishing it buys WAL decode and a per-subscription RLS evaluation on every write and delivers nothing', t;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.channel_links', 'UPDATE')
     OR has_table_privilege('anon', 'public.channel_links', 'UPDATE') THEN
    RAISE EXCEPTION
      'ABORT: authenticated/anon can UPDATE channel_links — use_count would not be guarded by consume_channel_link, and revoked_at would be self-service';
  END IF;

  IF has_function_privilege('authenticated', 'public.consume_channel_link(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.consume_channel_link(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'ABORT: authenticated/anon can EXECUTE consume_channel_link — anyone reaching /rest/v1/rpc could exhaust any link whose id they learned';
  END IF;

  RAISE NOTICE
    'home link channels created: workspaces.kind, channel_links + channel_link_claims (party-only SELECT, service-role writes), consume_channel_link as the single-statement use guard. No index on workspaces.kind — see the header.';
END
$$;
