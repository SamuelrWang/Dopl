// Dopl's per-launch `mcp_servers` entry (thread config, never a file or CLI verb). Timeout and device token
// are read from `main/mcp-config.js`, never restated.

const { MCP_URL } = require('../../config');
const { normalizeProfile, DOPL_CHANNEL_TOOL } = require('../../tool-profiles');
const { shortDoplName } = require('./tools');

// Values ride the child's env; only these NAMES appear in the entry, never the bearer in argv.
const BEARER_ENV = 'DOPL_MCP_TOKEN';
const WORKSPACE_ENV = 'DOPL_MCP_WORKSPACE_ID';
const SESSION_ENV = 'DOPL_MCP_SESSION_ID';

// The bearer must never reach a shell: Codex's KEY/TOKEN default exclude is off by default (CX-03).
const SHELL_ENV_EXCLUDE = Object.freeze(['DOPL_MCP_*']);
function shellEnvironmentPolicy() {
  return { exclude: SHELL_ENV_EXCLUDE.slice() };
}

// Same as Claude's (`claude/loader.js › withToolProfileStamp`): the server may only narrow (CX-12).
const TOOL_PROFILE_HEADER = 'X-Dopl-Tool-Profile';

// Custody, not vendor: `desktop-session` is compared literally (`main/targeting.js › DESKTOP_RUNTIMES`);
// the vendor must equal `src/shared/auth/runtime-header.ts › CODEX_VENDOR` (no shared module).
const RUNTIME_HEADERS = {
  'X-Dopl-Runtime': 'desktop-session',
  'X-Dopl-Vendor': 'codex',
};

const STARTUP_TIMEOUT_SEC = 10;

const CHANNEL_TOOL = shortDoplName(DOPL_CHANNEL_TOOL);

// The one definition: `launch-spec.js` mounts under it and `server-requests.js` matches `serverName` to it.
const SERVER_KEY = 'dopl';

// An elicitation names no tool, so this config names it: `'approve'` is the only never-ask mode (`auto`
// asks, measured), leaving `dopl_channel` (`prompt`) the sole asker. Deliberate; a second asker makes every
// ask un-nameable (declined).
const DEFAULT_TOOL_APPROVAL_MODE = 'approve';
const TOOL_APPROVAL_MODES = Object.freeze({ [CHANNEL_TOOL]: 'prompt' });

// Modes that can ask (`writes`/`auto` only sometimes — counted anyway, the fail-closed direction).
const ASKING_MODES = Object.freeze(['prompt', 'auto', 'writes']);

// Read off the entry the launch sends, so it cannot drift; `null` = the default asks (not nameable).
function askingToolsIn(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  if (ASKING_MODES.indexOf(e.default_tools_approval_mode) !== -1) return null;
  const table = (e.tools && typeof e.tools === 'object') ? e.tools : {};
  return Object.keys(table)
    .filter((tool) => {
      const cfg = table[tool];
      return !!cfg && ASKING_MODES.indexOf(cfg.approval_mode) !== -1;
    })
    .sort();
}

// Not intersected with `enabled_tools`: this knows no profile, and every profile offers `dopl_channel`.
function soleAskingTool(entry) {
  const asking = askingToolsIn(entry || buildDoplServerEntry(null));
  return asking && asking.length === 1 ? asking[0] : null;
}

function clientTimeoutSec() {
  // Lazy: `mcp-config` pulls auth, and an unwired harness must read "no token", never throw.
  try {
    return Math.max(1, Math.ceil(require('../../mcp-config').MCP_CLIENT_TIMEOUT_MS / 1000));
  } catch (_) {
    return 60;
  }
}

function doplBearer() {
  try {
    return require('../../mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    return '';
  }
}

// URL is the compiled-in `MCP_URL`; bearer and pins ride env var NAMES (`bearer_token_env_var`,
// `env_http_headers`), never argv. The `prompt` pin asks on every Axis-A mode only because Dopl never
// sends native `never`, under which it fails with no request (`policy.js › NEVER_NATIVE`).
function buildDoplServerEntry(doplToolsPolicy, profile) {
  const entry = {
    url: MCP_URL,
    bearer_token_env_var: BEARER_ENV,
    http_headers: Object.assign({}, RUNTIME_HEADERS, { [TOOL_PROFILE_HEADER]: normalizeProfile(profile) }),
    env_http_headers: {
      'X-Workspace-Id': WORKSPACE_ENV,
      'X-Dopl-Session-Id': SESSION_ENV,
    },
    enabled: true,
    startup_timeout_sec: STARTUP_TIMEOUT_SEC,
    tool_timeout_sec: clientTimeoutSec(),
    default_tools_approval_mode: DEFAULT_TOOL_APPROVAL_MODE,
    tools: Object.keys(TOOL_APPROVAL_MODES).reduce((acc, tool) => {
      acc[tool] = { approval_mode: TOOL_APPROVAL_MODES[tool] };
      return acc;
    }, {}),
  };
  // The offer bound for non-channel tools (they raise no request under `approve`). Absent on `full` /
  // `channel_agent`: the whole Dopl surface is offered (CX-23).
  if (Array.isArray(doplToolsPolicy) && doplToolsPolicy.length) entry.enabled_tools = doplToolsPolicy.slice();
  return entry;
}

// `slotKey` is a label telling concurrent sessions of one handle apart, not a lock; `bearerOverride` (a
// container-locked child credential) is the real workspace lock — `X-Workspace-Id` is only a hint.
function buildMcpEnv(workspaceId, bearerOverride, slotKey) {
  const override = typeof bearerOverride === 'string' ? bearerOverride.trim() : '';
  const token = override || doplBearer();
  const env = {};
  // No token → unusable, and the session still runs: an entry that 401s reads as a working path.
  if (!token) return { env, usable: false };
  env[BEARER_ENV] = token;
  const pin = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (pin) env[WORKSPACE_ENV] = pin;
  const slot = typeof slotKey === 'string' ? slotKey.trim() : '';
  // Same shape the server's own header parser accepts (id characters only, no whitespace, <=128).
  if (slot && /^[A-Za-z0-9:._-]{1,128}$/.test(slot)) env[SESSION_ENV] = slot;
  return { env, usable: true };
}

// Refused: `codex mcp add`'s flags are unverified, and a wrong `~/.codex/` entry outlives the session.
function registerMcp(_cfg) {
  return Promise.resolve({
    ok: false,
    reason: 'Dopl does not yet write a `codex mcp add` entry: the header and scope flags for this '
      + 'CLI are unverified, and a wrong entry in your own Codex config is not ours to leave behind. '
      + 'Sessions Dopl spawns reach Dopl regardless — this only affects your own manual `codex` runs.',
  });
}

// Unknown, not absent: an exit code cannot separate "no such server" from "unreadable config".
function probeMcp() {
  return Promise.resolve({ present: null, reason: 'this runtime cannot distinguish an absent entry from an unreadable one' });
}

const descriptor = {
  sessionTransport: 'http',
  hostRegistration: 'cli-verb',
  probe: false,
  // `mcpToolCall` carries `{ server, tool }` with the tool name bare — no `mcp__` prefix (measured).
  toolNamePrefix: '<tool>',
  // Axis B's pin; the key survives `config/read` under `--strict-config` (measured).
  perToolApproval: 'tools.<tool>.approval_mode',
  // None: Codex defers every MCP tool behind `tool_search`; `capability.mcpDiscovery` orders the search.
  eagerLoadFlag: null,
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = {
  registerMcp, probeMcp, descriptor,
  buildDoplServerEntry, buildMcpEnv,
  SERVER_KEY, askingToolsIn, soleAskingTool,
  DEFAULT_TOOL_APPROVAL_MODE, ASKING_MODES,
  BEARER_ENV, WORKSPACE_ENV, SESSION_ENV, RUNTIME_HEADERS, CHANNEL_TOOL,
  TOOL_PROFILE_HEADER, shellEnvironmentPolicy, STARTUP_TIMEOUT_SEC,
};
