-- DB backstop: a workspace must always keep >= 1 active owner (H-5).
--
-- The app checks "don't demote/remove the last owner" in the service layer, but
-- two owners self-demoting (or being removed) concurrently each read "another
-- owner still exists" and both proceed — a TOCTOU that can leave a workspace with
-- zero owners (orphaned: nobody can manage members or billing). Enforce the
-- invariant in the database, where it holds under concurrency.
--
-- "Active owner" == role = 'owner' AND status = 'active' (matches
-- is_workspace_member's role ladder and the workspace_members.status default).
--
-- TOCTOU closure: before counting, we take a FOR UPDATE lock on the parent
-- workspaces row. Every owner demotion/removal for a given workspace therefore
-- serializes on that single row, so the second concurrent transaction sees the
-- first's committed change and its count reflects reality -> it raises. Using the
-- parent row (not the sibling member rows) avoids the lock-ordering deadlock that
-- two crossed `SELECT ... FOR UPDATE`s on each other's rows would create.
--
-- Cascade safety: guarded by `pg_trigger_depth() = 1` so it fires only for direct
-- membership writes. Deleting a workspace legitimately removes its last owner via
-- FK cascade (member rows deleted at depth >= 2) — that path is skipped, so
-- teardown is never blocked. Benign updates to an owner row (e.g. last_seen_at)
-- return before taking any lock because the row stays an active owner.
--
-- Behavior-changing (a previously-succeeding "remove last owner" now raises), no
-- backfill. Lock scope: a brief FOR UPDATE on the workspaces row, contended only
-- by concurrent owner-role changes / workspace-row updates on the SAME workspace.

CREATE OR REPLACE FUNCTION public.enforce_last_active_owner()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_remaining integer;
BEGIN
  -- Skip cascade-driven writes (e.g. workspace teardown deletes all members).
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- The OLD row must be an active owner for this op to possibly reduce the count.
  IF NOT (OLD.role = 'owner' AND OLD.status = 'active') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- An UPDATE that leaves the row an active owner of the same workspace is a
  -- no-op for the invariant.
  IF TG_OP = 'UPDATE'
     AND NEW.role = 'owner'
     AND NEW.status = 'active'
     AND NEW.workspace_id = OLD.workspace_id THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent owner changes for this workspace on the parent row,
  -- then count the OTHER active owners under that lock.
  PERFORM 1 FROM public.workspaces WHERE id = OLD.workspace_id FOR UPDATE;

  SELECT count(*) INTO v_remaining
  FROM public.workspace_members
  WHERE workspace_id = OLD.workspace_id
    AND role = 'owner'
    AND status = 'active'
    AND id <> OLD.id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION
      'workspace % must retain at least one active owner', OLD.workspace_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS workspace_members_enforce_last_owner ON public.workspace_members;
CREATE TRIGGER workspace_members_enforce_last_owner
  BEFORE UPDATE OR DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_last_active_owner();
