-- ============================================================================
-- DEVICES — end a removed computer's Dopl sign-in server-side (2026-09-28)
-- ============================================================================
-- Remove (DELETE /api/devices/{id}) already revokes every MCP credential the
-- computer minted. Its Supabase SIGN-IN (refresh token) used to end only when
-- the app next heartbeated and signed itself out. Now:
--   * `desktop_devices.auth_session_id` — the `session_id` claim of the JWT the
--     desktop heartbeats with, stamped by the heartbeat route.
--   * `public.end_auth_session(user, session)` — deletes that one row of
--     `auth.sessions` (its refresh tokens cascade), so the machine cannot
--     refresh. An access token already issued lives out its own expiry.
-- ⚠ SECURITY DEFINER over a caller-supplied subject: EXECUTE is service_role
-- ONLY (the presence_heartbeat_all pattern), and the delete is pinned to the
-- given user so a wrong session id can never end someone else's sign-in.
-- ADDITIVE ONLY: one nullable column, one function. Apply by name.

ALTER TABLE public.desktop_devices
  ADD COLUMN IF NOT EXISTS auth_session_id uuid NULL;

CREATE OR REPLACE FUNCTION public.end_auth_session(p_user_id uuid, p_session_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ended AS (
    DELETE FROM auth.sessions
    WHERE id = p_session_id AND user_id = p_user_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM ended);
$$;

COMMENT ON FUNCTION public.end_auth_session(uuid, uuid) IS
  'Ends one Supabase sign-in of one user (Settings > Connect > Devices > Remove). EXECUTE is service_role ONLY.';

REVOKE ALL ON FUNCTION public.end_auth_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_auth_session(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_auth_session(uuid, uuid) TO service_role;
