// "USE MY TOOLS" (Samuel, 2026-09-25): the operator's own tooling — their MCP servers, account
// connectors, browser, skills and native sub-agents — beside Dopl's. A PRIVATE channel (the operator
// is its only member) always has it; a SHARED one only with its toggle on, and then only on turns the
// operator originated: on any other turn the gate denies every operator tool. Approval is unchanged —
// the channel's Ask/Auto/Full governs these tools like any other; hard-deny and the outbound gate hold.

const { isDoplToolName } = require('./mcp-tool-names');
const { AGENT_OPS_TOOL_NAMES } = require('./agent-self-ops');
const { isSharedChannel } = require('./targeting-window');
const { normalizeToolMode, widestToolModeFor } = require('./session-profiles-runtime');
const { NATIVE_BUILTINS } = require('./tool-profiles');

/** An operator tool: a native built-in above, or any MCP tool that is neither Dopl's nor agent-ops'. */
function isOperatorTool(name) {
  const n = typeof name === 'string' ? name : '';
  if (NATIVE_BUILTINS.indexOf(n) !== -1) return true;
  return n.indexOf('mcp__') === 0 && !isDoplToolName(n) && AGENT_OPS_TOOL_NAMES.indexOf(n) === -1;
}

/**
 * The gate's operator-tool step (`session-profiles.js › grantDecision`), over `a.operatorTools` (a
 * {@link turnState}): `'deny'` on an `'off'` turn, `'allow'` on an `'on'` turn at the runtime's widest
 * tool mode (Full), `'gate'` below it; `null` for other tools and for a session that loaded none (its
 * unclassified names keep the ordinary ask). Without the Full arm the level could never open them.
 */
function operatorToolVerdict(a, name) {
  if (!a || !a.operatorTools || !isOperatorTool(name)) return null;
  if (a.operatorTools !== 'on') return 'deny';
  return normalizeToolMode(a.toolMode, a.runtime) === widestToolModeFor(a.runtime) ? 'allow' : 'gate';
}

// Lazy, and an unreadable answer is "shared, toggle off": the listener and the store pull electron.
function watchedChannel(channelId) {
  try { return require('./channel-listener').watchedChannel(channelId); } catch (_err) { return null; }
}
function toggleOn(channelId) {
  try { return require('./channel-prefs').getUseMyTools(channelId) === true; } catch (_err) { return false; }
}

/** The operator is the channel's only member, per the listener's live DTO (unknown = shared). */
const isPrivateChannel = (channelId) => !!channelId && !isSharedChannel(watchedChannel(channelId));

// A restricted Tool access (Read only / Dopl only) is the operator's own narrowing and stays whole.
const WIDE_PROFILES = ['full', 'channel_agent'];

/** At launch: `'private'`, `'shared'` (toggle on), or `''` — what the session loads. */
function launchScope(channelId, profile) {
  if (WIDE_PROFILES.indexOf(profile) === -1) return '';
  if (isPrivateChannel(channelId)) return 'private';
  return toggleOn(channelId) ? 'shared' : '';
}

/**
 * Per call: `''` (the session loaded none), `'on'` or `'off'` for THIS turn. Membership and the toggle
 * are read live, so a peer joining drops the tools for new turns.
 */
function turnState(s) {
  if (!s || !s.operatorTools) return '';
  if (isPrivateChannel(s.channelId)) return 'on';
  return toggleOn(s.channelId) && !require('./session-private').isPeerTurn(s) ? 'on' : 'off';
}

module.exports = { isOperatorTool, operatorToolVerdict, isPrivateChannel, launchScope, turnState };
