-- Tidy the grant set on is_current_workspace_member (M-9 follow-up).
--
-- The wrapper picked up an `anon` EXECUTE grant via Supabase's default
-- privileges (which survive `REVOKE ... FROM PUBLIC`), leaving the grant set as
-- {postgres, anon, authenticated, service_role}. It is inert — the function
-- hard-pins the subject to (SELECT auth.uid()), which is NULL for anon, so the
-- membership check returns false and no oracle exists. But an anon-executable
-- SECURITY DEFINER function is exactly what the Supabase security advisor
-- flags, so revoke it to keep the grant set as originally intended
-- (authenticated + service_role) and avoid minting a fresh lint.

REVOKE EXECUTE ON FUNCTION public.is_current_workspace_member(uuid, text) FROM anon;
