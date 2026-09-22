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
    // ⚠ THE RESOLVER ANSWERS FIRST, and its refusal is the one an operator can act on: "not
    // installed where Dopl can find it" and "found but group-writable" are different problems, and
    // an errno from `execFile` is neither.
    const found = resolveBin.resolveCodexBin();
    if (!found.ok) {
      resolve({ ok: false, reason: found.reason, version: null, path: null, source: null });
      return;
    }
    let done = false;
    const finish = (value) => {
      if (!done) { done = true; resolve(Object.assign({ path: found.path, source: found.source }, value)); }
    };
    const timer = setTimeout(() => finish({
      ok: false,
      reason: `\`${found.path}\` did not answer \`${BIN} --version\` within ${PROBE_TIMEOUT_MS}ms — Dopl cannot start a Codex session on this Mac.`,
      version: null,
    }), PROBE_TIMEOUT_MS);
    try {
      execFile(found.path, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
        clearTimeout(timer);
        if (err) {
          // ⚠ IT RESOLVED AND THEN FAILED TO RUN — an unsupported build, a quarantined download, a
          // broken toolchain shim. Naming the file is the whole value of saying so.
          finish({
            ok: false,
            reason: `\`${found.path}\` could not answer \`${BIN} --version\`: ${(err && err.message) || err}`,
            version: null,
          });
          return;
        }
        finish({ ok: true, reason: '', version: String(stdout || '').trim() || null });
      });
    } catch (err) {
      clearTimeout(timer);
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
          if (err && Number.isInteger(err.rpcCode)) {
            write({ jsonrpc: '2.0', id: msg.id, error: { code: err.rpcCode, message: err.message } });
            return;
          }
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

// ── THE COMPATIBILITY GATE ───────────────────────────────────────────────────────────────────
//
// 🔒 ⚠ **"CONNECTED" IS A CLAIM ABOUT A PROTOCOL, NOT ABOUT A FILE BEING PRESENT** (U1,
// `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`). `probe()` answers "is there a
// `codex`"; it cannot answer "does this app-server speak the protocol this adapter was written
// against". Until 2026-09-21 nothing did — 94 targeted tests passed against SYNTHETIC fixtures
// while the adapter sent request shapes the installed CLI rejects.
//
// ⚠ **`unsupported-protocol` IS NOT `missing` AND NOT `signed-out`.** Install, sign in and upgrade
// are three different operator actions; collapsing them makes "Codex is broken" unanswerable.
//
// 🔒 ⚠ **UNKNOWN IS NOT EMPTY** (`docs/INVARIANTS.md`). `methods: null` (nothing declared) has not
// been MEASURED → `unverified-protocol`. `methods: []` HAS been measured and offers nothing Dopl
// needs → `unsupported-protocol`. Folding the first into the second refuses working installs;
// folding it into `ready` restores the false confidence this unit removes.
//
// ⚠ **NOTHING HERE INVENTS A WIRE SHAPE.** The gate is handed values a CALLER already extracted
// and never guesses where a field lives. `REQUIRED_METHODS` lists the methods THIS ADAPTER CALLS
// (grep `conn.request(` in `launch-spec.js` and `models.js`) — a statement about Dopl, which Dopl
// may make. `SUPPORTED_CLI` is UNPINNED until a real CLI measures it
// (`scripts/codex-app-server-schema.js`).

const PROTOCOL_STATE = Object.freeze({
  READY: 'ready', MISSING: 'missing', SIGNED_OUT: 'signed-out',
  UNSUPPORTED: 'unsupported-protocol', UNVERIFIED: 'unverified-protocol',
});

// ⚠ THE METHODS THIS ADAPTER ACTUALLY SENDS, sourced by grep: the thread/turn set in
// `launch-spec.js`, `model/list` in `models.js`. A method added to the adapter belongs on this
// list in the same change, or the gate passes a server that cannot run a session.
const REQUIRED_METHODS = Object.freeze([
  'initialize', 'thread/start', 'thread/resume',
  'turn/start', 'turn/steer', 'turn/interrupt', 'model/list',
]);

// ⚠ THE CRITICAL FACTS — what a handshake must have PRODUCED, stated as Dopl's requirement rather
// than as a path into a response.
const REQUIRED_FACTS = Object.freeze([
  Object.freeze({ key: 'threadId', why: 'a session cannot start without a thread handle' }),
  Object.freeze({ key: 'modelDefault', why: 'the model catalog must declare exactly one default' }),
]);

// 🔒 ⚠ **UNPINNED ON PURPOSE, AND AN UNPINNED RANGE REFUSES NOTHING.** No `codex` CLI existed on
// the machine this landed from, so a version written here would be a guess wearing a
// measurement's costume — the exact failure the plan corrects. Fill it from a real CLI:
// `node scripts/codex-app-server-schema.js` prints the value to paste.
const SUPPORTED_CLI = Object.freeze({ min: null, max: null, measuredFrom: null });

/** `"codex-cli 0.31.0"` → `[0, 31, 0]`. Returns `null` when no dotted number is present. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0) ? -1 : 1;
  }
  return 0;
}

/**
 * Is this CLI version inside the supported range? `{ ok, verdict, reason, detected, supported }`.
 * ⚠ `verdict` is `unpinned` while `SUPPORTED_CLI` holds no measured bound, and an unpinned gate is
 * `ok: true` — refusing every install on a range nobody measured is worse than not checking.
 */
function versionGate(version) {
  const detected = parseVersion(version);
  const supported = { min: SUPPORTED_CLI.min, max: SUPPORTED_CLI.max };
  if (!supported.min && !supported.max) {
    return { ok: true, verdict: 'unpinned', reason: '', detected: version || null, supported };
  }
  if (!detected) {
    return {
      ok: false,
      verdict: 'unreadable',
      reason: `Dopl could not read a version out of \`${version}\`.`,
      detected: version || null,
      supported,
    };
  }
  const min = supported.min ? parseVersion(supported.min) : null;
  const max = supported.max ? parseVersion(supported.max) : null;
  const refuse = (verdict, reason) => ({ ok: false, verdict, reason, detected: version || null, supported });
  if (min && compareVersion(detected, min) < 0) {
    return refuse('too-old', `Codex ${version} is older than the ${supported.min} this Dopl build supports. Upgrade the Codex CLI.`);
  }
  if (max && compareVersion(detected, max) > 0) {
    return refuse('too-new', `Codex ${version} is newer than the ${supported.max} this Dopl build was measured against. Update Dopl.`);
  }
  return { ok: true, verdict: 'supported', reason: '', detected: version || null, supported };
}

/**
 * Exactly one declared default in a model catalog.
 * ⚠ TOLERANT OVER THE KEY (`isDefault` / `is_default` / `default`), like `models.js › idsFrom` is
 * over the row shape: the spelling is not measured here. `rows == null` is UNVERIFIED, `rows: []`
 * is UNSUPPORTED — unknown is not empty.
 */
function catalogGate(rows) {
  if (rows == null) {
    return { ok: false, state: PROTOCOL_STATE.UNVERIFIED, reason: 'no model catalog was read', defaults: [] };
  }
  if (!Array.isArray(rows)) {
    return { ok: false, state: PROTOCOL_STATE.UNSUPPORTED, reason: 'the model catalog was not a list', defaults: [] };
  }
  const defaults = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const flag = row.isDefault !== undefined ? row.isDefault
      : (row.is_default !== undefined ? row.is_default : row.default);
    if (flag === true) defaults.push(row.id || row.model || row.name || '(unnamed)');
  }
  if (defaults.length === 1) return { ok: true, state: PROTOCOL_STATE.READY, reason: '', defaults };
  return {
    ok: false,
    state: PROTOCOL_STATE.UNSUPPORTED,
    reason: defaults.length === 0
      ? `the model catalog (${rows.length} models) declares no default`
      : `the model catalog declares ${defaults.length} defaults (${defaults.join(', ')}); exactly one is required`,
    defaults,
  };
}

/**
 * THE GATE. May Dopl report this Codex as connected?
 *
 * `input` — `{ version, methods, facts }`, all ALREADY EXTRACTED by the caller. `methods` is the
 * declared method names or `null` for "not declared"; `facts` is `{ threadId, modelDefault, … }`
 * measured during a handshake or `null` for "no handshake ran". ⚠ Unknown keys are IGNORED.
 * Returns `{ ok, state, reason, missingMethods, missingFacts, version }`; `ok` only for `ready`.
 */
function checkProtocol(input) {
  const inp = input || {};
  const version = versionGate(inp.version);
  if (!version.ok) {
    return {
      ok: false, state: PROTOCOL_STATE.UNSUPPORTED, reason: version.reason,
      missingMethods: [], missingFacts: [], version,
    };
  }

  const unverified = [];
  const missingMethods = [];
  if (inp.methods == null) {
    unverified.push('the app-server declared no method list, so Dopl could not verify it');
  } else if (!Array.isArray(inp.methods)) {
    return {
      ok: false, state: PROTOCOL_STATE.UNSUPPORTED,
      reason: 'the app-server\'s declared method list was not a list',
      missingMethods: REQUIRED_METHODS.slice(), missingFacts: [], version,
    };
  } else {
    const have = new Set(inp.methods.map((m) => String(m)));
    for (const need of REQUIRED_METHODS) if (!have.has(need)) missingMethods.push(need);
  }

  const missingFacts = [];
  if (inp.facts == null) {
    unverified.push('no handshake was run, so Dopl could not verify the response shapes');
  } else {
    for (const fact of REQUIRED_FACTS) {
      const value = inp.facts[fact.key];
      if (value === undefined || value === null || value === '') missingFacts.push(fact);
    }
  }

  if (missingMethods.length || missingFacts.length) {
    const parts = missingMethods.length ? [`it does not offer ${missingMethods.join(', ')}`] : [];
    for (const fact of missingFacts) parts.push(`it did not supply \`${fact.key}\` — ${fact.why}`);
    return {
      ok: false,
      state: PROTOCOL_STATE.UNSUPPORTED,
      reason: `This Codex speaks a protocol Dopl cannot drive: ${parts.join('; ')}.`,
      missingMethods, missingFacts, version,
    };
  }
  if (unverified.length) {
    return {
      ok: false,
      state: PROTOCOL_STATE.UNVERIFIED,
      reason: `Dopl has not verified this Codex: ${unverified.join('; ')}.`,
      missingMethods, missingFacts, version,
    };
  }
  return { ok: true, state: PROTOCOL_STATE.READY, reason: '', missingMethods, missingFacts, version };
}

module.exports = {
  BIN, probe, connect, initializeParams,
  makeLineReader, // exported for the framing fixtures
  CLIENT_NAME, CLIENT_TITLE, OVERLOADED_CODE, PROBE_TIMEOUT_MS,
  // The compatibility gate (U1).
  PROTOCOL_STATE, REQUIRED_METHODS, REQUIRED_FACTS, SUPPORTED_CLI,
  checkProtocol, versionGate, catalogGate, parseVersion,
};
