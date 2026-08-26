-- `ensure_default_workspace` — KIND GUARD for home channels (2026-08-23).
--
-- ✅ APPLIED. ⚠ THIS HEADER SAID "WRITTEN, NOT APPLIED" FOR A DAY AFTER IT WAS
-- LIVE — corrected 2026-08-24. Deploy state is a measurement: re-derive with
-- `supabase migration list` (or the MCP `list_migrations`), and JOIN ON THE
-- NAME — this file applied under version `20260823205026`, not its filename
-- prefix (INVARIANTS §12, REFACTOR-FINDINGS F-304).
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
-- One thing: the SELECT that picks an existing default now considers only
-- `kind = 'standard'` workspaces. Nothing else moves — same signature, same
-- advisory lock, same `created` contract, same grants.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- 20260823150000 adds `workspaces.kind` and mints `kind='link'` containers: one
-- hidden two-member workspace per person-to-person relationship, created when a
-- home-channel link is claimed. The CLAIMER OWNS that row, so from this
-- function's point of view a link container is an owned workspace like any
-- other — and it is created LATER than the user's real one, which is exactly
-- the case this guard does not fix by itself. What it does fix is the reverse
-- and far worse case: a user whose only owned workspaces are link containers
-- (invited-only accounts, or anyone who claims a link before ever creating a
-- workspace). Un-guarded, `ensureDefaultWorkspace` would hand them a hidden
-- relationship container as their default workspace — the SPA would boot into a
-- two-person container with no rail, no members page and no plan, and the seed
-- would never run because `created` came back false.
--
-- The app-side mirror (`workspaces/server/repository.ts ›
-- findDefaultWorkspaceForUser`) filters in CODE rather than SQL, because it must
-- keep working against a database where `kind` does not exist yet. This function
-- has no such constraint: file ordering guarantees 20260823150000 has run, so
-- the column is there and the predicate is a plain WHERE.
--
-- ⚠ `create or replace` cannot change a function's return type, so `kind` is
-- deliberately NOT added to the returned columns. It does not need to be: after
-- this change every row this function can return or create is standard, and
-- `mapWorkspaceRow` reads an absent `kind` as `'standard'`.
--
-- Write model unchanged: service-role only (the REVOKEs below re-assert it,
-- since `create or replace` preserves grants but restating them is cheap and
-- makes the file self-contained).

create or replace function public.ensure_default_workspace(
  p_owner_id uuid,
  p_name text,
  p_slug text,
  p_public_id text
)
returns table (
  id uuid,
  owner_id uuid,
  name text,
  slug text,
  public_id text,
  description text,
  icon_url text,
  created_at timestamptz,
  updated_at timestamptz,
  created boolean
)
language plpgsql
as $$
declare
  w public.workspaces%rowtype;
begin
  -- Serialize per owner. hashtextextended gives a stable bigint key; the
  -- constant seed namespaces this lock away from any other advisory use.
  perform pg_advisory_xact_lock(hashtextextended('ensure_default_workspace:' || p_owner_id::text, 0));

  -- Mirror findDefaultWorkspaceForUser: legacy 'default' slug first, then
  -- oldest owned. ⚠ STANDARD only in both branches — a hidden `link` container
  -- is never anybody's default workspace.
  select * into w from public.workspaces
    where workspaces.owner_id = p_owner_id
      and workspaces.slug = 'default'
      and workspaces.kind = 'standard'
    limit 1;
  if not found then
    select * into w from public.workspaces
      where workspaces.owner_id = p_owner_id
        and workspaces.kind = 'standard'
      order by workspaces.created_at asc
      limit 1;
  end if;

  if found then
    return query select w.id, w.owner_id, w.name, w.slug, w.public_id,
      w.description, w.icon_url, w.created_at, w.updated_at, false;
    return;
  end if;

  -- ⚠ `kind` omitted, not spelled: the column DEFAULTs to 'standard', and
  -- letting the default carry it keeps this INSERT the one that 20260823150000
  -- is free to re-shape.
  insert into public.workspaces (owner_id, name, slug, public_id, description)
    values (p_owner_id, p_name, p_slug, p_public_id, null)
    returning * into w;

  insert into public.workspace_members
      (workspace_id, user_id, role, status, joined_at)
    values (w.id, p_owner_id, 'owner', 'active', now());

  return query select w.id, w.owner_id, w.name, w.slug, w.public_id,
    w.description, w.icon_url, w.created_at, w.updated_at, true;
end;
$$;

revoke all on function public.ensure_default_workspace(uuid, text, text, text) from public;
revoke all on function public.ensure_default_workspace(uuid, text, text, text) from anon;
revoke all on function public.ensure_default_workspace(uuid, text, text, text) from authenticated;
