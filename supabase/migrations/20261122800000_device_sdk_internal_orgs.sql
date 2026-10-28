-- DEVICE SDK INTERNAL ORGS (W0.2, Plans/Dopl SDK Split) — a flag for Dopl's own developer orgs.
--
-- Dopl's own app is an SDK customer: it calls `/api/v1` with a key from an org/project named
-- "Dopl App" (seeded by the W0.1 Dopl App seed script). That traffic is real and must show in the
-- portal logs, but it is NOT customer usage: it is never billed and never counted in customer
-- metrics. `dev_orgs.internal = true` marks such an org.
--
-- `dev_billable_events` is the ONE read model for usage, metrics and billing: `dev_events` minus
-- every row whose org is internal. Any usage/billing query reads the view, never `dev_events`
-- directly (`device-sdk-internal-orgs-sql.test.ts` pins the view).
-- Portal LOG reads stay on `dev_events`: a developer sees all of their own calls.
--
-- `dev_events.org_id` is a uuid with no FK (an event outlives its org), so the view
-- excludes by NOT EXISTS: an event whose org row is gone stays billable rather than vanishing.
--
-- ⚠ `SELECT e.*` is expanded ONCE, at CREATE: a column added to `dev_events` later is NOT in the
-- view. Any migration that alters `dev_events` columns must re-run CREATE OR REPLACE VIEW here.
--
-- SECURITY: `security_invoker = true`, so the view has no privileges of its own (the reader's
-- RLS on `dev_events` / `dev_orgs` applies; both are service role only). SELECT to service_role
-- only, the A1 pattern. service_role is in the REVOKE list too: Supabase default privileges hand
-- it ALL on every new relation, and a view needs SELECT alone.
--
-- ROLLBACK (prose): DROP VIEW public.dev_billable_events; ALTER TABLE public.dev_orgs
-- DROP COLUMN internal. Nothing else references either.

ALTER TABLE public.dev_orgs
  ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.dev_orgs.internal IS
  'Dopl''s own org (e.g. "Dopl App"). Its events are excluded from dev_billable_events: never billed, never in customer metrics.';

CREATE OR REPLACE VIEW public.dev_billable_events
WITH (security_invoker = true) AS
  SELECT e.*
  FROM public.dev_events e
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.dev_orgs o
    WHERE o.id = e.org_id
      AND o.internal
  );

COMMENT ON VIEW public.dev_billable_events IS
  'dev_events minus internal orgs (dev_orgs.internal). The read model for usage, metrics and billing. Service role only.';

REVOKE ALL ON public.dev_billable_events FROM anon, authenticated, service_role;
GRANT SELECT ON public.dev_billable_events TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dev_orgs' AND column_name = 'internal'
  ) THEN
    RAISE EXCEPTION 'ABORT: dev_orgs.internal is missing';
  END IF;
  IF has_table_privilege('anon', 'public.dev_billable_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dev_billable_events', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: dev_billable_events is reachable by anon/authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.dev_billable_events', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: service_role cannot read dev_billable_events';
  END IF;
  IF has_table_privilege('service_role', 'public.dev_billable_events', 'INSERT') THEN
    RAISE EXCEPTION 'ABORT: dev_billable_events must be read-only to service_role';
  END IF;
END $$;
