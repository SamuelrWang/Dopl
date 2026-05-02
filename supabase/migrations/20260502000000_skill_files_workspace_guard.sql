-- Defense-in-depth guard: enforce that a `skill_files` row's
-- `workspace_id` always matches its parent `skills` row's
-- `workspace_id`.
--
-- The service layer already prevents drift (every write resolves the
-- skill via `getSkillBySlug(ctx, slug)`, which filters by
-- `ctx.workspaceId`, so `ctx.workspaceId` and the resolved skill's
-- `workspace_id` are always equal). This trigger covers the gap a
-- direct PostgREST/REST insert could exploit by setting a forged
-- `workspace_id` on a skill_files row pointing to a skill in another
-- workspace. RLS already prevents reading foreign skills, but without
-- this trigger an authenticated user could plant inconsistent rows
-- pointing to skill_ids they don't own.
--
-- A CHECK constraint can't reference another table; a trigger can.

CREATE OR REPLACE FUNCTION enforce_skill_files_workspace_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_workspace UUID;
BEGIN
  SELECT workspace_id INTO parent_workspace
  FROM skills WHERE id = NEW.skill_id;
  IF parent_workspace IS NULL THEN
    RAISE EXCEPTION 'skill_files.skill_id % does not exist', NEW.skill_id
      USING ERRCODE = '23503';
  END IF;
  IF parent_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION
      'skill_files.workspace_id (%) must match parent skill.workspace_id (%)',
      NEW.workspace_id, parent_workspace
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'skill_files_enforce_workspace_match'
  ) THEN
    CREATE TRIGGER skill_files_enforce_workspace_match
      BEFORE INSERT OR UPDATE OF workspace_id, skill_id ON skill_files
      FOR EACH ROW EXECUTE FUNCTION enforce_skill_files_workspace_match();
  END IF;
END $$;
