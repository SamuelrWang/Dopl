// Dopl's per-session MCP entry for Muse: `session/start.config.mcpServers[<SERVER_KEY>]`, transport
// `streamableHttp` (needs the `sessionMcp` capability, `client.js`). Never a settings file, never argv: the
// entry rides the JSON-RPC request on the child's stdin, so the bearer is never on a command line (§11.0d).
// Measured 1.4.7: a canary bearer sent this way was found nowhere under the private home afterwards.

const { MCP_URL } = require('../../config');
const { normalizeProfile, DOPL_CHANNEL_TOOL } = require('../../tool-profiles');
const { shortDoplName } = require('./tools');
const { toolSetHeaders } = require('../../mcp-connect');
const doplMcp = require('../kit/dopl-mcp');

// Same as Claude's and Codex's: the server may only narrow (CX-12).
const TOOL_PROFILE_HEADER = 'X-Dopl-Tool-Profile';

// Custody, not vendor: `desktop-session` is compared literally (`main/targeting.js › DESKTOP_RUNTIMES`);
// the vendor must equal `src/shared/auth/runtime-header.ts › MUSE_VENDOR` (no shared module).
const RUNTIME_HEADERS = {
  'X-Dopl-Runtime': 'desktop-session',
  'X-Dopl-Vendor': 'muse',
};

// A `dopl_` key: MSP refuses a session key that collides with a host or plugin server
// (`session_mcp_name_conflict`). Tools arrive as `mcp__dopl_session__<tool>`; the gate canonicalises any
// server segment (`mcp-tool-names.js`, F-139).
const SERVER_KEY = 'dopl_session';
const CHANNEL_TOOL = shortDoplName(DOPL_CHANNEL_TOOL);

const doplBearer = () => doplMcp.doplBearer();

/**
 * The entry, or `null` with no token (the session still launches without Dopl's tools — an entry that 401s
 * reads as a working path). `mode: 'required'`: a session whose Dopl server cannot start runs NO turn
 * (measured: `turn/completed failed configError "Required MCP server … failed during startup"`), which
 * `normalize.js` shows as Dopl's tools not connecting — never an agent that cannot post.
 */
function buildDoplServerEntry({ profile, toolSet, workspaceId, bearer, slotKey } = {}) {
  const override = typeof bearer === 'string' ? bearer.trim() : '';
  const token = override || doplBearer();
  if (!token) return null;
  const headers = Object.assign(
    { Authorization: `Bearer ${token}` },
    RUNTIME_HEADERS,
    { [TOOL_PROFILE_HEADER]: normalizeProfile(profile) },
    toolSetHeaders(toolSet),
  );
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) headers['X-Workspace-Id'] = pin;
  const slot = typeof slotKey === 'string' ? slotKey.trim() : '';
  // The server's own header parser's shape (id characters only, ≤128).
  if (slot && /^[A-Za-z0-9:._-]{1,128}$/.test(slot)) headers['X-Dopl-Session-Id'] = slot;
  return { transport: 'streamableHttp', url: MCP_URL, headers, mode: 'required' };
}

// Refused: Dopl never writes the operator's own Muse settings (`mcpServers` in `~/.config/muse`).
function registerMcp(_cfg) {
  return Promise.resolve({
    ok: false,
    reason: 'Dopl does not write an entry into your own Muse settings. Sessions Dopl spawns reach Dopl '
      + 'regardless — this only affects your own manual `muse` runs.',
  });
}

// Unknown, not absent: Dopl does not read the operator's Muse settings.
function probeMcp() {
  return Promise.resolve({ present: null, reason: 'Dopl does not read your own Muse settings' });
}

const descriptor = {
  sessionTransport: 'http',
  // No CLI verb Dopl drives; the session entry rides the protocol.
  hostRegistration: null,
  probe: false,
  toolNamePrefix: 'mcp__<server>__<tool>',
  // No per-tool approval key on the wire or in settings (MSP-REFERENCE §6): the approval MODE decides.
  perToolApproval: null,
  eagerLoadFlag: null,
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp, probeMcp, descriptor, buildDoplServerEntry,
  SERVER_KEY, RUNTIME_HEADERS, CHANNEL_TOOL, TOOL_PROFILE_HEADER,
};
