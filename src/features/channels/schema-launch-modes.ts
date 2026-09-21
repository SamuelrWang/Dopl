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

/**
 * **THE SHAPE OF A RUNTIME ID — AND IT IS A SHAPE, NOT A SET** (2026-09-21, U9).
 *
 * ⚠ **THERE IS DELIBERATELY NO CLOSED ENUM OF RUNTIMES ON THE SERVER, AND THAT IS THE ONE
 * DECISION TO UNDERSTAND BEFORE TOUCHING THIS.** The roster of runtimes is
 * `dopl-desktop-app/main/runtime/index.js`'s REGISTRY — a list that lives on the operator's
 * machine and moves with a DESKTOP release, not a server one. A `z.enum(["claude","codex",
 * "cursor"])` here would refuse a runtime a NEWER desktop ships, which is the same mistake
 * {@link LAUNCH_TOOL_MODES}' neighbour `model` already declines to make ("the effective model set
 * is the DESKTOP's and it is free-form"). So the wire bounds the SHAPE and the MACHINE decides
 * membership.
 *
 * ⚠ **WHICH MEANS THE REFUSAL IS THE DESKTOP'S, AND IT REALLY IS A REFUSAL.** An explicit runtime
 * this machine does not have registered, or has and cannot start, answers `no-sdk` —
 * `dopl-desktop-app/main/launch-directive-spawn.js › resolveRuntime`. It is NEVER swapped for
 * another vendor: that silent fallback is the defect U9 exists to close (a live MCP launch
 * carrying `model: "codex"` was accepted and started Claude Sonnet).
 *
 * ⚠ **AND A MODEL NAME IS NEVER A RUNTIME SELECTOR** (the plan's Key Technical Decision #4).
 * `runtime` chooses the adapter; `model` chooses a model INSIDE it. Nothing on this lane infers
 * one from the other, in either direction, and a missing `runtime` is never read as Codex.
 *
 * ⚠ ANCHORED, LOWERCASE, 1-32. It is hand-mirrored by
 * `dopl-desktop-app/main/launch-directive-vocab.js › RUNTIME_ID_RE` (main cannot import from
 * `src/`), by the column's own CHECK in
 * `20261017120000_channel_launch_directives_runtime.sql`, and by
 * `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`. Four statements of one
 * pattern; `launch-runtime-parity.test.ts` drives this one against the other three rather than
 * trusting this sentence.
 */
export const LAUNCH_RUNTIME_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** The message a caller gets for a value outside {@link LAUNCH_RUNTIME_ID_RE}. ⚠ It NAMES the
 *  field rather than restating the pattern: a character class is a contract a caller has to
 *  reverse-engineer (`tool-style.test.ts`'s standing rule). */
export const LAUNCH_RUNTIME_ID_MESSAGE =
  "A runtime id is 1-32 lowercase characters, e.g. claude or codex";
