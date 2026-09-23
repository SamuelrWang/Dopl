// The tool-profile containment VOCABULARY and the shared deny lists each adapter's tool config
// (`runtime/*/tools.js`) builds from. Profiles, narrowest first: `read_only`, `dopl_only`,
// `channel_agent` (`full` minus the shell: what a launch into a SHARED room resolves to, never stored;
// its web reads remain an outbound path, ruling B7) and `full`. The table block is electron-free:
// suites evaluate it verbatim.

// ─── BEGIN TOOL-PROFILE TABLE (extracted verbatim by test/tool-profiles.test.mjs) ───

// How an agent posts into a channel — the exfil surface; never pre-approved on a restricted profile.
const DOPL_CHANNEL_TOOL = 'mcp__dopl__dopl_channel';

// Every non-admin, non-posting tool the MCP server registers (`mcp__dopl__<tool>`). It must match the
// server's live surface (`tool-profiles.test.mjs` parses `packages/mcp-server/src`): an unlisted tool
// is unclassified and gates.
const DOPL_SAFE_TOOLS = [
  'mcp__dopl__dopl_kb',
  'mcp__dopl__dopl_search',
  'mcp__dopl__dopl_map',
  'mcp__dopl__dopl_members',
  'mcp__dopl__dopl_skill',
  'mcp__dopl__dopl_ontology',
  'mcp__dopl__dopl_chats',
  'mcp__dopl__dopl_agent',
  'mcp__dopl__dopl_status',
  'mcp__dopl__dopl_workspaces',
];

// Destructive `*_admin` tools the server registers today — none. The slot stays, held EQUAL to the
// server's live `*_admin` registrations, so a new one lands on the deny path, never the safe list.
const DOPL_ADMIN_TOOLS = [];

// Deleted tools stay DENIED: an unlisted name would resolve to `gate`, one click from running, and
// the name is caller-suppliable. Do not shorten (INVARIANTS §11 pins the floor's size).
const RETIRED_DOPL_TOOLS = [
  'mcp__dopl__dopl_workflow',
  'mcp__dopl__dopl_workflow_admin',
  'mcp__dopl__dopl_cluster',
  'mcp__dopl__dopl_cluster_admin',
  'mcp__dopl__dopl_kb_admin',
  'mcp__dopl__dopl_skill_admin',
  'mcp__dopl__dopl_ontology_admin',
  'mcp__dopl__dopl_chats_admin',
  'mcp__dopl__dopl_agent_admin',
];

// Matches every tool on the server (`dopl_channel` included): valid in a DENY list only.
const DOPL_SERVER_PREFIX = 'mcp__dopl';

// Local READ built-ins every restricted profile may use.
const READ_BUILTINS = ['Read', 'Grep', 'Glob', 'LS', 'TodoWrite'];

// Web reads: `dopl_only` only — web is an outbound channel, and `read_only` is zero-outbound.
const WEB_TOOLS = ['WebFetch', 'WebSearch'];

// The shell, spelled once (`BashOutput`/`KillShell` reach the same child); every reader derives from it.
const SHELL_BUILTINS = ['Bash', 'BashOutput', 'KillShell'];

// Built-ins a restricted profile never reaches, by what they would buy an injected message body.
const DENIED_BUILTINS = [
  ...SHELL_BUILTINS,
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Task', 'Agent', 'TaskCreate', 'TaskUpdate', 'TaskStop',
  'TaskGet', 'TaskList', 'TaskOutput',
  'Artifact', 'SendMessage', 'SendUserMessage',
  'PushNotification', 'RemoteTrigger', 'ReportFindings', 'DesignSync',
  'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'Monitor',
  'EnterWorktree', 'ExitWorktree', 'Workflow', 'Skill', 'ToolSearch',
];

// The deny floor under EVERY profile, `full` included (`runtime/claude/tools.js › SESSION_HARD_DENY` is
// a copy); `full`'s supervision is Axis A (auto/bypass are positive allow-lists), not this list.
const UNIVERSAL_HARD_DENY = [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS];

// `channel_agent`'s floor: `full`'s plus the shell, DERIVED so the two move together.
const CHANNEL_AGENT_HARD_DENY = [...UNIVERSAL_HARD_DENY, ...SHELL_BUILTINS];

// Narrowest first. `session-park.js › KNOWN_PROFILES` is a second copy over the durable record, held
// equal by `test/channel-agent-profile.test.mjs`.
const KNOWN_PROFILES = ['read_only', 'dopl_only', 'channel_agent', 'full'];

// An unknown value fails CLOSED to `read_only` (an unresolvable profile must never become the widest);
// an explicit `full` is honoured. The reporter is injected (wired to diag below) to keep this block pure.
let reportUnknownProfile = function () {};
function onUnknownProfile(fn) {
  reportUnknownProfile = typeof fn === 'function' ? fn : function () {};
}

function normalizeProfile(p) {
  if (KNOWN_PROFILES.indexOf(p) !== -1) return p;
  reportUnknownProfile(p);
  return 'read_only';
}

/**
 * The profile a launch into this room resolves to (ruling B7): `full` → `channel_agent` when the room
 * is SHARED (more than one member, `targeting-window.js › isSharedChannel`), else unchanged. It only
 * narrows, and is re-derived per spawn; nothing writes `channel_agent` back.
 */
function profileForChannel(profile, shared) {
  const p = normalizeProfile(profile);
  return shared === true && p === 'full' ? 'channel_agent' : p;
}

// ─── END TOOL-PROFILE TABLE ───

// Outside the block, lazily required: a failure to log never changes the fail-closed answer.
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

// The ask banner's plain-language profile label and reach hint (`trigger.js › notifyAsk`).
const PROFILE_LABELS = {
  read_only: 'Read-only',
  dopl_only: 'Dopl-only',
  channel_agent: 'Shared-channel',
  full: 'Full-access',
};
function profileLabel(profile) {
  // Falls back like `normalizeProfile` (read_only): a 'Full-access' label over a read_only spawn would lie.
  return PROFILE_LABELS[normalizeProfile(profile)] || PROFILE_LABELS.read_only;
}

const PROFILE_HINTS = {
  read_only: 'Reads your local files only — no web, Dopl, shell, or file writes.',
  dopl_only: 'Reads your files, the Dopl archive/KB, and the web — no shell or writes.',
  channel_agent: 'Full access minus the shell, because other people are in this channel.',
  full: 'Full access: your files, the shell, the web and Dopl.',
};
function profileHint(profile) {
  return PROFILE_HINTS[normalizeProfile(profile)] || PROFILE_HINTS.read_only;
}

module.exports = {
  DOPL_CHANNEL_TOOL,
  KNOWN_PROFILES,
  UNIVERSAL_HARD_DENY,
  CHANNEL_AGENT_HARD_DENY,
  SHELL_BUILTINS,
  onUnknownProfile,
  DOPL_SAFE_TOOLS,
  DOPL_ADMIN_TOOLS,
  RETIRED_DOPL_TOOLS,
  DOPL_SERVER_PREFIX,
  READ_BUILTINS,
  WEB_TOOLS,
  DENIED_BUILTINS,
  normalizeProfile,
  profileForChannel,
  profileLabel,
  profileHint,
};
