-- DEV PORTAL LOG FIELDS (2026-10-31, docs/specs/dev-portal-live/PLAN.md section 5, Phase 1).
--
-- Additive only. Every new column is nullable with no default, so old rows and an older web build
-- are unaffected. `logDevEvent` is hot path: a build that beats this migration drops the new fields
-- and keeps the row (`server/events.ts`, docs/INVARIANTS.md section 12).
--
-- dev_events:
--   api_key_id    the key that made the call (no FK: an analytics row must never fail on a key)
--   action_id     the dev_actions row this call created or moved
--   operation     stable name of the call (deliver, device.action, connect.pair, ...)
--   http_method, route, http_status   the request as the portal shows it
-- dev_actions:
--   delivered_at  when the device took it; settled_at  when it reached done or failed
--
-- dev_billable_events selects e.*, which Postgres expands at creation, so it is re-created here to
-- carry the new columns. Grants and security_invoker are restated and asserted.
--
-- ROLLBACK (prose): re-create dev_billable_events over the old column list, then DROP COLUMN each
-- column above and DROP INDEX dev_events_action_id_idx, dev_events_api_key_ts_idx.

ALTER TABLE public.dev_events
  ADD COLUMN IF NOT EXISTS api_key_id uuid,
  ADD COLUMN IF NOT EXISTS action_id uuid,
  ADD COLUMN IF NOT EXISTS operation text,
  ADD COLUMN IF NOT EXISTS http_method text,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS http_status integer;

CREATE INDEX IF NOT EXISTS dev_events_action_id_idx
  ON public.dev_events (action_id)
  WHERE action_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dev_events_api_key_ts_idx
  ON public.dev_events (api_key_id, ts DESC)
  WHERE api_key_id IS NOT NULL;

ALTER TABLE public.dev_actions
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

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

REVOKE ALL ON public.dev_billable_events FROM anon, authenticated, service_role;
GRANT SELECT ON public.dev_billable_events TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dev_billable_events' AND column_name = 'http_status'
  ) THEN
    RAISE EXCEPTION 'ABORT: dev_billable_events did not gain the new columns';
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
END;
$$;
