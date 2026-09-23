// Session state -> the server (`channel_sessions`, read by `dopl_channel op="status"`). A PUSH ON STATE CHANGE,
// never a heartbeat: it subscribes to session-summary's coalesced digest and writes only when a workspace's set
// moved. It posts the WHOLE set (the server replaces it, so a gone row is deleted by omission). Transport is
// api.js (the shared 401 repair). The only timer is the failure backoff (`session-state-push-retry.js`).
// Cross-account guard: every key is stamped with the operator current when first seen; only matching keys report.

const { apiFetch } = require('./api');
// No branch reads the body, success included, so every exit discards it (undici pool leak).
const { discardBody } = require('./api-repair');
const { diag } = require('./diag');
// Every dep sits above the sentinel: the extracted block may not `require`.
const wire = require('./session-state-push-wire');
const telemetry = require('./session-telemetry');
// Wake receipts are HELD there and drained into this push: a module posting receipts alone would send an empty
// session list and delete this machine's projection (A9).
const deliveryAck = require('./delivery-ack');
const retryLane = require('./session-state-push-retry');
const heal = require('./listener-heal');
const record = require('./session-state-push-record');
const Store = require('electron-store');

const store = new Store();

// ─── BEGIN SESSION-STATE-PUSH (injectable; unit-tested via source extraction) ───────────

// `apiFetch`, `diag`, `store`, `telemetry` and `Date` are free vars from here down.

const ENDPOINT = '/api/channels/sessions';
const HTTP_TIMEOUT_MS = 15000;

// Workspaces this machine has rows in, persisted: a run that starts with no sessions there still clears them.
const REPORTED_WORKSPACES_KEY = 'sessionReportWorkspaces';

// The inner per-POST retry is deliberately small; nothing is recorded on failure, so a later cycle re-sends.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;
// A deadlock detector, not a latency budget: the worst honest cycle (a quarantine sweep) stays far below (F-698).
const CYCLE_WATCHDOG_MS = 20 * 60 * 1000;

let armed = false;
let deps = { getUserId: null, summary: null };
let unsubscribe = null;
let lastUserId = null;
let running = false;
let queued = null;
let draining = null;

// sessionKey -> the userId current when first seen; pruned to the live set every cycle.
const origin = new Map();
// workspaceId -> digest of the set last STORED there; an unchanged set is not sent.
const pushedDigest = new Map();
// The cadence floor's facts: the stored set's STATE half and when it was stored.
const pushedStateDigest = new Map();
const pushedAt = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The failure lane and the quarantine are minted per writer (they remember). The retry re-runs `kick(true)`.
const { noteFailure, clearFailures, forgetFailures, retryable, armRetry, clearRetry } =
  retryLane.makeFailureLane(diag, () => kick(true));
// Rows the server refuses for reasons no client predicate restates; probed with `send` and no acks, so the winning
// probe stores exactly the set the next cycle would send.
const quarantine = retryLane.makeQuarantine(diag, (ws, rows) => send(ws, rows));

/** One report entry -> the wire row, picked BY NAME (a new summary field reaches no column until named here).
 *  `key` is the stable session key (not the ephemeral sessionId); '' taskId is the column's NULL. */
function reportRow(e) {
  return {
    sessionKey: String((e && e.key) || ''),
    channelId: String((e && e.channelId) || ''),
    threadId: (e && e.taskId) || null,
    name: (e && e.name) || '',
    state: (e && e.state) || '',
    channelName: (e && e.channelName) || null,
    threadTitle: (e && e.threadTitle) || null,
    identityName: telemetry.labelOrNull(e && e.identityName, telemetry.IDENTITY_NAME_MAX),
    // Peer-visible by design; it is state because `STATE_FIELDS` names it (F-708). 60 is the column's bound.
    displayName: telemetry.labelOrNull(e && e.displayName, 60),
    // An ASK the server resolves (its rule 1 keeps a stored colour, so null cannot erase one); a closed set, so
    // membership-tested rather than length-bounded.
    color: wire.colorKey(e && e.color),
    ...telemetry.telemetryFields(e),
  };
}

function setDigest(rows) {
  return JSON.stringify(rows || []);
}

// Stamp unseen keys with the identity current NOW (never rewritten); release keys that left the projection.
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

function ownedBy(entries, userId) {
  if (!userId) return [];
  return entries.filter((e) => origin.get(String((e && e.key) || '')) === userId);
}

// The wire refusals (ad-hoc key, nameless row, ended row) live in `session-state-push-wire.js`.
const { nameReportable, liveForWire, reportable } = wire.makeWireFilter(diag);

/** workspaceId -> rows. An entry with no workspace is dropped, never guessed at (the server fences on it). */
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

const { reportedWorkspaces, rememberWorkspace } = record.makeReportedRecord(store, diag, REPORTED_WORKSPACES_KEY);

/** POST one workspace's whole set plus any receipts. Answers `true` (stored), `'retry'` (a network throw or an
 *  exhausted 429/5xx) or `false` (a 4xx that will not answer differently); only `'retry'` may arm the backoff. */
async function send(workspaceId, rows, acks) {
  const body = { sessions: rows };
  if (acks && acks.length) body.acks = acks;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res = null;
    try {
      res = await apiFetch(ENDPOINT, {
        method: 'POST',
        workspaceId: workspaceId,
        body: body,
        timeoutMs: HTTP_TIMEOUT_MS,
        noStore: true,
      });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
      noteFailure(workspaceId, 'network', (err && err.message) || 'network error'); return 'retry';
    }
    if (res && res.ok) { discardBody(res); clearFailures(workspaceId); return true; }
    const status = (res && res.status) || 0; discardBody(res);
    if (retryable(status) && attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
    noteFailure(workspaceId, 'http-' + status, 'HTTP ' + status);
    return retryable(status) ? 'retry' : false;
  }
  return 'retry';
}

/** One cycle: the projection as it stands -> at most one POST per workspace whose set moved. An empty set is
 *  the DELETE half. */
async function cycle(entries) {
  const userId = (deps.getUserId && deps.getUserId()) || null;
  trackOrigin(entries, userId);
  // Signed out disarms the lane: nothing here is ours.
  if (!userId) { clearRetry(); return; }
  // A different operator: their server state and failures are not ours; only the origin stamps carry over. The
  // receipts are not cleared — `take` already hands back only this operator's.
  if (userId !== lastUserId) {
    pushedDigest.clear();
    pushedStateDigest.clear();
    pushedAt.clear();
    forgetFailures();
    lastUserId = userId;
  }
  // Refusals are applied before grouping, so the digest, the delete and the retry all see exactly the wire set.
  const reported = reportable(ownedBy(entries, userId));
  quarantine.prune(new Set(reported.map((e) => String((e && e.key) || ''))));
  const groups = groupByWorkspace(reported);
  for (const ws of reportedWorkspaces(userId)) {
    if (!groups.has(ws)) groups.set(ws, []);
  }
  // A workspace holding receipts is pushed even if its set never moved (A9).
  for (const ws of deliveryAck.pendingWorkspaces(userId)) {
    if (!groups.has(ws)) groups.set(ws, []);
  }
  let wantsRetry = false;
  for (const [ws, all] of groups) {
    // Above the digest, so a banished row cannot make a set look new every cycle.
    const rows = quarantine.allowed(ws, all);
    // Taken before the gates may `continue`, and restored on every path that does not send.
    const acks = deliveryAck.take(ws, userId);
    const digest = setDigest(rows);
    if (pushedDigest.get(ws) === digest && acks.length === 0) continue;
    // The cadence floor: a DELAY, not a schedule — a churn-only set inside the window is not written and not
    // recorded; a state change or a receipt bypasses it.
    const state = telemetry.stateDigest(rows);
    const stateMoved = pushedStateDigest.get(ws) !== state;
    if (!stateMoved && acks.length === 0 && !telemetry.floorAllows(pushedAt.get(ws), Date.now())) continue;
    // Serial on purpose.
    let stored = await send(ws, rows, acks);
    if (stored !== true) {
      deliveryAck.restore(ws, acks, userId);
      if (stored === 'retry') wantsRetry = true;
      // A non-retryable refusal is swept once, so one poisoned row cannot wedge the workspace for the run.
      else if (await quarantine.sweep(ws, rows)) wantsRetry = true;
      continue;
    }
    diag('session-state push: stored', rows.length, 'row(s) ws', String(ws).slice(0, 8));
    pushedDigest.set(ws, digest);
    pushedStateDigest.set(ws, state);
    // Stamped AFTER the send (which can hold 15s+), or the next cycle would read the floor as expired.
    pushedAt.set(ws, Date.now());
    rememberWorkspace(userId, ws, rows.length > 0);
  }
  // The cycle is the unit; a clean one (or one with nothing due) arms nothing.
  if (wantsRetry) armRetry();
  else clearRetry();
}

/** Coalesce: a running cycle takes the newest entries next time round, so runs never overlap. A real state change
 *  resets the backoff; a retry's own re-run passes `fromRetry`. */
function schedule(entries, fromRetry) {
  if (!armed) return;
  if (!fromRetry) clearRetry();
  queued = Array.isArray(entries) ? entries : [];
  if (running) return;
  running = true;
  draining = drain();
}

function onHungCycle(ms) {
  diag('session-state push: cycle still running after', ms / 1000, 's — RELEASING the single-flight guard so the',
    'next state change can push. The hung cycle is abandoned, not cancelled (F-698).');
}

async function drain() {
  try {
    while (queued) {
      const entries = queued;
      queued = null;
      // Watchdogged (F-698): a cycle that never settled was a permanent off switch. The hung one is abandoned, not
      // cancelled; `.catch` is on the pass because `watchPass` resolves on either arm.
      await heal.watchPass(cycle(entries).catch(onCycleError), onHungCycle, CYCLE_WATCHDOG_MS);
    }
  } finally {
    running = false;
  }
}

function onCycleError(err) {
  diag('session-state push: cycle error —', (err && err.message) || String(err));
}

/** Arm the writer. `getUserId()` is read at push time; `summary` is injected so the block stays evaluable. */
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

/** Run a cycle off the current projection (the sign-in transition; the retry). */
function kick(fromRetry) {
  if (!armed || !deps.summary || typeof deps.summary.reportList !== 'function') return;
  schedule(deps.summary.reportList(), fromRetry === true);
}

/** An awaitable `kick` for the quit path; the caller bounds the wait, and it never rejects. */
function flush() {
  kick();
  return draining || Promise.resolve();
}

function stop() {
  if (unsubscribe) { try { unsubscribe(); } catch (_err) { /* already gone */ } }
  unsubscribe = null;
  armed = false;
  queued = null;
  clearRetry();
}

// ─── END SESSION-STATE-PUSH ─────────────────────────────────────────────────────────────

module.exports = {
  start,
  kick,
  flush,
  stop,
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  REPORTED_WORKSPACES_KEY,
  reportRow,
  liveForWire,
  nameReportable,
  setDigest,
  TELEMETRY_MIN_INTERVAL_MS: telemetry.TELEMETRY_MIN_INTERVAL_MS,
  retryable,
  RETRY_BACKOFF_MS: retryLane.RETRY_BACKOFF_MS,
  reportedWorkspaces,
};
