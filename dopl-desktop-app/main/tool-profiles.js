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
//                destructive *_admin tools too (dopl_kb_admin alone publishes
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
//
// RETIREMENT (2026-08-07): `dopl_workflow` and `dopl_cluster` came off this list
// when server.ts stopped registering them; the tools themselves were DELETED on
// 2026-08-11. An allow-list entry for a tool that does not exist is a harmless
// no-op at the CLI, but it is not harmless HERE: this list is the desktop's
// written record of the server's surface, four test files read it as such, and a
// name that outlives the tool makes the record lie about what a spawn can reach.
const DOPL_SAFE_TOOLS = [
  'mcp__dopl__dopl_kb',
  'mcp__dopl__dopl_search',
  'mcp__dopl__dopl_map',
  'mcp__dopl__dopl_members',
  'mcp__dopl__dopl_skill',
  'mcp__dopl__dopl_ontology',
  'mcp__dopl__dopl_chats',
  'mcp__dopl__current_workspace',
  'mcp__dopl__list_workspaces',
];

// The destructive admin companions. NEVER grantable under any restricted
// profile; always denied explicitly (belt) as well as excluded from the allow
// list (braces).
//
// FOUR since the retirement (2026-08-07): `dopl_cluster_admin` and
// `dopl_workflow_admin` were unregistered server-side and are now DELETED
// (2026-08-11), so there is no tool left for the CLI to offer. Each of the four
// that remain
// now REFUSES every delete op at the server (§2b — deletion is app-only), which
// makes this list belt-and-braces on top of a server that already says no; it
// stays because a deny the operator cannot click through is still the stronger
// guarantee, and because containment must not depend on server-side policy.
const DOPL_ADMIN_TOOLS = [
  'mcp__dopl__dopl_kb_admin',
  'mcp__dopl__dopl_skill_admin',
  'mcp__dopl__dopl_ontology_admin',
  'mcp__dopl__dopl_chats_admin',
];

// Dopl tools that NO LONGER EXIST. Hidden by the server on 2026-08-07, then
// DELETED on 2026-08-11 — registrars, routes, tables and all. Nothing can
// register these names any more. They are gone from DOPL_SAFE_TOOLS and
// DOPL_ADMIN_TOOLS above, which are the lists that describe what a spawn CAN
// reach; this one exists so removing them does not quietly LOOSEN containment.
//
// THE DENY OUTLIVES THE TOOL, DELIBERATELY, and deleting the tool is not the
// event that retires the deny. `dopl_cluster_admin` and `dopl_workflow_admin`
// were hard-denied under every profile — a state the session table describes as
// immovable: no operator click, no task grant and no `bypass` opens it. Drop
// them from DOPL_ADMIN_TOOLS alone and they become UNCLASSIFIED, which resolves
// to `gate` — one click away from running, in the two profiles where a click is
// available. That the tool no longer exists is a good reason to expect the call
// never to arrive; it is not a reason for the desktop to start offering a button
// if it does, because the caller is a CLI we do not control and the name is
// attacker-suppliable. Containment must not depend on the server's current tool
// list, which is the whole premise of these layers.
//
// Unrecognized names in a deny list are harmless no-ops at the CLI (see the
// header), so this costs nothing. UNIVERSAL_HARD_DENY = admins + these = 8
// (docs/INVARIANTS.md §11 pins the number); do not shorten this list to tidy up.
const RETIRED_DOPL_TOOLS = [
  'mcp__dopl__dopl_workflow',
  'mcp__dopl__dopl_workflow_admin',
  'mcp__dopl__dopl_cluster',
  'mcp__dopl__dopl_cluster_admin',
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

// THE DENY FLOOR THAT APPLIES UNDER EVERY PROFILE, `full` INCLUDED (2026-08-08, the real
// half of audit C-10).
//
// WHAT THIS IS NOT. It is NOT a restriction of what `full` grants. `full` giving a
// teammate's request the operator's REAL tools — including their global MCP servers — is the
// product, not a hole, and nothing here narrows that: no `--tools` bound, no `--allowedTools`
// list, no scoped settings file and specifically NO `--strict-mcp-config` on this path.
//
// WHAT IT IS. `session-profiles.js` (the SDK lane) already hard-denied these under `full` while
// this lane short-circuited `full` to `[]` and applied nothing. Two lanes, one profile name,
// different answers. This is the floor made universal — and, since F-177, the SDK lane's
// `SESSION_HARD_DENY` is this very constant. It removes nothing anybody wants:
//   · RETIRED_DOPL_TOOLS name tools the server no longer registers at all, and an
//     unrecognized deny entry is a documented no-op at the CLI.
//   · DOPL_ADMIN_TOOLS are the destructive workspace admins, which the session lane already
//     refuses to offer a button for under `full` and which a channel session — running on an
//     untrusted peer's message — has no business reaching by any route.
//
// AND IT IS NOW THE WHOLE OF IT, IN BOTH LANES (2026-08-08, F-177). The C-10 round left the SDK
// lane's `SESSION_HARD_DENY` broader — it also hard-denied the delegation / outbound /
// persistence / escalation BUILT-INS (Task, Agent, Artifact, SendMessage, Cron*, Skill,
// ToolSearch, EnterWorktree, …) — and recorded the difference as a deliberate residual gap.
// Samuel reversed that: a `full` channel session SHOULD be able to use those built-ins, so
// `session-profiles.SESSION_HARD_DENY` is now literally `UNIVERSAL_HARD_DENY.slice()` and the
// two lanes answer `full` identically.
//
// THE REASONING, so nobody re-splits them. `Bash` was live-gated under `full` in the SDK lane
// the whole time, and anyone with Bash has `curl`, `launchd` and a child that outlives the
// window — so denying `SendMessage` / `Artifact` alongside it was not a boundary, it was a list.
// `full` gets its supervision from the OPERATOR'S PERMISSION PRESET (session-profiles' Axis A),
// not from the tool table: every one of those built-ins is absent from `AUTO_TOOLS` and
// `BYPASS_TOOLS`, both POSITIVE allow-lists, so each still stops on a button in every mode.
// What stays universal is only this floor: retired tools the server does not register, and the
// destructive workspace admins.
const UNIVERSAL_HARD_DENY = [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS];

const TOOL_PROFILES = {
  read_only: [...READ_BUILTINS],
  dopl_only: [...READ_BUILTINS, ...WEB_TOOLS, ...DOPL_SAFE_TOOLS],
  full: [], // empty => no --allowedTools bound at all (v1.1 behavior)
};

const KNOWN_PROFILES = ['read_only', 'dopl_only', 'full'];

// FAIL CLOSED ON AN UNKNOWN VALUE (2026-08-08, audit C-11).
//
// This used to answer `'full'` for anything it did not recognize — including `null`, which is
// what `myAgentToolProfile` is for a non-member read, for an unrefreshed DTO, and for any
// out-of-enum value that reaches the client. So a profile that could not be resolved silently
// BECAME the widest one, and nothing anywhere said so. The same app already answered the
// opposite question the opposite way one file over (`session-park.knownProfile`: unknown ->
// `read_only`, "fail restrictive"), so the tree held two deliberate, contradictory answers.
//
// THE DISTINCTION SAMUEL DREW, and it is the whole of this change: a user CHOOSING maximum
// access is fine — `full` is the DB column's default, a normal membership row really does
// carry it, and it passes through here untouched. An unknown value BECOMING maximum access is
// not. So an explicit `'full'` is honoured exactly as before and only the unresolvable case
// moves, to the same `read_only` the record path already picks.
//
// AND IT IS REPORTED. The operator whose explicit `read_only` evaporated into `full` had no
// signal of any kind; now the degradation is on the record. The reporter is INJECTED (wired to
// diag below, outside the extracted block) because this file must stay free of electron / fs /
// path — test/tool-profiles.test.mjs evaluates everything between the sentinels verbatim.
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
  // C-10: `full` is not "no deny list" any more — it is the UNIVERSAL FLOOR and nothing else.
  // See UNIVERSAL_HARD_DENY for what it contains, what it deliberately omits, and why none of
  // it narrows what `full` grants.
  if (p === 'full') return [...UNIVERSAL_HARD_DENY];
  const denied = [...DENIED_BUILTINS, ...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS];
  // read_only gets no Dopl MCP whatsoever AND no web: deny the whole server, the
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
  // C-10 — `full` GETS THE DENY FLOOR AND NOTHING ELSE. Exactly one flag: no `--tools`
  // (that would bound the built-in set), no `--allowedTools`, no `--settings`, and NO
  // `--strict-mcp-config` — the operator's global MCP servers are what `full` is FOR.
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

// C-11: wire the unknown-profile report to the shared diag log. OUTSIDE the extracted block
// on purpose — that block must stay free of electron / fs / path, and the require below is
// LAZY (it runs only when an unrecognized profile is actually seen), so requiring this module
// under `node --test` still costs nothing and cannot pull electron in. A failure to log must
// never be able to change the containment decision that has already been made.
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

// Plain-language profile label for operator-facing surfaces (Round C blast-radius
// line in the consent notification). Deliberately OUTSIDE the extracted table
// block above so it never perturbs the source-extraction test; still electron-free.
const PROFILE_LABELS = { read_only: 'Read-only', dopl_only: 'Dopl-only', full: 'Full-access' };
function profileLabel(profile) {
  // C-11: the fallback follows normalizeProfile rather than contradicting it. It used to
  // read 'Full-access' for an unresolvable profile — a consent card promising the operator
  // the widest scope over a spawn that is now contained at read_only.
  return PROFILE_LABELS[normalizeProfile(profile)] || PROFILE_LABELS.read_only;
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
  return PROFILE_HINTS[normalizeProfile(profile)] || PROFILE_HINTS.read_only; // C-11: same rule as the label
}

module.exports = {
  DOPL_CHANNEL_TOOL,
  KNOWN_PROFILES,
  UNIVERSAL_HARD_DENY, // C-10: the floor that applies under `full` too
  onUnknownProfile, // C-11: the injected reporter (wired to diag above; tests drive it directly)
  DOPL_SAFE_TOOLS,
  DOPL_ADMIN_TOOLS,
  RETIRED_DOPL_TOOLS,
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
