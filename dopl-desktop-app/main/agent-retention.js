// THE SEVEN-DAY SWEEP — every artifact an ended agent leaves, cleaned in ONE pass.
//
// ⚠ THIS FILE EXISTS BECAUSE THE LIST IS THE HARD PART, NOT THE TIMER. An agent's traces are
// spread across five stores that grew independently, each keyed by the SAME session key
// (`<channelId>:<taskId>:<agentId>`), and a retention rule that cleans four of them is not a
// retention rule — it is a slow leak with a comforting name. The list is written out below,
// with the owner of each, so the next person to add a per-agent store has somewhere obvious to
// fail to add it.
//
// THE ARTIFACTS, MEASURED 2026-08-22 (`grep -rn "sessionKey\|slotKey\|s\.key" main/`):
//   1. `agent-history.js › agentHistory`     the frozen narration ring + identity + endedAt.
//                                            THE CLOCK LIVES HERE — its `sweep()` decides which
//                                            keys expired and every other store follows it.
//   2. `session-store.js › sessionRecords`   the durable record (phase, caps, counterparty).
//   3. `session-store.js › sessionIds`       the resume map (sdkSessionId per key). ⚠ THE ONE
//                                            THAT MATTERS MOST: it is what a resume would use
//                                            to re-attach an SDK conversation, and an ended
//                                            agent must never be resumable.
//   4. `session-summary.js › releaseEnded`   the in-memory projection's cache of ended cards.
//   5. `queued-notice.js › announced`        the "queued, not ignored" one-per-thread guard.
//
// ⚠ THREE MORE ARE KEYED BY THE SAME KEY AND ARE DELIBERATELY NOT SWEPT HERE, because they
// PRUNE THEMSELVES to the live set on every cycle and a second cleaner would be a second
// answer: `session-state-push.js › origin` and `› loggedAdHoc` (both pruned in `trackOrigin` /
// `reportable`), and `session-narration.js › dirty` (cleared on every flush).
// ⚠ `consent-watcher.js`'s records were keyed by `(channelId, seq)` — a REQUEST, not an agent —
// and settled on their own decision, so they were never per-agent artifacts and were never swept
// here. That module is DELETED with the inbound consent lane (2026-08-22); nothing replaced it,
// so there is no fourth self-pruning store to account for.
// ⚠ `ownPostIds` / `ownPostSeq` live ON the session object and die with it at `settle`; they
// are never persisted, so there is nothing to sweep.
//
// ⚠ CHANNEL MESSAGES ARE NOT ON THIS LIST AND NEVER WILL BE. What the agent POSTED is
// `channel_messages` on the server: the shared record, owned by the channel, read by both
// members. This sweep deletes a local VIEW of how work happened, never the work
// (INVARIANTS §11).

const agentHistory = require('./agent-history');
const { diag } = require('./diag');

// ⚠ DAILY, AND COARSE ON PURPOSE. The bound is seven days; sweeping hourly would buy accuracy
// nobody can perceive at the cost of a timer that wakes a mostly-idle app. A record that lives
// a few hours past its window is not a defect — `expired()` is the rule, this is only how often
// anybody asks.
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let timer = null;
// The stores this sweep cleans BESIDES the history file. Injected rather than required so this
// module stays a leaf and the suite can drive the real list against fakes.
let deps = { clearRecord: null, releaseEnded: null, forgetNotice: null };

/**
 * Bind the cleaners. ⚠ `bind` REBUILDS `deps` from a literal — an omitted cleaner is DROPPED
 * SILENTLY and its store leaks, which is exactly the failure this file is about. The
 * `session-reopen.js › bind` docblock records the same trap. Add the field HERE when the list
 * above grows.
 */
function bind(d) {
  deps = {
    clearRecord: (d && d.clearRecord) || null, // session-store: record + resume map, one key
    releaseEnded: (d && d.releaseEnded) || null, // session-summary: the projection's ended cache
    forgetNotice: (d && d.forgetNotice) || null, // queued-notice: the per-thread announce guard
  };
}

/**
 * ONE PASS. The history file decides WHICH keys expired (it owns `endedAt` and `RETENTION_MS`);
 * every other store is told. Returns the keys dropped.
 * ⚠ EACH CLEANER IS INDEPENDENTLY GUARDED. One throwing store must not abandon the rest
 * half-swept — a partial sweep that stops at the first failure leaves precisely the orphans
 * this exists to prevent, and it would leave them silently.
 */
function sweepNow(now) {
  let keys = [];
  try {
    keys = agentHistory.sweep(now);
  } catch (err) {
    diag('agent-retention: history sweep failed —', (err && err.message) || String(err));
    return [];
  }
  if (!keys.length) return [];
  for (const [name, fn] of [
    ['session record + resume map', deps.clearRecord],
    ['ended-card projection', deps.releaseEnded],
    ['queued-notice guard', deps.forgetNotice],
  ]) {
    if (typeof fn !== 'function') {
      diag('agent-retention: NO CLEANER BOUND for', name, '— that store is leaking keys');
      continue;
    }
    try { fn(keys); }
    catch (err) { diag('agent-retention:', name, 'cleaner threw —', (err && err.message) || String(err)); }
  }
  diag('agent-retention: swept', keys.length, 'ended agent(s) past the 7-day window');
  return keys;
}

/**
 * FORGET these keys NOW, whatever their age — the thread-delete cascade's entry point. A
 * deleted thread takes its agents' local history with it, which is the same statement
 * `deleteSessionStatesForThread` makes on the server.
 */
function forgetThread(channelId, taskId) {
  const prefix = String(channelId || '') + ':' + String(taskId || '') + ':';
  let keys = [];
  try { keys = agentHistory.keysForThread(prefix); }
  catch (_err) { return []; }
  if (!keys.length) return [];
  try { agentHistory.forget(keys); } catch (_err) { /* best effort */ }
  for (const fn of [deps.clearRecord, deps.releaseEnded, deps.forgetNotice]) {
    if (typeof fn !== 'function') continue;
    try { fn(keys); } catch (_err) { /* one store must not stop the others */ }
  }
  return keys;
}

/**
 * Arm the sweep: once at app start, then daily. Idempotent — a second `start()` does not stack
 * a second timer, which is the bug every interval in this tree has had to be written against.
 * ⚠ `unref` so a pending sweep never holds the process open at quit.
 */
function start() {
  sweepNow(Date.now());
  if (timer) return;
  timer = setInterval(() => sweepNow(Date.now()), SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { SWEEP_INTERVAL_MS, bind, sweepNow, forgetThread, start, stop };
