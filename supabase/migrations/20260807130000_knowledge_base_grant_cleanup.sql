-- Knowledge-base team-grant GC — the FIFTH per-type trigger (soft-delete
-- removal, §2b).
--
-- `team_resource_access.resource_id` is POLYMORPHIC and carries NO foreign key
-- (20260611020000_teams.sql §3): the column holds a `knowledge_bases.id`, a
-- `workflows.id`, a `chats.id`, a `chat_folders.id` or a `skills.id` depending
-- on `resource_type`, so Postgres cannot cascade the grant rows away when the
-- resource row goes. Every other grantable type closes that gap with its own
-- AFTER DELETE trigger:
--
--   workflows    -> workflow_deleted_grant_cleanup   (20260611020000 §9)
--   chats        -> chat_grants_cleanup              (20260707210000)
--   chat_folders -> chat_folder_grants_cleanup       (20260708120000)
--   skills       -> skill_grants_cleanup             (20260708150000)
--   knowledge_bases -> (nothing)                     <- this migration
--
-- `knowledge_base` was the deliberate exception. 20260611020000 §9 says so in
-- as many words: "KB soft-delete intentionally does NOT purge grants (restore
-- keeps access; rows are inert while deleted_at is set because resolution joins
-- live resources)". That reasoning held only because a deleted KB was a
-- TOMBSTONE — the row survived, restore could bring the grants back with it,
-- and the retention purge eventually collected both.
--
-- As of 2026-08-07 deleting a knowledge base is PERMANENT and IMMEDIATE
-- (`deleteBase` -> `hardDeleteBase`, a real DELETE). There is no restore to
-- preserve access for and no purge cron left to sweep behind it, so the
-- exception now reads as a leak: every hard-deleted KB leaves its grant rows
-- behind forever, keyed to an id nothing will ever resolve again.
--
-- NOT a security hole — access resolution joins the LIVE resource, so an
-- orphaned row grants nothing and a recycled UUID is not a thing Postgres
-- produces. It is unbounded garbage in a table that admins read, and the fix is
-- the one every sibling type already uses.
--
-- Trigger rather than a `DELETE FROM team_resource_access` in `deleteBase`:
-- consistency with the other four, and coverage. The service is not the only
-- thing that deletes a `knowledge_bases` row — `ON DELETE CASCADE` from
-- `workspaces` does too, and so does any future admin path. A trigger fires for
-- all of them; a service-layer delete covers exactly one caller.
--
-- Also sweeps the rows already orphaned by hard deletes that ran before this
-- trigger existed (the anti-join below), since nothing else will.

CREATE OR REPLACE FUNCTION drop_knowledge_base_grants() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM team_resource_access
  WHERE resource_type = 'knowledge_base' AND resource_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS knowledge_base_grants_cleanup ON knowledge_bases;
CREATE TRIGGER knowledge_base_grants_cleanup AFTER DELETE ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION drop_knowledge_base_grants();

-- One-time sweep: grants whose knowledge base is already gone. Scoped to
-- `resource_type = 'knowledge_base'` so the polymorphic column is only ever
-- compared against the table it actually points at for those rows.
DELETE FROM team_resource_access tra
WHERE tra.resource_type = 'knowledge_base'
  AND NOT EXISTS (
    SELECT 1 FROM knowledge_bases kb WHERE kb.id = tra.resource_id
  );

-- Trigger functions never need direct EXECUTE from the API roles
-- (advisor 0028/0029) — same treatment as `delete_workflow_team_grants`.
REVOKE EXECUTE ON FUNCTION public.drop_knowledge_base_grants() FROM PUBLIC, anon, authenticated;
