-- CHANNEL_SESSIONS.RUNTIME — which agent runtime a session runs on (`claude`, `codex`, …), so a
-- peer's agent card can show the runtime badge (PLAN.md R9). Peer-visible through
-- `collab-dto.ts › mapPeerSessionStateRow`; no column GRANT, so PostgREST still cannot read it.
-- The grammar is `channel_launch_directives_runtime_shape_check`'s (20261017120000): the roster is
-- the desktop's registry, never an enum here. NULL = a desktop older than the field.
--
-- ROLLBACK (prose): drop the constraint, then the column. No row is rewritten by this file.

ALTER TABLE public.channel_sessions
  ADD COLUMN IF NOT EXISTS runtime text;

ALTER TABLE public.channel_sessions
  DROP CONSTRAINT IF EXISTS channel_sessions_runtime_shape_check;
ALTER TABLE public.channel_sessions
  ADD CONSTRAINT channel_sessions_runtime_shape_check
  CHECK (runtime IS NULL OR runtime ~ '^[a-z][a-z0-9_-]{0,31}$');

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.channel_sessions', 'runtime', 'SELECT')
     OR has_column_privilege('anon', 'public.channel_sessions', 'runtime', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: channel_sessions.runtime is SELECT-able by anon/authenticated; nothing here granted it';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.channel_sessions', 'runtime', 'SELECT') THEN
    RAISE EXCEPTION 'ABORT: service_role cannot read channel_sessions.runtime';
  END IF;
END $$;
