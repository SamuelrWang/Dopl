// Tool-profile containment table for spawned Claude sessions (HEADLESS lane).
//
// ⚠ MUST stay free of electron/fs/path — test/tool-profiles.test.mjs evaluates the sentinel
// block below verbatim in a plain Node context and breaks on those imports.
// (⚠ `scopedSettingsPath` / `writeScopedSettings` lived in session-spawner.js and went with the
// headless lane, 2026-08-20 — the SDK lane passes its bounds as options, never as a settings file.)
//
// ⚠ --allowedTools ALONE IS NOT CONTAINMENT. It is ADDITIVE — it pre-approves so tools do not
// prompt; it bounds nothing. The operator's own ~/.claude/settings.local.json `permissions.allow`
// keeps applying to a spawn regardless. Four layers, verified against claude 2.1.220:
//
//   L0  --tools <builtins>       POSITIVE bound on built-ins; unnamed tools are not offered to
//                                the model at all. MCP tools are NOT affected by --tools, so
//                                the Dopl server still reaches dopl_only.
//   L1  --settings <file>        scoped JSON whose `permissions.deny` neutralizes the
//                                operator's global allow list (deny beats allow in one file).
//   L2  --disallowedTools        same names at the CLI layer — in -p mode an invalid settings
//                                file is SILENTLY ignored.
//   L3  --strict-mcp-config      only the Dopl server from --mcp-config loads.
//
// L0 is the load-bearing layer: a deny list is a blacklist, and this CLI ships far more
// built-ins than the obvious write/exec ones, each an exfil, delegation or persistence channel.
//
// ⚠ HEADLESS: `claude -p` has no TTY, so any tool NOT pre-approved via --allowedTools is
// AUTO-DENIED mid-run. Each profile pre-approves exactly what it needs.
//   read_only  local READ built-ins only. NO web (an outbound channel bypassing the
//              approve-out gate), NO Dopl MCP, no write/exec/delegation. Zero-outbound.
//              Answers come back on stdout, so no tool is needed to reply.
//   dopl_only  local reads + WEB reads + NON-ADMIN Dopl MCP, each named EXPLICITLY.
//              ⚠ Never the bare `mcp__dopl` prefix in an allow list — it matches the
//              destructive *_admin tools too (made v1.1's dopl_only MORE dangerous than full).
//              `dopl_channel` excluded AND denied, so the reply
//              routes through stdout + approve-out. Residual exfil (a GET query string) is
//              bounded: no Bash/Write/admin, so injected web content cannot ACT.
//   full       no restriction flags beyond the deny floor; the CLI's own gating applies.
//              ⚠ A headless `full` spawn CANNOT use Bash/Write/MCP — DELIBERATE: pre-approving
//              them for an untrusted teammate message lets side effects land DURING the run,
//              before the approve-out gate. Real shell access = Run-in-Terminal (live TTY).
//
// Unrecognized names in --allowedTools / --disallowedTools / --tools are harmless no-ops, so
// these lists may name tools that exist only in some CLI versions.

// ─── BEGIN TOOL-PROFILE TABLE (extracted verbatim by test/tool-profiles.test.mjs) ───

// How an agent posts into a channel directly — a WRITE/exfil surface that bypasses approve-out,
// so never granted to a restricted profile. dopl_only omits it from the allow list AND denies
// it by name; read_only denies the whole server prefix.
const DOPL_CHANNEL_TOOL = 'mcp__dopl__dopl_channel';

// Every non-admin, non-posting tool registered by packages/mcp-server/src/server.ts.
// mcp-config.js names the server `dopl`, so the CLI exposes each as `mcp__dopl__<tool>`.
// ⚠ `dopl_channel` is intentionally absent (see DOPL_CHANNEL_TOOL).
// ⚠ This list is the desktop's written record of the server's surface and four test files read
// it as such — a name that outlives its tool makes the record lie about what a spawn can reach.
const DOPL_SAFE_TOOLS = [
  'mcp__dopl__dopl_kb',
  'mcp__dopl__dopl_search',
  'mcp__dopl__dopl_map',
  'mcp__dopl__dopl_members',
  'mcp__dopl__dopl_skill',
  'mcp__dopl__dopl_ontology',
  'mcp__dopl__dopl_chats',
  // AGENT TEMPLATES (2026-08-28, MCP surface v2 wave A). ⚠ SAFE-LIST placement is
  // by the same rule `dopl_kb` and `dopl_skill` sit here under: it authors rows in
  // the workspace, which a restricted spawn may already do, and it POSTS NOTHING —
  // the exfil surface is `dopl_channel`, which stays out (and denied). Authoring a
  // template starts no agent either: that is `dopl_channel(op="launch_agent")`.
  'mcp__dopl__dopl_agent',
  // HOME CHANNELS (2026-08-28, wave B). ⚠ SAFE-LIST placement by the same rule
  // as `dopl_kb`: it authors rows the caller could author anyway and POSTS
  // NOTHING. Its one write makes a room the caller is ALONE in — it cannot
  // invite anybody, because minting the link that reaches a person is
  // `sessionOnly` and unreachable over MCP for every role and token.
  'mcp__dopl__dopl_home',
  'mcp__dopl__current_workspace',
  'mcp__dopl__list_workspaces',
];

// Destructive admin companions. NEVER grantable under any restricted profile: denied
// explicitly (belt) AND excluded from the allow list (braces).
// ⚠ Keep even though each now refuses every delete op server-side — containment must not
// depend on server-side policy, and a deny the operator cannot click through is stronger.
const DOPL_ADMIN_TOOLS = [
  'mcp__dopl__dopl_kb_admin',
  'mcp__dopl__dopl_skill_admin',
  'mcp__dopl__dopl_ontology_admin',
  'mcp__dopl__dopl_chats_admin',
  'mcp__dopl__dopl_agent_admin',
];

// Dopl tools that NO LONGER EXIST — deleted server-side, registrars, routes and tables.
// ⚠ THE DENY OUTLIVES THE TOOL, DELIBERATELY. Dropping a name from DOPL_ADMIN_TOOLS alone
// makes it UNCLASSIFIED, which resolves to `gate` — one operator click away from running,
// instead of immovably denied. The caller is a CLI we do not control and the name is
// attacker-suppliable, so containment must not depend on the server's current tool list.
// UNIVERSAL_HARD_DENY = admins + these = 9 since 2026-08-28 (it was 8 from 2026-08-11, and moved
// because `dopl_agent_admin` joined the admin half — NOT because anything was retired; this list
// is unchanged). docs/INVARIANTS.md §11 pins the number.
// Do NOT shorten this list to tidy up.
const RETIRED_DOPL_TOOLS = [
  'mcp__dopl__dopl_workflow',
  'mcp__dopl__dopl_workflow_admin',
  'mcp__dopl__dopl_cluster',
  'mcp__dopl__dopl_cluster_admin',
];

// ⚠ Bare server prefix — valid ONLY in a DENY list (it matches every tool on the server,
// admins included), NEVER in an allow list.
const DOPL_SERVER_PREFIX = 'mcp__dopl';

// Local READ built-ins every restricted spawn may use; also the base of the --tools positive
// bound. None ever trigger a permission prompt, so they work unchanged headless.
const READ_BUILTINS = ['Read', 'Grep', 'Glob', 'LS', 'TodoWrite'];

// Web-READ built-ins, granted ONLY to dopl_only (--tools bound AND --allowedTools).
// ⚠ Keep them OUT of read_only: web is an outbound channel bypassing the approve-out gate,
// and read_only is the zero-outbound profile.
const WEB_TOOLS = ['WebFetch', 'WebSearch'];

// Built-ins a restricted spawn must never reach, grouped by what they'd buy an attacker who
// has injected the untrusted message body.
const DENIED_BUILTINS = [
  // Local execution + filesystem writes.
  'Bash', 'BashOutput', 'KillShell',
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  // Delegation: a subagent is a fresh session that does not inherit this bound.
  'Task', 'Agent', 'TaskCreate', 'TaskUpdate', 'TaskStop',
  'TaskGet', 'TaskList', 'TaskOutput',
  // Outbound channels — data off the machine WITHOUT passing the approve-out gate.
  // ⚠ WebFetch/WebSearch are NOT here: governed PER-PROFILE via WEB_TOOLS.
  'Artifact', 'SendMessage', 'SendUserMessage',
  'PushNotification', 'RemoteTrigger', 'ReportFindings', 'DesignSync',
  // Persistence / scheduling: survives the spawn and re-runs unattended.
  'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'Monitor',
  // Capability escalation: pulls in code, tools, or worktrees we did not scope.
  'EnterWorktree', 'ExitWorktree', 'Workflow', 'Skill', 'ToolSearch',
];

// ⚠ THE DENY FLOOR UNDER EVERY PROFILE, `full` INCLUDED. NOT a restriction of what `full`
// grants — `full` still gets no `--tools` bound, no `--allowedTools`, no scoped settings and
// specifically NO `--strict-mcp-config`.
// ⚠ session-profiles.SESSION_HARD_DENY IS this constant — both lanes must answer `full`
// identically. Do NOT re-split them: `Bash` is live-gated under `full` in the SDK lane, and
// anyone with Bash has curl, launchd and a child that outlives the window, so denying
// SendMessage / Artifact alongside it is a list, not a boundary. `full`'s supervision is
// Axis A (both AUTO_TOOLS and BYPASS_TOOLS are positive allow-lists, so those built-ins still
// stop on a button in every mode). Universal floor = retired tools + destructive admins.
const UNIVERSAL_HARD_DENY = [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS];

const TOOL_PROFILES = {
  read_only: [...READ_BUILTINS],
  dopl_only: [...READ_BUILTINS, ...WEB_TOOLS, ...DOPL_SAFE_TOOLS],
  full: [], // empty => no --allowedTools bound at all
};

const KNOWN_PROFILES = ['read_only', 'dopl_only', 'full'];

// ⚠ FAIL CLOSED ON AN UNKNOWN VALUE -> read_only, matching session-park.knownProfile.
// `myAgentToolProfile` is null for a non-member read, an unrefreshed DTO, and any out-of-enum
// value; an unresolvable profile must never BECOME the widest one. An EXPLICIT 'full' is
// honoured untouched — choosing max access is fine, drifting into it is not.
// ⚠ The reporter is INJECTED (wired to diag below, outside the extracted block) because this
// file must stay electron/fs/path-free.
let reportUnknownProfile = function () {};
function onUnknownProfile(fn) {
  reportUnknownProfile = typeof fn === 'function' ? fn : function () {};
}

function normalizeProfile(p) {
  if (KNOWN_PROFILES.indexOf(p) !== -1) return p;
  reportUnknownProfile(p);
  return 'read_only';
}

// The --allowedTools list for a profile (empty array => omit the flag).
function buildAllowedTools(profile) {
  return TOOL_PROFILES[normalizeProfile(profile)] || [];
}

// The deny list for a profile — used BOTH as `permissions.deny` in the scoped
// settings file and as --disallowedTools. Empty for `full`.
function buildDeniedTools(profile) {
  const p = normalizeProfile(profile);
  // `full` is the UNIVERSAL FLOOR and nothing else.
  if (p === 'full') return [...UNIVERSAL_HARD_DENY];
  const denied = [...DENIED_BUILTINS, ...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS];
  // read_only: no Dopl MCP at all AND no web. Admins repeated by name so containment survives
  // a CLI that stops honoring the bare-prefix form.
  if (p === 'read_only') {
    denied.unshift(DOPL_SERVER_PREFIX);
    denied.push(...WEB_TOOLS);
  } else if (p === 'dopl_only') {
    // Deny dopl_channel by name so the reply routes through stdout + approve-out.
    // WEB_TOOLS deliberately NOT denied here.
    denied.push(DOPL_CHANNEL_TOOL);
  }
  return denied;
}

// L0: the --tools positive bound on BUILT-INs (empty => omit the flag). A tool not named here
// is not offered to the model at all.
function buildBuiltinTools(profile) {
  const p = normalizeProfile(profile);
  if (p === 'full') return [];
  return p === 'dopl_only' ? [...READ_BUILTINS, ...WEB_TOOLS] : [...READ_BUILTINS];
}

// ⚠ Every restriction flag for a spawn, shared verbatim by headless and terminal mode so the
// two can never drift. `settingsPath` null => scoped settings unwritable; the other three
// layers still hold.
function buildRestrictionArgs(profile, settingsPath) {
  const p = normalizeProfile(profile);
  // ⚠ `full` gets the deny floor and EXACTLY ONE FLAG: no `--tools`, no `--allowedTools`, no
  // `--settings`, and NO `--strict-mcp-config` — the operator's global MCP servers are the
  // point of `full`.
  if (p === 'full') return ['--disallowedTools', UNIVERSAL_HARD_DENY.join(',')];
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

// ⚠ OUTSIDE the extracted block (which must stay electron/fs/path-free) and the require is
// LAZY, so `node --test` never pulls electron in. A failure to log must never change the
// containment decision already made.
onUnknownProfile(function (value) {
  try {
    require('./diag').diag(
      'tool-profile: unrecognized value',
      JSON.stringify(value === undefined ? null : value),
      '-> read_only (fail closed). A missing myAgentToolProfile is an UNREFRESHED or',
      'non-member channel DTO; an explicit "full" is unaffected.'
    );
  } catch (_) { /* the log is optional; the fail-closed answer is not */ }
});

// Plain-language profile label for the consent notification's blast-radius line.
// ⚠ OUTSIDE the extracted table block so it never perturbs the source-extraction test.
const PROFILE_LABELS = { read_only: 'Read-only', dopl_only: 'Dopl-only', full: 'Full-access' };
function profileLabel(profile) {
  // ⚠ Fallback follows normalizeProfile — a label of 'Full-access' over a spawn contained at
  // read_only is a consent card that lies.
  return PROFILE_LABELS[normalizeProfile(profile)] || PROFILE_LABELS.read_only;
}

// Per-profile capability hint on the consent notification, so the operator sees the REAL
// HEADLESS reach before approving. ⚠ OUTSIDE the extracted table block.
const PROFILE_HINTS = {
  read_only: 'Reads your local files only — no web, Dopl, shell, or file writes.',
  dopl_only: 'Reads your files, the Dopl archive/KB, and the web — no shell or writes.',
  full: 'Limited headless (no shell or writes). Run it in a session window to approve each tool live.',
};
function profileHint(profile) {
  return PROFILE_HINTS[normalizeProfile(profile)] || PROFILE_HINTS.read_only;
}

module.exports = {
  DOPL_CHANNEL_TOOL,
  KNOWN_PROFILES,
  UNIVERSAL_HARD_DENY, // the floor that applies under `full` too
  onUnknownProfile, // injected reporter (wired to diag above; tests drive it directly)
  DOPL_SAFE_TOOLS,
  DOPL_ADMIN_TOOLS,
  RETIRED_DOPL_TOOLS,
  DOPL_SERVER_PREFIX,
  READ_BUILTINS,
  WEB_TOOLS,
  DENIED_BUILTINS,
  normalizeProfile,
  buildAllowedTools,
  buildDeniedTools,
  buildBuiltinTools,
  buildRestrictionArgs,
  profileLabel,
  profileHint,
};
