// Channels — async consent watcher (pending-requests model, Round B).
//
// This is the engine that decouples consent from the channel long-poll loop. The
// loop never blocks on a decision: trigger.handleTrigger creates a server consent
// row, registers a durable PENDING-REQUEST RECORD here, fires a notification, and
// returns. This watcher polls each record's row OFF-LOOP and, when the row flips,
// dispatches to a resolver (in trigger.js) that spawns / posts / echoes.
//
// DURABILITY & THE REPLAY FIX. Records persist to electron-store, so a parked
// request (never answered) survives a restart and stays answerable — from the web
// Pending Requests list or a re-fired notification — for far longer than the old
// 30-minute modal window. Crucially, once a request reaches a TERMINAL outcome
// (allowed→spawned→outbound-resolved, denied, sent, cancelled, expired) its key is
// written to a persisted `settled` set and its record removed. The watcher only
// ever polls rows it has a record for, so a settled request is NEVER re-polled and
// NEVER re-spawned — even though the server's inbound row may stay `allowed`
// forever. That is the fix for the replay bug where a restart auto-allowed and
// re-spawned a request whose outbound had already been denied.
//
// SINGLE-FLIGHT. A per-key in-memory lock wraps the whole poll→resolve→spawn
// turn, so a long headless spawn can never be re-entered by the next tick, and the
// existing (operator, channel, kind, seq) server-side de-dupe backs it up. A
// record reloaded in the transient 'spawning' phase was interrupted mid-spawn and
// is dropped rather than re-run (never re-spawn a handled request).
//
// SELF-GATING. Polling no-ops while signed out. The watcher imports nothing from
// trigger.js (the resolvers are injected via start()), so there is no import
// cycle: trigger.js → consent-watcher.js, channel-listener.js → both.

const Store = require('electron-store');
const auth = require('./auth');
const consent = require('./consent');
const { diag } = require('./diag');

const store = new Store();
const WATCHED_KEY = 'channelWatched'; // { [requestKey]: record }
const SETTLED_KEY = 'channelSettled'; // { [requestKey]: { outcome, at } }

// One tick scans all records; each record self-throttles via nextPollDelay so the
// scan interval can stay short (fast reaction) without hammering the server.
const TICK_MS = 2000;
// Settled keys are pruned after this so the record never grows without bound; far
// longer than any request lives, so it cannot cause a re-spawn in practice.
const SETTLED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// A record parked this long with no decision is dropped locally (treated as
// expired). 24h dwarfs the old 30-min ceiling, so a request answered hours later
// still resolves; see the server-expiry coordination note in the build report.
const MAX_WATCH_MS = 24 * 60 * 60 * 1000;

// ─── BEGIN WATCHER-PURE (pure; unit-tested via source extraction) ────────────
// No electron / store / network refs below, so test/consent-watcher.test.mjs can
// slice this block and evaluate it verbatim (same pattern as seedModeFor).

// Stable identity of a request = (channel, message seq). The whole inbound→
// outbound lifecycle shares ONE key so settlement and de-dupe are per request.
function requestKey(channelId, seq) {
  return `${channelId}:${seq}`;
}

// Map a raw server consent status to the action the watcher takes.
function mapStatus(status) {
  const s = String(status || '');
  if (s === 'allowed' || s === 'auto_allowed') return 'allow';
  if (s === 'denied') return 'deny';
  if (s === 'expired') return 'expire';
  if (s === 'pending') return 'pending';
  return 'unknown'; // transient / unrecognized → keep waiting
}

// Poll cadence backs off the longer a request sits unanswered — every GET also
// runs the server's expire-stale sweep, so a tight loop is not free, and a human
// who has not answered in ten minutes is not answering in the next five seconds.
function nextPollDelay(elapsedMs) {
  if (elapsedMs < 60_000) return 5_000;
  if (elapsedMs < 5 * 60_000) return 10_000;
  if (elapsedMs < 30 * 60_000) return 20_000;
  return 60_000;
}

// A settled request key must never be re-acted on (the replay-respawn fix).
function isSettledIn(settled, key) {
  return !!(settled && Object.prototype.hasOwnProperty.call(settled, key));
}

// A record reloaded in this phase was interrupted mid-spawn: never re-run it.
function isInterruptedSpawn(phase) {
  return phase === 'spawning';
}

// v1.9: a record handed to a live SESSION window (§A.2). The session engine owns
// its whole lifecycle from here — the reply, milestones, End/idle/cap, the
// interrupted echo, and the opt-in resume affordance — so the watcher must NOT
// poll it, re-spawn it, or echo for it. It is a terminal handoff, dropped as
// settled('session') on the next resume with NO onInterrupted echo (that echo is
// the engine's job, not ours — echoing here would double-fire against it).
function isSessionPhase(phase) {
  return phase === 'session';
}

// A record counts toward the tray "Pending: N" only while it is awaiting a human
// decision (inbound consent or outbound review). Active work ('spawning') and
// settled requests do not.
function isAwaiting(phase) {
  return phase === 'await-inbound' || phase === 'await-outbound';
}

// The tray "Pending: N" is the count of records awaiting a human decision. A
// sign-out reset() empties the record set, so this returns 0 — that is what clears
// a stale "Pending: N" after sign-out (FIX 1). Kept pure so it stays unit-tested.
function countAwaiting(phases) {
  let n = 0;
  for (const p of phases) if (isAwaiting(p)) n++;
  return n;
}
// ─── END WATCHER-PURE ────────────────────────────────────────────────────────

const records = new Map(); // requestKey -> record (durable fields + lastPolledAt)
const inFlight = new Set(); // requestKey currently being polled/resolved
let settled = {}; // requestKey -> { outcome, at }
let resolvers = {}; // injected by start(): { inboundApproved, inboundDenied, ... }
let onCount = null; // ({ count, segment }) => void — tray pending count
let timer = null;
let started = false;

// ── Persistence ──────────────────────────────────────────────────────────────
function durable(rec) {
  const { lastPolledAt, ...rest } = rec; // lastPolledAt is in-memory only
  return rest;
}
function persistRecords() {
  const out = {};
  for (const [k, rec] of records) out[k] = durable(rec);
  store.set(WATCHED_KEY, out);
}
function persistSettled() {
  store.set(SETTLED_KEY, settled);
}

function emitCount() {
  if (!onCount) return;
  const recs = [...records.values()];
  const count = countAwaiting(recs.map((r) => r.phase));
  let newest = null;
  for (const rec of recs) {
    if (!isAwaiting(rec.phase)) continue;
    if (!newest || rec.createdAt > newest.createdAt) newest = rec;
  }
  try {
    onCount({ count, segment: newest ? newest.workspaceSegment : null });
  } catch (_) { /* tray may be gone */ }
}

// ── Public mutation API (called by trigger.js resolvers) ─────────────────────
function has(key) {
  return records.has(key);
}
function isSettled(key) {
  return isSettledIn(settled, key);
}
function get(key) {
  return records.get(key) || null;
}

// Register a fresh inbound pending-request record and begin watching it.
function register(rec) {
  const record = { ...rec, phase: 'await-inbound', lastPolledAt: 0, createdAt: rec.createdAt || Date.now() };
  records.set(record.key, record);
  persistRecords();
  emitCount();
  return record;
}

function setPhase(key, phase) {
  const rec = records.get(key);
  if (!rec) return;
  rec.phase = phase;
  persistRecords();
  emitCount();
}

// v1.9: hand this request to a live session window. Mark it 'session' (a terminal
// phase for the watcher) and stop tracking it as awaiting — the engine owns the
// lifecycle now. Kept as a durable record (not settled outright) so a restart's
// resume() can recognize an engine-owned handoff and drop it WITHOUT an echo. Not
// polled while it sits (processRecord early-returns on a session phase).
function toSession(key, { sessionId } = {}) {
  const rec = records.get(key);
  if (!rec) return;
  rec.phase = 'session';
  if (sessionId) rec.sessionId = sessionId;
  persistRecords();
  emitCount(); // no longer awaiting -> drops out of the tray "Pending: N" count
}

// Inbound was approved and the spawn produced a reply: move the same request to
// its outbound-review phase, pointing at the new outbound row and carrying the
// drafted reply so a restart can still post it on Send.
function toOutbound(key, { rowId, taskId, startedAt, proposedReply }) {
  const rec = records.get(key);
  if (!rec) return;
  rec.kind = 'outbound';
  rec.rowId = rowId;
  rec.phase = 'await-outbound';
  rec.taskId = taskId;
  rec.startedAt = startedAt;
  rec.proposedReply = proposedReply;
  rec.lastPolledAt = 0; // poll the new row promptly
  persistRecords();
  emitCount();
}

// Terminal: record the outcome durably (so the request is never re-handled) and
// drop the record. THIS is the terminal-decision persistence that fixes replay.
function settleRequest(key, outcome) {
  settled[key] = { outcome, at: Date.now() };
  persistSettled();
  if (records.delete(key)) persistRecords();
  emitCount();
  diag('watcher settle', key.split(':')[0].slice(0, 8), 'seq', key.split(':')[1], '->', outcome);
}

// Force the given key (or all records) to be due, and run a scan now.
function poke(key) {
  if (key) {
    const rec = records.get(key);
    if (rec) rec.lastPolledAt = 0;
  } else {
    for (const rec of records.values()) rec.lastPolledAt = 0;
  }
  tick();
}

// ── Poll loop ────────────────────────────────────────────────────────────────
function isDue(rec, now) {
  return now - rec.lastPolledAt >= nextPollDelay(now - rec.createdAt);
}

async function processRecord(key) {
  if (inFlight.has(key)) return;
  const rec = records.get(key);
  if (!rec) return;
  // A record handed to a live session window is engine-owned — never poll it.
  if (isSessionPhase(rec.phase)) return;
  const now = Date.now();
  if (!isDue(rec, now)) return;

  // Local expiry for a long-parked request (server may keep it pending forever).
  if (now - rec.createdAt > MAX_WATCH_MS) {
    settleRequest(key, 'expired');
    return;
  }

  inFlight.add(key);
  try {
    rec.lastPolledAt = Date.now();
    const decision = mapStatus(await consent.pollStatus(rec.workspaceId, rec.rowId));
    if (decision === 'pending' || decision === 'unknown') return; // keep waiting

    if (rec.phase === 'await-inbound') {
      if (decision === 'allow') await safeResolve('inboundApproved', rec);
      else if (decision === 'deny') await safeResolve('inboundDenied', rec);
      else if (decision === 'expire') await safeResolve('inboundExpired', rec);
    } else if (rec.phase === 'await-outbound') {
      if (decision === 'allow') await safeResolve('outboundApproved', rec);
      else await safeResolve('outboundCancelled', rec); // deny/expire = cancel
    }
  } catch (err) {
    diag('watcher: process error', err && err.message);
  } finally {
    inFlight.delete(key);
  }
}

async function safeResolve(name, rec) {
  const fn = resolvers && resolvers[name];
  if (typeof fn !== 'function') {
    diag('watcher: no resolver for', name);
    return;
  }
  await fn(rec);
}

function tick() {
  if (!started) return;
  if (!auth.isSignedIn()) return; // self-gate: no polling while signed out
  for (const key of Array.from(records.keys())) {
    processRecord(key).catch((err) => diag('watcher tick error', err && err.message));
  }
}

// ── Startup resume ───────────────────────────────────────────────────────────
function pruneSettled() {
  const cutoff = Date.now() - SETTLED_TTL_MS;
  let changed = false;
  for (const [k, v] of Object.entries(settled)) {
    if (!v || (v.at || 0) < cutoff) { delete settled[k]; changed = true; }
  }
  if (changed) persistSettled();
}

function resume() {
  settled = store.get(SETTLED_KEY) || {};
  pruneSettled();
  const saved = store.get(WATCHED_KEY) || {};
  records.clear();
  for (const [key, rec] of Object.entries(saved)) {
    if (!rec || !rec.rowId) continue;
    if (isSettled(key)) continue; // already terminal — drop
    if (isSessionPhase(rec.phase)) {
      // Engine-owned live session at crash time. The session engine's own store
      // handles the interrupted echo + resume affordance (§A.8), so here we ONLY
      // settle the consent record — NO onInterrupted echo, or it would double-fire
      // against the engine's echo (they share a deterministic clientMsgId anyway).
      settled[key] = { outcome: 'session', at: Date.now() };
      continue;
    }
    if (isInterruptedSpawn(rec.phase)) {
      // Spawn was in flight when the app died; the in-memory reply is gone and we
      // never re-spawn a handled request. Mark terminal and move on.
      settled[key] = { outcome: 'interrupted', at: Date.now() };
      // task_started was already posted before the crash, so the requester's
      // session card is stuck pulsing "active". Post a TERMINAL echo (task_failed
      // + { interrupted: true }, generic body) so the card settles to "Interrupted".
      // Fire-and-forget through the injected resolver so this file never imports the
      // channel-post path — same decoupling as every other resolver dispatch.
      safeResolve('onInterrupted', rec).catch((err) =>
        diag('watcher: interrupted echo error', err && err.message)
      );
      continue;
    }
    records.set(key, { ...rec, lastPolledAt: 0 });
  }
  persistSettled();
  persistRecords();
  emitCount();
  diag('watcher resumed', records.size, 'pending record(s)');
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
function start(opts = {}) {
  if (opts.resolvers) resolvers = opts.resolvers;
  if (opts.onPendingCount) onCount = opts.onPendingCount;
  if (started) { emitCount(); return; }
  started = true;
  resume();
  timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
  tick();
  diag('watcher started');
}

function stop() {
  started = false;
  if (timer) { clearInterval(timer); timer = null; }
  inFlight.clear();
}

// Sign-out reset (FIX 1). Drop the in-memory pending records and zero the tray
// "Pending: N" so a stale count can't linger after sign-out. The DURABLE store is
// left untouched, so a genuinely-parked request still survives a later restart's
// resume(); this only clears the live in-memory view + the display. The watcher
// keeps running — its tick already self-gates on isSignedIn — so this is purely
// the display reset, not a teardown. A normal signed-in reconcile never calls it.
function reset() {
  records.clear();
  inFlight.clear();
  emitCount(); // records now empty → emits count 0
}

module.exports = {
  start,
  stop,
  reset,
  register,
  setPhase,
  toSession,
  toOutbound,
  settle: settleRequest,
  poke,
  has,
  isSettled,
  get,
  requestKey,
};
