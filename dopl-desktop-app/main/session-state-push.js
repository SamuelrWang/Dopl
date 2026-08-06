// SESSION STATE -> THE SERVER (F-147, rollback plan §3.5 "read session state" + §5).
//
// WHAT THIS CLOSES. Phase 5 shipped the READ end to end — `dopl_channel(op="read_sessions")`
// -> GET /api/channels/sessions -> `channel_sessions` — and flagged the WRITE as a delivery
// gap (F-144 (a)), so "what is flint doing?" asked from Claude Desktop answered an honest
// empty because nothing on this machine ever wrote a row. This is the writer.
//
// ── IT IS A PUSH ON STATE CHANGE. IT IS NOT A HEARTBEAT. ────────────────────────────────
// `presence.js` beats every 30s per listener per workspace, unconditionally — the quadratic
// always-on term plan §5 is shedding (~120 writes an hour, forever, per machine). This
// writes when a session's DERIVED state actually moves: launch, first tool, a park, an end.
// A handful of writes per session lifetime. That difference is the entire argument for the
// new table existing at all, and sequencing item 7 (retiring the presence beat) is meant to
// be MEASURED against it. A future "just beat it every 30s, it's simpler" gives that back.
//
// THE TRIGGER IS NOT DERIVED HERE. `session-summary.js` is the ONE place engine state
// becomes a pill state (F-142), and it already coalesces a burst of engine dispatches into
// one digest and fires only when the digest really moved. This module SUBSCRIBES to that.
// It re-derives nothing: it maps the entry to the wire and posts it. Anything else would be
// the two-readers-one-fact defect the pills were built to delete.
//
// WHY A SEPARATE MODULE AND NOT A FEW LINES IN session-summary.js. That file is network-free
// above `module.exports` on purpose — its whole test suite reads it as SOURCE and evaluates
// the block with two fakes injected, which is what makes the mapping testable without
// Electron. An `apiFetch` in there ends that. So the seam is a subscription.
//
// ── THE TRANSPORT IS api.js, DELIBERATELY ───────────────────────────────────────────────
// There are exactly two authenticated main-process lanes and this had to pick one, not
// grow a third: `listener-io.js` keeps its own SEND because its long-poll wires a caller
// abort signal into the controller and its timeouts are load-bearing, and `api.js` is the
// shared helper every other main-process caller uses (consent, mcp-config, presence,
// session-history, session-peer-post, session-close-task). Both share ONE 401 repair
// (api-repair.js) — a second copy of that repair is what produced the 1.8.x Channels
// outage. This is a short POST with no abort wiring and no long-poll, i.e. exactly the
// shape `api.js` exists for, and it inherits the repair, the app-version stamp and the
// undici pool reset for free.
//
// ── THE ROW LIFETIME, and why an ENDED row is DELETED rather than swept ─────────────────
// F-142's rule is "a pill lives exactly as long as its window": an ended session's pill
// survives only for the ABANDONMENT case (the one end that keeps its window), it is a
// HANDLE rather than a tombstone, and the retained set needs no TTL because the window
// budget bounds it. THE SERVER ROW INHERITS THAT RULE, because the row is that projection.
// So: a session's row exists while its pill does, and it is DELETED when the pill leaves —
// including the ended one.
//
// The alternative (keep `ended` rows and sweep them later) was rejected twice over. A sweep
// needs a scheduler this product does not have, so "later" means "never" and the table
// grows without bound — which is the accumulation plan §5 is trying to get away from. And
// an `ended` row for a session with no window answers "what is flint doing?" with a session
// the operator cannot open: the channel transcript is already the record of what happened.
//
// THE DELETE IS IMPLICIT, WHICH IS WHY THIS POSTS THE WHOLE SET. Each push carries every
// session this machine is running in that workspace, and the server replaces the caller's
// set with it. A delta protocol would need an explicit "this one is gone" message, and the
// desktop that crashes or quits never sends it.
//
// WHAT A CRASH OR A QUIT LEAVES BEHIND, stated rather than papered over. This machine is
// the only writer, so rows it wrote outlive the process that wrote them. Two things bound
// that: the first push for a workspace in a new run replaces its whole set, and the
// workspaces this machine has rows in are PERSISTED, so a run that starts with no sessions
// clears them (`reportedWorkspaces` below). What is NOT covered is signing out — the
// credential that could delete the rows is already gone by the time anything here could
// react — so those rows stand until this account signs in on this Mac again.
//
// ── IDENTITY: THE ROW SAYS "THIS USER'S MACHINE IS RUNNING THIS SESSION" ────────────────
// Signing out does not end the sessions in the engine (they are the engine's to own), so
// operator A's live sessions are still in the registry when operator B signs in on the same
// Mac — and a push made under B's credential would file A's session handles, channel names
// and thread titles as B's, readable by B through `read_sessions`. That is a cross-account
// leak, and this project has already had two.
//
// So every session key is stamped with the identity that was current WHEN THIS MODULE FIRST
// SAW IT, and only keys stamped with the identity we are posting as are ever reported. A
// key first seen with no resolvable identity is never reported at all — fail closed. A
// sign-out and a sign-in as the SAME operator resumes reporting their own sessions, because
// the stamp matches again; there is nothing to un-quarantine by hand.

const { apiFetch } = require('./api');
const { diag } = require('./diag');
const Store = require('electron-store');

const store = new Store();

// ─── BEGIN SESSION-STATE-PUSH (injectable; unit-tested via source extraction) ───────────
// `apiFetch`, `diag` and `store` are free vars from here down (the session-summary idiom),
// so test/session-state-push.test.mjs evaluates this code verbatim with fakes — no
// Electron, no network, no disk.

const ENDPOINT = '/api/channels/sessions';
const HTTP_TIMEOUT_MS = 15000;

// The workspaces this machine has written rows into, persisted beside the listener's
// cursors. It exists for ONE case: a run that starts with no sessions in a workspace a
// previous run left rows in. Without it those rows stand until a session happens to run
// there again, claiming `working` for a process that is gone.
const REPORTED_WORKSPACES_KEY = 'sessionReportWorkspaces';

// BOUNDED RETRY, and the bound is small on purpose. `ui-sync`'s ~39 000-attempt storm is
// the cautionary tale in this tree: an unbounded retry over a failure that is not going to
// fix itself is worse than the missing feature. Two attempts, one fixed gap, and then STOP
// — the digest is not recorded on a failure, so the session's NEXT real state change is
// the retry. That cadence is bounded by the session's own life rather than by a timer.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;

let armed = false;
let deps = { getUserId: null, summary: null };
let unsubscribe = null;
let lastUserId = null;
let running = false; // one cycle at a time — the pushes inside one are serial
let queued = null; // the newest entries that arrived while a cycle was in flight

// sessionKey -> the userId that was current when this module first saw that key. Pruned to
// the live set on every cycle, so it is bounded by the window budget like everything else.
const origin = new Map();
// workspaceId -> the digest of the set this process last STORED there. A push whose digest
// is unchanged is not sent: a window rebuild, a re-mount or an identical re-derivation must
// not cost a write.
const pushedDigest = new Map();
// One line per (workspace, failure shape) — the `staleNotified` idiom. A subsystem that
// dies must say so, once, not once per state change.
const loggedFailures = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => String(id || '').slice(0, 8);

/**
 * ONE REPORT ENTRY -> THE WIRE ROW. The only mapping in this module, and it is a rename:
 * `key` is the server's `sessionKey` (the stable (channel, thread) key, which is why the
 * table upserts on it rather than on the ephemeral `sessionId`), and the empty `taskId` of
 * a responder with no first-class thread becomes the NULL the column actually stores.
 * `state`, `name`, `channelName` and `threadTitle` are passed through byte-for-byte — this
 * module does not get a vote on what a session's state is.
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

/** The set a workspace's rows are compared by. Same reasoning as `summariesDigest`: one
 *  stable string, so a field added to the row shape is compared automatically. */
function setDigest(rows) {
  return JSON.stringify(rows || []);
}

/**
 * Stamp every key we have not seen before with the identity that is current NOW, and
 * release the stamps of keys that have left the projection. This is the whole
 * cross-account guard: a stamp is written once per key and never rewritten, so a session
 * that started under one operator can never be re-attributed to the next one.
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

/** workspaceId -> the rows to report there. An entry with no workspace has nowhere to go
 *  and is dropped rather than guessed at (the header is X-Workspace-Id, and the server
 *  fences on it); it is not reachable from a real session, which is why it is a diag and
 *  not a throw. */
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
//
// KEYED BY OPERATOR, because a ROW is. `{ userId: [workspaceId, …] }`. A machine-wide list
// would make the next operator to sign in clear a workspace they may not even be a member
// of, and — worse — would forget that the PREVIOUS operator still has rows there, which is
// the one thing this record exists to remember. Entries empty out and are dropped, so it is
// bounded by the accounts that have actually signed in on this Mac.
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
 *
 * The empty-set push is the DELETE half. A workspace this machine has rows in that now has
 * no sessions gets `{ sessions: [] }` once, which is what removes the last session's row
 * (and, after a crash, whatever the previous run left behind).
 */
async function cycle(entries) {
  const userId = (deps.getUserId && deps.getUserId()) || null;
  trackOrigin(entries, userId);
  if (!userId) return; // signed out: nothing here is ours to assert
  if (userId !== lastUserId) {
    // A different operator's server state is unknown to this process, and their failures
    // are not ours. Nothing is carried across except the origin stamps, which are the
    // whole point.
    pushedDigest.clear();
    loggedFailures.clear();
    lastUserId = userId;
  }
  const groups = groupByWorkspace(ownedBy(entries, userId));
  for (const ws of reportedWorkspaces(userId)) {
    if (!groups.has(ws)) groups.set(ws, []);
  }
  for (const [ws, rows] of groups) {
    const digest = setDigest(rows);
    if (pushedDigest.get(ws) === digest) continue;
    // Serial on purpose: one machine, a handful of workspaces, and a burst of parallel
    // writes is exactly what this design exists to avoid.
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
  void drain();
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
 * Arm the writer. `getUserId()` answers the operator this machine is signed in as (read at
 * push time, never captured — it changes underneath us), and `summary` is
 * session-summary.js, injected rather than required so the block above stays evaluable.
 * Idempotent.
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
 * Run a cycle now, off the CURRENT projection. Its one caller is the sign-in transition: a
 * fresh credential is not a state change, so nothing would fire on its own — and a run that
 * starts signed out, then signs in, has a previous run's rows to clear and possibly a live
 * session to report.
 */
function kick() {
  if (!armed || !deps.summary || typeof deps.summary.reportList !== 'function') return;
  schedule(deps.summary.reportList());
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
