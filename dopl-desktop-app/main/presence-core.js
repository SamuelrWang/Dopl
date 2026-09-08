// THE PRESENCE LOOP — Slack's active/away rule, as a pure injectable factory.
//
// SPLIT NOTE (2026-09-08): this is `presence.js`'s whole body, lifted behind a deps object so
// `node --test` can drive it. `presence.js` requires `./api` → `./auth` → `electron`, which does
// not import outside Electron; that is why this module had NO test for the fourteen months it
// carried the operator's own online dot. It has one now (`test/presence-core.test.mjs`), and the
// adapter left behind is wiring only.
//
// ═══ WHAT SAMUEL REPORTED, AND THE FOUR THINGS THAT CAUSED IT ═══════════════════════════════
//
// Verbatim (2026-09-08): *"in the members listings, sometimes i see myself go offline, even
// though my computer is on and dopl is open … It will like flicker back and forth occasionally.
// im assuming slack's active versus inactive is based on whether or not the user's desktop app
// is open and their device is on … we should mirror that. and we need to make sure the logic
// doesnt have failure points."*
//
//   1. ⚠ ONE POST PER CONTAINER, SERIALLY, 12s TIMEOUT EACH, ON A 30s INTERVAL. Samuel is in
//      13+ containers. Three slow posts outlast the interval, so the loop could not finish
//      inside its own period — and it got WORSE the more rooms he joined, which is the property
//      that makes this a design bug and not a tuning one. FIXED: one user-scoped POST per tick
//      (`POST /api/channels/presence/all`), which stamps every container in one statement.
//   2. ⚠ `beating` SKIPPED THE WHOLE TICK while the previous cycle ran, so a slow cycle
//      guaranteed the NEXT beat never happened either — the rows aged out precisely when the
//      network was already unhappy. FIXED: ABORT-NOT-SKIP. A tick cancels its predecessor and
//      sends a fresh beat; a heartbeat has no value in duplicate, and even less in absence.
//   3. ⚠ A 401 `return`ED OUT OF THE WHOLE CYCLE, so one stale-credential moment took every
//      remaining container offline for the rest of the period. FIXED below — see `note401`.
//   4. ⚠ NO IDLE / SLEEP / LOCK SEMANTICS AT ALL. The heartbeat asserted "online" for as long
//      as the process lived. FIXED: the posture is computed on every tick, and the adapter
//      pushes an immediate `away` on suspend / lock-screen / shutdown / quit.
//
// ═══ THE POSTURE ════════════════════════════════════════════════════════════════════════════
//
// ACTIVE  = app open AND machine awake/unlocked AND some input within IDLE_AWAY_MS.
// AWAY    = anything else. There is no manual override (out of scope, 2026-09-08).
//
// ⚠ AN UNAVAILABLE IDLE READING IS `active`, NOT `away`. `powerMonitor.getSystemIdleTime()` can
// throw on a headless/CI Electron, and a presence system that answers "away" when it cannot
// measure would put every such machine permanently offline. The app being OPEN is the base
// fact; idle only ever demotes a fact we could measure.

const HEARTBEAT_MS = 30 * 1000;
// ⚠ JITTER IS NOT COSMETIC. Every desktop of every operator boots its interval from the same
// kind of event (login, wake), so an un-jittered 30s cadence re-synchronises whole fleets onto
// one second of every thirty — and `agent_presence` is a PUBLISHED table, so each of those
// writes fans out through realtime. ±3s spreads it without moving the mean.
const JITTER_MS = 3000;
const UNAVAILABLE_BACKOFF_MS = 5 * 60 * 1000; // an endpoint that 404s
const HTTP_TIMEOUT_MS = 12000;
// ⚠ THE FINAL `away` GETS A SHORT LEASH ON PURPOSE. It runs during quit/suspend, where the OS
// is already taking the process apart; a 12s post there is a hang the operator watches.
const AWAY_TIMEOUT_MS = 3000;
const RETRY_AFTER_MS = 5000; // one retry, after a NETWORK failure only
const IDLE_AWAY_MS = 30 * 60 * 1000; // Slack's threshold

const ALL_PATH = '/api/channels/presence/all';
const ONE_PATH = '/api/channels/presence';

/**
 * @param {object} deps
 *  - apiFetch(path, opts)  the shared authenticated transport (401 repair included)
 *  - discardBody(res)      release an unread body (the 17 GB dev incident — api-repair.js)
 *  - isSignedIn()          boolean
 *  - idleSeconds()         seconds since last input, or null when unmeasurable
 *  - now()                 ms
 *  - setTimer/clearTimer   scheduling (injected so a test owns the clock)
 *  - diag(...)             logging
 *  - random()              [0,1) for the jitter
 */
function createPresence(deps) {
  const {
    apiFetch, discardBody, isSignedIn, idleSeconds,
    now = () => Date.now(),
    setTimer = setTimeout, clearTimer = clearTimeout,
    diag = () => {}, random = Math.random,
  } = deps;

  let timer = null;
  let started = false;
  let paused = false; // suspended / screen locked — the loop stands down
  let workspaceIds = [];
  let unavailableUntil = 0; // presence is not deployed at all (the per-workspace 404)
  let allUnavailableUntil = 0; // the user-scoped arm is not deployed (its own 404)
  let inFlight = null; // AbortController of the beat currently running
  let retryTimer = null;

  function setWorkspaces(ids) {
    workspaceIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  }

  /** The Slack rule, evaluated fresh on every tick. */
  function posture() {
    if (paused) return 'away';
    let idle = null;
    try { idle = idleSeconds(); } catch (_) { idle = null; }
    if (typeof idle !== 'number' || Number.isNaN(idle)) return 'active'; // see header
    return idle * 1000 >= IDLE_AWAY_MS ? 'away' : 'active';
  }

  // ⚠ A 401 HERE HAS ALREADY BEEN REPAIRED AND RETRIED — `api-repair.js ›
  // fetchWithAuthRepair` wraps every `apiFetch`, forces ONE single-flighted rotation through the
  // token authority, writes the fresh session back into the jar and retries exactly once. So a
  // 401 that reaches this function is a REAL authorization answer (revoked session, identity
  // mismatch), and re-running the repair here would be the third divergent copy of it — the
  // exact defect that module was created to end.
  //
  // ⚠ WHAT CHANGED IS THAT IT NO LONGER ABANDONS ANYTHING. The old code `return`ed out of the
  // cycle, so one 401 cost every not-yet-posted container a full period offline. There is one
  // POST per tick now, and the fallback loop below is `allSettled`, so a 401 costs exactly the
  // beat it happened on. The next tick is 30s away and the online window is four beats.
  function note401(where) {
    diag('presence: 401 after repair —', where, '(next tick retries; nothing skipped)');
  }

  /** One POST. Returns 'ok' | 'unavailable' | 'auth' | 'error'. Never throws. */
  async function post(path, body, { workspaceId, timeoutMs, signal } = {}) {
    let res;
    try {
      res = await apiFetch(path, {
        method: 'POST',
        body,
        noStore: true,
        timeoutMs: timeoutMs || HTTP_TIMEOUT_MS,
        ...(workspaceId ? { workspaceId } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      // An AbortError here is USUALLY our own successor tick cancelling us, which is the
      // designed path and not a failure — say so, so the diag log stops reading like a storm.
      const aborted = err && (err.name === 'AbortError' || /abort/i.test(err.message || ''));
      diag('presence: beat', aborted ? 'superseded' : 'error', err && err.message);
      return aborted ? 'aborted' : 'error';
    }
    // ⚠ A HEARTBEAT READS NO BODY ON ANY BRANCH — the SUCCESS one included — so every beat used
    // to abandon an undici response and pin its socket (`api-repair.js › discardBody`). One per
    // workspace every 30s, for the life of the process, was the steadiest leak in the app
    // precisely because nothing about it ever failed. (2026-08-30, the 17 GB dev incident.)
    discardBody(res);
    if (res.status === 404) return 'unavailable';
    if (res.status === 401) { note401(path); return 'auth'; }
    if (!res.ok) { diag('presence: beat failed', res.status, path); return 'error'; }
    return 'ok';
  }

  /** The per-workspace fallback — ⚠ PARALLEL, never the old serial walk. */
  async function beatEachWorkspace(status, signal) {
    if (!workspaceIds.length) return 'ok';
    const results = await Promise.allSettled(
      workspaceIds.map((wsId) =>
        post(ONE_PATH, { status }, { workspaceId: wsId, signal })
      )
    );
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : 'error'));
    // ⚠ ONLY AN ALL-404 ANSWER MEANS "NOT DEPLOYED". One 404 among many used to back the whole
    // feature off for five minutes; that is a per-container answer, not a per-feature one.
    if (outcomes.length && outcomes.every((o) => o === 'unavailable')) return 'unavailable';
    return outcomes.some((o) => o === 'ok') ? 'ok' : outcomes[0] || 'error';
  }

  async function beatOnce(status, signal) {
    if (now() < unavailableUntil) return 'unavailable'; // presence not deployed at all
    if (now() >= allUnavailableUntil) {
      const outcome = await post(ALL_PATH, { status }, { signal });
      if (outcome !== 'unavailable') return outcome;
      // ⚠ BACKED OFF, NOT LATCHED. The migration behind this arm is written-not-applied (§12),
      // so the answer flips from 404 to 200 the moment the Desktop Agent applies it — a latch
      // would keep this machine on the slow path until it was restarted.
      allUnavailableUntil = now() + UNAVAILABLE_BACKOFF_MS;
      diag('presence: /presence/all 404 (not deployed) — per-workspace fallback for 5m');
    }
    const outcome = await beatEachWorkspace(status, signal);
    if (outcome === 'unavailable') {
      unavailableUntil = now() + UNAVAILABLE_BACKOFF_MS;
      diag('presence: endpoint 404 (not deployed) — backing off 5m');
    }
    return outcome;
  }

  /**
   * ⚠ ABORT-NOT-SKIP. The predecessor is cancelled rather than waited for, because the ONLY
   * reason a beat is still running at the next tick is that the network is slow — which is
   * exactly when a fresh beat matters and a stale one is worthless.
   */
  async function beat({ retry = true } = {}) {
    if (!isSignedIn()) return 'signed-out';
    if (inFlight) {
      try { inFlight.abort(); } catch (_) { /* already gone */ }
      diag('presence: superseding the in-flight beat');
    }
    const ctrl = new AbortController();
    inFlight = ctrl;
    let outcome;
    try {
      outcome = await beatOnce(posture(), ctrl.signal);
    } finally {
      if (inFlight === ctrl) inFlight = null;
    }
    // ⚠ ONE RETRY, AND ONLY FOR A NETWORK FAILURE. A 404 is backed off, a 401 is a real answer,
    // and an abort was deliberate — retrying any of those is a spin. Bounded by construction:
    // `retry:false` on the retry itself, and the timer is cleared by `stop`.
    if (outcome === 'error' && retry && !ctrl.signal.aborted) {
      if (retryTimer) clearTimer(retryTimer);
      retryTimer = setTimer(() => {
        retryTimer = null;
        beat({ retry: false }).catch(() => {});
      }, RETRY_AFTER_MS);
      if (retryTimer && retryTimer.unref) retryTimer.unref();
    }
    return outcome;
  }

  function nextDelay() {
    return HEARTBEAT_MS + Math.round((random() * 2 - 1) * JITTER_MS);
  }

  // A SELF-RESCHEDULING TIMEOUT, NOT `setInterval` — the jitter has to be re-rolled per tick,
  // and an interval whose callback outlives its period stacks callbacks in Node.
  function arm() {
    if (timer) clearTimer(timer);
    timer = setTimer(function tick() {
      timer = null;
      arm();
      beat().catch(() => {});
    }, nextDelay());
    if (timer && timer.unref) timer.unref();
  }

  function start() {
    if (started) return;
    started = true;
    paused = false;
    beat().catch(() => {});
    arm();
    diag('presence: started (30s ±3s heartbeat, one POST per tick)');
  }

  /** powerMonitor resume / unlock — assert `active` NOW and re-arm if the timer was lost. */
  function wake() {
    paused = false;
    if (!started) { start(); return Promise.resolve('started'); }
    arm();
    diag('presence: re-armed after wake');
    return beat().catch(() => 'error');
  }

  /**
   * powerMonitor suspend / lock-screen / shutdown — post `away` NOW and stand the loop down.
   *
   * ⚠ BEST-EFFORT ON A SHORT LEASH, AND IT MUST NOT BE AWAITED BY ANYTHING THAT CAN BLOCK THE
   * SUSPEND. If it does not land, the server's own window takes the row offline four beats
   * later; the post only buys immediacy.
   */
  function sleep(reason) {
    paused = true;
    if (timer) { clearTimer(timer); timer = null; }
    if (retryTimer) { clearTimer(retryTimer); retryTimer = null; }
    if (inFlight) { try { inFlight.abort(); } catch (_) { /* gone */ } inFlight = null; }
    diag('presence: away —', reason);
    if (!isSignedIn()) return Promise.resolve('signed-out');
    return postAway();
  }

  function postAway() {
    if (now() < unavailableUntil) return Promise.resolve('unavailable');
    const path = now() >= allUnavailableUntil ? ALL_PATH : null;
    if (path) {
      return post(path, { status: 'away' }, { timeoutMs: AWAY_TIMEOUT_MS })
        .then((o) => (o === 'unavailable'
          ? beatEachWorkspace('away', undefined)
          : o))
        .catch(() => 'error');
    }
    return beatEachWorkspace('away', undefined).catch(() => 'error');
  }

  /**
   * Shutdown. ⚠ RETURNS THE `away` POST so the caller can give it a bounded moment
   * (`quit-guard.js › teardown` races it inside FLUSH_DEADLINE_MS). Never awaited by
   * `channel-listener.js › stop`, which is synchronous by contract.
   */
  function stop() {
    const wasStarted = started;
    started = false;
    if (timer) { clearTimer(timer); timer = null; }
    if (retryTimer) { clearTimer(retryTimer); retryTimer = null; }
    if (inFlight) { try { inFlight.abort(); } catch (_) { /* gone */ } inFlight = null; }
    diag('presence: stopped');
    if (!wasStarted || !isSignedIn()) return Promise.resolve('signed-out');
    return postAway();
  }

  return {
    start, stop, wake, sleep, setWorkspaces,
    // exposed for the tests and for diag only — never a control surface
    _posture: posture,
    _beat: beat,
  };
}

module.exports = {
  createPresence,
  HEARTBEAT_MS,
  JITTER_MS,
  IDLE_AWAY_MS,
  UNAVAILABLE_BACKOFF_MS,
  AWAY_TIMEOUT_MS,
  RETRY_AFTER_MS,
  ALL_PATH,
  ONE_PATH,
};
