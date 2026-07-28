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
// HEADLESS FUNCTIONALITY (the point of this profile set). `claude -p` has no TTY,
// so it cannot show a permission prompt: any tool NOT pre-approved via
// --allowedTools is AUTO-DENIED mid-run. Each profile therefore pre-approves exactly
// the tools it is meant to use, so all three are actually usable headless:
//   read_only  — pure LOCAL research: local READ built-ins only (Read/Grep/Glob/LS/
//                TodoWrite). Those never prompt, so they already work headless with
//                no --allowedTools entry needed; the flag is emitted anyway as the
//                positive allow bound. NO web (WebFetch / WebSearch are an outbound
//                channel that bypasses the approve-out gate entirely), NO Dopl MCP at
//                all, no write/exec/delegation. This is the AIRTIGHT, zero-outbound
//                profile. Headless answers come back on stdout, so no tool is needed
//                to reply.
//   dopl_only  — the definitive SAFE headless READ profile: local READ built-ins +
//                WEB reads (WebFetch / WebSearch) + the NON-ADMIN Dopl MCP tools,
//                each named explicitly in --allowedTools so it is pre-approved and
//                works headless with NO prompt (this is what fixes the "Dopl tools
//                return permission-denied" headless failure). Net capability: "read
//                your files + the Dopl chat archive / KB / search + the web, nothing
//                destructive." Never the bare `mcp__dopl` prefix: that matches the
//                six destructive *_admin tools too (dopl_kb_admin alone carries
//                delete_base / delete_folder / delete_file), which made v1.1's
//                dopl_only MORE dangerous than full. `dopl_channel` is deliberately
//                EXCLUDED and explicitly DENIED (see below): a dopl_only agent could
//                otherwise post/exfiltrate directly and bypass the approve-out
//                review, so its reply instead routes through stdout + the approve-out
//                gate exactly like read_only. Web is granted here (unlike read_only)
//                by product design — dopl_only is the "assistant that can look things
//                up" profile. The residual exfil surface (a GET can carry data in its
//                query string) is BOUNDED: the agent has no Bash/Write/admin, so
//                injected web content cannot ACT, only inform the drafted reply the
//                operator still reviews at the approve-out gate. Choose read_only when
//                zero outbound is required.
//   full       — unchanged flag behavior: no restriction flags, no scoped settings,
//                the CLI's own permission gating applies. HEADLESS REALITY: with no
//                --allowedTools a headless `full` spawn CANNOT use Bash/Write/MCP —
//                the CLI auto-denies any non-pre-approved tool when there is no TTY.
//                This is DELIBERATE, not a gap: pre-approving Bash/Write for an
//                untrusted teammate message would let side effects land DURING the
//                run, before the approve-out gate — the real RCE surface. For genuine
//                shell/full capability the operator turns on Run-in-Terminal, where a
//                live TTY lets them approve each tool as it is requested. The consent
//                notification's capability hint says exactly this (see profileHint).
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

// Local READ built-ins every restricted spawn may use. Also the base of the --tools
// positive bound. None of these ever trigger a permission prompt, so they work
// unchanged in headless `claude -p` (this is why read_only is functional headless
// without pre-approving anything special).
const READ_BUILTINS = ['Read', 'Grep', 'Glob', 'LS', 'TodoWrite'];

// Web-READ built-ins. Granted ONLY to dopl_only — added to its --tools positive
// bound AND its --allowedTools so they are pre-approved and work headless. read_only
// DENIES these: web is an outbound channel that bypasses the approve-out gate, and
// read_only is the zero-outbound profile (keep them OUT of read_only).
const WEB_TOOLS = ['WebFetch', 'WebSearch'];

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
  // passing the approve-out gate, which is the whole point of that gate. (WebFetch/
  // WebSearch are NOT in this shared list: they are governed PER-PROFILE via
  // WEB_TOOLS — denied for read_only, allowed for dopl_only — see buildDeniedTools.)
  'Artifact', 'SendMessage', 'SendUserMessage',
  'PushNotification', 'RemoteTrigger', 'ReportFindings', 'DesignSync',
  // Persistence / scheduling: survives the spawn and re-runs unattended.
  'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'Monitor',
  // Capability escalation: pulls in code, tools, or worktrees we did not scope.
  'EnterWorktree', 'ExitWorktree', 'Workflow', 'Skill', 'ToolSearch',
];

const TOOL_PROFILES = {
  read_only: [...READ_BUILTINS],
  dopl_only: [...READ_BUILTINS, ...WEB_TOOLS, ...DOPL_SAFE_TOOLS],
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
  // read_only gets no Dopl MCP whatsoever AND no web: deny the whole server, the six
  // admins again by name (so containment survives a CLI that stops honoring the
  // bare-prefix form), and the web-read tools (read_only is zero-outbound).
  if (p === 'read_only') {
    denied.unshift(DOPL_SERVER_PREFIX);
    denied.push(...WEB_TOOLS);
  } else if (p === 'dopl_only') {
    // dopl_only keeps the read Dopl tools + web reads but must not post/exfiltrate
    // via the channel tool: deny dopl_channel by name so the reply routes through
    // stdout + approve-out. WEB_TOOLS are deliberately NOT denied here (dopl_only is
    // "read files + Dopl + web").
    denied.push(DOPL_CHANNEL_TOOL);
  }
  return denied;
}

// The --tools positive bound on BUILT-IN tools (empty => omit the flag). dopl_only
// additionally offers the web-read built-ins; read_only stays local-only. A tool not
// named here is not offered to the model at all (L0).
function buildBuiltinTools(profile) {
  const p = normalizeProfile(profile);
  if (p === 'full') return [];
  return p === 'dopl_only' ? [...READ_BUILTINS, ...WEB_TOOLS] : [...READ_BUILTINS];
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

// Plain-language profile label for operator-facing surfaces (Round C blast-radius
// line in the consent notification). Deliberately OUTSIDE the extracted table
// block above so it never perturbs the source-extraction test; still electron-free.
const PROFILE_LABELS = { read_only: 'Read-only', dopl_only: 'Dopl-only', full: 'Full-access' };
function profileLabel(profile) {
  return PROFILE_LABELS[normalizeProfile(profile)] || 'Full-access';
}

// One-line, per-profile capability hint appended to the consent notification body so
// the operator sees the REAL HEADLESS reach before approving. For the two restricted
// profiles it states the safe read scope; for `full` it states the headless
// limitation and points at Run-in-Terminal (a live TTY where each tool is approved as
// requested) for genuine shell/full access. Kept OUTSIDE the extracted table block so
// it never perturbs the source-extraction test; electron-free like profileLabel.
const PROFILE_HINTS = {
  read_only: 'Reads your local files only — no web, Dopl, shell, or file writes.',
  dopl_only: 'Reads your files, the Dopl archive/KB, and the web — no shell or writes.',
  full: 'Limited headless (no shell or writes). Run it in a session window to approve each tool live.',
};
function profileHint(profile) {
  return PROFILE_HINTS[normalizeProfile(profile)] || PROFILE_HINTS.full;
}

module.exports = {
  DOPL_CHANNEL_TOOL,
  DOPL_SAFE_TOOLS,
  DOPL_ADMIN_TOOLS,
  DOPL_SERVER_PREFIX,
  READ_BUILTINS,
  WEB_TOOLS,
  DENIED_BUILTINS,
  TOOL_PROFILES,
  normalizeProfile,
  buildAllowedTools,
  buildDeniedTools,
  buildBuiltinTools,
  buildRestrictionArgs,
  profileLabel,
  profileHint,
};
