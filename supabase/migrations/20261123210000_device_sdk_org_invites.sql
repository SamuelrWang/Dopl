-- DEVICE SDK ORG INVITES (P3 portal self-serve, Plans/Dopl SDK Split › §6, §9).
--
-- An org owner or admin invites a person by EMAIL into their developer org with a role
-- (`admin` or `developer`; `owner` is `dev_orgs.owner_user_id` alone and is never invited).
-- The portal shows the invite link ONCE to the inviter; no email is sent yet.
--
-- ⚠ THE TOKEN IS STORED HASHED (`token_hash` = lowercase hex sha256 of the raw token), the same
-- rule as `dev_api_keys.key_hash`: a membership grants key management, so a database read must
-- not hand out a working invite.
-- ⚠ AN INVITE IS BOUND TO ITS EMAIL. Accepting needs a signed-in Dopl account whose confirmed
-- email equals `email` (checked server-side in `features/device-sdk/server/portal-admin.ts`);
-- the link alone is not enough.
-- ⚠ ACCEPT IS A CLAIM: `accepted_at` is set by an UPDATE conditioned on
-- `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, so one invite yields one
-- membership even under a double click.
--
-- At most ONE open invite per (org, email): the partial unique index below. A re-invite while one
-- is open is refused by the server (and by the index on a race).
--
-- RLS: SERVICE ROLE ONLY, the A1 pattern (`20261122100000_device_sdk_tenancy.sql`).
--
-- ROLLBACK (prose): DROP TABLE public.dev_org_invites. Nothing else references it.

CREATE TABLE IF NOT EXISTS public.dev_org_invites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.dev_orgs (id) ON DELETE CASCADE,
  -- Stored lowercased and trimmed; compared lowercased.
  email       text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320 AND email = lower(btrim(email))),
  role        text        NOT NULL CHECK (role IN ('admin', 'developer')),
  token_hash  text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by  uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  CONSTRAINT dev_org_invites_expiry_after_create CHECK (expires_at > created_at),
  CONSTRAINT dev_org_invites_accepted_pair CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);

CREATE INDEX IF NOT EXISTS dev_org_invites_org_id_idx ON public.dev_org_invites (org_id);

CREATE UNIQUE INDEX IF NOT EXISTS dev_org_invites_one_open_per_email
  ON public.dev_org_invites (org_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE public.dev_org_invites IS
  'Device SDK org invite by email (P3). token_hash = sha256 hex of the raw token; accept needs the matching confirmed email. Service role only.';

ALTER TABLE public.dev_org_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dev_org_invites FROM anon, authenticated;
GRANT ALL ON public.dev_org_invites TO service_role;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dev_org_invites'::regclass) THEN
    RAISE EXCEPTION 'ABORT: RLS is off on dev_org_invites';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dev_org_invites') THEN
    RAISE EXCEPTION 'ABORT: dev_org_invites must carry no policy (service role only)';
  END IF;
  IF has_table_privilege('anon', 'public.dev_org_invites', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dev_org_invites', 'SELECT')
     OR has_table_privilege('authenticated', 'public.dev_org_invites', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dev_org_invites', 'UPDATE') THEN
    RAISE EXCEPTION 'ABORT: dev_org_invites is reachable by anon/authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.dev_org_invites', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: service_role cannot read dev_org_invites';
  END IF;
END $$;
