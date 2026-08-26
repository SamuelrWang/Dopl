-- GUEST REALTIME — a channel-membership arm on the four SUBSCRIBED channel-family
-- SELECT policies, so a `guest` receives the doorbell for the one channel they
-- are a member of.
--
-- WHY THIS EXISTS (the regression this closes). The guest web lane
-- (`src/app/c/[workspaceId]`) mounts `StandaloneChannelSurface`, whose live loop
-- is `channel-surface-data.ts › useChannelSurfaceData` → `channels-v2/live.ts ›
-- useChannelsV2Live` → `channels/client/realtime.ts` → `shared-channel-registry.ts`
-- → `getSupabaseBrowser()`. That is a USER client, so the `postgres_changes`
-- binding is filtered by RLS — unlike every guest-reachable HTTP read, which runs
-- through `channels/server/repository.ts` on the service-role client and bypasses
-- RLS entirely. Every policy below gates on
-- `is_current_workspace_member(workspace_id,'viewer')`; a `guest` ranks -1, so it
-- delivered ZERO events. A guest never saw a reply without reloading the page.
--
-- ⚠ THIS IS A REGRESSION THE guest-role WAVE INTRODUCED, not a pre-existing gap.
-- Before M0 a bound claimer landed at `admin`, which cleared the viewer floor, so
-- the same subscription worked. `20260825140000_guest_role.sql`'s header says "No
-- channel_members-based RLS arm is required" — TRUE for the API read path it was
-- reasoning about, and FALSE for realtime. That sentence is corrected by this file.
--
-- ⚠ `/api/channels/[channelId]/await` IS NOT THE FALLBACK. It has no browser
-- caller at all (`grep -rn "/await" src apps packages --include=*.ts --include=*.tsx`
-- → `packages/dopl-client/src/channel.ts` and the desktop only). REFACTOR-FINDINGS
-- F-324 claimed it was; that claim is corrected in the same change.
--
-- ═══ THE EDIT SHAPE, AND WHY IT CANNOT WIDEN ANYBODY ELSE ═══
--
-- Three of the four policies are `A AND B`, where A = the workspace floor and
-- B = the channel fence. They become:
--
--     (A AND B) OR (M AND B')
--
-- where M = `is_current_workspace_member(workspace_id,'guest')` — "an ACTIVE
-- member of this workspace at ANY rank" — and B' = the channel fence with the
-- `visibility='public'` arm REMOVED, i.e. real `channel_members` membership only.
--
-- Case analysis, exhaustive:
--   * NOT an active workspace member  → A false and M false → both disjuncts
--     false. Unchanged.
--   * active at viewer+ → A true, and B' implies B, so the second disjunct can
--     only be true where the first already is. Unchanged, exactly.
--   * active at `guest` (rank -1) → A false (that is the bug), M true, and the
--     row is admitted only if `is_channel_member(...)` holds. NEW, and this is
--     the intended set.
--
-- So the ONLY rows that become visible to anybody are: rows of a channel a
-- `guest` is genuinely a member of. A guest does NOT gain the `visibility='public'`
-- arm — that is deliberate, and it is the one asymmetry in this file: a lowered
-- floor plus an inherited public arm is how a narrow grant turns into a
-- cross-channel read.
--
-- ═══ `agent_presence` IS THE ONE THAT IS NOT SHAPED LIKE THE OTHERS ═══
--
-- It has no channel fence at all — presence is workspace-scoped by construction
-- (`(user_id, workspace_id)` + `last_seen_at`), so there is no B to reuse. It
-- becomes a single `is_current_workspace_member(workspace_id,'guest')` call
-- rather than a second OR-arm, for two reasons:
--   1. COST. `agent_presence` is the highest-churn published table in the schema
--      (a heartbeat per listener per ~30s) and its SELECT policy is re-evaluated
--      per subscriber per write. An OR-arm would roughly double that. §12's "do
--      not tax the hot write path" and §7's first bullet both forbid buying that
--      here; swapping one literal costs exactly zero.
--   2. COHERENCE. `POST /api/channels/presence` is ALREADY at `minRole:"guest"`
--      (Samuel's Q2 ruling: a guest appears in presence). A feed a guest may
--      WRITE and may never READ is incoherent.
-- The rule this states is "an ACTIVE member of a workspace may see who is around
-- in it", which is what the policy always meant — `viewer` was the floor only
-- because it used to be the floor role.
-- ⚠ BLAST RADIUS OF THAT ONE: a `role='guest'` row can only be produced by
-- `channel_links.granted_role` (`20260825150000`), whose CHECK caps at `member`
-- and which only ever binds to a `kind='link'` container; `InvitedRole`
-- (`admin|member|viewer`) cannot grant it. So every guest that exists is inside a
-- two-person container, and the workspace they gain presence for is that.
--
-- ═══ WHAT IS DELIBERATELY NOT TOUCHED ═══
--
-- `channel_tasks`, `channel_task_participants`, `channel_sessions`,
-- `channel_mention_reads`, `channel_consent_requests`, `channel_agents`,
-- `channel_launch_directives`, and every knowledge/skills/ontology/chat/teams/
-- billing policy. NONE of them has a guest-side subscriber and NONE of them is
-- read on the guest's API path (all of those run service-role). A policy arm with
-- no reader is the same speculative cost §12 refuses for an index with no
-- statement — and for the workspace-content tables, denying a guest is the POINT
-- (§4A). Measured 2026-08-26: 58 policies call `is_current_workspace_member`;
-- re-derive with the inventory query in the VERIFICATION block below.
--
-- ⚠ THIS IS A REALTIME CHANGE (§7): it touches the SELECT policy of four
-- PUBLISHED tables. No replica identity and no column grant is touched, so
-- `channel_members`' per-column GRANT (`20260810120000`) and every DELETE-frame
-- property are unchanged. `agent_presence` stays REPLICA IDENTITY DEFAULT (it is
-- on `NO_DELETE_DOORBELL` — rows are never deleted).
--
-- ⚠ NEW FILE — never an edit to an applied migration.
--
-- ROLLBACK (prose). Re-`CREATE OR REPLACE` each of the four policies with the
-- `is_current_workspace_member(workspace_id,'viewer')` form quoted above each
-- statement. NO ORDERING TRAP and no data loss: dropping the arms only re-hides
-- rows. The cost of rolling back is that the guest lane silently stops updating
-- again — the failure with no error shape — so pair it with a poll-based refresh
-- on that surface.

-- ── 1. channels ──────────────────────────────────────────────────────────────
-- WAS: (is_current_workspace_member(workspace_id,'viewer') AND deleted_at IS NULL
--       AND (visibility='public' OR is_channel_member(id)))
DROP POLICY IF EXISTS channels_member_select ON public.channels;
CREATE POLICY channels_member_select ON public.channels
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (
        is_current_workspace_member(workspace_id, 'viewer')
        AND (visibility = 'public' OR is_channel_member(id))
      )
      OR (
        -- The guest arm: workspace membership at ANY rank, plus REAL channel
        -- membership. No `visibility='public'` arm, on purpose.
        is_current_workspace_member(workspace_id, 'guest')
        AND is_channel_member(id)
      )
    )
  );

-- ── 2. channel_members ───────────────────────────────────────────────────────
-- WAS: (is_current_workspace_member(workspace_id,'viewer') AND EXISTS(
--        SELECT 1 FROM channels c WHERE c.id = channel_id AND c.deleted_at IS NULL
--        AND (c.visibility='public' OR is_channel_member(c.id))))
DROP POLICY IF EXISTS channel_members_member_select ON public.channel_members;
CREATE POLICY channel_members_member_select ON public.channel_members
  FOR SELECT
  USING (
    (
      is_current_workspace_member(workspace_id, 'viewer')
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_members.channel_id
          AND c.deleted_at IS NULL
          AND (c.visibility = 'public' OR is_channel_member(c.id))
      )
    )
    OR (
      is_current_workspace_member(workspace_id, 'guest')
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_members.channel_id
          AND c.deleted_at IS NULL
          AND is_channel_member(c.id)
      )
    )
  );

-- ── 3. channel_messages ──────────────────────────────────────────────────────
-- WAS: the channel_members shape, over channel_messages.channel_id.
DROP POLICY IF EXISTS channel_messages_member_select ON public.channel_messages;
CREATE POLICY channel_messages_member_select ON public.channel_messages
  FOR SELECT
  USING (
    (
      is_current_workspace_member(workspace_id, 'viewer')
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_messages.channel_id
          AND c.deleted_at IS NULL
          AND (c.visibility = 'public' OR is_channel_member(c.id))
      )
    )
    OR (
      is_current_workspace_member(workspace_id, 'guest')
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_messages.channel_id
          AND c.deleted_at IS NULL
          AND is_channel_member(c.id)
      )
    )
  );

-- ── 4. agent_presence ────────────────────────────────────────────────────────
-- WAS: is_current_workspace_member(workspace_id,'viewer')
-- One literal, not a second disjunct — see the cost note in the header.
DROP POLICY IF EXISTS agent_presence_member_select ON public.agent_presence;
CREATE POLICY agent_presence_member_select ON public.agent_presence
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'guest'));

-- ── 5. Verification read (INVARIANTS §12) ────────────────────────────────────
-- The commands that confirm this applied:
--   SELECT tablename, policyname, qual FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('channels','channel_members','channel_messages','agent_presence')
--      AND cmd='SELECT';
--   -- inventory of every policy that consults the rank function:
--   SELECT count(*) FROM pg_policies WHERE schemaname='public'
--     AND qual::text LIKE '%is_current_workspace_member%';
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['channels','channel_members','channel_messages','agent_presence']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = t
      AND p.cmd = 'SELECT'
      AND p.qual::text LIKE '%''guest''%'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'guest realtime arm missing on: %', v_missing;
  END IF;

  -- The three channel tables must keep BOTH arms: dropping the viewer arm would
  -- close the surface for everyone else, which no test above would notice.
  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN ('channels','channel_members','channel_messages')
      AND p.cmd = 'SELECT'
      AND p.qual::text NOT LIKE '%''viewer''%'
  ) THEN
    RAISE EXCEPTION 'a channel SELECT policy lost its viewer arm';
  END IF;

  RAISE NOTICE 'guest realtime RLS arm applied to 4 published channel-family SELECT policies';
END $$;
