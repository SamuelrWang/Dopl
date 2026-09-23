-- ============================================================================
-- AGENT IDENTITIES CARRY A RUNTIME (Samuel rulings 4, 5, 6)
-- ============================================================================
-- An identity names the runtime its model belongs to, so the editor offers that
-- runtime's models and a launch prefers it (launcher pick → identity runtime →
-- channel runtime). NULL = no preference: the channel decides.
--
-- Grammar-only CHECK, never an enum: the runtime roster is the desktop's
-- registry, not this database's. Same pattern as
-- `src/features/channels/schema-launch-modes.ts › LAUNCH_RUNTIME_ID_RE` and
-- `channel_launch_directives_runtime_shape_check` (20261017120000).
--
-- Backfill (ruling 6): an identity whose model is a Claude id (`claude-*`) or a
-- Claude alias (`opus|sonnet|haiku|fable`, optional `[1m]`-style suffix; the
-- aliases of `dopl-desktop-app/main/session-model.js`) gets `claude`; every
-- other row, including no model, stays NULL.
--
-- The table's SELECT grant and RLS policy are table-level and no function
-- selects an explicit column list of this table, so nothing else needs the
-- column. Apply by name; replays cleanly.

BEGIN;

ALTER TABLE public.agent_identities
  ADD COLUMN IF NOT EXISTS runtime TEXT;

ALTER TABLE public.agent_identities
  DROP CONSTRAINT IF EXISTS agent_identities_runtime_shape_check;

ALTER TABLE public.agent_identities
  ADD CONSTRAINT agent_identities_runtime_shape_check
  CHECK (runtime IS NULL OR runtime ~ '^[a-z][a-z0-9_-]{0,31}$');

UPDATE public.agent_identities
   SET runtime = 'claude'
 WHERE runtime IS NULL
   AND model IS NOT NULL
   AND (
     model ~ '^claude-'
     OR model ~ '^(opus|sonnet|haiku|fable)([[][A-Za-z0-9]{1,8}[]])?$'
   );

COMMENT ON COLUMN public.agent_identities.runtime IS
  'The runtime this identity prefers (claude, codex, ...). NULL = no preference; the channel''s runtime decides. The identity model is read against this runtime''s catalog. Grammar-only: the roster is the desktop''s.';

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'agent_identities'
     AND column_name = 'runtime'
     AND data_type = 'text'
     AND is_nullable = 'YES';
  IF n <> 1 THEN
    RAISE EXCEPTION 'ABORT: agent_identities.runtime is missing or not a nullable text column';
  END IF;

  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'public.agent_identities'::regclass
     AND conname = 'agent_identities_runtime_shape_check';
  IF n <> 1 THEN
    RAISE EXCEPTION 'ABORT: agent_identities_runtime_shape_check is missing';
  END IF;

  SELECT count(*) INTO n
    FROM public.agent_identities
   WHERE runtime IS NULL
     AND model IS NOT NULL
     AND (
       model ~ '^claude-'
       OR model ~ '^(opus|sonnet|haiku|fable)([[][A-Za-z0-9]{1,8}[]])?$'
     );
  IF n <> 0 THEN
    RAISE EXCEPTION 'ABORT: % identity row(s) with a Claude model still have no runtime', n;
  END IF;
END
$$;

COMMIT;
