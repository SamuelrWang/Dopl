/**
 * The directive and direction lanes' closed sets, stated once for every tree. The DB repeats each
 * as a column CHECK that no TypeScript reaches: a new word is a schema change in both trees.
 * Type-only (see `index.ts`); the desktop mirrors these in `main/launch-directive-vocab.js`.
 */

/**
 * Why a desktop refused a direction. A key, never a sentence: the reader writes the prose.
 * `no-session` (no live session with that key) is the ordinary answer; `no-bridge` (the direct
 * toggle is off) is written by nothing today — an un-opted machine ignores the row silently.
 */
export type DirectionRefusalReason =
  | "no-session"
  | "auth-hold"
  | "busy"
  | "blocked"
  | "no-bridge";

/**
 * Why a desktop refused a directive. A key, never a sentence (`channel-ops-launch.ts` renders it).
 * Restated in the route zod enum, the column CHECK and `main/launch-directive-vocab.js`; all move
 * together. `busy` is the only temporary word. `no-bridge` is the operator's consent toggle — a
 * choice, not a fault. `no-identity` covers both deleted and not-visible-to-the-operator (one answer,
 * 404-never-403). `identity-approval` is an IPC-only word and must never join this set: a directive
 * has no human to click.
 */
export type LaunchRefusalReason =
  | "cap"
  | "busy"
  | "no-sdk"
  | "auth-hold"
  | "no-bridge"
  | "no-counterparty"
  | "no-identity"
  // `no-session` and `bad-name` belong to the non-launch kinds; `no-session` (the agent is gone) is
  // not an error.
  | "no-session"
  // The channel forbids chaining (`main/launch-posture.js › CHAIN_SETTING`): re-issue without `chain`.
  | "no-chain"
  // The resolved runtime's live roster lacks the model: re-issue with one it lists, or none.
  // CHECK: `20261019120000_rename_agent_templates_to_agent_identities.sql` §7.
  | "no-model"
  | "bad-name";

/**
 * Which verb a directive asks for. `launch` and `set_agent_mode` spend local compute and sit behind
 * the machine's launch-consent toggle (`main/launch-directive-wire.js ›
 * KINDS_NEEDING_LAUNCH_CONSENT`); `end` and `rename` widen nothing and do not.
 */
export type LaunchDirectiveKind = "launch" | "end" | "rename" | "set_agent_mode";

/** A directive row's lifecycle. `done` is the non-launch kinds' success, `launched` the launch's. */
export type LaunchDirectiveStatus =
  | "pending"
  | "claimed"
  | "launched"
  | "done"
  | "refused"
  | "expired";

/**
 * The two posture axes a directive ASKS for; it never widens. The operator's machine clamps each to
 * its stored channel ceiling (`main/launch-posture.js`). Tools: a permission LEVEL (`ask`/`auto`/
 * `full`, applied in the launch runtime's own settings) or, for compatibility, one runtime's own
 * word, clamped in that runtime's descriptor order. Messages clamp as an inbound/outbound
 * intersection. `applied_tool_mode` is always the runtime's own word, never a level.
 */
export type LaunchToolMode =
  | "ask" | "full" // levels; `auto` is also a level (Claude's word, same meaning)
  | "manual" | "accept_edits" | "auto" | "bypass" // claude
  | "untrusted" | "granular" | "on-request" | "never" // codex
  | "allowlist" | "auto-review" | "run-everything"; // cursor

/** What the machine echoes as applied: always a runtime's own word, never a level. */
export type LaunchAppliedToolMode = Exclude<LaunchToolMode, "ask" | "full">;

export type LaunchMessageMode =
  | "ask"
  | "auto_inbound"
  | "auto_outbound"
  | "auto_both";

