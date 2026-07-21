-- Revoke the default PUBLIC EXECUTE on the two SECURITY DEFINER trigger
-- functions added earlier in this branch (H-5 last-owner guard, H-4 ontology
-- relationship CAS bump).
--
-- Both are trigger functions (RETURNS trigger) owned by postgres. They inherit
-- the default PUBLIC EXECUTE grant, which trips the Supabase security advisor
-- (lints 0028/0029: SECURITY DEFINER function executable by anon/authenticated)
-- and is inconsistent with the rest of this branch (which revokes such grants,
-- e.g. is_current_workspace_member). The grant is inert — Postgres refuses a
-- direct call to a trigger function ("trigger functions can only be called as
-- triggers", SQLSTATE 0A000) before the body runs, and trigger firing does not
-- depend on the EXECUTE grant — but revoke it so no standing advisor WARN ships.

REVOKE EXECUTE ON FUNCTION public.enforce_last_active_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_ontology_object_on_relationship_change() FROM PUBLIC, anon, authenticated;
