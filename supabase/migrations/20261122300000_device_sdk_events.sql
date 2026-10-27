-- DEVICE SDK EVENT LOG (A2) — one `dev_events` row per SDK, REST or MCP call (C8).
-- Spec: docs/specs/device-sdk/SPEC-v1.md › C8; contract: `@dopl/contracts/device-sdk › events.ts`
-- (`DeviceEventRowSchema`). The columns ARE that row, field for field and in its order
-- (`device-sdk-events-sql.test.ts` pins the list): `route_decision`, `confirmation` and
-- `latency_ms` are the contract's nested objects, stored as jsonb.
--
-- Writer: `src/features/device-sdk/server/events.ts › logDevEvent` (service role, batched,
-- fire-and-forget), called by `withDeveloperKey` for every `/api/v1` route.
-- Pruner: `src/app/api/cron/device-sdk-events-prune` (default retention 30 days).
--
-- The closed sets below (env, device_kind, risk_tier, outcome) restate the contracts
-- (`ENVIRONMENTS`, `DEVICE_KINDS`, `RISK_TIERS`, `EVENT_OUTCOMES`); the SQL test pins them.
-- `capability`, `intent` and `error_code` carry no CHECK on purpose: those sets grow by ruling,
-- and a stale CHECK on a log table would drop rows (the writer validates them against zod).
--
-- Id columns other than the PK are text, not FKs: connections do not exist yet, device ids may
-- be simulator ids (C10 magic ids), and an event must outlive the thing it describes.
--
-- RLS: SERVICE ROLE ONLY (the A1 pattern). Portal reads go through the server.
--
-- ROLLBACK (prose): DROP TABLE public.dev_events. Nothing references it.

CREATE TABLE IF NOT EXISTS public.dev_events (
  event_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts               timestamptz NOT NULL DEFAULT now(),
  org_id           uuid        NOT NULL,
  project_id       uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env              text        NOT NULL CHECK (env IN ('test', 'live')),
  external_user_id text,
  connection_id    text,
  device_id        text,
  device_kind      text        CHECK (device_kind IS NULL OR device_kind IN ('glasses', 'phone', 'desktop', 'watch', 'home_hub', 'home_device', 'vehicle', 'robot')),
  vendor           text,
  model            text,
  firmware         text,
  adapter_version  text,
  capability       text,
  intent           text,
  route_decision   jsonb       CHECK (route_decision IS NULL OR jsonb_typeof(route_decision) = 'object'),
  profile_id       text,
  profile_version  integer     CHECK (profile_version IS NULL OR profile_version > 0),
  risk_tier        text        CHECK (risk_tier IS NULL OR risk_tier IN ('T0', 'T1', 'T2', 'T3', 'T4')),
  confirmation     jsonb       CHECK (confirmation IS NULL OR jsonb_typeof(confirmation) = 'object'),
  outcome          text        NOT NULL CHECK (outcome IN ('ok', 'error', 'denied')),
  error_code       text,
  latency_ms       jsonb       NOT NULL CHECK (jsonb_typeof(latency_ms) = 'object'),
  bytes_in         bigint      NOT NULL DEFAULT 0 CHECK (bytes_in >= 0),
  bytes_out        bigint      NOT NULL DEFAULT 0 CHECK (bytes_out >= 0),
  cost_units       numeric     NOT NULL DEFAULT 0 CHECK (cost_units >= 0)
);

-- Portal / analytics reads (C8): recent events per project+env, device mix, top capabilities.
-- The first also covers the project_id FK cascade (leading column).
CREATE INDEX IF NOT EXISTS dev_events_project_env_ts_idx    ON public.dev_events (project_id, env, ts DESC);
CREATE INDEX IF NOT EXISTS dev_events_project_kind_ts_idx   ON public.dev_events (project_id, device_kind, ts);
CREATE INDEX IF NOT EXISTS dev_events_project_cap_ts_idx    ON public.dev_events (project_id, capability, ts);
-- Retention prune: `DELETE ... WHERE ts < cutoff` across every project.
CREATE INDEX IF NOT EXISTS dev_events_ts_idx                ON public.dev_events (ts);

COMMENT ON TABLE public.dev_events IS
  'Device SDK event log (C8): one row per /v1, SDK or MCP call. Written by device-sdk/server/events.ts › logDevEvent; pruned by /api/cron/device-sdk-events-prune. Service role only.';

ALTER TABLE public.dev_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dev_events FROM anon, authenticated;
GRANT ALL ON public.dev_events TO service_role;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dev_events'::regclass) THEN
    RAISE EXCEPTION 'ABORT: RLS is off on dev_events';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dev_events') THEN
    RAISE EXCEPTION 'ABORT: dev_events must carry no policy (service role only)';
  END IF;
  IF has_table_privilege('anon', 'public.dev_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dev_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dev_events', 'INSERT') THEN
    RAISE EXCEPTION 'ABORT: dev_events is reachable by anon/authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.dev_events', 'INSERT') THEN
    RAISE EXCEPTION 'ABORT: service_role cannot write dev_events';
  END IF;
END $$;
