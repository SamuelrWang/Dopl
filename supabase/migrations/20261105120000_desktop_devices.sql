-- ============================================================================
-- DEVICES — computers running the Dopl desktop app (2026-09-28)
-- ============================================================================
-- One row per desktop INSTALL the user signed into. The desktop registers and
-- heartbeats through `POST /api/devices/heartbeat` with a stable per-install id
-- (kept in its electron-store), the machine's own name (macOS ComputerName),
-- platform and versions. Settings > Connect > Devices lists these beside the
-- paired glasses (`glasses_device_links`); both are "devices connected to the
-- user's agents" and `GET /api/devices` presents them with an open `kind`.
--
-- `mcp_tokens.device_id` links the MCP credentials a desktop mints (its 90-day
-- device token and every per-session container token) to the computer that
-- minted them, so removing a computer revokes exactly its credentials.
--
-- ADDITIVE ONLY: one new table, one nullable column + index. Service role only:
-- RLS on with an owner-only SELECT. Apply by name; replays cleanly.

CREATE TABLE IF NOT EXISTS public.desktop_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  install_id text NOT NULL CHECK (install_id ~ '^[0-9a-fA-F-]{36}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  platform text NOT NULL CHECK (platform IN ('macos', 'windows', 'linux')),
  os_version text NULL CHECK (os_version IS NULL OR char_length(os_version) <= 32),
  app_version text NULL CHECK (app_version IS NULL OR char_length(app_version) <= 32),
  arch text NULL CHECK (arch IS NULL OR char_length(arch) <= 16),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'away', 'offline')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NULL,
  revoked_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS desktop_devices_user_install_uidx
  ON public.desktop_devices (user_id, install_id);

ALTER TABLE public.desktop_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS desktop_devices_owner_select ON public.desktop_devices;
CREATE POLICY desktop_devices_owner_select ON public.desktop_devices
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.mcp_tokens
  ADD COLUMN IF NOT EXISTS device_id uuid NULL
    REFERENCES public.desktop_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mcp_tokens_device_active_idx
  ON public.mcp_tokens (device_id)
  WHERE device_id IS NOT NULL AND revoked_at IS NULL;
