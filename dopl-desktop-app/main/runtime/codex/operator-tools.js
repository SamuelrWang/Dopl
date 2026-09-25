// "Use my tools" on Codex (`main/operator-tools.js` decides WHEN; the gate still judges every call).
// Every scope: the operator's own MCP servers, read through `codex mcp list --json` against THEIR config
// home (never their auth; the session keeps Dopl's private CODEX_HOME), each forced to `prompt` so every
// call reaches Dopl's gate and their per-tool approvals cannot shadow it. A PRIVATE channel also lifts
// the native fences (sub-agents, goals, sleep, memories, apps, plugins, skills, the catalog's delegation
// fence); a shared one keeps them, because they raise no per-call request the gate could refuse on a
// peer's turn.

const { execFile } = require('child_process');
const { isDoplServer, isPrivateChannel } = require('../../operator-tools');

const LIST_TIMEOUT_MS = 10000;
// `hooks` stays off: a hook runs a command no gate sees, and the ruling does not name it.
const NATIVE_FEATURES = Object.freeze({
  apps: true, plugins: true, multi_agent: true, goals: true, sleep_tool: true, memories: true, hooks: false,
});
// The server `features.apps` mounts from the account; its tool calls are the operator's too.
const APPS_SERVER = 'codex_apps';
const APPROVAL_MODE = 'prompt';

/** Are the native fences lifted for this spawn? Re-read at every spawn, so a room that gained a peer
 *  relaunches fenced. */
const nativesOn = (s) => !!s && s.operatorTools === 'private' && isPrivateChannel(s.channelId);

const TRANSPORT_KEYS = {
  stdio: ['command', 'args', 'env', 'env_vars', 'cwd'],
  streamable_http: ['url', 'bearer_token_env_var', 'http_headers', 'env_http_headers', 'http_headers_helper'],
};

/** One `mcp list` row as a thread-config entry, or null (disabled, unknown transport, or Dopl's own). */
function entryFor(row) {
  const t = row && row.transport;
  const keys = t && TRANSPORT_KEYS[t.type];
  if (!keys || row.enabled !== true || isDoplServer(row.name, t.url)) return null;
  const out = { default_tools_approval_mode: APPROVAL_MODE };
  for (const key of keys) if (t[key] != null) out[key] = t[key];
  for (const key of ['startup_timeout_sec', 'tool_timeout_sec']) if (typeof row[key] === 'number') out[key] = row[key];
  return out;
}

/** `{ [name]: entry }` for the operator's enabled servers; `{}` on any failure (the launch proceeds). */
function operatorServers(bin, env, log) {
  if (!bin) return Promise.resolve({});
  return new Promise((resolve) => {
    execFile(bin, ['mcp', 'list', '--json'], { env, encoding: 'utf8', timeout: LIST_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      const servers = {};
      try {
        if (err) throw err;
        for (const row of JSON.parse(out)) {
          const entry = entryFor(row);
          if (entry && typeof row.name === 'string' && row.name) servers[row.name] = entry;
        }
      } catch (e) {
        log('codex: could not read your MCP servers —', e && e.message);
      }
      resolve(servers);
    });
  });
}

/** The server names whose tool-call approvals are the operator's (`server-requests.js`). */
function approvalServers(servers, natives) {
  const names = new Set(Object.keys(servers));
  if (natives === true) names.add(APPS_SERVER);
  return names;
}

module.exports = { NATIVE_FEATURES, nativesOn, entryFor, operatorServers, approvalServers };
