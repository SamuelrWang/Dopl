// Grok's Axis-A vocabulary and containment table, in Grok's own tool ids (the `_x.ai/hooks/run` payload's
// `toolName`, the permission request's `_meta["x.ai/tool"].name`). Restricted profiles ship a deny list
// (`grantDecision` step 1) that the PreToolUse hook enforces on EVERY tool — including the ones Grok never
// asks about (`read_file`, `web_search`) — plus, on read_only/dopl_only, a positive allow-list: a built-in
// Dopl has not classified is denied there, never run (`approval.js › hookVerdict`).

const {
  DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY,
  DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('../../tool-profiles');
const { DOPL_WRITE_TOOLS, DOPL_READ_TOOLS, GRANULAR_SAFE_TOOLS, withGranularOffer } = require('../../session-dopl-tools');
const { canonicalDoplName } = require('../../mcp-tool-names');

function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// ── GROK'S BUILT-IN TOOL IDS ────────────────────────────────────────────────────────────────
// LIVE on 1.0.52 (2026-10-13, `smoke-s1..s3`): `run_terminal_command`, `read_file`, `write`, `search_tool`,
// `use_tool`. The rest are read in xAI's docs (`22-permissions-and-safety.md`) — smoke S5b confirms them.
// `use_tool` is the MCP dispatcher: the hook and the permission request both name the RESOLVED tool
// (`dopl_session__post_message`), so `use_tool` itself is never a gate question.
const SHELL_TOOLS = Object.freeze(['run_terminal_command', 'kill_command_or_subagent']);
const DELEGATION_TOOLS = Object.freeze(['spawn_subagent', 'send_subagent_message']);
const EDIT_TOOLS = Object.freeze(['write', 'search_replace', 'write_file']);
const NETWORK_TOOLS = Object.freeze(['web_search', 'web_fetch', 'x_keyword_search', 'x_semantic_search']);
// Never prompted on any mode (Grok's read-only set) and harmless on every profile.
const READ_TOOLS = Object.freeze([
  'read_file', 'list_dir', 'grep', 'search_tool', 'todo_write', 'get_command_or_subagent_output',
  'exit_plan_mode', 'task_complete',
]);
const ESCALATION_TOOLS = SHELL_TOOLS.concat(DELEGATION_TOOLS);

// The MCP dispatcher, and the server key Dopl registers its session server under (`mcp.js`, and the private
// config's ask rule + MCP allow-list, `config-home.js`): Grok names an MCP tool `<server>__<tool>`; the gate's
// vocabulary is `mcp__<server>__<tool>`. A `dopl_` key, like Muse's.
const USE_TOOL = 'use_tool';
const SERVER_KEY = 'dopl_session';

/** Grok's name for a tool → the name the gate is asked about. `dopl_session__post_message` →
 *  `mcp__dopl_session__post_message`; a built-in id passes as itself. */
function gateNameOf(grokName) {
  const n = typeof grokName === 'string' ? grokName.trim() : '';
  if (!n) return '';
  if (n.startsWith('mcp__')) return n;
  return /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+$/.test(n) ? `mcp__${n}` : n;
}

// ── AXIS A ───────────────────────────────────────────────────────────────────────────────────
// The tool modes, narrowest first; `[0]` is the fail-closed default. `default` (no flag) and `autoMode` (the
// `_meta` flag's own name — not `auto`, which is Claude's word: no word is shared by two runtimes, the
// directive wire is a SET) are Grok's session modes (`session/new._meta`, `policy.js`); `approve-all` is
// Dopl's — it runs on Grok's `default`
// mode and Dopl's gate allows every classified tool (`axisAAllows`). Grok's `yoloMode` is NEVER sent: it skips
// every prompt, Dopl's MCP ask rule included, and the requirements lock does not stop it (LIVE, `smoke-s2`).
const TOOL_MODES = ['default', 'autoMode', 'approve-all'];

// Positive allow-lists only: an unrecognised name gates in every mode, `approve-all` included.
const DEFAULT_TOOLS = DOPL_READ_TOOLS.concat(READ_TOOLS);
const AUTO_TOOLS = DEFAULT_TOOLS.concat(EDIT_TOOLS);
const APPROVE_ALL_TOOLS = AUTO_TOOLS.concat(SHELL_TOOLS, NETWORK_TOOLS, DOPL_WRITE_TOOLS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? TOOL_MODES[0] : mode;
}

// Never sees a channel call (`grantDecision` branches it to Axis B first). Names canonicalised (F-139).
function axisAAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'default') return DEFAULT_TOOLS.indexOf(name) !== -1;
  if (m === 'autoMode') return AUTO_TOOLS.indexOf(name) !== -1;
  return APPROVE_ALL_TOOLS.indexOf(name) !== -1; // approve-all
}

// ── CONTAINMENT ──────────────────────────────────────────────────────────────────────────────
// Every profile: no sub-agents (later work is a visible Dopl agent — the Muse workflow / Codex delegation
// precedent). Restricted profiles: no shell, no edits, no network, and only `hookAllow` built-ins at all.
const RESTRICTED_DENY = Object.freeze(ESCALATION_TOOLS.concat(EDIT_TOOLS, NETWORK_TOOLS));

function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);
  const doplSurfaceDeny = DOPL_ADMIN_TOOLS.concat(RETIRED_DOPL_TOOLS);
  const row = (fields) => Object.assign({ builtinTools: [], preApproved: [] }, fields);
  // `hookAllow` null = no positive list (every built-in not denied may run, asked per Axis A).
  const native = (hookAllow) => ({ hookAllow });

  if (p === 'read_only') {
    return row({
      disallowedTools: RESTRICTED_DENY.concat(doplSurfaceDeny, DOPL_SAFE_TOOLS, GRANULAR_SAFE_TOOLS),
      doplToolsPolicy: withGranularOffer([channelShort]),
      native: native(READ_TOOLS.slice()),
    });
  }
  if (p === 'dopl_only') {
    return row({
      disallowedTools: RESTRICTED_DENY.concat(doplSurfaceDeny),
      doplToolsPolicy: withGranularOffer(DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort])),
      native: native(READ_TOOLS.slice()),
    });
  }
  // `full` minus the shell and delegation.
  if (p === 'channel_agent') {
    return row({
      disallowedTools: UNIVERSAL_HARD_DENY.concat(ESCALATION_TOOLS),
      doplToolsPolicy: null,
      native: native(null),
    });
  }
  return row({
    disallowedTools: UNIVERSAL_HARD_DENY.concat(DELEGATION_TOOLS),
    doplToolsPolicy: null,
    native: native(null),
  });
}

// Declared data (`grok-runtime.md` §3 [3]): Grok's auto mode — routine local work proceeds on Grok's
// classifier, and every Dopl MCP call still reaches the gate (the private config's ask rule), which a
// windowless session settles or denies. `capability.js › floorWindowlessTool` never narrows a wider pick.
const WINDOWLESS_FLOOR = 'autoMode';

module.exports = {
  shortDoplName, gateNameOf, buildSessionToolConfig, axisAAllows, normalizeToolMode,
  TOOL_MODES, WINDOWLESS_FLOOR, SHELL_TOOLS, DELEGATION_TOOLS, EDIT_TOOLS, NETWORK_TOOLS, READ_TOOLS,
  ESCALATION_TOOLS, RESTRICTED_DENY, USE_TOOL, SERVER_KEY, DEFAULT_TOOLS, AUTO_TOOLS, APPROVE_ALL_TOOLS,
};
