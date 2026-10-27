-- ============================================================================
-- DEVICE SDK — one `devices` table + `device_credentials` (A3, 2026-10-27)
-- ============================================================================
-- docs/specs/device-sdk/SPEC-v1.md › §2 object model, C3, C9. Addresses F-770
-- (one table per device type).
--
--   * `devices` — every device of every kind (`@dopl/contracts/device-sdk ›
--     DEVICE_KINDS`, held equal to the `kind` CHECK by
--     `src/features/device-sdk/devices-schema-sql.test.ts`). A row has EXACTLY ONE
--     owner shape (`devices_owner_shape_check`):
--       prosumer: `user_id`                             (a Dopl account)
--       SDK:      `project_id` + `env` + `end_user_id`  (a developer's end user)
--     `adapter_id` / `adapter_version` name the adapter in
--     `src/features/device-sdk/adapters/registry.ts`.
--   * `device_credentials` — SHA-256 hex hashes only (never plaintext), one
--     live credential per (device, kind).
--
-- ⚠ `project_id` / `end_user_id` carry NO foreign key yet: `dev_projects` and
--   `dev_end_users` land in the parallel Lane X migration
--   `20261122100000_*`. The FKs (`→ dev_projects(id)`, `→ dev_end_users(id)`,
--   both ON DELETE CASCADE) are a follow-up migration once both are merged, so
--   the two lanes never collide on one file.
--
-- BACKFILL: the prosumer rows of `glasses_device_links` and `desktop_devices`
-- are copied with their OWN ids (so a later cutover repoints FKs without a
-- remap) and `legacy_source` naming the table. `ON CONFLICT (id) DO NOTHING`
-- makes a replay insert zero rows. Credentials are NOT backfilled: copying
-- token hashes into a table nothing keeps in sync would leave a revoked token
-- live here; the cutover moves them atomically.
--
-- ⚠ NO BEHAVIOUR CHANGE. The old tables stay authoritative for every prosumer
--   path (pairing, MCP, Settings > Devices, heartbeats) until a later cutover;
--   nothing reads `devices` yet and rows created after this backfill are not
--   mirrored.
--
-- ADDITIVE ONLY: two new tables. RLS on with NO policy: service role only.
-- Apply by name; replays cleanly.
--
-- MANUAL IDEMPOTENCY CHECK (no SQL engine runs without Docker here): on a local
-- stack, apply this file, record
--   SELECT legacy_source, count(*) FROM public.devices GROUP BY 1;
-- run the two INSERT … SELECT blocks below again, and the counts are unchanged.

CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL
    CHECK (kind IN ('glasses', 'phone', 'desktop', 'watch', 'home_hub', 'home_device', 'vehicle', 'robot')),
  vendor text NOT NULL CHECK (char_length(vendor) BETWEEN 1 AND 64),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 64),
  firmware text NULL CHECK (firmware IS NULL OR char_length(firmware) <= 64),
  adapter_id text NOT NULL CHECK (adapter_id ~ '^[a-z0-9_]{1,32}$'),
  adapter_version text NOT NULL CHECK (adapter_version ~ '^[0-9][0-9A-Za-z.+-]{0,31}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
  -- Owner, prosumer shape.
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Owner, SDK shape. FKs to dev_projects / dev_end_users: follow-up (see header).
  project_id uuid NULL,
  env text NULL CHECK (env IS NULL OR env IN ('test', 'live')),
  end_user_id uuid NULL,
  -- Which prosumer table a backfilled row came from; NULL for rows born here.
  legacy_source text NULL
    CHECK (legacy_source IS NULL OR legacy_source IN ('glasses_device_links', 'desktop_devices')),
  last_seen timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CONSTRAINT devices_owner_shape_check CHECK (
    (user_id IS NOT NULL AND project_id IS NULL AND env IS NULL AND end_user_id IS NULL)
    OR
    (user_id IS NULL AND project_id IS NOT NULL AND env IS NOT NULL AND end_user_id IS NOT NULL)
  )
);

COMMENT ON COLUMN public.devices.project_id IS
  'SDK owner: dev_projects.id. No FK until Lane X (20261122100000) and A3 are both merged; added in a follow-up migration.';
COMMENT ON COLUMN public.devices.end_user_id IS
  'SDK owner: dev_end_users.id. No FK until Lane X (20261122100000) and A3 are both merged; added in a follow-up migration.';

CREATE INDEX IF NOT EXISTS devices_user_active_idx
  ON public.devices (user_id)
  WHERE user_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS devices_end_user_active_idx
  ON public.devices (project_id, env, end_user_id)
  WHERE project_id IS NOT NULL AND revoked_at IS NULL;

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.devices FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.device_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('device_token', 'assistant_key')),
  -- SHA-256 hex of the secret; the plaintext is returned once and never stored.
  hash text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS device_credentials_live_kind_uidx
  ON public.device_credentials (device_id, kind)
  WHERE revoked_at IS NULL;

ALTER TABLE public.device_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_credentials FROM anon, authenticated;

-- Backfill 1/2: paired glasses. adapter_version = `adapters/even-g2.ts › EVEN_G2_ADAPTER_VERSION`.
INSERT INTO public.devices (
  id, kind, vendor, model, firmware, adapter_id, adapter_version, display_name,
  user_id, legacy_source, last_seen, created_at, revoked_at
)
SELECT
  g.id,
  'glasses',
  CASE g.platform WHEN 'even_g2' THEN 'even_realities' ELSE g.platform END,
  g.platform,
  NULL,
  g.platform,
  '0.1.0',
  g.name,
  g.user_id,
  'glasses_device_links',
  g.last_seen,
  g.created_at,
  g.revoked_at
FROM public.glasses_device_links g
ON CONFLICT (id) DO NOTHING;

-- Backfill 2/2: desktop installs. adapter_version = `adapters/desktop.ts › DESKTOP_ADAPTER_VERSION`.
INSERT INTO public.devices (
  id, kind, vendor, model, firmware, adapter_id, adapter_version, display_name,
  user_id, legacy_source, last_seen, created_at, revoked_at
)
SELECT
  d.id,
  'desktop',
  CASE d.platform WHEN 'macos' THEN 'apple' WHEN 'windows' THEN 'microsoft' ELSE 'linux' END,
  d.platform,
  d.os_version,
  'desktop',
  '0.1.0',
  COALESCE(d.display_name, d.name),
  d.user_id,
  'desktop_devices',
  d.last_seen,
  d.created_at,
  d.revoked_at
FROM public.desktop_devices d
ON CONFLICT (id) DO NOTHING;
