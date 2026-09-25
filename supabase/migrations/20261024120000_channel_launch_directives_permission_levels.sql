-- ============================================================================
-- DIRECTIVE PERMISSION LEVELS + THE REPORTED NATIVE SETTING (2026-09-25)
-- ============================================================================
-- An MCP launch or posture re-ask may now ask for a permission LEVEL (`ask` /
-- `auto` / `full`), which the operator's machine applies in the launch runtime's
-- own settings; each runtime's own words stay accepted. `auto` is already Claude's
-- word (same meaning), so the ask side gains `ask` and `full`. The machine still
-- echoes a runtime's own word in `applied_tool_mode` (never a level), and now also
-- reports the whole effective setting in `applied_setting`, e.g.
-- `never/danger-full-access`, so the launch reply can say what really runs.
--
-- Mirrors (suite-pinned): `src/features/channels/schema-launch-modes.ts ›
-- LAUNCH_TOOL_MODES` / `› LAUNCH_SETTING_RE`, `dopl-desktop-app/main/launch-directive-vocab.js ›
-- TOOL_MODES`, and `dopl-desktop-app/main/runtime/permission-level.js › LEVELS`.
--
-- ⚠ Re-created whole (a CHECK cannot be ALTERed); idempotent. Widening only: every
-- stored value stays valid. ⚠ Written, not applied — apply by NAME.

-- 1. start / target take a level; applied stays a runtime's own word.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_tool_modes_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_tool_modes_check
  CHECK (
    (start_tool_mode IS NULL OR start_tool_mode IN (
      'ask', 'full',
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
    AND (target_tool_mode IS NULL OR target_tool_mode IN (
      'ask', 'full',
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
    AND (applied_tool_mode IS NULL OR applied_tool_mode IN (
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
  );

-- 2. resolved: retired (every create writes NULL), widened with start so the group
-- cannot refuse a word the lane speaks.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_resolved_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_resolved_check
  CHECK (
    (resolved_tool_mode IS NULL OR resolved_tool_mode IN (
      'ask', 'full',
      'manual', 'accept_edits', 'auto', 'bypass',
      'untrusted', 'granular', 'on-request', 'never',
      'allowlist', 'auto-review', 'run-everything'))
    AND (resolved_message_mode IS NULL
      OR resolved_message_mode IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
  );

-- 3. The reported effective setting: a launch-only echo, shape-checked, never a request.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS applied_setting TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_applied_setting_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_applied_setting_check
  CHECK (applied_setting IS NULL OR (kind = 'launch' AND applied_setting ~ '^[a-z0-9_/-]{1,80}$'));

-- The rewrite is asserted, not assumed.
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_tool_modes_check'
     AND convalidated;
  IF def IS NULL OR position('''full''' IN def) = 0 OR position('''ask''' IN def) = 0
     OR position('''run-everything''' IN def) = 0 OR position('applied_tool_mode' IN def) = 0 THEN
    RAISE EXCEPTION 'ABORT: the tool-mode CHECK is missing, unvalidated, or lost a word';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.channel_launch_directives'::regclass
     AND conname = 'channel_launch_directives_applied_setting_check'
     AND convalidated;
  IF def IS NULL THEN
    RAISE EXCEPTION 'ABORT: channel_launch_directives_applied_setting_check is missing or NOT VALIDATED';
  END IF;
END $$;
