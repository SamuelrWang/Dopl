// JSON-RPC 2.0 client for `codex app-server` over stdio. app-server, not the SDK or `codex exec`
// (both fix policy at launch): only it sends approvals as server->client requests that block the turn.

const { spawn, execFile } = require('child_process');
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
        // The measured floor: an older CLI would die at clap or the protocol with an unreadable error.
        const floor = protocol.versionGate(version);
        finish({ ok: floor.ok, reason: floor.reason, version });
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

// ── FRAMING ──────────────────────────────────────────────────────────────────────────────────
// Newline-delimited JSON; an unparseable line is dropped with a diag, never guessed at.
function makeLineReader(onLine) {
  let buf = '';
  return function feed(chunk) {
    buf += String(chunk);
    let cut = buf.indexOf('\n');
    while (cut !== -1) {
      const line = buf.slice(0, cut).trim();
      buf = buf.slice(cut + 1);
      if (line) onLine(line);
      cut = buf.indexOf('\n');
    }
  };
}

// ── BACKPRESSURE ─────────────────────────────────────────────────────────────────────────────
const OVERLOADED_CODE = -32001;
const INTERNAL_ERROR_CODE = -32603;
// How long after `exit` the stdout tail may still drain before the end is reported anyway.
const CLOSE_GRACE_MS = 2000;
const RETRY_BASE_MS = 120;
const RETRY_MAX = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CONNECTION ───────────────────────────────────────────────────────────────────────────────

/**
 * Spawn `codex app-server` and speak JSON-RPC to it. Returns synchronously — the caller assigns the
 * handle before any await (two-children bug), so `initialize` is a separate call.
 * `opts` — `{ args, env, cwd, onNotification, onServerRequest, onExit, log }`; `onServerRequest(msg)`
 * is the held callback (resolves to the reply); `onExit(code, signal, spawnError)` fires once.
 */
function connect(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  // Throws now rather than hand `spawn` a bare name that fails later with an unreadable ENOENT.
  const resolved = resolveBin.resolveCodexBin();
  if (!resolved.ok) throw new Error(resolved.reason);
  const child = spawn(resolved.path, ['app-server'].concat(AUTH_STORE_ARGS, o.args || []), {
    cwd: o.cwd || undefined,
    env: o.env || process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  const pending = new Map();
  let closed = false;
  let spawnError = null;
  let exitInfo = null;
  let exitReported = false;

  // `false` = not handed to the pipe; `stdin.write`'s own `false` is backpressure, still queued (CX-01).
  function write(obj) {
    const stdin = child.stdin;
    if (closed || !stdin || stdin.destroyed || !stdin.writable) return false;
    try { stdin.write(JSON.stringify(obj) + '\n'); return true; } catch (_) { return false; }
  }

  function handle(line) {
    let msg = null;
    try { msg = JSON.parse(line); } catch (_) {
      log('codex app-server: unparseable frame dropped', line.slice(0, 120));
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || 'app-server error'), { code: msg.error.code }));
      else entry.resolve(msg.result);
      return;
    }
    // A server request must be answered: an unanswered one hangs the turn forever.
    if (msg.id != null && typeof msg.method === 'string') {
      Promise.resolve()
        .then(() => {
          if (typeof o.onServerRequest !== 'function') throw new Error('no approval handler on this connection');
          return o.onServerRequest(msg);
        })
        .then((answer) => write({ jsonrpc: '2.0', id: msg.id, result: answer }))
        .catch((err) => {
          log('codex app-server: server request refused —', (err && err.message) || err);
          // A JSON-RPC error is valid for every method; a guessed result shape could hang the turn.
          const code = err && Number.isInteger(err.rpcCode) ? err.rpcCode : INTERNAL_ERROR_CODE;
          write({ jsonrpc: '2.0', id: msg.id, error: { code, message: (err && err.message) || 'refused' } });
        });
      return;
    }
    if (typeof msg.method === 'string' && typeof o.onNotification === 'function') o.onNotification(msg);
  }

  const feedOut = makeLineReader(handle);
  if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', feedOut); }
  // stderr is diagnostic only, never parsed as protocol (a clap error or panic is not an event).
  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => log('codex app-server stderr:', String(d).trim().slice(0, 400)));
  }
  // A write after the child died surfaces as EPIPE on the pipe itself; the exit path reports it.
  if (child.stdin) child.stdin.on('error', (err) => log('codex app-server stdin:', (err && err.message) || err));
  // A spawn failure (ENOENT/EACCES) emits `error` + `close` and never `exit` (CX-10).
  child.on('error', (err) => {
    log('codex app-server: spawn error', (err && err.message) || err);
    spawnError = err instanceof Error ? err : new Error(String(err));
    closed = true;
    rejectAll(spawnError);
  });
  // Reported on `close` (stdout drained, so a response written just before exit still resolves);
  // `exit` only arms a bound in case an inherited pipe holds `close` back.
  function ended(code, signal) {
    closed = true;
    const info = exitInfo || { code, signal };
    rejectAll(spawnError || new Error(`codex app-server exited (code ${info.code}, signal ${info.signal})`));
    if (exitReported) return;
    exitReported = true;
    if (typeof o.onExit === 'function') o.onExit(info.code, info.signal, spawnError);
  }
  child.on('exit', (code, signal) => {
    exitInfo = { code, signal };
    closed = true;
    const t = setTimeout(() => ended(code, signal), CLOSE_GRACE_MS);
    if (typeof t.unref === 'function') t.unref();
  });
  child.on('close', ended);

  function rejectAll(err) {
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
  }

  /** One JSON-RPC request. Only -32001 (overloaded) is retried; retrying a refusal re-asks a gate. */
  async function request(method, params) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await once(method, params);
      } catch (err) {
        if (err && err.code === OVERLOADED_CODE && attempt < RETRY_MAX) {
          await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
  }

  function once(method, params) {
    return new Promise((resolve, reject) => {
      if (closed) { reject(spawnError || new Error('codex app-server is not running')); return; }
      const id = nextId; nextId += 1;
      pending.set(id, { resolve, reject });
      if (!write({ jsonrpc: '2.0', id, method, params: params === undefined ? {} : params })) {
        pending.delete(id);
        reject(spawnError || new Error('codex app-server stdin is closed'));
      }
    });
  }

  function notify(method, params) {
    write({ jsonrpc: '2.0', method, params: params === undefined ? {} : params });
  }

  function close() {
    closed = true;
    try { if (child.stdin) child.stdin.end(); } catch (_) { /* best effort */ }
    try { child.kill(); } catch (_) { /* best effort */ }
  }

  return { child, request, notify, close, isClosed: () => closed };
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
  makeLineReader, // the framing fixtures
  REQUIRED_METHODS: protocol.REQUIRED_METHODS,
  SUPPORTED_CLI: protocol.SUPPORTED_CLI,
  versionGate: protocol.versionGate,
  parseVersion: protocol.parseVersion,
};
