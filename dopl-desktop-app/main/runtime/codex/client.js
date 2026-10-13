// JSON-RPC 2.0 client for `codex app-server` over stdio. app-server, not the SDK or `codex exec`
// (both fix policy at launch): only it sends approvals as server->client requests that block the turn.

const stdioRpc = require('../kit/stdio-rpc');
const probeBin = require('../kit/probe-bin');
const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');
const { AUTH_STORE_ARGS } = require('./config-home');

// ── BINARY ───────────────────────────────────────────────────────────────────────────────────
// The `--version` probe, its downloaded-build retry and the updater's reject loop are the kit's
// (`../kit/probe-bin.js`, runtime scaffold K10); this adapter supplies the resolver, the version read,
// the build-key note and its update source — each looked up at CALL time, as before.

// The name is for messages; `spawn` gets `resolve-bin.js`'s path (a Finder launch has launchd's PATH).
const BIN = resolveBin.BIN_NAME;

const prober = probeBin.makeProber({
  binName: BIN,
  label: 'Codex',
  resolve: () => resolveBin.resolveCodexBin(),
  versionGate: (version) => protocol.versionGate(version),
  onReadable: (file, version) => require('./identity').noteVersion(file, version),
  updateSource: () => require('./update-source'),
});

/**
 * Is there a usable `codex`? `{ ok, reason, version, path, source }`; `reason` is for the operator.
 * ⚠ A DOWNLOAD THAT FAILS IS RETRIED ONCE, LONGER, THEN REJECTED, AND THE ANSWER IS WHAT LAUNCHES RUN AFTER
 * THAT (the last good build or the bundle), never "no Codex" on account of an update. `o` is for tests.
 */
const probe = (o) => prober.probe(o);

// ── CONNECTION ───────────────────────────────────────────────────────────────────────────────
// The transport is the kit's (`../kit/stdio-rpc.js`, runtime scaffold K1): framing, correlation, the
// held server-request callback (a request with no handler, or whose handler throws, is answered `-32603`
// or the handler's own `rpcCode` — never a guessed `{decision}`, CX-25), the `-32001` retry, the queued
// over-high-water write (CX-01) and the close-vs-exit report (CX-10). This adapter owns the binary and argv.

/**
 * Spawn `codex app-server` and speak JSON-RPC to it. Returns synchronously — the caller assigns the
 * handle before any await (two-children bug), so `initialize` is a separate call.
 * `opts` — `{ bin, args, env, cwd, onNotification, onServerRequest, onExit, log }`; `onServerRequest(msg)`
 * is the held callback (resolves to the reply); `onExit(code, signal, spawnError)` fires once.
 */
function connect(opts) {
  const o = opts || {};
  // Throws now rather than hand `spawn` a bare name that fails later with an unreadable ENOENT.
  // A caller that already checked a binary (`launch-spec.js › start`: fence + readback) passes THAT path, so
  // the child spawned is the one that was verified — never a re-resolve that an updater switch could move.
  const resolved = o.bin ? { ok: true, path: o.bin } : resolveBin.resolveCodexBin();
  if (!resolved.ok) throw new Error(resolved.reason);
  return stdioRpc.connect({
    command: resolved.path,
    args: ['app-server'].concat(AUTH_STORE_ARGS, o.args || []),
    cwd: o.cwd,
    env: o.env,
    label: 'codex app-server',
    errorFallback: 'app-server error',
    onNotification: o.onNotification,
    onServerRequest: o.onServerRequest,
    onExit: o.onExit,
    log: o.log,
  });
}

// ── HANDSHAKE ────────────────────────────────────────────────────────────────────────────────
// `clientInfo.name = 'dopl'` is the only join between a Codex turn and a Dopl session in OpenAI's
// compliance logs.
const CLIENT_NAME = 'dopl';
const CLIENT_TITLE = 'Dopl';

function initializeParams(version) {
  return {
    clientInfo: {
      name: CLIENT_NAME,
      title: CLIENT_TITLE,
      version: typeof version === 'string' && version ? version : '0.0.0',
    },
  };
}

module.exports = {
  probe, connect, initializeParams, DOWNLOAD_RETRY_TIMEOUT_MS: probeBin.DOWNLOAD_RETRY_TIMEOUT_MS,
  REQUIRED_METHODS: protocol.REQUIRED_METHODS,
  SUPPORTED_CLI: protocol.SUPPORTED_CLI,
  versionGate: protocol.versionGate,
  parseVersion: protocol.parseVersion,
};
