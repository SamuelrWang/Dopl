-- Make the ontology relationship-write CAS actually detect concurrent edge edits (H-4).
--
-- `ontology_objects.updated_at` is the optimistic-concurrency token the ontology
-- service reads and checks (features/ontology/server/service.ts). A relationship-
-- only write goes through `replaceRelationshipsForSource`, which DELETEs every
-- `ontology_relationships` row for the source object and re-INSERTs the new set —
-- it never touches `ontology_objects`, so `updated_at` never moved and the
-- `expected_version` compare-and-swap was a silent no-op: two clients editing the
-- same object's edges could clobber each other undetected.
--
-- Fix: bump the SOURCE object's `updated_at` whenever its relationship rows change.
-- Relationships are keyed by `source_object_id` (that's the row the service CAS-
-- checks and the key `replaceRelationshipsForSource` deletes/inserts by), so the
-- source object is exactly — and only — the object whose version must advance. We
-- deliberately do NOT bump the target object: its own edge set (rows where it is
-- the source) is unchanged, and bumping it would mint false-positive stale-version
-- errors for a concurrent editor of the target.
--
-- Cascade safety: the trigger runs ONLY for direct edge writes (`pg_trigger_depth()
-- = 1`). Relationship rows deleted as a side effect of tearing an object or
-- workspace down (FK ON DELETE CASCADE) fire this trigger nested under the RI
-- action at depth >= 2 and are skipped — so purging/retention/workspace-delete
-- never try to UPDATE a row that the same command is deleting. The `deleted_at IS
-- NULL` guard is belt-and-suspenders (the service only writes edges for live
-- objects). This is additive and behavior-changing only in that stale edge writes
-- now correctly 412 instead of silently winning; no backfill, no lock risk
-- (updates a single already-locked object row per edit).

CREATE OR REPLACE FUNCTION public.bump_ontology_object_on_relationship_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only enforce for direct edge writes; skip cascade-driven deletes
  -- (object/workspace teardown), which fire this trigger nested under an
  -- RI action and must never re-touch the row being deleted.
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.ontology_objects
       SET updated_at = now()
     WHERE id = OLD.source_object_id
       AND deleted_at IS NULL;
    RETURN OLD;
  ELSE
    UPDATE public.ontology_objects
       SET updated_at = now()
     WHERE id = NEW.source_object_id
       AND deleted_at IS NULL;
    RETURN NEW;
  END IF;
END;
$function$;

DROP TRIGGER IF EXISTS ontology_relationships_bump_source ON public.ontology_relationships;
CREATE TRIGGER ontology_relationships_bump_source
  AFTER INSERT OR DELETE OR UPDATE ON public.ontology_relationships
  FOR EACH ROW EXECUTE FUNCTION public.bump_ontology_object_on_relationship_change();
