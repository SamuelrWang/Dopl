-- Team workspaces are invite-only for now (Samuel, 2026-10-15). The rail's
-- "+ new workspace" opens a popup with a "Request Access" button; a press records
-- the account here. ONE row per user: a second press is a no-op, not a second row.
--
-- Written by the app through `/api/user/workspace-access-request` (service role,
-- scoped to the authenticated user id). RLS still lets a signed-in user insert and
-- read only their own row, so a direct client never sees anyone else's request.

CREATE TABLE IF NOT EXISTS public.workspace_access_requests (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_access_requests IS
  'Accounts that pressed Request Access on the gated new-workspace popup. One row per user (PK). See src/app/api/user/workspace-access-request/route.ts.';

ALTER TABLE public.workspace_access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_access_requests_insert_own" ON public.workspace_access_requests;
CREATE POLICY "workspace_access_requests_insert_own"
  ON public.workspace_access_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "workspace_access_requests_select_own" ON public.workspace_access_requests;
CREATE POLICY "workspace_access_requests_select_own"
  ON public.workspace_access_requests
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.workspace_access_requests FROM anon;
GRANT SELECT, INSERT ON public.workspace_access_requests TO authenticated;
