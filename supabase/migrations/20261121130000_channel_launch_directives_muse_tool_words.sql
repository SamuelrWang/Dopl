-- ============================================================================
-- MUSE'S TOOL WORDS ON THE LAUNCH-DIRECTIVE LANE (2026-10-13)
-- ============================================================================
-- The Muse runtime adapter (`dopl-desktop-app/main/runtime/muse/`) declares MSP's
-- own approval-mode words, narrowest first: `promptUnmatched`, `onRequest`,
-- `allowAll` (`muse/tools.js › TOOL_MODES`). A directive may ask one, and a
-- machine launching Muse echoes one in `applied_tool_mode`, so every tool-word
-- CHECK gains them. Everything else is
-- `20261024120000_channel_launch_directives_permission_levels.sql`, unchanged.
--
-- Mirrors (suite-pinned by `dopl-desktop-app/test/runtime-vocab-cross-tree.test.mjs`):
-- `src/features/channels/schema-launch-modes.ts › LAUNCH_TOOL_MODES_BY_RUNTIME.muse`,
-- `packages/contracts/src/directives.ts › LaunchToolMode`,
-- `packages/mcp-server/src/tools/channel-schema-launch-fields.ts` (posture.tools enum),
-- `dopl-desktop-app/main/launch-directive-vocab.js › APPLIED_TOOL_MODES`.
--
-- ⚠ Re-created whole (a CHECK cannot be ALTERed); idempotent. Widening only: every
-- stored value stays valid. ⚠ Written, not applied — apply by NAME.

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_tool_modes_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_tool_modes_check
  CHECK (
    (start_tool_mode IS NULL OR start_tool_mode IN (
      'ask', 'full',
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything',
      'promptUnmatched', 'onRequest', 'allowAll'))
    AND (target_tool_mode IS NULL OR target_tool_mode IN (
      'ask', 'full',
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything',
      'promptUnmatched', 'onRequest', 'allowAll'))
    AND (applied_tool_mode IS NULL OR applied_tool_mode IN (
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything',
      'promptUnmatched', 'onRequest', 'allowAll'))
  );

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_resolved_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_resolved_check
  CHECK (
    (resolved_tool_mode IS NULL OR resolved_tool_mode IN (
      'ask', 'full',
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything',
      'promptUnmatched', 'onRequest', 'allowAll'))
    AND (resolved_message_mode IS NULL
      OR resolved_message_mode IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
  );

-- The rewrite is asserted, not assumed.
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_tool_modes_check'
     AND convalidated;
  IF def IS NULL OR position('''allowAll''' IN def) = 0 OR position('''run-everything''' IN def) = 0
     OR position('applied_tool_mode' IN def) = 0 THEN
    RAISE EXCEPTION 'ABORT: the tool-mode CHECK is missing, unvalidated, or lost a word';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_resolved_check'
     AND convalidated;
  IF def IS NULL OR position('''promptUnmatched''' IN def) = 0 THEN
    RAISE EXCEPTION 'ABORT: channel_launch_directives_resolved_check is missing or lost a word';
  END IF;
END $$;
