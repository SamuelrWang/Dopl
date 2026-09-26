-- ============================================================================
-- GLASSES MCP PROTOTYPE — message queue + device heartbeat (2026-09-26)
-- ============================================================================
-- Backs `/api/mcp/glasses` (agent side) and `/api/glasses/device/*` (the G2
-- plugin's long-poll). Code: `src/features/glasses/`. ADDITIVE ONLY: two new
-- tables, nothing existing is touched, so it can be dropped wholesale if the
-- prototype is lifted out.
--
-- The server reaches both tables with the service role; the owner-only policies
-- exist so a user-JWT client can never read another user's rows.
-- Apply by name; replays cleanly.

CREATE TABLE IF NOT EXISTS public.glasses_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('notify', 'show', 'ask')),
  card_id text NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'answered', 'dismissed', 'expired')),
  answer jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS glasses_messages_user_status_created_idx
  ON public.glasses_messages (user_id, status, created_at);

ALTER TABLE public.glasses_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS glasses_messages_owner_select ON public.glasses_messages;
CREATE POLICY glasses_messages_owner_select ON public.glasses_messages
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS glasses_messages_owner_update ON public.glasses_messages;
CREATE POLICY glasses_messages_owner_update ON public.glasses_messages
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.glasses_devices (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.glasses_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS glasses_devices_owner_select ON public.glasses_devices;
CREATE POLICY glasses_devices_owner_select ON public.glasses_devices
  FOR SELECT USING (auth.uid() = user_id);
