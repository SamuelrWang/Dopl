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

// ── THE BINARY ───────────────────────────────────────────────────────────────────────────────

const BIN = 'codex';
// ⚠ BOUNDED, because a probe that hangs takes the whole launch with it: `available()` is awaited
// on the spawn path and on the triage path, and a `codex` that never answers must read as absent
// rather than as a stuck session.
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
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    const timer = setTimeout(() => finish({
      ok: false,
      reason: `\`${BIN}\` did not answer \`${BIN} --version\` within ${PROBE_TIMEOUT_MS}ms — Dopl cannot start a Codex session on this Mac.`,
      version: null,
    }), PROBE_TIMEOUT_MS);
    try {
      execFile(BIN, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
        clearTimeout(timer);
        if (err) {
          finish({
            ok: false,
            reason: `\`${BIN}\` is not on this Mac's PATH. Install the Codex CLI and re-open Dopl — this release does not bundle it.`,
            version: null,
          });
          return;
        }
        finish({ ok: true, reason: '', version: String(stdout || '').trim() || null });
      });
    } catch (err) {
      clearTimeout(timer);
      finish({ ok: false, reason: `\`${BIN}\` could not be started: ${(err && err.message) || err}`, version: null });
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
 *   `onExit(code, signal)`  the child ended.
 *
 * ⚠ IT RETURNS SYNCHRONOUSLY. `initialize` is a separate awaited call, because the caller assigns
 * this handle to the session IMMEDIATELY — an await between "the child exists" and "something
 * points at it" is the two-children bug, where a second child is left holding a session's channel
 * access with nothing pointing at it to stop it.
 */
function connect(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  const child = spawn(BIN, ['app-server'].concat(o.args || []), {
    cwd: o.cwd || undefined,
    env: o.env || process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  const pending = new Map();
  let closed = false;

  function write(obj) {
    if (closed || !child.stdin || child.stdin.destroyed) return false;
    try { return child.stdin.write(JSON.stringify(obj) + '\n'); } catch (_) { return false; }
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
        .then(() => (typeof o.onServerRequest === 'function'
          ? o.onServerRequest(msg)
          : { decision: 'decline', message: 'no approval handler on this session' }))
        .then((answer) => write({ jsonrpc: '2.0', id: msg.id, result: answer }))
        .catch((err) => {
          log('codex app-server: approval handler threw —', (err && err.message) || err, '(declining)');
          // ⚠ FAIL CLOSED. A handler that throws is a gate that did not answer, and the only safe
          // answer to a question nobody answered is no.
          write({ jsonrpc: '2.0', id: msg.id, result: { decision: 'decline', message: 'Denied by operator' } });
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
  child.on('error', (err) => {
    log('codex app-server: spawn error', (err && err.message) || err);
    rejectAll(err);
  });
  child.on('exit', (code, signal) => {
    closed = true;
    rejectAll(new Error(`codex app-server exited (code ${code}, signal ${signal})`));
    if (typeof o.onExit === 'function') o.onExit(code, signal);
  });

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
      if (closed) { reject(new Error('codex app-server is not running')); return; }
      const id = nextId; nextId += 1;
      pending.set(id, { resolve, reject });
      if (!write({ jsonrpc: '2.0', id, method, params: params === undefined ? {} : params })) {
        pending.delete(id);
        reject(new Error('codex app-server stdin is closed'));
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
  BIN, probe, connect, initializeParams,
  makeLineReader, // exported for the framing fixtures
  CLIENT_NAME, CLIENT_TITLE, OVERLOADED_CODE, PROBE_TIMEOUT_MS,
};
