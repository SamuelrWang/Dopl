// JSON-RPC 2.0 client for `codex app-server` over stdio. app-server, not the SDK or `codex exec`
// (both fix policy at launch): only it sends approvals as server->client requests that block the turn.

const { execFile } = require('child_process');
const stdioRpc = require('../kit/stdio-rpc');
const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');
const { AUTH_STORE_ARGS } = require('./config-home');

// ── BINARY ───────────────────────────────────────────────────────────────────────────────────

// The name is for messages; `spawn` gets `resolve-bin.js`'s path (a Finder launch has launchd's PATH).
const BIN = resolveBin.BIN_NAME;
// Bounded: `available()` awaits the probe on the spawn path, and a hung `codex` must read as absent.
const PROBE_TIMEOUT_MS = 5000;

// A downloaded build's first exec may wait out macOS's first-exec scan, so a failed probe on one is retried
// once with this budget before the build is rejected (`../updates/index.js › reject`).
const DOWNLOAD_RETRY_TIMEOUT_MS = 60000;

/** One `--version` run of the resolved `found` → the probe's answer. Never rejects. */
function probeAt(found, timeoutMs) {
  return new Promise((resolve) => {
    const finish = (value) => resolve(Object.assign({ path: found.path, source: found.source }, value));
    try {
      execFile(found.path, ['--version'], { timeout: timeoutMs }, (err, stdout) => {
        if (err) {
          finish({
            ok: false,
            reason: err.killed
              ? `\`${found.path}\` did not answer \`${BIN} --version\` within ${timeoutMs}ms — Dopl cannot start a Codex session on this Mac.`
              : `\`${found.path}\` could not answer \`${BIN} --version\`: ${(err && err.message) || err}`,
            version: null,
          });
          return;
        }
        const version = String(stdout || '').trim() || null;
        // Only readability is checked here: whether this build speaks the protocol Dopl reads is the shape
        // gate's question (`shape.js` + `../sdk-shape.js`), answered from the build's own schema — never a
        // version range. The answer is recorded for the build key (`identity.js`).
        const read = protocol.versionGate(version);
        if (read.ok) require('./identity').noteVersion(found.path, version);
        finish({ ok: read.ok, reason: read.reason, version });
      });
    } catch (err) {
      finish({ ok: false, reason: `\`${found.path}\` could not be started: ${(err && err.message) || err}`, version: null });
    }
  });
}

/**
 * Is there a usable `codex`? `{ ok, reason, version, path, source }`; `reason` is for the operator.
 * ⚠ A DOWNLOAD THAT FAILS IS RETRIED ONCE, LONGER, THEN REJECTED, AND THE ANSWER IS WHAT LAUNCHES RUN AFTER
 * THAT (the last good build or the bundle), never "no Codex" on account of an update. `o` is for tests.
 */
async function probe(o) {
  const timeoutMs = (o && o.timeoutMs) || PROBE_TIMEOUT_MS;
  const retryMs = (o && o.retryTimeoutMs) || DOWNLOAD_RETRY_TIMEOUT_MS;
  // The resolver's reason (missing vs untrusted) is readable; an `execFile` errno is not.
  const found = resolveBin.resolveCodexBin();
  if (!found.ok) return { ok: false, reason: found.reason, version: null, path: null, source: null };
  const gate = await probeAt(found, timeoutMs);
  if (gate.ok || found.source !== 'downloaded') return gate;
  const again = await probeAt(found, retryMs);
  if (again.ok) return again;
  // `reject` repoints the updater and its `onSwitch` drops resolve-bin's cached hit, so the next resolve is
  // a different binary; each rejection retires one download, so this ends at the bundle.
  if (!require('../updates').reject(require('./update-source'), found.path)) return again;
  return probe(o);
}

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
  probe, connect, initializeParams, DOWNLOAD_RETRY_TIMEOUT_MS,
  REQUIRED_METHODS: protocol.REQUIRED_METHODS,
  SUPPORTED_CLI: protocol.SUPPORTED_CLI,
  versionGate: protocol.versionGate,
  parseVersion: protocol.parseVersion,
};
