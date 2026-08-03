-- ensure_default_workspace: race-proof SELECT-or-INSERT for the user's
-- default workspace.
--
-- WHY (desktop migration review, 2026-08-02): ensureDefaultWorkspace's
-- catch-23505 recovery has been dead code since the slug uniqueness
-- constraints were dropped (20260502120000 removed owner+slug uniqueness,
-- 20260504000000 removed global slug uniqueness; the only remaining unique
-- key, public_id, is random and never collides). Two concurrent callers
-- (auth callback + a fast client, or two cold-booting desktop windows)
-- could both see "no workspace", both insert, and leave the user with two
-- "Untitled" workspaces. A per-owner transaction-scoped advisory lock
-- serializes the check-then-insert; the lock is held for exactly this
-- function's transaction and keys on the owner id, so different users
-- never contend.
--
-- Write model: service-role only, matching the channels-v1 convention —
-- REVOKE from authenticated/anon; the app's service layer is the caller.
-- The seed of the starter corpus stays app-side, gated on `created`.

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
  -- oldest owned.
  select * into w from public.workspaces
    where workspaces.owner_id = p_owner_id and workspaces.slug = 'default'
    limit 1;
  if not found then
    select * into w from public.workspaces
      where workspaces.owner_id = p_owner_id
      order by workspaces.created_at asc
      limit 1;
  end if;

  if found then
    return query select w.id, w.owner_id, w.name, w.slug, w.public_id,
      w.description, w.icon_url, w.created_at, w.updated_at, false;
    return;
  end if;

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
