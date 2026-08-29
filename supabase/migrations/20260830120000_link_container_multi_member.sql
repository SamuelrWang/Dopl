-- A HOME CONTAINER HOLDS MORE THAN TWO PEOPLE (Samuel's ruling, 2026-08-26).
--
-- ⚠️ WRITTEN, NOT APPLIED at the time of writing. Deploy state is a MEASUREMENT,
-- not a claim this header can make: re-derive with `supabase migration list` (or
-- the MCP `list_migrations`) **joined on the NAME** (`link_container_multi_member`)
-- and never on the filename prefix — F-304 re-stamps every file in this tree,
-- including the one that documents it (INVARIANTS §12).
--
-- ⚠ FILENAME PREFIX. This file was written on 2026-08-26 and is prefixed
-- `20260830` because the four migrations committed that same day already took
-- `20260826`–`20260829`. The convention in this directory is MONOTONIC ORDER,
-- one slot per file; a today-dated prefix would sort this drop into the middle
-- of an already-written sequence for anyone replaying the tree from empty.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
-- `20260824120000_home_channel_containers.sql` capped a `kind='link'` container
-- at TWO active members with a BEFORE INSERT OR UPDATE OF status trigger on
-- `workspace_members`, raising `LINK_CONTAINER_FULL` past two. MVP was "0 or 1
-- peer" and the cap was how that was held.
--
-- Samuel's ruling retires the number: a home channel is a RELATIONSHIP, and a
-- relationship may have more than two parties. "Add person" stays available
-- after the first peer joins, and each further person arrives the same way the
-- first one did.
--
-- ── WHAT DOES *NOT* CHANGE, AND THIS IS THE HALF THAT MATTERS ──────────────
-- 🔒 **THE LINK-CLAIM LANE IS STILL THE ONLY DOOR.** `workspaces/server/authz.ts
-- › assertMemberAddable` keeps refusing invitations, join links and direct
-- member-add against a `kind='link'` target with `LINK_CONTAINER_CLOSED`. The
-- cap was never what kept strangers out — the CLOSED refusal is, and it is
-- untouched. Dropping the cap widens WHO MAY BE INVITED IN, not HOW.
--
-- 🔒 **A LINK IS STILL SINGLE-USE, AND STILL ONE-OPEN-PER-CONTAINER.** The
-- service pins `maxUses: 1`, the claim revokes the token, and
-- `channel_links_one_open_per_workspace` (this file leaves it alone) still
-- allows at most ONE un-revoked bound link per container. Adding person #3 is a
-- FRESH mint, deliberately: one token admits one named person, so an operator
-- who pastes a link into the wrong window has admitted one stranger rather than
-- opened a room.
--
-- Both indexes on `channel_links`, the `workspace_id` column itself, and the
-- legacy unbound claim branch all stand. This file touches the CAP and nothing
-- else.
--
-- ── WHY A DROP AND NOT A RAISED NUMBER ─────────────────────────────────────
-- A trigger that counts to N is the same trigger with a different constant, and
-- the constant would be a product decision restated in plpgsql where nothing
-- reads it. There is no N. The remaining fence on membership is the one that
-- was always doing the work (`assertMemberAddable`'s CLOSED refusal), so the
-- honest form is to delete the counter rather than to park a number in the
-- database that the product has stopped believing in.
--
-- ⚠ CONSEQUENCE, STATED RATHER THAN DISCOVERED: `home/server/repository-
-- containers.ts › listContainerPeers` takes the FIRST other member with no
-- `ORDER BY`, so `HomeChannel.peer` above two members is non-deterministic —
-- REFACTOR-FINDINGS **F-307**, filed in advance for exactly this day and now
-- LIVE. The ROSTER (`channels-v2/member-roster.tsx`) shows every member and is
-- unaffected; `peer` is a display convenience on the row, not a fence.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The trigger and the function are both gone:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='public.workspace_members'::regclass AND NOT tgisinternal;
--   SELECT proname FROM pg_proc
--    WHERE pronamespace='public'::regnamespace
--      AND proname='enforce_link_container_member_cap';
--
--   -- 2. THE BEHAVIOUR, which the catalog cannot confirm: with a kind='link'
--   --    workspace holding two active members, a THIRD INSERT must now SUCCEED.
--
--   -- 3. What must still refuse — measure it through the APP, not here:
--   --    an invitation / join link / direct add against that same workspace
--   --    still answers LINK_CONTAINER_CLOSED.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
-- In a NEW migration, re-create the function and trigger from
-- `20260824120000_home_channel_containers.sql`. ⚠ ORDERING TRAP: re-arming the
-- cap over containers that have since grown past two members does NOT shrink
-- them — the trigger excludes `NEW.user_id` and fires only on INSERT or a status
-- UPDATE, so existing rows are untouched while the NEXT re-activation of any
-- member of an over-full container is refused. Reduce the rosters first, or
-- accept that the cap applies to writes and not to what is already there.
-- Prose rather than commented-out SQL, per the precedent in
-- 20260822160000_channel_launch_directives.sql.

-- ===========================================================================
-- Drop the cap: trigger first, then the function it calls.
-- ===========================================================================
DROP TRIGGER IF EXISTS workspace_members_enforce_link_cap ON public.workspace_members;
DROP FUNCTION IF EXISTS public.enforce_link_container_member_cap();

-- ===========================================================================
-- The comment the ruling makes stale
-- ===========================================================================
COMMENT ON COLUMN public.workspaces.kind IS
  'standard = a real user-facing workspace. link = a hidden home-channel container holding ONE OR MORE members and exactly one channel: minted either by "New channel" (solo, self-owned, for agent orchestration) or by a legacy unbound claim (two members at birth). It grows one member at a time, each by a claim of a single-use link BOUND to it — there is no other door in (workspaces/server/authz.ts › assertMemberAddable still answers LINK_CONTAINER_CLOSED to every workspace-level add). Never in the rail or the switcher, never a default-resolution candidate, bills to each side''s own plan.';

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.workspace_members'::regclass
       AND tgname = 'workspace_members_enforce_link_cap'
  ) THEN
    RAISE EXCEPTION
      'ABORT: workspace_members_enforce_link_cap survives — a third member would still be refused, and the service no longer has any sentence to translate that raise into';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = 'enforce_link_container_member_cap'
  ) THEN
    RAISE EXCEPTION
      'ABORT: enforce_link_container_member_cap survives with no trigger on it — a dead SECURITY DEFINER function is a thing a future trigger can be pointed at by accident';
  END IF;

  -- ⚠ THE ONE-OPEN-BOUND-LINK INDEX IS NOT PART OF THE CAP AND MUST SURVIVE.
  -- Adding person #3 is a FRESH single-use mint; without this index two tabs
  -- pressing "Add person" produce two live tokens and the operator hands out
  -- two invitations believing they sent one.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'channel_links_one_open_per_workspace'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_links_one_open_per_workspace is missing — single-use-one-at-a-time is the surviving shape of the invitation, and this drop did not touch it';
  END IF;

  RAISE NOTICE
    'link containers are no longer capped at two members. The link-claim lane is still the ONLY door in (assertMemberAddable → LINK_CONTAINER_CLOSED), links are still single-use, and at most one may be open per container at a time.';
END
$$;
