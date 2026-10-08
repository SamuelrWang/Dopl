-- AGENT COLOURS CIRCLE BACK WHEN THE BANK IS FULL (Samuel, 2026-10-08: "it can circle back").
--
-- Until now a seventeenth live agent in one channel ran UNCOLOURED, because the per-channel
-- unique index `channel_sessions_channel_color_live_key` allowed one live holder per key. The
-- picker (`src/features/channels/lib/agent-color-pick.ts`) now REUSES a key when every key is
-- held, and the reconcile stamps that row `color_shared = true`.
--
-- ⚠ WHY A FLAG AND NOT A PLAIN NON-UNIQUE INDEX. Dropping uniqueness outright would also drop the
-- one thing that keeps two CONCURRENT launches into a room with keys left from landing on the
-- same free key (two machines pushing inside the read-then-write window). Keeping the index for
-- exclusive rows and exempting only shared ones keeps that guarantee in the database, with no
-- lock or SQL function: a free assignment still collides and the push's existing 23505 degrade
-- (`repository-session-colors.ts › withoutClaimedColors`) handles it; a reuse never collides.
--
-- ⚠ SAME INDEX NAME, REDEFINED: the degrade narrows on that name, so a rename would silently
-- turn a colour clash into a 500.
--
-- DEPLOY ORDER: no longer load-bearing. The web build tolerates the column being absent
-- (`src/features/channels/server/color-shared-compat.ts`): before this is applied a full room just
-- does not share, and the session push keeps working. Additive, so applying it early is harmless.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.channel_sessions_channel_color_live_idx;
--   DROP INDEX IF EXISTS public.channel_sessions_channel_color_live_key;
--   CREATE UNIQUE INDEX channel_sessions_channel_color_live_key
--     ON public.channel_sessions (channel_id, color)
--     WHERE color IS NOT NULL AND state <> 'ended';
--   ALTER TABLE public.channel_sessions DROP COLUMN IF EXISTS color_shared;
--   (Re-creating the old unique index fails while two live rows share a key: end or recolour
--    the shared rows first.)

ALTER TABLE public.channel_sessions
  ADD COLUMN IF NOT EXISTS color_shared BOOLEAN NOT NULL DEFAULT false;

-- One live EXCLUSIVE holder per key per channel, across members — the rule as before, minus
-- the rows that are knowingly sharing.
DROP INDEX IF EXISTS public.channel_sessions_channel_color_live_key;
CREATE UNIQUE INDEX channel_sessions_channel_color_live_key
  ON public.channel_sessions (channel_id, color)
  WHERE color IS NOT NULL AND state <> 'ended' AND NOT color_shared;

-- The taken-set read counts EVERY live coloured row, shared ones included; the unique index above
-- no longer covers those, so this one serves the read.
CREATE INDEX IF NOT EXISTS channel_sessions_channel_color_live_idx
  ON public.channel_sessions (channel_id, color)
  WHERE color IS NOT NULL AND state <> 'ended';

COMMENT ON COLUMN public.channel_sessions.color_shared IS
  'SERVER-SET (session-colors.ts › resolveReportedColors), never reported by a desktop: TRUE when '
  'this live session REUSES a colour another live session in the channel holds, because every '
  'key was taken (2026-10-08). Exempts the row from channel_sessions_channel_color_live_key; a '
  'shared session keeps its key for life.';
