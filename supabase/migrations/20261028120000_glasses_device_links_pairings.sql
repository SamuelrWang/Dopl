-- ============================================================================
-- GLASSES — per-device credentials + pairing (2026-09-26, production phase)
-- ============================================================================
-- Replaces the prototype's single env-configured device with rows:
--   * `glasses_device_links` — one row per paired pair of glasses. Credentials
--     are stored as SHA-256 hashes only (`token_hash` = the device bearer,
--     `hey_even_key_hash` = the Hey Even key); the plaintext is returned once.
--     A device may be LINKED to one channel (voice posts there as the owner,
--     agent replies there are mirrored back); `reply_cursor_seq` is that
--     mirror's per-device cursor.
--   * `glasses_pairings` — a short-lived code shown on the lens and claimed by a
--     signed-in user. No token is ever stored: the device token is minted on
--     the first status poll after the claim and only its hash is kept.
-- ADDITIVE ONLY: two new tables. The prototype's `glasses_devices` (keyed by
-- user) is left in place and no longer read; drop it in a later cleanup.
-- Both tables are reached by the service role only; RLS is on, with an
-- owner-only SELECT on devices and no policy at all on pairings.
-- Apply by name; replays cleanly.

CREATE TABLE IF NOT EXISTS public.glasses_device_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Even G2'
    CHECK (char_length(name) BETWEEN 1 AND 64),
  platform text NOT NULL DEFAULT 'even_g2'
    CHECK (platform ~ '^[a-z0-9_]{1,32}$'),
  token_hash text NULL UNIQUE,
  hey_even_key_hash text NULL UNIQUE,
  linked_channel_id uuid NULL REFERENCES public.channels(id) ON DELETE SET NULL,
  linked_container_id uuid NULL REFERENCES public.workspaces(id) ON DELETE SET NULL,
  reply_cursor_seq bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NULL,
  revoked_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS glasses_device_links_user_active_idx
  ON public.glasses_device_links (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.glasses_device_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS glasses_device_links_owner_select ON public.glasses_device_links;
CREATE POLICY glasses_device_links_owner_select ON public.glasses_device_links
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.glasses_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  poll_secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'expired')),
  device_id uuid NULL REFERENCES public.glasses_device_links(id) ON DELETE SET NULL,
  token_issued_at timestamptz NULL,
  claimed_at timestamptz NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A code is unique among PENDING pairings only; expired and claimed codes free up.
CREATE UNIQUE INDEX IF NOT EXISTS glasses_pairings_pending_code_uidx
  ON public.glasses_pairings (code)
  WHERE status = 'pending';

ALTER TABLE public.glasses_pairings ENABLE ROW LEVEL SECURITY;
