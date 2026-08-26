-- HOME CHANNELS, INVERTED — a container is minted by "New channel", and a
-- person is added to it AFTERWARDS (Samuel's ruling, 2026-08-24).
--
-- ✅ APPLIED. Deploy state is a measurement, not a claim: re-derive with
-- `supabase migration list` (or the MCP `list_migrations`) and with the
-- VERIFICATION block below. ⚠ THE HISTORY VERSION IS NOT THIS FILENAME — this
-- file went in as version `20260825063725`, which is F-304's re-stamp
-- reproducing on the very migration that documents it. JOIN ON THE NAME
-- (`home_channel_containers`), never on the prefix (INVARIANTS §12).
--
-- ── WHAT INVERTS ───────────────────────────────────────────────────────────
-- BEFORE (20260823150000): a link was minted UNBOUND, and CLAIMING it minted a
-- brand-new two-member container plus a DIRECT channel. There was no way to
-- have a home channel by yourself, and no way to add somebody to one you
-- already had — the relationship and the container were born together.
--
-- AFTER: "New channel" mints a ONE-member container holding a PRIVATE,
-- NON-DIRECT channel — a place the operator's own agents work, with nobody
-- else in it. Adding a person is a second, later act: a link BOUND to that
-- container (`channel_links.workspace_id`), whose claim INSERTS the peer as a
-- member of the container that already exists. A container therefore grows
-- exactly once, from one member to two.
--
-- ⚠ THE LEGACY UNBOUND PATH SURVIVES AND IS NOT DEAD CODE. Measured 2026-08-24
-- against the live project: 2 open claimable tokens, 0 claims, all with
-- `workspace_id IS NULL`. Those URLs are in somebody's chat history and must
-- keep working, so NULL keeps its old meaning — mint a container on claim —
-- and non-NULL means join the named one. One column, two claim branches.
--
-- ── THE COLUMN ─────────────────────────────────────────────────────────────
--   channel_links.workspace_id  NULL     = legacy UNBOUND link (claim mints its
--                                          own container, exactly as before).
--                               non-NULL = BOUND link (claim inserts the
--                                          claimer into THAT container).
--                               ON DELETE CASCADE: a deleted container must not
--                                          leave a token pointing at nothing —
--                                          claiming it would 500 rather than
--                                          410, and the row is not audit history
--                                          worth keeping once its container is
--                                          gone (the claims it produced cascade
--                                          from `workspaces` already).
--
-- ── WHY A PARTIAL UNIQUE INDEX AND NOT AN APPLICATION CHECK ───────────────
-- `channel_links_one_open_per_workspace` allows at most ONE un-revoked bound
-- link per container. The service reads the open link first and returns it
-- (the `getOrCreateJoinLink` precedent), so the index is not the common path —
-- it is what makes two concurrent mints CONVERGE instead of racing: the loser
-- gets 23505 and re-reads the winner's row. Without it, two tabs pressing "Add
-- person" produce two live tokens for one seat, and whichever is claimed second
-- gets LINK_CONTAINER_FULL from a link the app told the operator to send.
-- ⚠ Its predicate is `revoked_at IS NULL` and NOTHING ELSE, deliberately: the
-- service's `findOpenLinkForWorkspace` must select exactly the row set this
-- index constrains, or the converge-on-conflict re-read can come back empty.
--
-- ── WHY THE CAP IS A TRIGGER ───────────────────────────────────────────────
-- MVP is 0-or-1 peer. A CHECK constraint cannot count sibling rows, and the
-- service-layer refusals (`assertMemberAddable*`, LINK_CONTAINER_CLOSED) are
-- a TOCTOU under concurrency: two claims of two different bound links for the
-- same container each read "one member" and both insert. The trigger takes a
-- FOR UPDATE lock on the parent `workspaces` row first — the same serialization
-- point, and the same lock-ordering argument, as
-- `enforce_last_active_owner` (20260720184806) — so the second transaction
-- counts after the first has committed.
-- ⚠ THE COUNT EXCLUDES `NEW.user_id`, which is what makes re-activating an
-- existing member idempotent rather than an error: a member whose row goes
-- revoked → active must not be refused by their own row.
--
-- ── NO INDEX ON `workspaces.kind`, STILL ───────────────────────────────────
-- Unchanged from 20260823150000: both readers reach `workspaces` by primary key
-- after entering through `workspace_members.user_id`. The two indexes this file
-- adds are the exception that proves the rule — each has a named statement
-- (below), which is §12's whole test.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. The column, nullable, with its FK:
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='channel_links'
--      AND column_name='workspace_id';
--
--   -- 2. Both indexes, and the trigger:
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='channel_links';
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='public.workspace_members'::regclass AND NOT tgisinternal;
--
--   -- 3. THE BEHAVIOUR, which the catalog cannot confirm: with a kind='link'
--   --    workspace holding two active members, a third INSERT must raise
--   --    LINK_CONTAINER_FULL, and re-activating either existing member must
--   --    NOT.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
-- In a NEW migration: drop the trigger, then the function, then both indexes,
-- then `channel_links.workspace_id`. ⚠ ORDERING TRAP, the mirror of
-- 20260823150000's: dropping the column while BOUND links are open turns every
-- one of them back into an UNBOUND link, so the next claim mints a SECOND
-- container for a pair that already shares one — revoke the bound links first
-- (`UPDATE channel_links SET revoked_at = now() WHERE workspace_id IS NOT
-- NULL`), or leave the column. Prose rather than commented-out SQL, per the
-- precedent in 20260822160000_channel_launch_directives.sql.

-- ===========================================================================
-- channel_links.workspace_id — the binding
-- ===========================================================================
ALTER TABLE public.channel_links
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.channel_links.workspace_id IS
  'NULL = legacy UNBOUND link: the claim mints its own container (the 2026-08-23 model, still live for tokens already in the wild). Non-NULL = BOUND link: the claim inserts the claimer into THIS container, which already exists and already has one member.';

-- THE CHIP READ (`home/server/repository.ts › listLinksByWorkspaces` — the
-- pending-link chip rendered on a solo channel's row), and the FK cover for
-- `workspaces(id) ON DELETE CASCADE`, which §12 counts as a named statement in
-- its own right. Partial: unbound rows are the legacy tail and are never
-- reached by workspace.
CREATE INDEX IF NOT EXISTS channel_links_workspace_idx
  ON public.channel_links (workspace_id)
  WHERE workspace_id IS NOT NULL;

-- AT MOST ONE OPEN BOUND LINK PER CONTAINER — see the header. The 23505 is the
-- convergence point, not an error the operator ever sees.
CREATE UNIQUE INDEX IF NOT EXISTS channel_links_one_open_per_workspace
  ON public.channel_links (workspace_id)
  WHERE workspace_id IS NOT NULL AND revoked_at IS NULL;

-- ===========================================================================
-- enforce_link_container_member_cap — MVP is 0-or-1 peer
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.enforce_link_container_member_cap()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_kind    TEXT;
  v_others  INTEGER;
BEGIN
  -- Only ACTIVE rows occupy a seat. A pending or revoked row costs nothing.
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Serialize every membership write for this workspace on the PARENT row,
  -- then read `kind` under that lock. Standard workspaces fall straight
  -- through — this trigger is on the hottest membership path in the schema and
  -- must cost one indexed primary-key read there.
  SELECT w.kind INTO v_kind
    FROM public.workspaces AS w
   WHERE w.id = NEW.workspace_id
     FOR UPDATE;

  IF v_kind IS DISTINCT FROM 'link' THEN
    RETURN NEW;
  END IF;

  -- ⚠ EXCLUDES `NEW.user_id`: re-activating an existing member must not be
  -- refused by their own row (see the header).
  SELECT count(*) INTO v_others
    FROM public.workspace_members AS m
   WHERE m.workspace_id = NEW.workspace_id
     AND m.status = 'active'
     AND m.user_id <> NEW.user_id;

  IF v_others >= 2 THEN
    RAISE EXCEPTION
      'LINK_CONTAINER_FULL: a home container holds at most two members'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_link_container_member_cap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_link_container_member_cap() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_link_container_member_cap() FROM authenticated;

DROP TRIGGER IF EXISTS workspace_members_enforce_link_cap ON public.workspace_members;
CREATE TRIGGER workspace_members_enforce_link_cap
  BEFORE INSERT OR UPDATE OF status ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_link_container_member_cap();

-- ===========================================================================
-- Comments the inversion makes stale
-- ===========================================================================
COMMENT ON COLUMN public.workspaces.kind IS
  'standard = a real user-facing workspace. link = a hidden home-channel container holding ONE OR TWO members and exactly one channel: minted either by "New channel" (solo, self-owned, for agent orchestration) or by a legacy unbound claim (two members at birth). It grows exactly once, when a link BOUND to it is claimed. Never in the rail or the switcher, never a default-resolution candidate, bills to each side''s own plan.';

COMMENT ON COLUMN public.channel_link_claims.workspace_id IS
  'The container this claim RESOLVED TO — minted by the claim when the link was unbound, or JOINED by the claim when the link carried a workspace_id. Not necessarily created by this row.';

-- ===========================================================================
-- Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'channel_links'
       AND column_name = 'workspace_id'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_links.workspace_id is missing — every mint would be unbound and "Add person" would mint a second container instead of filling the one on screen';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'channel_links_workspace_idx'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_links_workspace_idx is missing — the chip read and the workspaces FK cascade both scan';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'channel_links_one_open_per_workspace'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_links_one_open_per_workspace is missing — concurrent mints would produce two live tokens for one seat, and the second claim would be refused a link the app handed out';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.workspace_members'::regclass
       AND tgname = 'workspace_members_enforce_link_cap'
  ) THEN
    RAISE EXCEPTION
      'ABORT: workspace_members_enforce_link_cap is missing — the two-member cap would be a service-layer claim only, and two concurrent claims would both pass it';
  END IF;

  -- Unchanged from 20260823150000, restated because this file touches the
  -- table: nothing subscribes to channel_links, and nobody but the service
  -- writes it.
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'channel_links'
  ) THEN
    RAISE EXCEPTION
      'ABORT: channel_links is published to supabase_realtime — this table has no subscriber by design (the home surface refetches on write)';
  END IF;

  IF has_table_privilege('authenticated', 'public.channel_links', 'INSERT')
     OR has_table_privilege('authenticated', 'public.channel_links', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.channel_links', 'DELETE')
     OR has_table_privilege('anon', 'public.channel_links', 'INSERT')
     OR has_table_privilege('anon', 'public.channel_links', 'UPDATE')
     OR has_table_privilege('anon', 'public.channel_links', 'DELETE') THEN
    RAISE EXCEPTION
      'ABORT: authenticated/anon retain a write on channel_links — workspace_id is now an AUTHORIZATION input (which container a claim joins), so a forged one would insert the forger into somebody else''s container';
  END IF;

  RAISE NOTICE
    'home channel containers: channel_links.workspace_id (NULL = legacy unbound), one-open-bound-link-per-container unique index, and the two-member cap trigger. The unbound claim branch is intentionally still live.';
END
$$;
