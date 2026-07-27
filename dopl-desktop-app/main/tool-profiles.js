// Tool-profile containment table for spawned Claude sessions (v1.2 Feature 6 —
// hardened by the v1.2 adversarial review H-1/H-2).
//
// SPLIT NOTE (§2 refactor): this table was extracted from session-spawner.js so
// that file could come under the 500-line cap. session-spawner.js re-exports the
// build* helpers, so its public API is unchanged. This file MUST stay free of
// electron/fs/path references (scopedSettingsPath/writeScopedSettings live in
// session-spawner.js) — test/tool-profiles.test.mjs evaluates the sentinel block
// below verbatim in a plain Node context and would break on those imports.
//
// WHY --allowedTools ALONE IS NOT CONTAINMENT (H-1). `--allowedTools` is
// ADDITIVE: it PRE-APPROVES tools so they don't prompt. It does not bound a
// session. The operator's own ~/.claude/settings.local.json can (and on this
// machine does) carry a large `permissions.allow` list — `Bash(python3 *)`,
// `Bash(npm run *)`, `Bash(bash)`, `mcp__dopl__delete_entry` — and those keep
// applying to a spawn no matter what we pass in --allowedTools. So a v1.1
// "read_only" spawn could still run Bash. Containment therefore uses four
// layers, all verified empirically against claude 2.1.220:
//
//   L0  --tools <builtins>       A POSITIVE bound on the built-in toolset.
//                                Everything not named is not offered to the
//                                model at all. Verified: MCP tools are NOT
//                                affected by --tools, so the Dopl server still
//                                comes through for dopl_only.
//   L1  --settings <file>        A scoped settings JSON whose
//                                `permissions.deny` neutralizes the operator's
//                                global allow list. Verified: with
//                                allow:["Bash(python3 *)"] AND deny:["Bash"]
//                                in the same file, Bash is not offered.
//   L2  --disallowedTools        The same names at the CLI layer, in case the
//                                settings file is rejected (in -p mode an
//                                invalid settings file is SILENTLY ignored).
//   L3  --strict-mcp-config      Only the Dopl server from --mcp-config loads;
//                                the operator's other global MCP servers
//                                (attio/slack/gmail/supabase/…) do not.
//
// L0 is the load-bearing one: a deny list is a blacklist and this CLI ships far
// more built-ins than the obvious write/exec ones (Agent, TaskCreate, Artifact,
// CronCreate, SendMessage, RemoteTrigger, Skill, ToolSearch, …), every one of
// which is an exfiltration, delegation, or persistence channel. L1/L2 still
// enumerate them so a CLI that ignores --tools is still contained.
//
// Profiles:
//   read_only  — pure research: local READ built-ins only. NO web (WebFetch /
//                WebSearch are an outbound channel that bypasses the approve-out
//                gate entirely), NO Dopl MCP at all, no write/exec/delegation.
//                Headless answers from stdout, so no tool is needed to reply.
//   dopl_only  — local READ built-ins + the NON-ADMIN Dopl MCP tools, named one
//                by one. Never the bare `mcp__dopl` prefix: that matches the six
//                destructive *_admin tools too (dopl_kb_admin alone carries
//                delete_base / delete_folder / delete_file), which made v1.1's
//                dopl_only MORE dangerous than full. `dopl_channel` is
//                deliberately EXCLUDED and explicitly DENIED (see below): a
//                dopl_only agent could otherwise post/exfiltrate directly and
//                bypass the approve-out review, so its reply instead routes
//                through stdout + the approve-out gate exactly like read_only.
//   full       — unchanged v1.1 behavior: no flags, no scoped settings, the
//                CLI's own permission gating applies.
//
// Unrecognized names in --allowedTools / --disallowedTools / --tools are
// harmless no-ops (verified), so these lists can name tools that only exist in
// some CLI versions.

// ─── BEGIN TOOL-PROFILE TABLE (extracted verbatim by test/tool-profiles.test.mjs) ───

// The dopl_channel MCP tool is how an agent posts into a channel directly. It is
// a WRITE/exfiltration surface that bypasses the desktop's approve-out review, so
// it is never granted to a restricted profile — dopl_only both omits it from the
// allow list AND denies it by name (read_only denies the whole server prefix).
const DOPL_CHANNEL_TOOL = 'mcp__dopl__dopl_channel';

// Every non-admin, non-posting tool registered by
// packages/mcp-server/src/server.ts (verified against its
// registerTool/registerMetaTool call sites). mcp-config.js names the server
// `dopl`, so the CLI exposes each as `mcp__dopl__<tool>` (verified against a live
// stdio MCP server). NOTE: `dopl_channel` is intentionally absent — it is the one
// non-admin tool a restricted spawn must not reach (see DOPL_CHANNEL_TOOL).
const DOPL_SAFE_TOOLS = [
  'mcp__dopl__dopl_kb',
  'mcp__dopl__dopl_search',
  'mcp__dopl__dopl_map',
  'mcp__dopl__dopl_members',
  'mcp__dopl__dopl_skill',
  'mcp__dopl__dopl_workflow',
  'mcp__dopl__dopl_ontology',
  'mcp__dopl__dopl_chats',
  'mcp__dopl__dopl_cluster',
  'mcp__dopl__current_workspace',
  'mcp__dopl__list_workspaces',
];

// The six destructive admin companions. NEVER grantable under any restricted
// profile; always denied explicitly (belt) as well as excluded from the allow
// list (braces).
const DOPL_ADMIN_TOOLS = [
  'mcp__dopl__dopl_kb_admin',
  'mcp__dopl__dopl_cluster_admin',
  'mcp__dopl__dopl_skill_admin',
  'mcp__dopl__dopl_ontology_admin',
  'mcp__dopl__dopl_chats_admin',
  'mcp__dopl__dopl_workflow_admin',
];

// The bare server prefix. Only ever valid in a DENY list (it matches every tool
// on the server, admins included) — never in an allow list.
const DOPL_SERVER_PREFIX = 'mcp__dopl';

// Built-ins a restricted spawn may use. Also the --tools positive bound.
const READ_BUILTINS = ['Read', 'Grep', 'Glob', 'LS', 'TodoWrite'];

// Built-ins a restricted spawn must never reach, grouped by what they'd buy an
// attacker who has injected the untrusted message body.
const DENIED_BUILTINS = [
  // Local execution + filesystem writes.
  'Bash', 'BashOutput', 'KillShell',
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  // Delegation: a subagent is a fresh session that does not inherit this bound.
  'Task', 'Agent', 'TaskCreate', 'TaskUpdate', 'TaskStop',
  'TaskGet', 'TaskList', 'TaskOutput',
  // Outbound channels — every one of these gets data off the machine WITHOUT
  // passing the approve-out gate, which is the whole point of that gate.
  'WebFetch', 'WebSearch', 'Artifact', 'SendMessage', 'SendUserMessage',
  'PushNotification', 'RemoteTrigger', 'ReportFindings', 'DesignSync',
  // Persistence / scheduling: survives the spawn and re-runs unattended.
  'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'Monitor',
  // Capability escalation: pulls in code, tools, or worktrees we did not scope.
  'EnterWorktree', 'ExitWorktree', 'Workflow', 'Skill', 'ToolSearch',
];

const TOOL_PROFILES = {
  read_only: [...READ_BUILTINS],
  dopl_only: [...READ_BUILTINS, ...DOPL_SAFE_TOOLS],
  full: [], // empty => no restriction flags at all (v1.1 behavior)
};

function normalizeProfile(p) {
  return p === 'read_only' || p === 'dopl_only' || p === 'full' ? p : 'full';
}

// The --allowedTools list for a profile (empty array => omit the flag).
function buildAllowedTools(profile) {
  return TOOL_PROFILES[normalizeProfile(profile)] || [];
}

// The deny list for a profile — used BOTH as `permissions.deny` in the scoped
// settings file and as --disallowedTools. Empty for `full`.
function buildDeniedTools(profile) {
  const p = normalizeProfile(profile);
  if (p === 'full') return [];
  const denied = [...DENIED_BUILTINS, ...DOPL_ADMIN_TOOLS];
  // read_only gets no Dopl MCP whatsoever: deny the whole server, then the six
  // admins again by name so containment survives a CLI that stops honoring the
  // bare-prefix form.
  if (p === 'read_only') {
    denied.unshift(DOPL_SERVER_PREFIX);
  } else if (p === 'dopl_only') {
    // dopl_only keeps the read Dopl tools but must not post/exfiltrate directly:
    // deny dopl_channel by name so the reply routes through stdout + approve-out.
    denied.push(DOPL_CHANNEL_TOOL);
  }
  return denied;
}

// The --tools positive bound on BUILT-IN tools (empty => omit the flag).
function buildBuiltinTools(profile) {
  return normalizeProfile(profile) === 'full' ? [] : [...READ_BUILTINS];
}

// The full set of restriction flags for a spawn, shared verbatim by headless and
// terminal mode so the two can never drift. `settingsPath` is null when the
// scoped settings file could not be written — the other three layers still hold.
function buildRestrictionArgs(profile, settingsPath) {
  const p = normalizeProfile(profile);
  if (p === 'full') return [];
  const args = [];
  const builtins = buildBuiltinTools(p);
  if (builtins.length) args.push('--tools', builtins.join(','));
  const allowed = buildAllowedTools(p);
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  const denied = buildDeniedTools(p);
  if (denied.length) args.push('--disallowedTools', denied.join(','));
  if (settingsPath) args.push('--settings', settingsPath);
  // Only the Dopl server from --mcp-config; never the operator's global ones.
  args.push('--strict-mcp-config');
  return args;
}

// ─── END TOOL-PROFILE TABLE ───

module.exports = {
  DOPL_CHANNEL_TOOL,
  DOPL_SAFE_TOOLS,
  DOPL_ADMIN_TOOLS,
  DOPL_SERVER_PREFIX,
  READ_BUILTINS,
  DENIED_BUILTINS,
  TOOL_PROFILES,
  normalizeProfile,
  buildAllowedTools,
  buildDeniedTools,
  buildBuiltinTools,
  buildRestrictionArgs,
};
