/** The launch lane's closed vocabularies. A leaf, so `schema-launch.ts` and
 *  `schema-launch-decide.ts` can both read the enums without a module-eval cycle. */

/** Each runtime's own words, narrowest first (the desktop clamps this axis by index); mirrors
 *  `dopl-desktop-app/main/runtime/<id>/tools.js › TOOL_MODES`. */
export const LAUNCH_TOOL_MODES_BY_RUNTIME = {
  claude: ["manual", "accept_edits", "auto", "bypass"],
  codex: ["untrusted", "granular", "on-request", "never"],
  cursor: ["allowlist", "auto-review", "run-everything"],
} as const;

/** The permission levels, narrowest first; the desktop applies one in the launch runtime's own
 *  settings (`dopl-desktop-app/main/runtime/permission-level.js › LEVELS`). */
export const LAUNCH_PERMISSION_LEVELS = ["ask", "auto", "full"] as const;

/** What a machine echoes as applied: every runtime's own words, a set (never a level). */
export const LAUNCH_APPLIED_TOOL_MODES = [
  ...LAUNCH_TOOL_MODES_BY_RUNTIME.claude,
  ...LAUNCH_TOOL_MODES_BY_RUNTIME.codex,
  ...LAUNCH_TOOL_MODES_BY_RUNTIME.cursor,
] as const;

/** The union a request and the column CHECKs accept: a set, not an order. The levels' `auto` is
 *  Claude's own word, so it appears once. */
export const LAUNCH_TOOL_MODES = ["ask", "full", ...LAUNCH_APPLIED_TOOL_MODES] as const;

/** Runtime-neutral, narrowest first (the desktop clamps it by capability bits, not index). */
export const LAUNCH_MESSAGE_MODES = [
  "ask",
  "auto_inbound",
  "auto_outbound",
  "auto_both",
] as const;

/** CHECK restated in `20261019120000_rename_agent_templates_to_agent_identities.sql` §7. */
export const LAUNCH_REFUSAL_REASONS = [
  "cap",
  "busy",
  "no-sdk",
  "auth-hold",
  "no-bridge",
  "no-counterparty",
  "no-identity",
  "no-session",
  "bad-name",
  "no-chain",
  "no-model",
] as const;

/** A SHAPE, not a set: membership is the desktop registry's. Hand-mirrored in
 *  `dopl-desktop-app/main/launch-directive-vocab.js › RUNTIME_ID_RE` and the column CHECK in
 *  `20261017120000_channel_launch_directives_runtime.sql`, both pinned by
 *  `schema-launch-runtime.test.ts`; `packages/mcp-server/src/tools/channel-schema-launch-fields.ts`
 *  mirrors only its length. */
export const LAUNCH_RUNTIME_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** A reported native setting's SHAPE (`never/danger-full-access`, `bypass`); restated by the
 *  column CHECK in `20261024120000_channel_launch_directives_permission_levels.sql`. */
export const LAUNCH_SETTING_RE = /^[a-z0-9_/-]{1,80}$/;

/** Names the field rather than restating the pattern. */
export const LAUNCH_RUNTIME_ID_MESSAGE =
  "A runtime id is 1-32 lowercase characters, e.g. claude or codex";
