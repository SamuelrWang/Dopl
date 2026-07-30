-- Realtime WALRUS evaluates every SELECT policy on a published table as the SUBSCRIBER's
-- role. An `anon` subscriber (a signed-out tab, or a client that joined without calling
-- setAuth) therefore executes these two helpers -- and lacking EXECUTE raised
-- 42501 "permission denied for function is_current_workspace_member" inside
-- realtime.apply_rls(), which kills the CDC pipeline for EVERY subscriber, not just the
-- offending one (observed in prod 2026-07-29 22:58Z-23:20Z, repeating every ~30s, traced
-- from the desktop app joining as anon when its stored JWT had expired).
--
-- Granting EXECUTE exposes nothing: both helpers are SECURITY DEFINER and resolve the
-- caller from auth.uid(), which is NULL for anon, so they return FALSE (verified against
-- prod) and the policy denies every row exactly as before. This converts a tenant-wide
-- outage into a correct per-subscriber denial. Reverse with REVOKE ... FROM anon.
--
-- These are the ONLY two functions referenced by SELECT/ALL policies on the 22 tables in
-- the supabase_realtime publication; any NEW policy helper on a published table must get
-- the same grant or it reintroduces this failure mode.
GRANT EXECUTE ON FUNCTION public.is_current_workspace_member(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.is_channel_member(uuid) TO anon;
