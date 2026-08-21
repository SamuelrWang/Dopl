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

const auth = require('./auth');
const consent = require('./consent');
// §2 SPLIT (2026-08-08, C-7): the electron-store half — the two persisted maps, the durable
// projection and the settled-key TTL — lives in consent-store.js. This file is the poll loop.
const persist = require('./consent-store');
const {
  MAX_POLLS_PER_WINDOW,
  POLL_WINDOW_MS,
  nextPollDelay,
  nextScanDelay,
  recentPolls,
  pollAllowed,
  createScheduler,
} = require('./consent-cadence');
const { diag } = require('./diag');

// SCAN CADENCE (Q12 — request-volume diet, 2026-07-31). This used to be a flat
// `setInterval(tick, 2000)`: 1,800 wakeups/hour forever, each one decrypting the
// auth blob via `auth.isSignedIn()`, even with zero records to poll. The watcher
// is a FALLBACK — realtime wakes and the explicit `poke()`s from trigger.js are the
// primary signal (session-consent.js was the other poker and is deleted) — so the steady state should be slow
// and the fast cadence should be earned by recent activity.
//
// The scan is now self-scheduling and adaptive (see nextScanDelay): 3s for a short
// window after a wake / registration / decision, then it drifts out to the next
// record's own due time, capped at 30s. With no records it sits at 30s doing
// nothing. `poke()` snaps it back to fast, so nothing waits on the ladder.
//
// All of that lives in `./consent-cadence.js` — pure, no electron, and therefore
// directly `require`-able by test/consent-cadence.test.mjs.
//
// A record parked this long with no decision expires locally. 24h dwarfs the old
// 30-min ceiling, so a request answered hours later still resolves. It EQUALS the
// server's own CONSENT_TTL_MS and `createdAt` is stamped after the insert returns,
// so in practice this clock always notices first — which is why processRecord runs
// the SAME resolver the server's `expired` status would (C-7) rather than settling
// on its own. Raising it above the server's value would only change which of two
// identical paths runs; routing is what makes them identical.
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

// H2 — the two allows are the SAME action but NOT the same authority, and one thing
// depends on the difference: a stored permission arm may only be consumed by a human
// deciding right now. `allowed` is exactly that — a person clicked Allow on the web
// card or the native notification. `auto_allowed` is the server's STANDING trust for
// the channel, decided at some earlier time by rules, with no card in front of anyone.
// mapStatus deliberately keeps collapsing them (the spawn is identical); this is the
// one seam that must tell them apart, so it fails closed on anything it does not
// recognize as a live human decision.
function isHumanAllow(status) {
  return String(status || '') === 'allowed';
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
  return phase === 'await-inbound'; // ⚠ 'await-outbound' went with the headless lane (2026-08-20)
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
let scheduler = null;
let started = false;
// Timestamps of the consent GETs in the trailing POLL_WINDOW_MS (the rate cap).
let pollTimes = [];
let cappedAt = 0; // last time the cap bound, so the diag line is not spammed
// Last wake / registration / decision. Drives the fast cadence.
let lastActivityAt = 0;
// Injectable clock (Q12). Real timers by default; tests hand in a fake one.
let clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h),
};

// Every path that makes a decision imminent calls this: a new record, a poke from
// trigger.js (and, until it was deleted, session-consent.js), or a phase move. It arms the fast cadence AND
// re-arms an already-running scheduler so the change takes effect now, not after
// the currently-armed idle timer expires.
function markActivity() {
  lastActivityAt = clock.now();
  if (scheduler) scheduler.bump();
}

// ── Persistence (the store layer is consent-store.js) ────────────────────────
function persistRecords() {
  persist.saveWatched(records);
}
function persistSettled() {
  persist.saveSettled(settled);
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
  markActivity(); // a brand-new ask: arm the fast cadence
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

// ⚠ `toOutbound(key, {...})` STOOD HERE AND IS DELETED (2026-08-20, Samuel's ruling).
// It moved an approved request into an OUTBOUND-REVIEW phase, pointing at a second consent row
// and carrying the drafted reply so a restart could still post it on Send. Its sole writer was
// the `claude -p` headless lane (`trigger-headless.js › openOutboundReview`), which is deleted:
// that lane produced a reply as a STRING for the desktop to post on the agent's behalf, and the
// review was how a human got to see it first.
//
// ⚠ APPROVE-OUT ITSELF IS UNTOUCHED AND IS NOT THIS. A windowless session's own-channel post
// still bridges to an `outbound` consent row (`session-windowless.js › bridgeOutbound`) and is
// still answered in the thread view's send box. The difference is WHO POSTS THE BYTES: there the
// AGENT does, when its held tool call is released, and the row's whole lifecycle lives in the
// session rather than in this watcher. So `await-outbound` — a PHASE OF A WATCHED RECORD — has
// no writer left, while the `outbound` KIND is busier than ever.

// Terminal: record the outcome durably (so the request is never re-handled) and
// drop the record. THIS is the terminal-decision persistence that fixes replay.
function settleRequest(key, outcome) {
  settled[key] = { outcome, at: Date.now() };
  persistSettled();
  if (records.delete(key)) persistRecords();
  emitCount();
  diag('watcher settle', key.split(':')[0].slice(0, 8), 'seq', key.split(':')[1], '->', outcome);
}

// Force the given key (or all records) to be due, and run a scan now. This is the
// primary reaction path — every in-app decision routes through here — so the
// polling ladder below is genuinely a fallback, not the mechanism.
function poke(key) {
  if (key) {
    const rec = records.get(key);
    if (rec) rec.lastPolledAt = 0;
  } else {
    for (const rec of records.values()) rec.lastPolledAt = 0;
  }
  markActivity();
  tick();
}

// ── Poll loop ────────────────────────────────────────────────────────────────
function isDue(rec, now) {
  return now - rec.lastPolledAt >= nextPollDelay(now - rec.createdAt, now - lastActivityAt);
}

// When each pollable record next comes due — the input to the adaptive scan
// cadence. Session-phase records are engine-owned and never polled, so they must
// not hold the scheduler at a fast cadence.
function dueAts(now) {
  const out = [];
  for (const rec of records.values()) {
    if (isSessionPhase(rec.phase)) continue;
    out.push(rec.lastPolledAt + nextPollDelay(now - rec.createdAt, now - lastActivityAt));
  }
  return out;
}

function scanDelay(now) {
  return nextScanDelay(now, dueAts(now), lastActivityAt);
}

async function processRecord(key) {
  if (inFlight.has(key)) return;
  const rec = records.get(key);
  if (!rec) return;
  // A record handed to a live session window is engine-owned — never poll it.
  if (isSessionPhase(rec.phase)) return;
  const now = clock.now();
  if (!isDue(rec, now)) return;

  // Local expiry for a long-parked request (server may keep it pending forever).
  // Checked BEFORE the rate cap: it costs no request, and a capped watcher must
  // still be able to retire dead records.
  //
  // C-7 (2026-08-08) — IT GOES THROUGH THE SAME RESOLVER THE SERVER'S EXPIRY DOES.
  //
  // It used to `settleRequest(key, 'expired')` and RETURN, which drops the record and runs
  // nothing else. That looked like a rare fallback and is in fact the ONLY expiry path that
  // ever runs: MAX_WATCH_MS equals the server's own CONSENT_TTL_MS, and `rec.createdAt` is
  // stamped AFTER the insert returns, so the local clock is always the earlier of the two and
  // this branch wins every race. `inboundExpired` therefore never ran — and two things lived
  // inside it: `closeConsentWindow`, so a pre-consent window left open for 24h stayed open
  // FOREVER with a live Accept over a row the server had already expired, and
  // `clearPermissionPreset`, so the posture the operator armed for a request they then ignored
  // stayed armed for the NEXT launch in that channel.
  // ⚠ BOTH OF THOSE CONSEQUENCES ARE GONE WITH THEIR MECHANISMS (2026-08-20): the pre-consent
  // window with F-228, the arm with Samuel's ruling. They are recorded because the ROUTING is
  // what survived them and this is why it exists — a resolver that never runs is a resolver
  // whose contents nobody checks.
  //
  // Routing rather than re-implementing is the point: one definition of what an expiry does,
  // whichever clock notices it first. The resolvers settle the record themselves, so the belt
  // below only fires if one is missing or threw — a record must never survive its own expiry.
  if (now - rec.createdAt > MAX_WATCH_MS) {
    diag('watcher: LOCAL expiry (24h, no decision) —', key, 'phase', rec.phase);
    inFlight.add(key);
    try {
      await safeResolve('inboundExpired', rec);
    } catch (err) {
      diag('watcher: local-expiry resolver error', err && err.message);
    } finally {
      inFlight.delete(key);
    }
    if (records.has(key)) settleRequest(key, 'expired');
    return;
  }

  // Global rate ceiling. Skipping is safe: the record keeps its phase and its
  // lastPolledAt, so the next scan retries it — nothing is settled or lost.
  if (!pollAllowed(pollTimes, now)) {
    if (now - cappedAt > POLL_WINDOW_MS) {
      cappedAt = now;
      diag('watcher: poll rate cap hit —', MAX_POLLS_PER_WINDOW, 'polls/min; deferring', records.size, 'record(s)');
    }
    return;
  }
  pollTimes = recentPolls(pollTimes, now);
  pollTimes.push(now);

  inFlight.add(key);
  try {
    rec.lastPolledAt = clock.now();
    const status = await consent.pollStatus(rec.workspaceId, rec.rowId);
    const decision = mapStatus(status);
    if (decision === 'pending' || decision === 'unknown') return; // keep waiting

    // ⚠ ONE AWAITING PHASE LEFT (2026-08-20). The `await-outbound` arm went with the headless
    // lane that was its only writer; a windowless session's outbound row is polled by the
    // session itself (`session-windowless.js › watchRow`), never by this watcher.
    if (rec.phase === 'await-inbound') {
      // H2: the resolver used to be told WHO allowed this — a live human (`allowed`) or the
      // server's standing trust (`auto_allowed`) — because only the former could consume the
      // single-use permission ARM. ⚠ THE ARM IS DELETED (2026-08-20) and nothing reads the
      // distinction any more, so it is no longer passed. `isHumanAllow` survives BELOW, unused
      // by this file: the server still makes the distinction, it is the only statement of how
      // to read it, and the next thing that needs "was a human looking at this" should not
      // re-derive it from the status string.
      if (decision === 'allow') await safeResolve('inboundApproved', rec);
      else if (decision === 'deny') await safeResolve('inboundDenied', rec);
      else if (decision === 'expire') await safeResolve('inboundExpired', rec);
    }
  } catch (err) {
    diag('watcher: process error', err && err.message);
  } finally {
    inFlight.delete(key);
  }
}

async function safeResolve(name, rec, meta) {
  const fn = resolvers && resolvers[name];
  if (typeof fn !== 'function') {
    diag('watcher: no resolver for', name);
    return;
  }
  await fn(rec, meta || {});
}

function tick() {
  if (!started) return;
  if (!auth.isSignedIn()) return; // self-gate: no polling while signed out
  for (const key of Array.from(records.keys())) {
    processRecord(key).catch((err) => diag('watcher tick error', err && err.message));
  }
}

// ── Startup resume ───────────────────────────────────────────────────────────
function resume() {
  settled = persist.loadSettled();
  if (persist.pruneSettled(settled, Date.now())) persistSettled();
  const saved = persist.loadWatched();
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
// `opts.clock` (Q12) injects { now, setTimer, clearTimer } for tests; production
// callers pass only resolvers + onPendingCount and get real timers.
function start(opts = {}) {
  if (opts.resolvers) resolvers = opts.resolvers;
  if (opts.onPendingCount) onCount = opts.onPendingCount;
  if (opts.clock) clock = { ...clock, ...opts.clock };
  if (started) { emitCount(); return; }
  started = true;
  resume();
  // A fresh start counts as activity: resume() may have reloaded parked records
  // whose decisions landed while the app was closed.
  lastActivityAt = clock.now();
  scheduler = createScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayFor: scanDelay,
    onScan: tick,
  });
  scheduler.start();
  tick();
  diag('watcher started');
}

function stop() {
  started = false;
  if (scheduler) { scheduler.stop(); scheduler = null; }
  inFlight.clear();
  pollTimes = [];
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
  settle: settleRequest,
  poke,
  has,
  isSettled,
  get,
  isHumanAllow, // ⚠ NO production caller since the arm was deleted (2026-08-20) — kept as the one reading of `allowed` vs `auto_allowed`
  requestKey,
};
