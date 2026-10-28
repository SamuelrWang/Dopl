-- DEVICE SDK CONNECT (A4) — Connect sessions, connections, the webhook outbox, and the
-- devices FKs that A3 deferred.
-- Spec: docs/specs/device-sdk/SPEC-v1.md › C2 (Connect), C7 (grants), C8 (webhooks); D1.
--
--   * `connect_sessions` — one hosted Connect run for one end user. `token_hash` and
--     `public_token_hash` are lowercase hex sha256 of the raw tokens; the raw tokens are returned
--     once (connect token to the developer, public token to the redirect) and never stored.
--     `branding` is a SNAPSHOT taken at creation (project branding + request override).
--   * `connections` — one end user's grant to one device (C7 layer 2). `granted_scopes` is what
--     the user approved on the consent screen (a subset of the session's `requested_scopes`);
--     `tier_grants` records the risk tier each granted scope was shown under. A T4 grant does NOT
--     waive confirmation: T4 stays confirm-every-call in the policy engine (A5).
--   * `dev_webhook_outbox` — webhook events as rows. Delivery (signing, retries) is P1; this lane
--     only writes `connection.created` / `connection.revoked`.
--   * `glasses_pairings.sdk_device_id` — a G2 pairing claimed THROUGH a Connect session points at
--     an SDK-owned `devices` row instead of a prosumer `glasses_device_links` row
--     (`glasses/core/devices/pairing.ts › claimPairingForConnect`). Never both.
--   * FOLDED A3 FOLLOW-UP: `devices.project_id → dev_projects`, `devices.end_user_id →
--     dev_end_users`, both ON DELETE CASCADE. Added NOT VALID then VALIDATEd: prosumer rows carry
--     NULL in both columns and a NULL never violates a foreign key, so validation passes on every
--     existing row (A3's backfill wrote only prosumer rows).
--
-- Writer and reader: `src/features/device-sdk/server/connect/` (service role).
-- The closed sets below restate `@dopl/contracts/device-sdk` (`ENVIRONMENTS`, `DEVICE_KINDS`,
-- `CONNECTION_STATUSES`, `WEBHOOK_EVENT_NAMES`); `device-sdk-connect-sql.test.ts` pins them.
--
-- RLS: SERVICE ROLE ONLY on the three new tables — RLS on, no policy, REVOKEd from
-- anon/authenticated, asserted by the DO block at the end.
--
-- ADDITIVE ONLY. Replays cleanly (IF NOT EXISTS everywhere; constraints guarded by name).
-- ROLLBACK (prose): DROP TABLE public.dev_webhook_outbox, public.connect_sessions,
-- public.connections; ALTER TABLE public.glasses_pairings DROP COLUMN sdk_device_id;
-- ALTER TABLE public.devices DROP CONSTRAINT devices_project_id_fkey, DROP CONSTRAINT
-- devices_end_user_id_fkey.

-- ── A3 follow-up: the devices FKs ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_project_id_fkey') THEN
    ALTER TABLE public.devices
      ADD CONSTRAINT devices_project_id_fkey FOREIGN KEY (project_id)
      REFERENCES public.dev_projects (id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_end_user_id_fkey') THEN
    ALTER TABLE public.devices
      ADD CONSTRAINT devices_end_user_id_fkey FOREIGN KEY (end_user_id)
      REFERENCES public.dev_end_users (id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.devices VALIDATE CONSTRAINT devices_project_id_fkey;
ALTER TABLE public.devices VALIDATE CONSTRAINT devices_end_user_id_fkey;

COMMENT ON COLUMN public.devices.project_id IS
  'SDK owner: dev_projects.id (FK since 20261122400000). NULL on prosumer rows.';
COMMENT ON COLUMN public.devices.end_user_id IS
  'SDK owner: dev_end_users.id (FK since 20261122400000). NULL on prosumer rows.';

-- ── connections ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connections (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env            text        NOT NULL CHECK (env IN ('test', 'live')),
  end_user_id    uuid        NOT NULL REFERENCES public.dev_end_users (id) ON DELETE CASCADE,
  device_id      uuid        NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  granted_scopes text[]      NOT NULL CHECK (cardinality(granted_scopes) >= 1),
  -- { "<scope>": "<tier>" } as shown on the consent screen.
  tier_grants    jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(tier_grants) = 'object'),
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'revoked')),
  -- Grant TTL ("permission half-life"); NULL = none.
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connections_revoked_shape CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS connections_end_user_idx ON public.connections (project_id, env, end_user_id);
CREATE INDEX IF NOT EXISTS connections_device_idx ON public.connections (device_id);

-- ── connect_sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_sessions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env                     text        NOT NULL CHECK (env IN ('test', 'live')),
  end_user_id             uuid        NOT NULL REFERENCES public.dev_end_users (id) ON DELETE CASCADE,
  -- Snapshot of the developer's id for the end user (D1: never a Dopl user id).
  external_user_id        text        NOT NULL CHECK (char_length(external_user_id) BETWEEN 1 AND 256),
  allowed_kinds           text[]      NOT NULL CHECK (
                                        cardinality(allowed_kinds) >= 1
                                        AND allowed_kinds <@ ARRAY['glasses', 'phone', 'desktop', 'watch', 'home_hub', 'home_device', 'vehicle', 'robot']::text[]
                                      ),
  requested_scopes        text[]      NOT NULL CHECK (cardinality(requested_scopes) >= 1),
  redirect_uri            text        CHECK (redirect_uri IS NULL OR char_length(redirect_uri) <= 2048),
  branding                jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(branding) = 'object'),
  token_hash              text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  public_token_hash       text        UNIQUE CHECK (public_token_hash IS NULL OR public_token_hash ~ '^[0-9a-f]{64}$'),
  public_token_expires_at timestamptz,
  status                  text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paired', 'consented', 'exchanged')),
  device_id               uuid        REFERENCES public.devices (id) ON DELETE SET NULL,
  connection_id           uuid        REFERENCES public.connections (id) ON DELETE SET NULL,
  -- Failed pairing-code attempts on this session (the hosted page caps them).
  claim_attempts          integer     NOT NULL DEFAULT 0 CHECK (claim_attempts >= 0),
  expires_at              timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_sessions_project_env_idx ON public.connect_sessions (project_id, env);
CREATE INDEX IF NOT EXISTS connect_sessions_expires_idx ON public.connect_sessions (expires_at);

-- ── dev_webhook_outbox ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_webhook_outbox (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env             text        NOT NULL CHECK (env IN ('test', 'live')),
  event_type      text        NOT NULL CHECK (event_type IN (
                                'connection.created', 'connection.revoked', 'connection.needs_reauth',
                                'device.offline', 'device.online', 'action.completed', 'action.failed',
                                'ask.answered', 'input.utterance'
                              )),
  payload         jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_webhook_outbox_pending_idx
  ON public.dev_webhook_outbox (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS dev_webhook_outbox_project_env_idx ON public.dev_webhook_outbox (project_id, env, created_at);

-- ── glasses_pairings: a claim through a Connect session ─────────────────────────
ALTER TABLE public.glasses_pairings
  ADD COLUMN IF NOT EXISTS sdk_device_id uuid NULL REFERENCES public.devices (id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'glasses_pairings_one_owner_check') THEN
    ALTER TABLE public.glasses_pairings
      ADD CONSTRAINT glasses_pairings_one_owner_check CHECK (device_id IS NULL OR sdk_device_id IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.glasses_pairings.sdk_device_id IS
  'Set when the pairing was claimed through a Device SDK Connect session (devices.id); device_id stays NULL then.';

COMMENT ON TABLE public.connect_sessions IS
  'Device SDK hosted Connect run (C2). Tokens stored as sha256 hex only. Service role only; src/features/device-sdk/server/connect.';
COMMENT ON TABLE public.connections IS
  'Device SDK connection: an end user''s grant to one device (C2/C7). Service role only.';
COMMENT ON TABLE public.dev_webhook_outbox IS
  'Device SDK webhook events awaiting delivery (C8). Delivery is P1. Service role only.';

ALTER TABLE public.connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_webhook_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.connections        FROM anon, authenticated;
REVOKE ALL ON public.connect_sessions   FROM anon, authenticated;
REVOKE ALL ON public.dev_webhook_outbox FROM anon, authenticated;

GRANT ALL ON public.connections        TO service_role;
GRANT ALL ON public.connect_sessions   TO service_role;
GRANT ALL ON public.dev_webhook_outbox TO service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections', 'connect_sessions', 'dev_webhook_outbox']
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
END $$;
