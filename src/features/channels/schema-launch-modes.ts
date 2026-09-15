/**
 * **THE LAUNCH LANE'S THREE FROZEN VOCABULARIES, AS DATA** (§1 split, 2026-09-15).
 *
 * ⚠ **A LEAF, SO THE REQUEST AND THE REPORT CAN BOTH READ IT WITHOUT A CYCLE.**
 * `schema-launch.ts` (what a caller may ASK for) re-exports `schema-launch-decide.ts` (what the
 * machine REPORTS), and that file needs the same enum members — importing them back would be a
 * MODULE-EVAL cycle, not a type one. **Measured**: `ToolModeSchema` arrived `undefined` and every
 * schema suite failed to collect. One leaf, two readers, members declared exactly once.
 *
 * ⚠ **THE ORDER OF THE TWO MODE ARRAYS IS THE CONTRACT AND MAY NOT BE SORTED.** They are
 * NARROWEST FIRST, and the operator's machine clamps by INDEXING into a copy of these sequences
 * (`main/launch-posture.js`), so re-ordering either one silently inverts the bound.
 *
 * ⚠ **THEY ARE ARRAYS, NOT SCHEMAS.** `closedEnum` wraps them at each end, which is what keeps
 * the zod objects out of a module two schemas import at load time.
 */

/** ⚠ NARROWEST FIRST — the clamp indexes into this order. */
export const LAUNCH_TOOL_MODES = [
  "manual",
  "accept_edits",
  "auto",
  "bypass",
] as const;

/** ⚠ NARROWEST FIRST, like its twin, and for the same clamp. */
export const LAUNCH_MESSAGE_MODES = [
  "ask",
  "auto_inbound",
  "auto_outbound",
  "auto_both",
] as const;

/**
 * THE TEN REFUSAL WORDS ONE DIRECTIVE CAN COME BACK WITH.
 *
 * ⚠ **TEN SINCE 2026-09-02.** `no-chain` splits a fact off `no-bridge`: a directive that asked to
 * CHAIN in a channel where the operator has not enabled it answered the SAME word this machine
 * sends when it is not watching that channel at all. The two are opposite instructions —
 * `no-bridge` says go elsewhere, `no-chain` says the channel is right and one named setting is
 * off — so an orchestrator that read the first retried somewhere else instead of asking for one
 * toggle. ⚠ The column CHECK landed in the same wave
 * (`20260910120000_channel_launch_directives_posture.sql` §3A).
 */
export const LAUNCH_REFUSAL_REASONS = [
  "cap",
  "busy",
  "no-sdk",
  "auth-hold",
  "no-bridge",
  "no-counterparty",
  "no-template",
  "no-session",
  "bad-name",
  "no-chain",
] as const;
