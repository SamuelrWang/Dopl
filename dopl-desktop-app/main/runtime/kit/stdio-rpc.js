// JSON-RPC 2.0 over a child process's stdio (docs/specs/runtime-scaffold.md §3 K1): spawn, newline
// framing, request/response correlation, server→client requests answered through a held callback,
// notifications, and the close-vs-exit end report. Vendor-neutral: the adapter's `client.js` resolves the
// binary, builds argv (subcommand + its own flags) and passes a `label` that names the peer in every log
// line and error. Moved verbatim from the first RPC adapter's client.js (2026-10-13).

const { spawn } = require('child_process');

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
 * Spawn `command args…` and speak JSON-RPC to it. Returns synchronously — the caller assigns the
 * handle before any await (two-children bug), so `initialize` is a separate call.
 * `opts` — `{ command, args, env, cwd, label, errorFallback, onNotification, onServerRequest, onExit, log }`.
 * `command` is an already-resolved PATH (never a bare name); `label` names the peer in logs and errors;
 * `errorFallback` is the message of a JSON-RPC error that carries none (default `<label> error`).
 * `onServerRequest(msg)` is the held callback (resolves to the reply); `onExit(code, signal, spawnError)`
 * fires once.
 */
function connect(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  const label = o.label || 'rpc peer';
  const errorFallback = o.errorFallback || `${label} error`;
  const child = spawn(o.command, o.args || [], {
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

  // `false` = not handed to the pipe; `stdin.write`'s own `false` is backpressure, still queued.
  function write(obj) {
    const stdin = child.stdin;
    if (closed || !stdin || stdin.destroyed || !stdin.writable) return false;
    try { stdin.write(JSON.stringify(obj) + '\n'); return true; } catch (_) { return false; }
  }

  function handle(line) {
    let msg = null;
    try { msg = JSON.parse(line); } catch (_) {
      log(`${label}: unparseable frame dropped`, line.slice(0, 120));
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || errorFallback), { code: msg.error.code }));
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
          log(`${label}: server request refused —`, (err && err.message) || err);
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
  // stderr is diagnostic only, never parsed as protocol (a usage error or panic is not an event).
  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => log(`${label} stderr:`, String(d).trim().slice(0, 400)));
  }
  // A write after the child died surfaces as EPIPE on the pipe itself; the exit path reports it.
  if (child.stdin) child.stdin.on('error', (err) => log(`${label} stdin:`, (err && err.message) || err));
  // A spawn failure (ENOENT/EACCES) emits `error` + `close` and never `exit`.
  child.on('error', (err) => {
    log(`${label}: spawn error`, (err && err.message) || err);
    spawnError = err instanceof Error ? err : new Error(String(err));
    closed = true;
    rejectAll(spawnError);
  });
  // Reported on `close` (stdout drained, so a response written just before exit still resolves);
  // `exit` only arms a bound in case an inherited pipe holds `close` back.
  function ended(code, signal) {
    closed = true;
    const info = exitInfo || { code, signal };
    rejectAll(spawnError || new Error(`${label} exited (code ${info.code}, signal ${info.signal})`));
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
      if (closed) { reject(spawnError || new Error(`${label} is not running`)); return; }
      const id = nextId; nextId += 1;
      pending.set(id, { resolve, reject });
      if (!write({ jsonrpc: '2.0', id, method, params: params === undefined ? {} : params })) {
        pending.delete(id);
        reject(spawnError || new Error(`${label} stdin is closed`));
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

module.exports = {
  connect, makeLineReader,
  OVERLOADED_CODE, INTERNAL_ERROR_CODE, CLOSE_GRACE_MS, RETRY_BASE_MS, RETRY_MAX,
};
