-- ============================================================================
-- DIRECTIVE TOOL MODES IN EACH RUNTIME'S OWN WORDS (Samuel ruling R3)
-- ============================================================================
-- An MCP launch or `set_agent_mode` asks in the LAUNCH (or running) runtime's own
-- Axis-A words, and the machine echoes the word it applied. The tool-mode CHECKs
-- held Claude's four only, so a Codex ask or a Codex echo was refused at rest.
-- They now admit the UNION of the registered runtimes' words — a SET: the
-- operator's machine validates a word against the resolved runtime and clamps it
-- in that runtime's own descriptor order.
--
-- Mirrors (suite-pinned): `src/features/channels/schema-launch-modes.ts ›
-- LAUNCH_TOOL_MODES_BY_RUNTIME`, `dopl-desktop-app/main/launch-directive-vocab.js ›
-- TOOL_MODES`, and each `dopl-desktop-app/main/runtime/<id>/tools.js › TOOL_MODES`.
--
-- ⚠ Re-created whole (a CHECK cannot be ALTERed); idempotent. Widening only: every
-- stored value stays valid. The message-mode CHECKs are runtime-neutral and untouched.
-- ⚠ Written, not applied — apply by NAME.

-- 1. start / target / applied (`20260910120000` §3)
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_tool_modes_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_tool_modes_check
  CHECK (
    (start_tool_mode IS NULL OR start_tool_mode IN (
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
    AND (target_tool_mode IS NULL OR target_tool_mode IN (
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
    AND (applied_tool_mode IS NULL OR applied_tool_mode IN (
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
  );

-- 2. resolved (`20260912120000` §3). The create writes NULL here now (the server
-- clamps nothing); widened anyway so the group cannot refuse a word the lane speaks.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_resolved_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_resolved_check
  CHECK (
    (resolved_tool_mode IS NULL OR resolved_tool_mode IN (
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
    AND (resolved_message_mode IS NULL
      OR resolved_message_mode IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
  );

-- The rewrite is asserted, not assumed: both CHECKs exist, are validated, and name
-- every word of every runtime; the message axis kept its four.
DO $$
DECLARE
  def TEXT;
  cname TEXT;
  word TEXT;
BEGIN
  FOREACH cname IN ARRAY ARRAY['channel_launch_directives_tool_modes_check',
                               'channel_launch_directives_resolved_check'] LOOP
    SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
     WHERE conrelid = 'public.channel_launch_directives'::regclass
       AND conname = cname
       AND convalidated;
    IF def IS NULL THEN
      RAISE EXCEPTION 'ABORT: % is missing or NOT VALIDATED', cname;
    END IF;
    FOREACH word IN ARRAY ARRAY['manual', 'accept_edits', 'auto', 'bypass',
                                'untrusted', 'granular', 'on-request', 'never',
                                'allowlist', 'auto-review', 'run-everything'] LOOP
      IF position(quote_literal(word) IN def) = 0 THEN
        RAISE EXCEPTION 'ABORT: % does not admit the tool word %', cname, word;
      END IF;
    END LOOP;
  END LOOP;

  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_tool_modes_check';
  IF position('start_tool_mode' IN def) = 0
     OR position('target_tool_mode' IN def) = 0
     OR position('applied_tool_mode' IN def) = 0 THEN
    RAISE EXCEPTION 'ABORT: the tool-mode CHECK lost one of start/target/applied';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_message_modes_check'
     AND convalidated;
  IF def IS NULL
     OR position('auto_inbound' IN def) = 0 OR position('auto_outbound' IN def) = 0
     OR position('auto_both' IN def) = 0 OR position('''ask''' IN def) = 0 THEN
    RAISE EXCEPTION 'ABORT: the message-mode CHECK is missing or lost a mode';
  END IF;
END $$;
