/**
 * ⚠ **AUTO-SEND IS DELETED (2026-09-06, Samuel's settings overhaul, item 8).** This file is a
 * TOMBSTONE and exports nothing.
 *
 * WHAT IT WAS: a durable per-channel toggle (Samuel, 2026-08-20) deciding whether the operator's
 * own agent's drafted reply posted without a Send click.
 *
 * WHY IT WENT: it was a SECOND control over the SAME axis as the launch posture's `messages`, and
 * the two disagreed by construction. `messages` was frozen into a session at launch; this was
 * read live at the gate; and `session-private.js › autoSendMessageMode` FORCED the out half on
 * over whatever `messages` said. An operator could set Messaging to "Ask" and still have agents
 * posting unattended, with nothing on the Settings tab saying which control was in force.
 *
 * ⚠ **THE BEHAVIOUR THAT MATTERED SURVIVED — IT LIVED IN THE READ SITE, NOT IN THIS RECORD.** The
 * 2026-08-31 ruling was *"if a user toggles auto-send, that goes into effect for ALL their agents
 * in that channel, IMMEDIATELY"*. `main/session-private.js › effectiveMessageMode` is still the
 * single live Axis-B read and still consults the store on every decision — it reads
 * `getLaunchPosture(channelId).messages` now. So a Messaging change still reaches running
 * sessions, reopened shells, crash resumes and directed turns at once.
 *
 * WHERE THE SETTING IS NOW: the **Messaging** row on the Settings tab
 * (`components/channels-v2/settings-agent-launch-rows.tsx`), written through
 * `use-channel-launch-posture.ts`. Its eye popover states the one asymmetry this fold created —
 * Messaging is read live while the rest of that group is read at launch.
 *
 * ⚠ **DO NOT REVIVE THIS HOOK TO "KEEP" AN EXISTING TOGGLE.** The `channelAutoSend` rows still on
 * disk are inert on purpose: a machine that had the toggle ON now follows whatever that channel's
 * Messaging value says, which is the value its operator can SEE. Reading the old key to preserve
 * the old setting would restore, invisibly, the second authority this item removed.
 *
 * ⚠ ITS OPTIMISTIC-WITH-REVERT IDIOM IS STILL CITED by `use-orchestrator-launch.ts`, which names
 * this file. That reference is to the PATTERN, not to this code; the pattern is unchanged and
 * lives on in that hook and in `use-channel-agent-chain.ts`.
 *
 * The main-process half went in the same change: `channel-prefs.getAutoSend` / `setAutoSend`, the
 * `channels:getAutoSend` / `channels:setAutoSend` IPC handlers, their `app-preload.js` bridge
 * methods, their `dopl-bridge.ts` declarations, and their rows in `test/_ipc-ops-table.mjs`.
 */

export {};
