-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- RETIRE THE CHANNEL AGENT CEILING — Samuel's rulings on items 12, 13 and 14 (2026-09-06)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- WHAT IS BEING RETIRED. `channels.agent_tool_ceiling`, `channels.agent_message_ceiling` and
-- `channels.agent_chain_allowed` — added by `20260912120000_channel_delivery_verdict.sql` §2
-- (A9, guardrails G6/G7) — were a room MANAGER's clamps over EVERY member's agents in a
-- channel: the widest tool mode a launch there could run, the widest message mode, and whether
-- those agents could launch further agents.
--
-- His words, on the tools axis: *"remove the tool ceiling option and the logic related to it
-- because all agents launched should just inherit the original tools' permissions"*, and on the
-- chain clamp: *"make sure all the logic is deleted."*
--
-- ⚠ THE CONTAINMENT LOSS, STATED RATHER THAN IMPLIED, AND HE WAS TOLD IT BEFORE HE RULED.
-- **No room bounds a peer's agent on any axis now.** A member's agents in a channel run at
-- whatever that member set on their own machine. The sharpest of the three did not even clamp:
-- `agent_chain_allowed = false` REFUSED a `chain: true` directive at creation (G7, HTTP 400),
-- on the reasoning that a clamped chain hands back an agent which hits a bound mid-run, after
-- its caller has already given it work assuming workers. That refusal is gone too.
--
-- ⚠ THIS IS THE OPERATOR'S OWN CLAMP'S OPPOSITE, AND THE TWO MUST NOT BE CONFUSED.
-- `dopl-desktop-app/main/launch-posture.js` still clamps — that is a person bounding their OWN
-- agents on their OWN machine, which none of these rulings touched. What died is one person
-- bounding SOMEBODY ELSE'S.
--
-- ── ⚠ NON-DESTRUCTIVE, AND THE COLUMNS ARE DELIBERATELY LEFT IN PLACE ──────────────────────
--
-- There is **no `DROP COLUMN` here and no backfill**, and both omissions are choices:
--
--   • NO DROP — this repo's standing posture. The application stopped reading these columns in
--     the same change (`server/dto.ts › mapAgentPosture` deleted, `server/repository.ts`
--     patch fields removed, `agentPosture` off `service-writes.ts › MANAGED_CHANNEL_FIELDS`),
--     so they are inert. Dropping them would make the previous release unrunnable against this
--     database, which is the thing a non-destructive posture exists to prevent.
--
--   • NO BACKFILL TO NULL — clearing values that nothing reads is destruction with no
--     beneficiary. An unread column bounds nothing, and a channel whose row still carries an
--     old ceiling is not enforcing it; wiping them would only destroy the record of what a room
--     manager once configured, which is the one thing the rows are still good for.
--
-- WHAT THIS MIGRATION ACTUALLY DOES: drops the CHECK constraint that held the two mode columns
-- to their enums, and re-comments all three columns so anybody reading the schema learns they
-- are retired rather than assuming an enforcement path still exists.
--
-- ⚠ THE CONSTRAINT GOES BECAUSE IT WOULD OUTLIVE ITS VOCABULARY. It names four tool modes and
-- four message modes; those enums live in the application and may move, and a database CHECK
-- enforcing a stale copy against a column nobody writes is a trap for whoever next has a reason
-- to touch these rows.
--
-- ── TO REVERT ──────────────────────────────────────────────────────────────────────────────
-- The columns and their data are untouched, so a revert is application-side plus one statement:
--   1. restore `mapAgentPosture`, the `ChannelPatch` fields, `agentPosture` on
--      `ChannelUpdateSchema` and `MANAGED_CHANNEL_FIELDS`, the clamp in
--      `server/service-launch-posture.ts`, and the three Settings rows;
--   2. re-add the CHECK below (its original text is in `20260912120000` §2, reproduced here so
--      a reverter does not have to go and find it):
--
--        ALTER TABLE public.channels ADD CONSTRAINT channels_agent_ceiling_check CHECK (
--          (agent_tool_ceiling IS NULL
--            OR agent_tool_ceiling IN ('manual', 'accept_edits', 'auto', 'bypass'))
--          AND (agent_message_ceiling IS NULL
--            OR agent_message_ceiling IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
--        );
--
-- ⚠ A REVERTER MUST ALSO RE-READ THE RULINGS. Restoring this feature restores one member's
-- ability to bound another member's agents, which is a permission change and not a rollback.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ⚠ `IF EXISTS` — this migration must be re-runnable and must not fail on a database that
-- never had the constraint (a fresh environment created after the columns but before it).
ALTER TABLE public.channels
  DROP CONSTRAINT IF EXISTS channels_agent_ceiling_check;

COMMENT ON COLUMN public.channels.agent_tool_ceiling IS
  'RETIRED 2026-09-06 (Samuel''s ruling, item 12) — READ BY NOTHING. Was: the widest tool mode an agent launched in this channel could run, set by a room manager over every member''s agents. Agents now inherit the launching operator''s own tool permissions. Kept non-destructively; do not read it, and see 20260928120000 before restoring it.';

COMMENT ON COLUMN public.channels.agent_message_ceiling IS
  'RETIRED 2026-09-06 (Samuel''s ruling, item 13) — READ BY NOTHING. Was: the widest message mode an agent launched in this channel could run. Kept non-destructively; do not read it, and see 20260928120000 before restoring it.';

COMMENT ON COLUMN public.channels.agent_chain_allowed IS
  'RETIRED 2026-09-06 (Samuel''s ruling, item 14) — READ BY NOTHING. Was: whether an agent launched in this channel could launch further agents; FALSE refused a chain:true directive at creation (400) rather than clamping it. Kept non-destructively; do not read it, and see 20260928120000 before restoring it.';
