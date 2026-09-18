-- THE HOME SPACE IS PERMANENT — a `kind='personal'` container cannot be deleted
-- (Samuel's ruling R-35 / R-34, 2026-09-17).
--
--   "New users should not be getting a workspace. It should be the home space.
--    Home spaces are the only thing new users get... Each user has a home space,
--    and that should be permanent. Every user will always have a home space, no
--    matter what."
--
-- APPLIED 2026-09-17, by name (`personal_container_permanent`), byte-exact, no
-- `db push`. Deploy state is a MEASUREMENT (INVARIANTS §12): re-derive with
-- `supabase migration list` / MCP `list_migrations` and JOIN ON THE NAME — the
-- history version is not this file's prefix (F-304).
--
-- ⚠ **IT DEPENDS ON `20260920120000_workspace_kind_personal.sql`**, which widens
-- `workspaces_kind_check` to admit `'personal'` and mints one container per
-- `auth.users` row. Applying this file first would install a guard over a value
-- no row can hold — harmless, but it would report itself as protecting
-- something. Apply in filename order.
--
-- ============================================================================
-- WHY A TRIGGER AND NOT ONLY THE APP GATE
-- ============================================================================
-- `features/workspaces/server/service.ts › deleteWorkspaceForUser` refuses the
-- kind (`authz.ts › assertWorkspacePermanent`, 403
-- `PERSONAL_CONTAINER_PERMANENT`). That is the door a human walks through and it
-- is not the only one: `repository.ts › deleteWorkspace` is a plain
-- `.from("workspaces").delete().eq("id", …)` on the SERVICE-ROLE client, so any
-- future caller that skips the service layer destroys a home space and every row
-- that cascades off it — knowledge bases, skills, chats, ontology clusters,
-- channels, the personal shelf. Permanence stated only in TypeScript is a
-- convention; stated here it is an invariant. Same argument, same shape and the
-- same `pg_trigger_depth()` exemption as
-- `20260720184806_workspace_last_active_owner_guard.sql`.
--
-- ============================================================================
-- CASCADE SAFETY — AND IT IS THE WHOLE DESIGN, NOT A FOOTNOTE
-- ============================================================================
-- `workspaces.owner_id` is `REFERENCES auth.users(id) ON DELETE CASCADE`
-- (`20260430190046_canvases_to_workspaces.sql`). **ACCOUNT DELETION MUST STILL
-- WORK.** An unconditional `BEFORE DELETE` guard would make every home space an
-- un-deletable row that pins its owner's `auth.users` row forever — the account
-- delete would raise, and a permanence rule would have become a data-retention
-- bug. So the guard fires ONLY at `pg_trigger_depth() = 1`, i.e. for a DIRECT
-- `DELETE FROM public.workspaces`. The FK cascade deletes at depth >= 2 and is
-- skipped.
--
-- The rule this encodes is therefore exactly the ruling's: **for as long as the
-- account exists, its home space exists.** The container dies with the account
-- and by no other route.
--
-- ⚠ NO BACKFILL AND NO DATA CHANGE. Behaviour-changing only: a previously
-- succeeding `DELETE` of a personal container now raises `check_violation`
-- (SQLSTATE 23514), which is what `deleteWorkspace`'s PostgREST error surfaces.
--
-- ⚠ `link` AND `standard` CONTAINERS ARE UNTOUCHED. A home channel ends when the
-- relationship does; a workspace is deleted by its owner. The predicate is
-- POSITIVE on `'personal'` for the same reason `authz.ts › assertWorkspacePermanent`
-- is — a fourth kind must opt IN to permanence rather than be frozen by a
-- negation somebody wrote about three.

CREATE OR REPLACE FUNCTION public.enforce_personal_container_permanent()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Cascade-driven teardown (account deletion through
  -- `workspaces.owner_id -> auth.users ON DELETE CASCADE`) runs at depth >= 2.
  -- Never block it: the home space is permanent for the life of the ACCOUNT.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF OLD.kind = 'personal' THEN
    RAISE EXCEPTION
      'workspace % is a personal container (home space) and cannot be deleted', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_personal_container_permanent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_personal_container_permanent() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_personal_container_permanent() FROM authenticated;

DROP TRIGGER IF EXISTS workspaces_enforce_personal_permanent ON public.workspaces;
CREATE TRIGGER workspaces_enforce_personal_permanent
  BEFORE DELETE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personal_container_permanent();
