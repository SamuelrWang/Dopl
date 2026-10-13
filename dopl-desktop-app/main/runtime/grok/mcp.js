// Dopl's per-session MCP entry for Grok: ACP `session/new.mcpServers[]` (and `session/load`), transport
// `http` with `headers: [{ name, value }]`. Never a settings file, never argv: the entry rides the JSON-RPC
// request on the child's stdin, so the bearer is never on a command line (§11.0d). LIVE (1.0.52,
// `smoke-s1-mcp-server.log`): the headers reach the server verbatim — Authorization and X-Dopl-Runtime were
// present on all 42 requests. The private `requirements.toml` allow-lists this server name and no other
// (`config-home.js`), so a project `.mcp.json` never joins Dopl's session.

const { MCP_URL } = require('../../config');
const { normalizeProfile, DOPL_CHANNEL_TOOL } = require('../../tool-profiles');
const { shortDoplName, SERVER_KEY } = require('./tools');
const { toolSetHeaders } = require('../../mcp-connect');
const doplMcp = require('../kit/dopl-mcp');

// Same as Claude's, Codex's and Muse's: the server may only narrow (CX-12).
const TOOL_PROFILE_HEADER = 'X-Dopl-Tool-Profile';

// Custody, not vendor: `desktop-session` is compared literally (`main/targeting.js › DESKTOP_RUNTIMES`);
// the vendor must equal `src/shared/auth/runtime-header.ts › GROK_VENDOR` (no shared module).
const RUNTIME_HEADERS = {
  'X-Dopl-Runtime': 'desktop-session',
  'X-Dopl-Vendor': 'grok',
};

const CHANNEL_TOOL = shortDoplName(DOPL_CHANNEL_TOOL);

const doplBearer = () => doplMcp.doplBearer();

/** `{ k: v }` → ACP's `[{ name, value }]`. */
const headerList = (obj) => Object.keys(obj).map((name) => ({ name, value: String(obj[name]) }));

/**
 * The entry, or `null` with no token (the session still launches without Dopl's tools — an entry that 401s
 * reads as a working path). A server that does not come up arrives as `_x.ai/mcp/server_status` with a status
 * other than `ready` (`normalize.js` shows Dopl's tools not connecting).
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
  return { type: 'http', name: SERVER_KEY, url: MCP_URL, headers: headerList(headers) };
}

// Refused: Dopl never writes the operator's own Grok settings (`~/.grok/config.toml`).
function registerMcp(_cfg) {
  return Promise.resolve({
    ok: false,
    reason: 'Dopl does not write an entry into your own Grok settings. Sessions Dopl spawns reach Dopl '
      + 'regardless — this only affects your own manual `grok` runs.',
  });
}

// Unknown, not absent: Dopl does not read the operator's Grok settings.
function probeMcp() {
  return Promise.resolve({ present: null, reason: 'Dopl does not read your own Grok settings' });
}

const descriptor = {
  sessionTransport: 'http',
  // No CLI verb Dopl drives; the session entry rides the protocol.
  hostRegistration: null,
  probe: false,
  // Grok's own naming is `<server>__<tool>`; the gate is asked `mcp__<server>__<tool>` (`tools.js › gateNameOf`).
  toolNamePrefix: 'mcp__<server>__<tool>',
  // No per-tool approval key Dopl sets: the private config's ask rule covers the whole server.
  perToolApproval: null,
  eagerLoadFlag: null,
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp, probeMcp, descriptor, buildDoplServerEntry, headerList,
  SERVER_KEY, RUNTIME_HEADERS, CHANNEL_TOOL, TOOL_PROFILE_HEADER,
};
