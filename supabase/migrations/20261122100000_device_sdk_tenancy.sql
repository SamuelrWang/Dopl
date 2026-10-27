-- DEVICE SDK TENANCY (A1) — developer orgs, projects, API keys and end users.
-- Spec: docs/specs/device-sdk/SPEC-v1.md › C1 + §2 (object model) + D1.
--
-- A DEVELOPER signs in with an existing Dopl account and owns an org (`dev_orgs.owner_user_id`).
-- An END USER never has a Dopl account (D1): `dev_end_users` is the developer's own id for them
-- (`external_user_id`), scoped to one project and one environment, and references no auth user.
--
-- API keys are stored HASHED (`key_hash` = lowercase hex sha256 of the raw key); the raw key is
-- shown once at creation and never stored or logged. `prefix` is the short display form
-- (e.g. `sk_live_4fQa`). Rotation sets `expires_at` on the outgoing key (overlap window).
-- Writer and reader: `src/features/device-sdk/server/keys.ts` (service role).
--
-- The closed sets below (env, kind, scopes) restate `@dopl/contracts/device-sdk › keys.ts`
-- (`ENVIRONMENTS`, `API_KEY_KINDS`, `API_KEY_SCOPES`); `device-sdk-tenancy-sql.test.ts` pins them.
--
-- RLS: SERVICE ROLE ONLY. Every table has RLS on, no policy, and no grant to anon/authenticated;
-- portal reads go through the server.
--
-- ROLLBACK (prose): DROP TABLE public.dev_end_users, public.dev_api_keys, public.dev_projects,
-- public.dev_org_members, public.dev_orgs (that order). Nothing else references them.

CREATE TABLE IF NOT EXISTS public.dev_orgs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  -- A Dopl account (developers sign in with Dopl). Deleting the account deletes its orgs.
  owner_user_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_orgs_owner_user_id_idx ON public.dev_orgs (owner_user_id);

CREATE TABLE IF NOT EXISTS public.dev_org_members (
  org_id     uuid        NOT NULL REFERENCES public.dev_orgs (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'developer' CHECK (role IN ('owner', 'admin', 'developer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS dev_org_members_user_id_idx ON public.dev_org_members (user_id);

CREATE TABLE IF NOT EXISTS public.dev_projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.dev_orgs (id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  -- White-label settings (P8): logo, colours, display name. Shape is the portal's; an object here.
  branding    jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(branding) = 'object'),
  -- Dated API version pinned per project, Stripe style (C10). Default = `DEVICE_SDK_API_VERSION`.
  api_version text        NOT NULL DEFAULT '2026-10-27' CHECK (api_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_projects_org_id_idx ON public.dev_projects (org_id);

CREATE TABLE IF NOT EXISTS public.dev_api_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env          text        NOT NULL CHECK (env IN ('test', 'live')),
  kind         text        NOT NULL CHECK (kind IN ('secret', 'publishable')),
  prefix       text        NOT NULL CHECK (char_length(prefix) BETWEEN 4 AND 32),
  key_hash     text        NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes       text[]      NOT NULL CHECK (
                             cardinality(scopes) >= 1
                             AND scopes <@ ARRAY['connect', 'devices:read', 'actions:write', 'analytics:read']::text[]
                           ),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  -- Set on a key being rotated out: it keeps working until then.
  expires_at   timestamptz,
  -- A publishable key may only carry `connect` (C1).
  CONSTRAINT dev_api_keys_publishable_connect_only
    CHECK (kind = 'secret' OR scopes <@ ARRAY['connect']::text[])
);

CREATE INDEX IF NOT EXISTS dev_api_keys_project_env_idx ON public.dev_api_keys (project_id, env);

CREATE TABLE IF NOT EXISTS public.dev_end_users (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL REFERENCES public.dev_projects (id) ON DELETE CASCADE,
  env              text        NOT NULL CHECK (env IN ('test', 'live')),
  -- The developer's own id for this person. Never a Dopl user id (D1).
  external_user_id text        NOT NULL CHECK (char_length(external_user_id) BETWEEN 1 AND 256),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_end_users_project_env_external_key UNIQUE (project_id, env, external_user_id)
);

COMMENT ON TABLE public.dev_orgs IS
  'Device SDK developer org (agent company), owned by a Dopl account. Service role only; src/features/device-sdk/server.';
COMMENT ON TABLE public.dev_org_members IS
  'Dopl accounts that belong to a Device SDK org. Service role only.';
COMMENT ON TABLE public.dev_projects IS
  'Device SDK project: branding + pinned api_version. Keys, end users and (later) devices hang off it. Service role only.';
COMMENT ON TABLE public.dev_api_keys IS
  'Device SDK API keys (C1). key_hash = sha256 hex of the raw key; the raw key is never stored. Service role only.';
COMMENT ON TABLE public.dev_end_users IS
  'A developer''s end user (external_user_id), per project and env. End users never have a Dopl account (D1). Service role only.';

ALTER TABLE public.dev_orgs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_projects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_api_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_end_users   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dev_orgs        FROM anon, authenticated;
REVOKE ALL ON public.dev_org_members FROM anon, authenticated;
REVOKE ALL ON public.dev_projects    FROM anon, authenticated;
REVOKE ALL ON public.dev_api_keys    FROM anon, authenticated;
REVOKE ALL ON public.dev_end_users   FROM anon, authenticated;

GRANT ALL ON public.dev_orgs        TO service_role;
GRANT ALL ON public.dev_org_members TO service_role;
GRANT ALL ON public.dev_projects    TO service_role;
GRANT ALL ON public.dev_api_keys    TO service_role;
GRANT ALL ON public.dev_end_users   TO service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dev_orgs', 'dev_org_members', 'dev_projects', 'dev_api_keys', 'dev_end_users']
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
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'ABORT: service_role cannot read %', t;
    END IF;
  END LOOP;
END $$;
