-- ============================================================================
-- DEVICE SDK — context profiles + the action log (A5, 2026-10-27)
-- ============================================================================
-- docs/specs/device-sdk/SPEC-v1.md › C4, C5, C7, D3.
--
--   * `context_profiles` — a project's OVERRIDES of Dopl's default profiles
--     (`src/features/device-sdk/delivery/default-profiles.ts`). One row per
--     (project, env, profile_id, version); `match` is the C5 `ProfileMatch`
--     (kind / model / posture), `body` the rest of the C5 `ContextProfile`
--     (prompt_append, output, allowed_capabilities, display_template,
--     confirmation, overflow). Both are re-validated against the frozen zod
--     contract on read; an invalid row is skipped, never half-applied.
--     Versioned so events can record `profile_id` + `profile_version` (C8).
--     D3: there is no rewrite option anywhere in `body`; the contract refuses one.
--   * `dev_actions` — every `deliver` and device-level action (C4): status,
--     result, the routing decision, and the IDEMPOTENCY record. One row per
--     (project, env, idempotency_key); `request_hash` (sha256 hex of the
--     canonical request) tells a replay (same hash → same stored response) from
--     a conflict (different hash → `idempotency_conflict`). Also the source of
--     the simple per-project rate limit (rows in the last window).
--
-- ⚠ NOT HERE: `connect_sessions`, `connections`, `dev_webhook_outbox` are the
--   parallel A4 lane's (20261122400000). Grants are read through the
--   `GrantStore` port (`src/features/device-sdk/server/grant-store.ts`).
--
-- ADDITIVE ONLY: two new tables. RLS on with NO policy: service role only.
-- Apply by name; replays cleanly. No backslash anywhere (the MCP SQL transport
-- mangles them).

CREATE TABLE IF NOT EXISTS public.context_profiles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env        text        NOT NULL CHECK (env IN ('test', 'live')),
  profile_id text        NOT NULL CHECK (char_length(profile_id) BETWEEN 1 AND 64),
  match      jsonb       NOT NULL CHECK (jsonb_typeof(match) = 'object' AND match <> '{}'::jsonb),
  body       jsonb       NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  version    integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_profiles_project_env_profile_version_key UNIQUE (project_id, env, profile_id, version)
);

CREATE INDEX IF NOT EXISTS context_profiles_active_idx
  ON public.context_profiles (project_id, env)
  WHERE active;

CREATE TABLE IF NOT EXISTS public.dev_actions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env             text        NOT NULL CHECK (env IN ('test', 'live')),
  end_user_id     uuid        NULL REFERENCES public.dev_end_users (id) ON DELETE CASCADE,
  device_id       uuid        NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  source          text        NOT NULL CHECK (source IN ('deliver', 'action')),
  capability      text        NULL CHECK (capability IS NULL OR char_length(capability) BETWEEN 1 AND 64),
  intent          text        NULL CHECK (intent IS NULL OR intent IN ('message', 'ask', 'notify', 'display')),
  status          text        NOT NULL CHECK (status IN ('queued', 'delivered', 'done', 'failed', 'needs_confirmation')),
  idempotency_key text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  request_hash    text        NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  http_status     integer     NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  response        jsonb       NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  result          jsonb       NULL,
  error           jsonb       NULL,
  route_decision  jsonb       NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_actions_project_env_idempotency_key UNIQUE (project_id, env, idempotency_key)
);

CREATE INDEX IF NOT EXISTS dev_actions_project_env_created_idx
  ON public.dev_actions (project_id, env, created_at DESC);

COMMENT ON TABLE public.context_profiles IS
  'Device SDK context profile overrides (C5), per project and env, versioned. D3: guidance + limits only, never a rewrite. Service role only.';
COMMENT ON TABLE public.dev_actions IS
  'Device SDK deliveries and device actions (C4) with the idempotency record and route decision. Service role only.';

ALTER TABLE public.context_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_actions      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.context_profiles FROM anon, authenticated;
REVOKE ALL ON public.dev_actions      FROM anon, authenticated;

GRANT ALL ON public.context_profiles TO service_role;
GRANT ALL ON public.dev_actions      TO service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['context_profiles', 'dev_actions']
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'ABORT: RLS is off on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'ABORT: % must carry no policy (service role only)', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'ABORT: % is reachable by anon/authenticated', t;
    END IF;
  END LOOP;
END $$;
