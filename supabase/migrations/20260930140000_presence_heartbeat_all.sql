-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ONE HEARTBEAT FOR EVERY CONTAINER — Slack's active/away rule, at rest (2026-09-08, Samuel)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ WRITTEN, NOT APPLIED — §12's standing gate. Docker is unavailable on this machine, so
-- `supabase db reset` cannot start and replay is OWED rather than glossed. The Desktop Agent
-- applies it BY NAME (`presence_heartbeat_all`), never by filename version — F-304's re-stamp.
--
-- ── WHAT SAMUEL REPORTED ────────────────────────────────────────────────────────────────────
--
-- Verbatim (2026-09-08): *"in the members listings, sometimes i see myself go offline, even
-- though my computer is on and dopl is open … It will like flicker back and forth."*
--
-- The mechanism was arithmetic, not luck. `main/presence.js` posted `/api/channels/presence`
-- ONCE PER CONTAINER, SERIALLY, each with a 12 s timeout, on a 30 s interval — and skipped the
-- next tick whenever the previous cycle was still running. Samuel is in 13+ containers. Three
-- slow posts is 36 s; the tick is skipped, the cycle restarts, and `last_seen_at` on the
-- containers at the TAIL of the loop ages past the 90 s window while the machine is wide awake.
-- The roster then reads him offline, the next completed cycle refreshes the row, and the dot
-- comes back: the flicker, exactly as described.
--
-- ── WHAT THIS FILE ADDS ─────────────────────────────────────────────────────────────────────
--
-- 1. `public.presence_heartbeat_all(uuid, text)` — ONE statement that stamps EVERY container
--    the caller is an active member of. N round trips become one, so the cycle cannot outlast
--    its own interval no matter how many containers an operator joins. The whole class of
--    failure — "presence degrades as you join more rooms" — is removed rather than tuned.
--
-- 2. `agent_presence_status_check` widened to admit `'active'` and `'away'`. Those two ARE the
--    Slack semantics the desktop now sends (`away` on suspend / lock-screen / shutdown / quit,
--    and on `powerMonitor.getSystemIdleTime() >= 30 min`; `active` otherwise). The four legacy
--    words STAY — an older desktop still beats `'listening'` and must not start 23514-ing
--    against a server that shipped ahead of it (§13: an older peer is supported).
--
-- ── ⚠ IT IS AN `INSERT … SELECT`, WHICH IS THE ONLY REASON IT IS ONE STATEMENT ───────────────
--
-- PostgREST cannot express "upsert a row per row of a subquery"; supabase-js `.upsert()` takes
-- a client-side array, which would mean the SERVER first reading the membership set and then
-- sending N rows — two round trips and a set that can be stale between them. The RPC reads the
-- membership set and writes the rows inside ONE transaction, so a container joined a
-- millisecond ago is stamped by the same call that discovers it.
--
-- ── ⚠ `SECURITY DEFINER` WITH A `p_user_id` PARAMETER IS SPOOFABLE, AND THAT IS WHY EXECUTE IS
--      REVOKED FROM EVERY LOGIN ROLE ────────────────────────────────────────────────────────
--
-- The parameter exists because the only caller is the SERVICE-ROLE client behind
-- `withUserAuth` (`src/app/api/channels/presence/all/route.ts`), which passes a server-resolved
-- `ctx.userId` — there is no `auth.uid()` to read in that context. A function that trusts a
-- caller-supplied subject MUST NOT be reachable by a caller who can choose it, so:
-- `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` and `GRANT` to `service_role` alone.
-- ⚠ Do NOT add an `authenticated` grant later without first switching the body to `auth.uid()`
-- and dropping the parameter — the grant is the whole fence here.
--
-- ⚠ `SET search_path = public, pg_temp` — a DEFINER function without a pinned search_path is
-- the standard privilege-escalation shape (a caller-created `pg_temp.workspace_members`).
--
-- ── ⚠ NOT A REALTIME CHANGE, AND THIS FILE ASSERTS IT RATHER THAN ASSUMING IT (§7) ───────────
--
-- No SELECT policy, no column GRANT, no publication membership and no replica identity is
-- touched. `agent_presence` stays `REPLICA IDENTITY DEFAULT` (it is on
-- `ui-sync-replica-identity.test.mjs › NO_DELETE_DOORBELL` — its rows are never deleted) and
-- stays in `supabase_realtime`. The closing `DO $$` RAISEs if either has moved.
-- ⚠ The RPC's UPDATEs DO emit frames on that published table — but so did the N per-workspace
-- upserts it replaces, and there are strictly FEWER of them now (one row per container per
-- 30 s, unchanged, minus the duplicate cycles the skipped-tick bug used to produce).
--
-- ── ROLLBACK (prose, per §12; NO ordering trap, NO data loss) ────────────────────────────────
--
--   DROP FUNCTION IF EXISTS public.presence_heartbeat_all(uuid, text);
--   -- then, and ONLY once no row holds one of the two new words:
--   --   UPDATE public.agent_presence SET status = 'listening' WHERE status IN ('active','away');
--   ALTER TABLE public.agent_presence DROP CONSTRAINT agent_presence_status_check;
--   ALTER TABLE public.agent_presence ADD CONSTRAINT agent_presence_status_check
--     CHECK (status IN ('listening', 'busy', 'paused', 'offline'));
--
-- ⚠ THE UPDATE IS NOT OPTIONAL AND IT MUST COME FIRST: a surviving `'away'` row fails the
-- narrowed CHECK on its next UPDATE — i.e. on that operator's next heartbeat — which would 500
-- their presence forever while every other member's kept working. Same trap `20260825140000`
-- records for the guest role, and the same remedy.
-- ⚠ Dropping the FUNCTION alone is safe at any time and needs no data step: the route answers
-- 404 and `main/presence-core.js` falls back to the per-workspace loop, in PARALLEL, on its own.


-- ---------------------------------------------------------------------------
-- 1. The status vocabulary — widen, never replace
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_presence
  DROP CONSTRAINT IF EXISTS agent_presence_status_check;

ALTER TABLE public.agent_presence
  ADD CONSTRAINT agent_presence_status_check
  CHECK (status IN ('listening', 'busy', 'paused', 'offline', 'active', 'away'));

COMMENT ON COLUMN public.agent_presence.status IS
  'Slack-shaped posture: ''active'' (app open, machine awake, input within 30 min) or ''away''. '
  '⚠ ''listening'' / ''busy'' / ''paused'' / ''offline'' are LEGACY words an older desktop still '
  'sends and are read as NOT-away by `repository-collab.ts › presenceForWorkspace`; only the '
  'literal ''away'' suppresses the online dot.';


-- ---------------------------------------------------------------------------
-- 2. The one-statement heartbeat
-- ---------------------------------------------------------------------------
-- Returns the rows it stamped so the caller can report a count without a second read. An
-- operator in zero containers gets zero rows and no error — that is an ANSWER, not a failure
-- (the same reading `channel-listener.js`'s FIX S8 gives an empty workspace enumeration).
CREATE OR REPLACE FUNCTION public.presence_heartbeat_all(
  p_user_id UUID,
  p_status  TEXT
)
RETURNS TABLE (workspace_id UUID, last_seen_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.agent_presence AS ap (user_id, workspace_id, last_seen_at, status)
  SELECT p_user_id, wm.workspace_id, now(), p_status
    FROM public.workspace_members wm
   WHERE wm.user_id = p_user_id
     AND wm.status  = 'active'
  ON CONFLICT (user_id, workspace_id) DO UPDATE
     SET last_seen_at = now(),
         status       = EXCLUDED.status
  RETURNING ap.workspace_id, ap.last_seen_at;
$$;

COMMENT ON FUNCTION public.presence_heartbeat_all(UUID, TEXT) IS
  'One-statement presence heartbeat across every ACTIVE workspace membership of p_user_id. '
  '⚠ SECURITY DEFINER over a caller-supplied subject: EXECUTE is service_role ONLY. Granting it '
  'to `authenticated` would let any signed-in user stamp presence as anybody.';

-- ⚠ THE GRANT IS THE FENCE (see the header). REVOKE FROM PUBLIC first — a new function is
-- EXECUTE-able by PUBLIC by default, so omitting this line grants it to every login role.
REVOKE ALL ON FUNCTION public.presence_heartbeat_all(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_heartbeat_all(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presence_heartbeat_all(UUID, TEXT) TO service_role;


-- ---------------------------------------------------------------------------
-- VERIFICATION — asserts what this file claims, including what it did NOT touch
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- (a) both new words admitted, all four legacy words kept
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent_presence_status_check'
       AND conrelid = 'public.agent_presence'::regclass
       AND pg_get_constraintdef(oid) LIKE '%''away''%'
       AND pg_get_constraintdef(oid) LIKE '%''active''%'
       AND pg_get_constraintdef(oid) LIKE '%''listening''%'
  ) THEN
    RAISE EXCEPTION 'agent_presence_status_check did not widen to active/away while keeping listening';
  END IF;

  -- (b) the function exists, is DEFINER, and has a pinned search_path
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'presence_heartbeat_all'
       AND p.prosecdef
       AND array_to_string(coalesce(p.proconfig, ARRAY[]::text[]), ',') LIKE '%search_path%'
  ) THEN
    RAISE EXCEPTION 'presence_heartbeat_all missing, not SECURITY DEFINER, or has no pinned search_path';
  END IF;

  -- (c) ⚠ NOT reachable by a login role. This is the spoof fence, so it is asserted.
  IF has_function_privilege('authenticated', 'public.presence_heartbeat_all(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.presence_heartbeat_all(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'presence_heartbeat_all is EXECUTE-able by a login role — the subject is spoofable';
  END IF;

  -- (d) ⚠ NOT a realtime change: publication membership and replica identity are UNCHANGED.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_presence'
  ) THEN
    RAISE EXCEPTION 'agent_presence left the realtime publication — this migration must not do that';
  END IF;
  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.agent_presence'::regclass) <> 'd' THEN
    RAISE EXCEPTION 'agent_presence replica identity moved off DEFAULT — this migration must not do that';
  END IF;
END
$$;
