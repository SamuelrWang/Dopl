// JSON-RPC 2.0 client for `grok agent --no-leader stdio` — xAI's Grok Build CLI speaking the Agent Client
// Protocol (ACP v1) over stdio. ACP, not headless `grok -p`: only ACP holds a permission request open for
// Dopl to answer (`session/request_permission`); `-p` cancels or auto-approves it (`grok-runtime.md` §1).
// The transport is the kit's (`../kit/stdio-rpc.js`); the probe is the kit's (`../kit/probe-bin.js`).

const stdioRpc = require('../kit/stdio-rpc');
const probeBin = require('../kit/probe-bin');
const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');

const BIN = resolveBin.BIN_NAME;

const prober = probeBin.makeProber({
  binName: BIN,
  label: 'Grok',
  resolve: () => resolveBin.resolveGrokBin(),
  versionGate: (version) => protocol.versionGate(version),
  onReadable: (file, version) => require('./identity').noteVersion(file, version),
  updateSource: () => require('./update-source'),
});

/** Is there a usable `grok`? `{ ok, reason, version, path, source }`. `o` is for tests. */
const probe = (o) => prober.probe(o);

// ── SPAWN ────────────────────────────────────────────────────────────────────────────────────
// `--no-leader`: no shared leader process and no socket (LIVE: none created) — every Dopl session is its own
// process in Dopl's private home. Agent options go BEFORE the `stdio` subcommand (flag order matters).
// No `-m`: it is ignored by `grok agent` (LIVE) — the model is set per session (`launch-spec.js`).
const AGENT_ARGS = Object.freeze(['agent', '--no-leader', 'stdio']);

/** The argv after the binary. */
function agentArgs() {
  return AGENT_ARGS.slice();
}

/**
 * Spawn `grok agent --no-leader stdio` and speak JSON-RPC to it. Returns synchronously (two-children bug).
 * `opts` — `{ bin, args, env, cwd, onNotification, onServerRequest, onExit, log }`.
 */
function connect(opts) {
  const o = opts || {};
  const resolved = o.bin ? { ok: true, path: o.bin } : resolveBin.resolveGrokBin();
  if (!resolved.ok) throw new Error(resolved.reason);
  return stdioRpc.connect({
    command: resolved.path,
    args: o.args || agentArgs(),
    cwd: o.cwd,
    env: o.env,
    label: 'grok agent',
    errorFallback: 'grok agent error',
    onNotification: o.onNotification,
    onServerRequest: o.onServerRequest,
    onExit: o.onExit,
    log: o.log,
  });
}

// ── HANDSHAKE ────────────────────────────────────────────────────────────────────────────────
// Dopl offers no client filesystem and no terminal: Grok uses its own tools, which the hook and the
// permission request put in front of Dopl's gate.
const CLIENT_NAME = 'dopl';
const CLIENT_TITLE = 'Dopl';

function initializeParams(version) {
  return {
    protocolVersion: protocol.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: CLIENT_NAME, title: CLIENT_TITLE, version: typeof version === 'string' && version ? version : '0.0.0' },
  };
}

/** `initialize`, its protocol version asserted. ACP has no `initialized` notification. */
async function handshake(conn, version) {
  const init = await conn.request('initialize', initializeParams(version));
  protocol.assertProtocol(init);
  return init;
}

// The auth method Grok advertises ONLY when a token file is present (LIVE: absent → only `grok.com`).
const CACHED_TOKEN = 'cached_token';

/**
 * Does this `initialize` answer offer the cached token? ⚠ Dopl NEVER sends `authenticate` at all: with no
 * token it silently starts a browser OAuth flow and never answers (LIVE, `g3-auth-shapes.ndjson`), and with a
 * token `session/new` works without it (LIVE, `smoke-s2`/`s3`). This read is the signed-in check only.
 */
function cachedTokenOffered(init) {
  const methods = init && Array.isArray(init.authMethods) ? init.authMethods : [];
  return methods.some((m) => m && m.id === CACHED_TOKEN);
}

module.exports = {
  probe, connect, agentArgs, initializeParams, handshake, cachedTokenOffered,
  AGENT_ARGS, CLIENT_NAME, CACHED_TOKEN,
  REQUIRED_METHODS: protocol.REQUIRED_METHODS,
};
