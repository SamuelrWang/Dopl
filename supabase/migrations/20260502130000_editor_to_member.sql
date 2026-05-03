-- Rename the 'editor' role to 'member' across workspace_members and
-- workspace_invitations.
--
-- Order matters: the existing CHECK constraints reject 'member', so
-- the constraints must be dropped *before* the UPDATE runs. Then the
-- new constraints are re-added on the migrated values.

ALTER TABLE workspace_members
  DROP CONSTRAINT workspace_members_role_check;

ALTER TABLE workspace_invitations
  DROP CONSTRAINT workspace_invitations_invited_role_check;

UPDATE workspace_members SET role = 'member' WHERE role = 'editor';

UPDATE workspace_invitations SET invited_role = 'member' WHERE invited_role = 'editor';

ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner','admin','member','viewer'));

ALTER TABLE workspace_invitations
  ADD CONSTRAINT workspace_invitations_invited_role_check
    CHECK (invited_role IN ('admin','member','viewer'));
