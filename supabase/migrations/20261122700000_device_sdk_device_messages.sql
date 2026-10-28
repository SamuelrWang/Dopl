-- ============================================================================
-- DEVICE SDK — the lens queue of an SDK-owned G2 (A8, 2026-10-27)
-- ============================================================================
-- docs/specs/device-sdk/SPEC-v1.md › C9. An SDK end user has no Dopl account
-- (D1), so `glasses_messages` (keyed by `auth.users`) cannot hold what a
-- developer delivers to their user's glasses. `dev_device_messages` is the SAME
-- row shape keyed by `devices.id` instead: the glasses plugin reads it through
-- the same device routes (`/api/glasses/device/{inbox,answer,dismiss}`), the
-- same inbox/answer code (`glasses/core/messages/inbox.ts`) and the same
-- compiler (`platforms/even-g2`), authenticated by the device's
-- `device_credentials` token.
--
--   * `device_id` — the SDK device (`devices`, SDK owner shape). Every query in
--     `device-sdk/server/glasses/sdk-glasses-store.ts` filters on it.
--   * The `dev_actions` row a lens message serves is found by
--     `dev_actions.result ->> 'lens_message_id'` (the adapter's result), so this
--     table carries no FK into `dev_actions`.
--   * `updated_at` is stamped by the DB with the prosumer table's own trigger
--     function (`glasses_messages_touch_updated_at`, which reads only status /
--     payload / answer / expires_at): one clock for the inbox cursor.
--
-- ADDITIVE ONLY: one new table. RLS on with NO policy: service role only.
-- Apply by name; replays cleanly.

CREATE TABLE IF NOT EXISTS public.dev_device_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('notify', 'show', 'ask', 'screen')),
  card_id text NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'answered', 'dismissed', 'expired')),
  answer jsonb NULL,
  spec jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS dev_device_messages_device_updated_idx
  ON public.dev_device_messages (device_id, updated_at);

CREATE INDEX IF NOT EXISTS dev_device_messages_device_status_idx
  ON public.dev_device_messages (device_id, status, expires_at);

DROP TRIGGER IF EXISTS dev_device_messages_touch_updated_at ON public.dev_device_messages;
CREATE TRIGGER dev_device_messages_touch_updated_at
  BEFORE UPDATE ON public.dev_device_messages
  FOR EACH ROW EXECUTE FUNCTION public.glasses_messages_touch_updated_at();

ALTER TABLE public.dev_device_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dev_device_messages FROM anon, authenticated;

-- Answers resolve the `dev_actions` row by the lens message id the adapter returned.
CREATE INDEX IF NOT EXISTS dev_actions_device_lens_message_idx
  ON public.dev_actions (device_id, (result ->> 'lens_message_id'))
  WHERE (result ->> 'lens_message_id') IS NOT NULL;
