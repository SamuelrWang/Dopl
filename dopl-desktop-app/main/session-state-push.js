// SESSION STATE -> THE SERVER. The writer behind `dopl_channel(op="read_sessions")` ->
// GET /api/channels/sessions -> `channel_sessions`.
//
// ⚠ A PUSH ON STATE CHANGE, NOT A HEARTBEAT. presence.js beats every 30s per listener per
// workspace unconditionally (~120 writes/hour/machine, forever); this writes when a session's
// DERIVED state actually moves — launch, first tool, park, end. A handful of writes per session
// lifetime. That difference is the whole argument for the table existing. Do NOT "simplify" it
// to a timer.
// ⚠ THE TRIGGER IS NOT DERIVED HERE. session-summary.js is the ONE place engine state becomes
// a pill state, and it already coalesces and fires only when the digest moved. This SUBSCRIBES
// and re-derives nothing. Anything else is the two-readers-one-fact defect.
// ⚠ SEPARATE MODULE because session-summary.js is network-free above `module.exports` — its
// suite reads it as SOURCE and evaluates the block with fakes injected. An apiFetch there ends
// that. The seam is a subscription.
//
// TRANSPORT IS api.js: a short POST with no abort wiring and no long-poll, so it inherits the
// shared 401 repair (api-repair.js — a second copy of that repair produced the 1.8.x Channels
// outage), the app-version stamp and the undici pool reset. listener-io.js keeps its own SEND
// only because its long-poll wires a caller abort signal in.
//
// ── ROW LIFETIME ────────────────────────────────────────────────────────────────────────
// ⚠ A session's row exists while its PILL does and is DELETED when the pill leaves, ended rows
// included — the row IS that projection (session-summary's retention rule). Keeping `ended`
// rows to sweep later needs a scheduler this product does not have, so "later" means never and
// the table grows unbounded; and an `ended` row for a window-less session answers "what is
// flint doing?" with a session the operator cannot open.
// ⚠ THE DELETE IS IMPLICIT, which is why this POSTS THE WHOLE SET: the server replaces the
// caller's set. A delta protocol needs an explicit "this one is gone" that a crashed or quit
// desktop never sends.
// KNOWN GAP: rows outlive the process that wrote them. Bounded by (a) the first push for a
// workspace in a new run replacing its whole set and (b) `reportedWorkspaces` being PERSISTED,
// so a run starting with no sessions clears them. NOT covered: signing out — the credential
// that could delete the rows is gone before anything here can react.
//
// ── IDENTITY ────────────────────────────────────────────────────────────────────────────
// ⚠ CROSS-ACCOUNT GUARD. Signing out does not end engine sessions, so operator A's sessions
// are still in the registry when operator B signs in on the same Mac — and a push under B's
// credential files A's handles, channel names and thread titles as B's, readable by B through
// `read_sessions`. Every session key is therefore stamped with the identity current WHEN THIS
// MODULE FIRST SAW IT, and only matching keys are reported. A key first seen with no resolvable
// identity is never reported — fail closed. Signing back in as the SAME operator resumes
// reporting automatically.

const { apiFetch } = require('./api');
const { diag } = require('./diag');
const Store = require('electron-store');

const store = new Store();

// ─── BEGIN SESSION-STATE-PUSH (injectable; unit-tested via source extraction) ───────────
// ⚠ `apiFetch`, `diag` and `store` are free vars from here down, so
// test/session-state-push.test.mjs evaluates this verbatim with fakes — no Electron, no
// network, no disk.

const ENDPOINT = '/api/channels/sessions';
const HTTP_TIMEOUT_MS = 15000;

// Workspaces this machine has written rows into, persisted beside the listener's cursors. For
// ONE case: a run that starts with no sessions in a workspace a previous run left rows in.
// Without it those rows stand claiming `working` for a process that is gone.
const REPORTED_WORKSPACES_KEY = 'sessionReportWorkspaces';

// ⚠ BOUNDED RETRY, deliberately small (ui-sync's ~39 000-attempt storm is the cautionary tale).
// Two attempts, one fixed gap, then STOP — the digest is NOT recorded on failure, so the
// session's next real state change is the retry. Bounded by the session's life, not a timer.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;

let armed = false;
let deps = { getUserId: null, summary: null };
let unsubscribe = null;
let lastUserId = null;
let running = false; // one cycle at a time — the pushes inside one are serial
let queued = null; // the newest entries that arrived while a cycle was in flight
let draining = null; // the in-flight cycle, so the quit path can await one final push

// sessionKey -> userId current when this module first saw that key. Pruned to the live set
// every cycle, so it is bounded by the window budget.
const origin = new Map();
// workspaceId -> digest of the set this process last STORED there. ⚠ An unchanged digest is
// not sent: a window rebuild, a re-mount or an identical re-derivation must not cost a write.
const pushedDigest = new Map();
// One line per (workspace, failure shape). A subsystem that dies must say so ONCE, not once
// per state change.
const loggedFailures = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => String(id || '').slice(0, 8);

/**
 * ONE REPORT ENTRY -> THE WIRE ROW. The only mapping here, and it is a rename: `key` is the
 * server's `sessionKey` (the stable (channel, thread) key the table upserts on, NOT the
 * ephemeral `sessionId`), and an empty `taskId` becomes the NULL the column stores.
 * ⚠ state / name / channelName / threadTitle pass through byte-for-byte — this module gets no
 * vote on what a session's state is.
 */
function reportRow(e) {
  return {
    sessionKey: String((e && e.key) || ''),
    channelId: String((e && e.channelId) || ''),
    threadId: (e && e.taskId) || null,
    name: (e && e.name) || '',
    state: (e && e.state) || '',
    channelName: (e && e.channelName) || null,
    threadTitle: (e && e.threadTitle) || null,
  };
}

/** One stable string, like `summariesDigest`, so a field added to the row shape is compared
 *  automatically. */
function setDigest(rows) {
  return JSON.stringify(rows || []);
}

/**
 * Stamp unseen keys with the identity current NOW; release stamps of keys that left the
 * projection. ⚠ THE WHOLE CROSS-ACCOUNT GUARD: a stamp is written once per key and NEVER
 * rewritten, so a session started under one operator can never be re-attributed to the next.
 */
function trackOrigin(entries, userId) {
  const live = new Set();
  for (const e of entries) {
    const key = String((e && e.key) || '');
    live.add(key);
    if (!origin.has(key)) origin.set(key, userId || null);
  }
  for (const key of [...origin.keys()]) {
    if (!live.has(key)) origin.delete(key);
  }
}

/** The entries this operator may honestly report as their own. */
function ownedBy(entries, userId) {
  if (!userId) return [];
  return entries.filter((e) => origin.get(String((e && e.key) || '')) === userId);
}

// ── THE AD-HOC SESSION NEVER GOES ON THE WIRE ───────────────────────────────────────────
// ⚠ An UNTHREADED inbound (the ordinary DM) has no first-class thread, so trigger.taskIdFor
// mints `task-<channelId>-<seq>`, which the server's `SESSION_KEY_RE` and
// `threadId: z.string().uuid()` both refuse. Zod validates the ARRAY, so ONE such entry 400s
// the WHOLE payload; retryable(400) is false, so the digest is never recorded and every later
// push for that workspace fails identically — `read_sessions` answers [] for the machine,
// valid UUID-threaded sessions included, and stale rows are never cleared.
// ⚠ Filter client-side; do NOT widen the server schema. `read_sessions` answers "what is this
// member's agent doing on THIS thread", and an ad-hoc session has no thread for the answer to
// be about. Widening the key charset also gives up the reconcile's delete-by-key safety.
// The predicate RESTATES the server's contract (uuid channel, uuid thread or none) rather than
// sniffing `!key.startsWith('task-')`: the reason to drop a row is that the server refuses it.
const WIRE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serverReportable(e) {
  const x = e || {};
  if (!WIRE_UUID_RE.test(String(x.channelId || ''))) return false;
  const taskId = String(x.taskId || '');
  return taskId === '' || WIRE_UUID_RE.test(taskId);
}

// ⚠ One line per dropped session, NOT per push: a filtered entry survives every state change
// of a session that may run for hours. Pruned to the live set every cycle, like `origin`.
const loggedAdHoc = new Set();

function reportable(entries) {
  const kept = [];
  const live = new Set();
  for (const e of entries) {
    const key = String((e && e.key) || '');
    live.add(key);
    if (serverReportable(e)) { kept.push(e); continue; }
    if (loggedAdHoc.has(key)) continue;
    loggedAdHoc.add(key);
    diag('session-state push: SKIPPING ad-hoc session', key,
      '— no first-class thread, so read_sessions has nothing to be about;',
      'the rest of this workspace\'s set is reported normally');
  }
  for (const key of [...loggedAdHoc]) {
    if (!live.has(key)) loggedAdHoc.delete(key);
  }
  return kept;
}

/** workspaceId -> rows to report there. ⚠ An entry with no workspace is DROPPED, never
 *  guessed at (the server fences on X-Workspace-Id). Unreachable from a real session, which
 *  is why it diags rather than throws. */
function groupByWorkspace(entries) {
  const out = new Map();
  for (const e of entries) {
    const ws = String((e && e.workspaceId) || '');
    if (!ws) {
      noteFailure('none', 'no-workspace', 'a session summary carried no workspace id');
      continue;
    }
    const rows = out.get(ws);
    if (rows) rows.push(reportRow(e));
    else out.set(ws, [reportRow(e)]);
  }
  return out;
}

// ── The persisted "workspaces this machine has rows in" record ──────────────────────────
// ⚠ KEYED BY OPERATOR (`{ userId: [workspaceId, …] }`), because a ROW is. A machine-wide list
// would make the next operator to sign in clear a workspace they may not be a member of, and
// would forget that the PREVIOUS operator still has rows there — the one thing this remembers.
// Empty entries are dropped, so it is bounded by accounts that signed in on this Mac.
function reportedRecord() {
  let raw = null;
  try { raw = store.get(REPORTED_WORKSPACES_KEY); } catch (_err) { return {}; }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function reportedWorkspaces(userId) {
  const list = reportedRecord()[String(userId || '')];
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : [];
}

function rememberWorkspace(userId, workspaceId, hasRows) {
  const record = reportedRecord();
  const next = new Set(reportedWorkspaces(userId));
  if (hasRows) next.add(workspaceId);
  else next.delete(workspaceId);
  if (next.size > 0) record[String(userId)] = [...next];
  else delete record[String(userId)];
  try { store.set(REPORTED_WORKSPACES_KEY, record); } catch (err) {
    diag('session-state push: could not persist the reported-workspace set —', err && err.message);
  }
}

// ── Failure reporting: once per distinct shape, and it says what it costs ────────────────
function noteFailure(workspaceId, shape, detail) {
  const key = String(workspaceId) + '|' + shape;
  if (loggedFailures.has(key)) return;
  loggedFailures.add(key);
  diag('session-state push failed —', detail, 'ws', short(workspaceId),
    '— read_sessions will not see this machine until a later state change succeeds');
}

function clearFailures(workspaceId) {
  const prefix = String(workspaceId) + '|';
  for (const key of [...loggedFailures]) {
    if (key.startsWith(prefix)) loggedFailures.delete(key);
  }
}

// A 5xx or a 429 may differ next time; a 4xx will not (a bad payload, a workspace this
// credential is not in, an expired session api-repair already retried once).
function retryable(status) {
  return status === 429 || status >= 500;
}

/** POST one workspace's whole set. Returns whether the server stored it. */
async function send(workspaceId, rows) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res = null;
    try {
      res = await apiFetch(ENDPOINT, {
        method: 'POST',
        workspaceId: workspaceId,
        body: { sessions: rows },
        timeoutMs: HTTP_TIMEOUT_MS,
        noStore: true,
      });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
      noteFailure(workspaceId, 'network', (err && err.message) || 'network error');
      return false;
    }
    if (res && res.ok) { clearFailures(workspaceId); return true; }
    const status = (res && res.status) || 0;
    if (retryable(status) && attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
    noteFailure(workspaceId, 'http-' + status, 'HTTP ' + status);
    return false;
  }
  return false;
}

/**
 * ONE CYCLE: the projection as it stands -> at most one POST per workspace whose set moved.
 * ⚠ The empty-set push is the DELETE half: a workspace with rows but no sessions gets
 * `{ sessions: [] }` once, removing the last session's row (and a previous run's leftovers).
 */
async function cycle(entries) {
  const userId = (deps.getUserId && deps.getUserId()) || null;
  trackOrigin(entries, userId);
  if (!userId) return; // signed out: nothing here is ours to assert
  if (userId !== lastUserId) {
    // A different operator's server state is unknown here and their failures are not ours.
    // ⚠ Nothing carries across except the origin stamps, which are the whole point.
    pushedDigest.clear();
    loggedFailures.clear();
    lastUserId = userId;
  }
  // ⚠ Ad-hoc rows are dropped HERE, before grouping, so the digest, the empty-set delete and
  // the bounded retry all operate on exactly the set that goes on the wire. Filtering inside
  // `send` leaves the digest recording a payload that was never sent.
  const groups = groupByWorkspace(reportable(ownedBy(entries, userId)));
  for (const ws of reportedWorkspaces(userId)) {
    if (!groups.has(ws)) groups.set(ws, []);
  }
  for (const [ws, rows] of groups) {
    const digest = setDigest(rows);
    if (pushedDigest.get(ws) === digest) continue;
    // Serial on purpose: a burst of parallel writes is what this design exists to avoid.
    const stored = await send(ws, rows);
    if (!stored) continue; // NOT recorded, so the next real change retries
    pushedDigest.set(ws, digest);
    rememberWorkspace(userId, ws, rows.length > 0);
  }
}

/** Coalesce: a cycle already running takes the newest entries when it comes round again,
 *  so a state change during a slow POST can never start a second overlapping run. */
function schedule(entries) {
  if (!armed) return;
  queued = Array.isArray(entries) ? entries : [];
  if (running) return;
  running = true;
  draining = drain();
}

async function drain() {
  try {
    while (queued) {
      const entries = queued;
      queued = null;
      await cycle(entries); // the loop IS the serialization
    }
  } catch (err) {
    diag('session-state push: cycle error —', (err && err.message) || String(err));
  } finally {
    running = false;
  }
}

/**
 * Arm the writer. ⚠ `getUserId()` is read at PUSH time, never captured — it changes
 * underneath us. `summary` is session-summary.js, INJECTED rather than required so the block
 * above stays evaluable. Idempotent.
 */
function start(opts) {
  const o = opts || {};
  deps = {
    getUserId: typeof o.getUserId === 'function' ? o.getUserId : null,
    summary: o.summary || null,
  };
  if (armed) return;
  if (!deps.summary || typeof deps.summary.subscribe !== 'function') {
    diag('session-state push: NOT armed — no session-summary to subscribe to');
    return;
  }
  armed = true;
  unsubscribe = deps.summary.subscribe((entries) => schedule(entries));
  diag('session-state push: armed (on state change — no heartbeat)');
}

/**
 * Run a cycle now off the CURRENT projection. One caller: the sign-in transition. A fresh
 * credential is not a state change, so nothing fires on its own — yet a run that starts signed
 * out then signs in has a previous run's rows to clear and possibly a live session to report.
 */
function kick() {
  if (!armed || !deps.summary || typeof deps.summary.reportList !== 'function') return;
  schedule(deps.summary.reportList());
}

/**
 * `kick()`, AWAITABLE, for the quit path and nothing else — a quit that ends every session
 * otherwise leaves rows saying `working` for a dead process until the same account signs in on
 * this Mac again.
 * ⚠ THE CALLER BOUNDS THE WAIT, not this function: `send`'s 15s timeout + one retry is right
 * for a running app and wrong for a quit, so racing it against a short deadline is the quit
 * guard's decision. `drain()`'s own try/catch means this promise can never reject.
 */
function flush() {
  kick();
  return draining || Promise.resolve();
}

function stop() {
  if (unsubscribe) { try { unsubscribe(); } catch (_err) { /* already gone */ } }
  unsubscribe = null;
  armed = false;
  queued = null;
}

// ─── END SESSION-STATE-PUSH ─────────────────────────────────────────────────────────────

module.exports = {
  // the live half
  start,
  kick,
  flush, // an awaitable kick, for the quit teardown
  stop,
  // the pure core (exported for the shell + the tests)
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  REPORTED_WORKSPACES_KEY,
  reportRow,
  setDigest,
  retryable,
  reportedWorkspaces,
};
