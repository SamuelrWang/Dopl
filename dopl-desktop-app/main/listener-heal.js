// Reconcile self-heal for the Channels listener (Q4 fix 2).
//
// THE INCIDENT THIS EXISTS FOR. The desktop looked signed in — the web UI
// rendered on valid cookies — while the listener was fully dead: `realtime wake
// … (loop=miss)` for a channel nobody was watching, `want=0` persisting across
// reboots, and one boot where a single workspace's channel enumeration failed
// inside an expired-token window and was never retried (the name cache loaded 2
// of 3 workspaces and the third's channels simply vanished). Every one of those
// states was RECOVERABLE and none of them recovered, because reconcile treats a
// failed read as an authoritative empty answer and nothing re-asks.
//
// Three decisions live here, all bounded (F-072: no read-triggered writes on
// realtime tables, and no retry may become a storm):
//   (a) a realtime wake that finds NO loop for the channel → re-enumerate, at
//       most ONCE per window however many misses arrive, and at most
//       MISS_GIVE_UP_COUNT times in total for any one channel (S7);
//   (b) a per-workspace enumeration failure → a short bounded retry ladder, then
//       ONE follow-up reconcile, instead of dropping the workspace until reboot;
//   (c) `want=0` while a credential is live → re-apply the last known-good
//       workspace set immediately, rather than waiting for a pass that may fail.
//
// DEPENDENCY-FREE ON PURPOSE (no electron, no store, no diag): the whole module
// imports under `node --test`, so test/listener-heal.test.mjs exercises the real
// shipped code instead of a source-sliced copy. Logging and the reconcile call
// are injected.

// (a) At most one miss-triggered re-enumeration per window.
const MISS_RECONCILE_WINDOW_MS = 60_000;
// (a) …and at most this many miss-triggered passes for the SAME channel, ever
// (FIX S7). The window bounds the RATE but nothing bounded the TOTAL: a channel
// that legitimately has no loop — the operator was removed from it, it was
// archived out from under a still-subscribed Realtime topic, the DTO hides it —
// produced a full reconcile every 60 seconds for as long as the app ran, forever,
// because each pass correctly re-derives a set that still does not contain it.
// After this many the channel is parked: the 5-minute periodic reconcile still
// picks it up if it ever really returns, so this gives up on the SELF-HEAL, not on
// the channel.
const MISS_GIVE_UP_COUNT = 5;
// (b) Backoff ladder for retrying ONE workspace's channel enumeration inside a
// single reconcile pass. Two retries is enough to ride out a token-refresh
// window without holding the pass open for long.
const ENUM_RETRY_DELAYS_MS = [1_000, 3_000];
// (b) …and if it still failed, re-run the whole pass this soon, rather than
// waiting out LISTENER.CHANNEL_REFRESH_MS (5 min).
const ENUM_RETRY_RECONCILE_MS = 30_000;

// ── Pure decisions ──────────────────────────────────────────────────────────

// (a) Is a miss-triggered re-enumeration due? `lastAtMs` 0 means "never", which
// always admits — the first miss after start should re-enumerate immediately.
function missReconcileDue(nowMs, lastAtMs, windowMs) {
  if (!lastAtMs) return true;
  return nowMs - lastAtMs >= windowMs;
}

// (b) How long to wait before enumeration attempt `attempt+1`, or null when the
// ladder is exhausted and the caller must give up for this pass. The `ladder`
// parameter this took was DEAD — no caller and no test ever passed one, so it read
// as configurable while shipping exactly one ladder. Dropped rather than wired: the
// one caller (listener-io.listChannelsWithRetry) has no reason to vary it.
function enumerationRetryDelay(attempt) {
  const i = Number(attempt) || 0;
  return i >= 0 && i < ENUM_RETRY_DELAYS_MS.length ? ENUM_RETRY_DELAYS_MS[i] : null;
}

// (b) Whether a loop whose channel is absent from the freshly-enumerated
// `desired` set must be KEPT anyway. A workspace we FAILED to enumerate told us
// nothing about its channels, so treating its absence as "these channels are
// gone" is what silently killed a whole workspace's loops at 02:18. Only a
// workspace we successfully read may prune.
function keepLoopOnPrune(entryWorkspaceId, failedWorkspaceIds) {
  if (!failedWorkspaceIds || typeof failedWorkspaceIds.has !== 'function') return false;
  return failedWorkspaceIds.has(entryWorkspaceId);
}

// (c) Realtime's DESIRED workspace set is emptied by reconcile's signed-out
// branch and refilled only by a SUCCESSFUL enumeration pass. So one pass that
// looked signed out (a dead blob, an expired-token window) left `want=0` wedged
// with push dead — across reboots, since nothing re-derived it. When we are
// signed in, realtime wants nothing, and we DID have a workspace set, re-apply it
// now: before the fresh enumeration, which may itself fail.
function shouldReapplyWorkspaces(signedIn, wantCount, lastGoodCount) {
  return !!signedIn && (Number(wantCount) || 0) === 0 && (Number(lastGoodCount) || 0) > 0;
}

// ── Bounded scheduler ───────────────────────────────────────────────────────
// Owns the two "re-ask later" paths so channel-listener.js stays a thin caller.
// `run` is the listener's already-coalesced reconcile(); `log` is diag. `now` and
// `timers` are injected so the test drives a fake clock.
function createReconcileHealer(opts = {}) {
  const run = typeof opts.run === 'function' ? opts.run : () => {};
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const now = opts.now || Date.now;
  const T = opts.timers || { setTimeout, clearTimeout };
  const missWindowMs = opts.missWindowMs || MISS_RECONCILE_WINDOW_MS;
  const retryMs = opts.retryMs || ENUM_RETRY_RECONCILE_MS;
  const giveUpAfter = opts.giveUpAfter || MISS_GIVE_UP_COUNT;

  let lastMissAt = 0;
  let suppressedMisses = 0;
  let retryTimer = null;
  const missCounts = new Map(); // channelId -> miss-triggered passes run for it (S7)

  // A realtime INSERT woke a channel with NO loop. Re-enumerate — but only once
  // per window: a burst across several unwatched channels must produce ONE
  // reconcile, not one per channel. And only `giveUpAfter` times per channel in
  // total (FIX S7): re-deriving the same set a sixth time cannot produce a
  // different answer, so past that point the channel is parked and the periodic
  // reconcile is the only thing still looking for it.
  function onLoopMiss(channelId) {
    const key = String(channelId || '');
    const seen = missCounts.get(key) || 0;
    if (seen >= giveUpAfter) return false; // parked; already escalated below
    const t = now();
    if (!missReconcileDue(t, lastMissAt, missWindowMs)) {
      suppressedMisses += 1;
      return false;
    }
    lastMissAt = t;
    const held = suppressedMisses;
    suppressedMisses = 0;
    missCounts.set(key, seen + 1);
    log('reconcile self-heal: loop=miss', key.slice(0, 8),
      '— re-enumerating channels', held ? `(+${held} suppressed)` : '');
    if (seen + 1 >= giveUpAfter) {
      log('reconcile self-heal: GIVING UP on', key.slice(0, 8), 'after', giveUpAfter,
        'miss-triggered passes — no loop ever appeared for it; the periodic reconcile is now the only retry');
    }
    run();
    return true;
  }

  // A reconcile pass could not enumerate `failedCount` workspaces. Schedule ONE
  // follow-up pass; a second failing pass re-uses the pending timer, so this can
  // never stack into a reconcile storm.
  function onEnumerationFailure(failedCount) {
    if (!failedCount || retryTimer) return false;
    log('reconcile self-heal: retrying', failedCount, 'unenumerated workspace(s) in', `${retryMs}ms`);
    retryTimer = T.setTimeout(() => {
      retryTimer = null;
      run();
    }, retryMs);
    if (retryTimer && retryTimer.unref) retryTimer.unref();
    return true;
  }

  function pendingRetry() {
    return retryTimer !== null;
  }

  function stop() {
    if (retryTimer) { T.clearTimeout(retryTimer); retryTimer = null; }
    lastMissAt = 0;
    suppressedMisses = 0;
    missCounts.clear(); // S7: a restart is the operator's reset for a parked channel
  }

  return { onLoopMiss, onEnumerationFailure, pendingRetry, stop };
}

module.exports = {
  MISS_RECONCILE_WINDOW_MS,
  MISS_GIVE_UP_COUNT,
  ENUM_RETRY_DELAYS_MS,
  ENUM_RETRY_RECONCILE_MS,
  missReconcileDue,
  enumerationRetryDelay,
  keepLoopOnPrune,
  shouldReapplyWorkspaces,
  createReconcileHealer,
};
