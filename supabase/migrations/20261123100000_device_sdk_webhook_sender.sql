-- DEVICE SDK WEBHOOK SENDER (P3) — endpoints, per-endpoint deliveries, the attempt log, and the
-- RPCs the sender drives. Spec: docs/specs/device-sdk/SPEC-v1.md › C8 (webhooks: signed, retried,
-- replayable). Rulings: KB orchestration-guidelines › Plans/"Dopl SDK - Webhook Sender".
--
--   * `dev_webhook_endpoints` — one developer URL per project + env. `enabled_events` NULL = every
--     event. The signing secret (`whsec_…`) lives in SUPABASE VAULT (`vault.secrets`), never in a
--     column: `secret_id` / `previous_secret_id` point at the vault rows. `previous_secret_id` is the
--     rotated-out secret, still signed with until `previous_secret_expires_at` (overlap window).
--     Deleting an endpoint (or its project) deletes its vault rows (trigger below).
--   * `dev_webhook_deliveries` — one per (outbox event, endpoint). `attempts` counts tries in the
--     CURRENT run (a replay resets it to 0); `status` pending → delivered | failed (dead-letter).
--     `locked_until` is the sender's lease so two concurrent sender runs never send one delivery twice.
--   * `dev_webhook_attempts` — one row per HTTP try, ever (`attempt` is per delivery, monotonic across
--     replays). The portal reads these. `response_body` is capped at 1 KiB, `error` at 500 chars.
--   * `dev_webhook_outbox.status = 'delivered'` now means FANNED OUT (copied into one delivery per
--     matching endpoint); per-endpoint delivery state lives in `dev_webhook_deliveries`.
--
-- Writer and reader: `src/features/device-sdk/server/webhooks/` (service role).
--
-- SECURITY. Every table is service role only (RLS on, no policy, REVOKEd from anon/authenticated).
-- Every function is SECURITY INVOKER with a pinned search_path, EXECUTE revoked from
-- PUBLIC/anon/authenticated and granted to service_role only (INVARIANTS §9). Asserted at the end.
--
-- ADDITIVE ONLY. Replays cleanly (IF NOT EXISTS / CREATE OR REPLACE).
-- ROLLBACK (prose): DROP FUNCTION public.dev_webhook_create_endpoint, public.dev_webhook_rotate_secret,
-- public.dev_webhook_endpoint_secrets, public.dev_webhook_fan_out, public.dev_webhook_claim,
-- public.dev_webhook_record_attempt, public.dev_webhook_replay; DROP TRIGGER
-- dev_webhook_endpoints_vault_cleanup ON public.dev_webhook_endpoints; DROP FUNCTION
-- public.dev_webhook_endpoints_vault_cleanup(); DROP TABLE public.dev_webhook_attempts,
-- public.dev_webhook_deliveries, public.dev_webhook_endpoints; then delete vault rows named
-- 'dev_webhook_endpoint:%'.

-- ── dev_webhook_endpoints ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_webhook_endpoints (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env                        text        NOT NULL CHECK (env IN ('test', 'live')),
  url                        text        NOT NULL CHECK (url ~ '^https://' AND length(url) <= 2048),
  description                text        NULL CHECK (description IS NULL OR length(description) <= 500),
  enabled_events             text[]      NULL CHECK (enabled_events IS NULL OR (
                                           cardinality(enabled_events) > 0 AND enabled_events <@ ARRAY[
                                             'connection.created', 'connection.revoked', 'connection.needs_reauth',
                                             'device.offline', 'device.online', 'action.completed', 'action.failed',
                                             'ask.answered', 'input.utterance'
                                           ]::text[])),
  secret_id                  uuid        NOT NULL,
  previous_secret_id         uuid        NULL,
  previous_secret_expires_at timestamptz NULL,
  disabled_at                timestamptz NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CHECK ((previous_secret_id IS NULL) = (previous_secret_expires_at IS NULL))
);

CREATE INDEX IF NOT EXISTS dev_webhook_endpoints_project_env_idx
  ON public.dev_webhook_endpoints (project_id, env, created_at);

-- ── dev_webhook_deliveries ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_webhook_deliveries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id        uuid        NOT NULL REFERENCES public.dev_webhook_outbox (id) ON DELETE CASCADE,
  endpoint_id      uuid        NOT NULL REFERENCES public.dev_webhook_endpoints (id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env              text        NOT NULL CHECK (env IN ('test', 'live')),
  event_type       text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz NULL,
  last_status_code integer     NULL,
  last_error       text        NULL CHECK (last_error IS NULL OR length(last_error) <= 500),
  delivered_at     timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, endpoint_id)
);

CREATE INDEX IF NOT EXISTS dev_webhook_deliveries_due_idx
  ON public.dev_webhook_deliveries (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS dev_webhook_deliveries_endpoint_idx
  ON public.dev_webhook_deliveries (endpoint_id, created_at DESC, id DESC);

-- ── dev_webhook_attempts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_webhook_attempts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   uuid        NOT NULL REFERENCES public.dev_webhook_deliveries (id) ON DELETE CASCADE,
  attempt       integer     NOT NULL CHECK (attempt >= 1),
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  status_code   integer     NULL,
  error         text        NULL CHECK (error IS NULL OR length(error) <= 500),
  duration_ms   integer     NOT NULL CHECK (duration_ms >= 0),
  response_body text        NULL CHECK (response_body IS NULL OR length(response_body) <= 1024),
  UNIQUE (delivery_id, attempt)
);

COMMENT ON TABLE public.dev_webhook_endpoints IS
  'Device SDK webhook endpoint (C8). Signing secrets live in vault.secrets (secret_id, previous_secret_id). Service role only.';
COMMENT ON TABLE public.dev_webhook_deliveries IS
  'One Device SDK webhook event bound for one endpoint: retry state + dead-letter (status failed). Service role only.';
COMMENT ON TABLE public.dev_webhook_attempts IS
  'One HTTP attempt of a webhook delivery (portal delivery log). Service role only.';
COMMENT ON TABLE public.dev_webhook_outbox IS
  'Device SDK webhook events (C8). status delivered = fanned out into dev_webhook_deliveries. Service role only.';

ALTER TABLE public.dev_webhook_endpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_webhook_attempts   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dev_webhook_endpoints  FROM anon, authenticated;
REVOKE ALL ON public.dev_webhook_deliveries FROM anon, authenticated;
REVOKE ALL ON public.dev_webhook_attempts   FROM anon, authenticated;

GRANT ALL ON public.dev_webhook_endpoints  TO service_role;
GRANT ALL ON public.dev_webhook_deliveries TO service_role;
GRANT ALL ON public.dev_webhook_attempts   TO service_role;

-- ── Vault cleanup: an endpoint takes its secrets with it ──────────────────────
CREATE OR REPLACE FUNCTION public.dev_webhook_endpoints_vault_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id IN (OLD.secret_id, OLD.previous_secret_id);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS dev_webhook_endpoints_vault_cleanup ON public.dev_webhook_endpoints;
CREATE TRIGGER dev_webhook_endpoints_vault_cleanup
  AFTER DELETE ON public.dev_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.dev_webhook_endpoints_vault_cleanup();

-- ── Create: endpoint row + its vault secret, one transaction ──────────────────
CREATE OR REPLACE FUNCTION public.dev_webhook_create_endpoint(
  p_project_id uuid,
  p_env text,
  p_url text,
  p_description text,
  p_enabled_events text[],
  p_secret text
)
RETURNS SETOF public.dev_webhook_endpoints
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_secret_id uuid;
BEGIN
  IF p_secret IS NULL OR p_secret !~ '^whsec_[A-Za-z0-9+/]{40,}={0,2}$' THEN
    RAISE EXCEPTION 'dev_webhook_create_endpoint: malformed secret' USING ERRCODE = '22023';
  END IF;
  v_secret_id := vault.create_secret(p_secret, 'dev_webhook_endpoint:' || v_id::text || ':' || gen_random_uuid()::text);
  RETURN QUERY
  INSERT INTO public.dev_webhook_endpoints (id, project_id, env, url, description, enabled_events, secret_id)
  VALUES (v_id, p_project_id, p_env, p_url, p_description, p_enabled_events, v_secret_id)
  RETURNING *;
END $$;

-- ── Rotate: new current secret; the old one signs alongside until the overlap ends ──
-- p_overlap_seconds = 0 drops the old secret at once. A secret already in its overlap window is
-- dropped by the next rotation (only one previous secret is kept).
CREATE OR REPLACE FUNCTION public.dev_webhook_rotate_secret(
  p_endpoint_id uuid,
  p_new_secret text,
  p_overlap_seconds integer
)
RETURNS SETOF public.dev_webhook_endpoints
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row public.dev_webhook_endpoints;
  v_new_id uuid;
BEGIN
  IF p_new_secret IS NULL OR p_new_secret !~ '^whsec_[A-Za-z0-9+/]{40,}={0,2}$' THEN
    RAISE EXCEPTION 'dev_webhook_rotate_secret: malformed secret' USING ERRCODE = '22023';
  END IF;
  IF p_overlap_seconds IS NULL OR p_overlap_seconds < 0 OR p_overlap_seconds > 604800 THEN
    RAISE EXCEPTION 'dev_webhook_rotate_secret: overlap must be 0..604800 seconds' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.dev_webhook_endpoints WHERE id = p_endpoint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_row.previous_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_row.previous_secret_id;
  END IF;
  v_new_id := vault.create_secret(p_new_secret, 'dev_webhook_endpoint:' || p_endpoint_id::text || ':' || gen_random_uuid()::text);
  IF p_overlap_seconds = 0 THEN
    DELETE FROM vault.secrets WHERE id = v_row.secret_id;
    RETURN QUERY
    UPDATE public.dev_webhook_endpoints
       SET secret_id = v_new_id, previous_secret_id = NULL, previous_secret_expires_at = NULL, updated_at = now()
     WHERE id = p_endpoint_id
    RETURNING *;
  ELSE
    RETURN QUERY
    UPDATE public.dev_webhook_endpoints
       SET secret_id = v_new_id,
           previous_secret_id = v_row.secret_id,
           previous_secret_expires_at = now() + make_interval(secs => p_overlap_seconds),
           updated_at = now()
     WHERE id = p_endpoint_id
    RETURNING *;
  END IF;
END $$;

-- ── Secrets for signing: current + previous (only while its overlap lasts) ────
CREATE OR REPLACE FUNCTION public.dev_webhook_endpoint_secrets(p_endpoint_ids uuid[])
RETURNS TABLE (endpoint_id uuid, secret text, previous_secret text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT e.id,
         cur.decrypted_secret,
         CASE WHEN e.previous_secret_expires_at > now() THEN prev.decrypted_secret END
    FROM public.dev_webhook_endpoints e
    JOIN vault.decrypted_secrets cur ON cur.id = e.secret_id
    LEFT JOIN vault.decrypted_secrets prev ON prev.id = e.previous_secret_id
   WHERE e.id = ANY (p_endpoint_ids);
$$;

-- ── Fan out: pending outbox events → one delivery per matching enabled endpoint ──
-- Returns how many outbox rows were fanned out. An event with no matching endpoint is fanned out
-- to nobody (an endpoint registered later never receives past events).
CREATE OR REPLACE FUNCTION public.dev_webhook_fan_out(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM (
    SELECT o.id
      FROM public.dev_webhook_outbox o
     WHERE o.status = 'pending' AND o.next_attempt_at <= now()
     ORDER BY o.created_at
     LIMIT greatest(1, least(p_limit, 500))
     FOR UPDATE SKIP LOCKED
  ) picked;

  INSERT INTO public.dev_webhook_deliveries (outbox_id, endpoint_id, project_id, env, event_type)
  SELECT o.id, e.id, o.project_id, o.env, o.event_type
    FROM public.dev_webhook_outbox o
    JOIN public.dev_webhook_endpoints e
      ON e.project_id = o.project_id
     AND e.env = o.env
     AND e.disabled_at IS NULL
     AND (e.enabled_events IS NULL OR o.event_type = ANY (e.enabled_events))
   WHERE o.id = ANY (v_ids)
  ON CONFLICT (outbox_id, endpoint_id) DO NOTHING;

  -- Stamp the project's pinned API version into the body before any endpoint sees it.
  UPDATE public.dev_webhook_outbox o
     SET status = 'delivered',
         attempts = o.attempts + 1,
         payload = CASE WHEN o.payload ? 'api_version' THEN o.payload
                        ELSE o.payload || jsonb_build_object('api_version', p.api_version) END
    FROM public.dev_projects p
   WHERE o.id = ANY (v_ids) AND p.id = o.project_id;

  RETURN cardinality(v_ids);
END $$;

-- ── Claim: lease due deliveries to one sender run ─────────────────────────────
CREATE OR REPLACE FUNCTION public.dev_webhook_claim(p_limit integer, p_lease_seconds integer)
RETURNS SETOF public.dev_webhook_deliveries
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.dev_webhook_deliveries d
     SET locked_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
         updated_at = now()
   WHERE d.id IN (
     SELECT id
       FROM public.dev_webhook_deliveries
      WHERE status = 'pending'
        AND next_attempt_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_attempt_at
      LIMIT greatest(1, least(p_limit, 200))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
$$;

-- ── Record one attempt and move the delivery on, atomically ───────────────────
-- p_success → delivered. Else p_next_attempt_at NULL → failed (dead-letter), else pending again.
CREATE OR REPLACE FUNCTION public.dev_webhook_record_attempt(
  p_delivery_id uuid,
  p_status_code integer,
  p_error text,
  p_duration_ms integer,
  p_response_body text,
  p_success boolean,
  p_next_attempt_at timestamptz
)
RETURNS SETOF public.dev_webhook_deliveries
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_attempt integer;
BEGIN
  PERFORM 1 FROM public.dev_webhook_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT coalesce(max(attempt), 0) + 1 INTO v_attempt
    FROM public.dev_webhook_attempts WHERE delivery_id = p_delivery_id;

  INSERT INTO public.dev_webhook_attempts (delivery_id, attempt, status_code, error, duration_ms, response_body)
  VALUES (p_delivery_id, v_attempt, p_status_code, left(p_error, 500), greatest(0, p_duration_ms), left(p_response_body, 1024));

  RETURN QUERY
  UPDATE public.dev_webhook_deliveries
     SET attempts = attempts + 1,
         status = CASE WHEN p_success THEN 'delivered'
                       WHEN p_next_attempt_at IS NULL THEN 'failed'
                       ELSE 'pending' END,
         next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
         delivered_at = CASE WHEN p_success THEN now() ELSE delivered_at END,
         locked_until = NULL,
         last_status_code = p_status_code,
         last_error = left(p_error, 500),
         updated_at = now()
   WHERE id = p_delivery_id
  RETURNING *;
END $$;

-- ── Replay: queue a delivery again with a fresh retry budget ──────────────────
CREATE OR REPLACE FUNCTION public.dev_webhook_replay(p_delivery_id uuid)
RETURNS SETOF public.dev_webhook_deliveries
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.dev_webhook_deliveries
     SET status = 'pending', attempts = 0, next_attempt_at = now(), locked_until = NULL, updated_at = now()
   WHERE id = p_delivery_id
  RETURNING *;
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'dev_webhook_endpoints_vault_cleanup', 'dev_webhook_create_endpoint', 'dev_webhook_rotate_secret',
    'dev_webhook_endpoint_secrets', 'dev_webhook_fan_out', 'dev_webhook_claim',
    'dev_webhook_record_attempt', 'dev_webhook_replay'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', f);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  f text;
  v_oid oid;
BEGIN
  FOREACH t IN ARRAY ARRAY['dev_webhook_endpoints', 'dev_webhook_deliveries', 'dev_webhook_attempts']
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'ABORT: RLS is off on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'ABORT: % must carry no policy (service role only)', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE') THEN
      RAISE EXCEPTION 'ABORT: % is reachable by anon/authenticated', t;
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'dev_webhook_endpoints_vault_cleanup', 'dev_webhook_create_endpoint', 'dev_webhook_rotate_secret',
    'dev_webhook_endpoint_secrets', 'dev_webhook_fan_out', 'dev_webhook_claim',
    'dev_webhook_record_attempt', 'dev_webhook_replay'
  ]
  LOOP
    SELECT p.oid INTO v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'ABORT: public.% is missing', f;
    END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'ABORT: % is SECURITY DEFINER (INVARIANTS §9)', f;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'ABORT: anon/authenticated can EXECUTE %', f;
    END IF;
    IF f <> 'dev_webhook_endpoints_vault_cleanup' AND NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'ABORT: service_role cannot EXECUTE %', f;
    END IF;
  END LOOP;
END $$;
