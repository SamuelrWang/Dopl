// THE `codex app-server` JSON-RPC CLIENT — the CODEX ADAPTER's platform half.
//
// ⚠ THE TARGET IS `codex app-server`, NOT THE SDK AND NOT `codex exec`, AND THAT CHOICE IS THE
// WHOLE INTEGRATION. `codex-research.md` §1 measures all three: the SDK (`@openai/codex-sdk`) and
// `codex exec --json` both FIX POLICY AT LAUNCH and have no mid-turn approval handshake, so on
// either of them Dopl's gate would be a pre-flight list and the outbound consent card would have
// no mechanism at all. Only app-server sends `item/commandExecution/requestApproval` and
// `item/fileChange/requestApproval` as server->client REQUESTS that block the turn on our answer.
// The deprecated `codex mcp-server` subcommand is a fourth surface and is not built on.
//
// ⚠ THE SINGLE MODULE THAT TOUCHES A CHILD PROCESS OR A SOCKET, so process spawning, framing and
// binary-path math live in exactly one place — the same contract `main/runtime/claude/loader.js`
// holds for its own platform.
//
// ⚠ EVERY REQUIRE THAT PULLS `child_process` IS AT THE TOP HERE AND THIS MODULE IS REACHED ONLY
// LAZILY FROM `index.js`. `main/session-profiles.js` is a PURE module two suites evaluate
// standalone and it asks the registry for every gate decision, so requiring the registry must not
// pull electron or spawn anything.
//
// ⚠ DELIVERY IS `path` (see `packaging.js`): the `codex` this connects to is the OPERATOR'S, found
// on PATH at acquire time. `probe()` is therefore a real question with a real refusal, not a
// formality, and its reason has to be readable — a refusal an operator cannot read is one they
// work around.

const { spawn, execFile } = require('child_process');
const resolveBin = require('./resolve-bin');
// The compatibility floor + required methods, re-exported below for the schema script and suites.
const protocol = require('./protocol');

// ── THE BINARY ───────────────────────────────────────────────────────────────────────────────

// ⚠ **THE NAME IS FOR MESSAGES, THE PATH IS FOR `spawn`** (U2, 2026-09-21). `spawn('codex')`
// searched the PATH of whoever started Dopl, which for a Finder launch is `launchd`'s — so a
// machine with a working `codex` in Terminal reported it missing the moment Dopl was opened from
// the Dock. `resolve-bin.js` owns the search and the trust check; this module owns the process.
const BIN = resolveBin.BIN_NAME;
// ⚠ BOUNDED, because a probe that hangs takes the whole launch with it: `available()` is awaited
// on the spawn path, and a `codex` that never answers must read as absent rather than as a stuck
// session.
const PROBE_TIMEOUT_MS = 5000;

/**
 * Is there a `codex` on this machine's PATH, and what does it call itself?
 *
 * ⚠ `{ ok, reason, version }` AND THE REASON IS FOR AN OPERATOR, NOT A LOG. `packaging.delivery`
 * is `path` for v1, which means the supply chain is the operator's and "install it" is a real
 * answer — so the refusal names the command to run rather than reporting an errno.
 */
function probe() {
  return new Promise((resolve) => {
    // The resolver answers first: "not installed where Dopl can find it" and "found but
    // group-writable" are different problems, and an errno from `execFile` is neither.
    const found = resolveBin.resolveCodexBin();
    if (!found.ok) {
      resolve({ ok: false, reason: found.reason, version: null, path: null, source: null });
      return;
    }
    const finish = (value) => resolve(Object.assign({ path: found.path, source: found.source }, value));
    try {
      execFile(found.path, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
        if (err) {
          finish({
            ok: false,
            reason: err.killed
              ? `\`${found.path}\` did not answer \`${BIN} --version\` within ${PROBE_TIMEOUT_MS}ms — Dopl cannot start a Codex session on this Mac.`
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

// ── FRAMING ──────────────────────────────────────────────────────────────────────────────────
//
// ⚠ NEWLINE-DELIMITED JSON, AND THE BUFFER IS UNBOUNDED ONLY BETWEEN NEWLINES. `item/…/outputDelta`
// streams command stdout, so a single line can be large; splitting on `\n` and parsing per line is
// what the protocol specifies. A line that does not parse is DROPPED WITH A DIAG, never guessed at
// — a half-read frame that resolved a pending request would be worse than a missed event.
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
//
// ⚠ `-32001` "Server overloaded" IS A DOCUMENTED, RETRYABLE ANSWER, not a failure
// (`codex-research.md` §1: bounded queues, retry with exponential backoff). Every other error code
// is a real error and is rejected immediately — retrying a refusal is how a gate decision comes to
// be asked twice.
const OVERLOADED_CODE = -32001;
const INTERNAL_ERROR_CODE = -32603;
// How long after `exit` the stdout tail may still drain before the end is reported anyway.
const CLOSE_GRACE_MS = 2000;
const RETRY_BASE_MS = 120;
const RETRY_MAX = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── THE CONNECTION ───────────────────────────────────────────────────────────────────────────

/**
 * Spawn `codex app-server` over stdio and speak JSON-RPC 2.0 to it.
 *
 * `opts` — `{ args, env, cwd, onNotification, onServerRequest, onExit, log }`.
 *   `onNotification(msg)`   every server->client NOTIFICATION, verbatim `{ method, params }`.
 *   `onServerRequest(msg)`  every server->client REQUEST; must resolve to the answer object.
 *                           ⚠ THIS IS THE HELD CALLBACK. The app-server blocks the turn until the
 *                           reply is written, which is what makes Dopl's `gate` a real verdict.
 *   `onExit(code, signal, spawnError)`  the child ended (once, after stdout drained); `spawnError`
 *                           is the ENOENT/EACCES-style error when it never started.
 *
 * ⚠ IT RETURNS SYNCHRONOUSLY. `initialize` is a separate awaited call, because the caller assigns
 * this handle to the session IMMEDIATELY — an await between "the child exists" and "something
 * points at it" is the two-children bug, where a second child is left holding a session's channel
 * access with nothing pointing at it to stop it.
 */
function connect(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  // ⚠ THE RESOLVED FILE, NEVER THE BARE NAME (U2) — see the BINARY block. A connect on a machine
  // where the resolver found nothing throws here rather than handing `spawn` a name that will fail
  // asynchronously with an `ENOENT` nobody can read.
  const resolved = resolveBin.resolveCodexBin();
  if (!resolved.ok) throw new Error(resolved.reason);
  const child = spawn(resolved.path, ['app-server'].concat(o.args || []), {
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

  // `false` means the line was NOT handed to the pipe. `stdin.write`'s own `false` is backpressure
  // (the chunk is queued and will be delivered), so it is not read here (CX-01).
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
    // A RESPONSE to something we asked.
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || 'app-server error'), { code: msg.error.code }));
      else entry.resolve(msg.result);
      return;
    }
    // A REQUEST from the server — the approval handshake. ⚠ ANSWERED, ALWAYS: an unanswered
    // server request hangs the turn forever, so an absent handler and a thrown handler both
    // produce an explicit reply rather than silence.
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
    // A NOTIFICATION.
    if (typeof msg.method === 'string' && typeof o.onNotification === 'function') o.onNotification(msg);
  }

  const feedOut = makeLineReader(handle);
  if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', feedOut); }
  // ⚠ stderr IS DIAGNOSTIC ONLY AND NEVER PARSED. The protocol is on stdout; anything the binary
  // writes to stderr is a human message (a clap error for an unknown flag, a panic) and reading it
  // as protocol is how an error message becomes an event.
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

  /**
   * One JSON-RPC request. ⚠ RETRIES ONLY `-32001`, with exponential backoff — every other code is
   * a real answer and is surfaced.
   */
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

// ── THE MANDATORY HANDSHAKE ──────────────────────────────────────────────────────────────────
//
// ⚠ `clientInfo.name` IS NOT COSMETIC AND IT IS NOT OPTIONAL. `codex-research.md` §1: clients MUST
// identify in `initialize`, and `clientInfo.name` feeds OpenAI's Compliance Logs Platform — it is
// the ONLY forensic join between a Codex turn and a Dopl session, and it is exactly the join the
// Claude side does NOT have (`session_id` + `appVersion` do not join). So it is set deliberately
// and versioned with the desktop build.
// ⚠ AND CAPABILITY NEGOTIATION IS TREATED AS MANDATORY, NOT OPTIONAL (§5 item C15): the protocol
// is young, `packaging.delivery` is `path` so the operator's version is unbounded, and a handshake
// that fails is the loud, early failure this is here to produce.
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
  probe, connect, initializeParams,
  makeLineReader, // the framing fixtures
  REQUIRED_METHODS: protocol.REQUIRED_METHODS,
  SUPPORTED_CLI: protocol.SUPPORTED_CLI,
  versionGate: protocol.versionGate,
  parseVersion: protocol.parseVersion,
};
