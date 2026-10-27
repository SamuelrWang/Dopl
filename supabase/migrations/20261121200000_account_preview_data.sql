-- ACCOUNT_PREVIEW_DATA — per-account seeded demo content for /home surfaces whose real data source
-- does not exist yet (agents by computer, routing, reach order, approvals; identity tools and logs).
-- A row is written by hand (service role) for one account; the product reads only the viewer's own
-- rows through `GET /api/home/preview` and draws a card only when its part of the payload exists.
-- No user id lives in code: an account without rows sees the product unchanged.
--
-- ROLLBACK (prose): DROP TABLE public.account_preview_data. Nothing else reads or references it.
-- To remove one account's preview: DELETE FROM public.account_preview_data WHERE user_id = '<id>'.

CREATE TABLE IF NOT EXISTS public.account_preview_data (
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  surface    text        NOT NULL CHECK (surface IN ('overview', 'identities')),
  payload    jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surface)
);

COMMENT ON TABLE public.account_preview_data IS
  'Seeded demo payloads per account and /home surface. Service role only; read by src/app/api/home/preview/route.ts.';

ALTER TABLE public.account_preview_data ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_preview_data FROM anon, authenticated;
GRANT ALL ON public.account_preview_data TO service_role;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.account_preview_data'::regclass) THEN
    RAISE EXCEPTION 'ABORT: RLS is off on account_preview_data';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_preview_data') THEN
    RAISE EXCEPTION 'ABORT: account_preview_data must carry no policy (service role only)';
  END IF;
  IF has_table_privilege('anon', 'public.account_preview_data', 'SELECT')
     OR has_table_privilege('authenticated', 'public.account_preview_data', 'SELECT')
     OR has_table_privilege('authenticated', 'public.account_preview_data', 'INSERT') THEN
    RAISE EXCEPTION 'ABORT: account_preview_data is reachable by anon/authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.account_preview_data', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: service_role cannot read account_preview_data';
  END IF;
END $$;
