// The channels listener's I/O layer: cursor/seed persistence, the authenticated fetch, and workspace/channel
// enumeration. It owns the two HTTP-status flags those helpers set and never imports channel-listener.js back;
// `listener-people.js` reaches `apiFetch`/`normalizeList` back lazily. Auth is forwarded Supabase cookies.

const { Notification } = require('electron');
const Store = require('electron-store');
const auth = require('./auth');
const appVersion = require('./app-version');
const sessionStamp = require('./session-id-header');
const heal = require('./listener-heal');
const { fetchWithAuthRepair, discardBody } = require('./api-repair');
const budget = require('./listener-budget');
const { API_BASE, LISTENER, REALTIME } = require('./config');
const { diag } = require('./diag');
// Who the operator is and who the peers are (display names), re-exported below as its own function objects.
const people = require('./listener-people');

const store = new Store();

let featureAvailable = true;
let staleNotified = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getCursor(channelId) {
  const c = store.get('cursors') || {};
  return c[channelId] || 0;
}
function setCursor(channelId, seq) {
  const c = store.get('cursors') || {};
  c[channelId] = seq;
  store.set('cursors', c);
}
function isSeeded(channelId) {
  const s = store.get('seeded') || {};
  return !!s[channelId];
}
function markSeeded(channelId) {
  const s = store.get('seeded') || {};
  s[channelId] = true;
  store.set('seeded', s);
}

// ─── BEGIN SEED-DECISION (pure; unit-tested via source extraction) ───────────
// SEED mode (drain history quietly) only on the very first watch of a channel; once the first drain reaches the
// tip the channel is never re-seeded, so messages that arrived while the app was gone surface as triggers. The
// cursor alone never flips a channel to live: one interrupted MID-seed keeps seeding.
function seedModeFor(seeded) {
  return !seeded;
}
// ─── END SEED-DECISION ───────────────────────────────────────────────────────

// ─── BEGIN CHEAP-AWAIT (pure; unit-tested via source extraction) ─────────────

// Push-transport loop helpers: healthy realtime -> a cheap catch-up await then a long interruptible idle;
// unhealthy -> the held long-poll, byte-for-byte. Timers are injectable.

// Wrapped so a blown await budget is logged; the classification is `listener-budget.js`'s.
function isWakeAbort(err, signal, channelId) {
  if (budget.isWakeAbort(err, signal)) return true;
  if (err && err.name === 'AbortError') {
    diag('await budget expired', String(channelId || '?').slice(0, 8), '— backing off');
  }
  return false;
}

// Unhealthy or still draining -> the short gap; healthy and caught up -> the long idle a wake interrupts.
function idleWaitFor(healthy, drained, idleGapMs, longIdleMs) {
  if (!healthy) return idleGapMs;
  return drained ? idleGapMs : longIdleMs;
}
// An interruptible sleep: a realtime wake resolves it early; the timer is cleared on either path.
function sleepOrWake(entry, ms, timers) {
  const T = timers || { setTimeout, clearTimeout };
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      T.clearTimeout(timer);
      entry.sleepWaker = null;
      resolve();
    };
    const timer = T.setTimeout(finish, ms);
    entry.sleepWaker = finish;
  });
}
// Coalesce a burst to one catch-up: mark dirty, end any idle sleep, abort any in-flight cheap await.
function wakeEntry(entry) {
  if (!entry) return;
  entry.dirty = true;
  if (entry.sleepWaker) entry.sleepWaker();
  try { if (entry.awaitCtrl) entry.awaitCtrl.abort(); } catch (_) { /* already gone */ }
}
// ─── END CHEAP-AWAIT ─────────────────────────────────────────────────────────

function shouldSeed(channelId) {
  return seedModeFor(isSeeded(channelId));
}

function notifyStale() {
  if (staleNotified) return;
  staleNotified = true;
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Dopl',
        body: 'Your session expired. Open Dopl and sign in to resume channel listening.',
      }).show();
    }
  } catch (_) { /* best-effort */ }
}
// The listen loop resets this after a successful await, so a later expiry notifies again.
function resetStale() {
  staleNotified = false;
}
function isFeatureAvailable() {
  return featureAvailable;
}

// ONE attempt, split out so the 401 repair can run it twice with a repaired jar (every call re-reads the
// cookie). The cookie read is bounded upstream, before the controller arms (F-700).
async function sendOnce(pathname, opts) {
  const { method = 'GET', workspaceId, body, timeoutMs, signal, sessionId } = opts;
  const cookie = await auth.getAuthCookie();
  // `X-Dopl-Runtime: desktop-session` marks these posts as written by Dopl about sessions it spawned; without it
  // the server badged every lifecycle row "outside session". A routing hint, not authorization. Spelled INLINE:
  // suites brace-extract this function, so a module-scope constant would be undefined there.
  const headers = { Accept: 'application/json', ...appVersion.versionHeaders(), ...sessionStamp.sessionHeaders(sessionId), 'X-Dopl-Runtime': 'desktop-session' };
  if (cookie) headers.Cookie = cookie;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // One controller: our own timeout AND the caller's signal (a wake kick cutting a long-poll short) both abort it;
  // the caller reads the AbortError as a turnover.
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(`${API_BASE}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The shared 401 repair (`api-repair.js`: one single-flighted rotation, written back, retried once); the send
// stays ours because the abort signal and the timeouts are. An abort between attempts still rejects as AbortError.
function apiFetch(pathname, opts = {}) {
  return fetchWithAuthRepair('listener', pathname, () => sendOnce(pathname, opts));
}

// Healthy -> a cheap immediate catch-up; unhealthy -> the exact held long-poll.
function awaitOrCheap(entry, since, healthy, signal) {
  const timeoutMs = budget.awaitTimeoutFor(healthy, REALTIME.CHEAP_AWAIT_TIMEOUT_MS, LISTENER.AWAIT_TIMEOUT_MS);
  const fetchMs = budget.fetchTimeoutFor(healthy, REALTIME.CHEAP_FETCH_TIMEOUT_MS, LISTENER.AWAIT_FETCH_TIMEOUT_MS);
  return apiFetch(
    `/api/channels/${entry.channel.id}/await?since=${since}&timeoutMs=${timeoutMs}`,
    { workspaceId: entry.workspaceId, timeoutMs: fetchMs, signal }
  );
}

function idleAfterAwait(entry, healthy, drained) {
  const ms = idleWaitFor(healthy, drained, LISTENER.IDLE_GAP_MS, REALTIME.LONG_IDLE_MS);
  if (healthy && !drained) return sleepOrWake(entry, ms);
  return sleep(ms);
}

function normalizeList(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

// NULL means "could not ask" (401 / non-OK), never "no workspaces": reconcile keeps every loop on null, and []
// would prune them all. Every exit logs, and the body is released before every early return (undici pool).
async function listWorkspaces() {
  const res = await apiFetch('/api/workspaces', { timeoutMs: 15000 });
  if (res.status === 401) {
    discardBody(res);
    notifyStale();
    diag('listWorkspaces 401 — session stale even after the repair; NO workspaces this pass,',
      'so presence, push and every channel loop are starved until one succeeds');
    return null;
  }
  if (!res.ok) { discardBody(res); diag('listWorkspaces', res.status); return null; }
  return normalizeList(await res.json(), 'workspaces');
}

// An ARRAY, or NULL when this workspace could not be enumerated (401 / 5xx / network / parse). A 404 is a real
// answer (the feature is not deployed) and stays []. `outcome.authFailure` marks a 401 for this call only, so
// the retry refreshes the session only then (Supabase rotates the refresh token on use) (FIX S6).
async function listChannels(workspaceId, outcome) {
  const short = String(workspaceId).slice(0, 8);
  let res;
  try {
    res = await apiFetch('/api/channels', { workspaceId, timeoutMs: 15000 });
  } catch (err) {
    diag('listChannels error ws', short, err && err.message);
    return null;
  }
  if (res.status === 404) { discardBody(res); featureAvailable = false; return []; }
  if (res.status === 401) { discardBody(res); if (outcome) outcome.authFailure = true; notifyStale(); diag('listChannels 401 ws', short); return null; }
  if (!res.ok) { discardBody(res); diag('listChannels', res.status, 'ws', short); return null; }
  try {
    const list = normalizeList(await res.json(), 'channels');
    featureAvailable = true;
    return list;
  } catch (err) {
    diag('listChannels parse error ws', short, err && err.message);
    return null;
  }
}

// A bounded, serial retry ladder (never concurrent, F-072); only an auth-shaped failure repairs the session first.
async function listChannelsWithRetry(workspaceId) {
  for (let attempt = 0; ; attempt += 1) {
    const outcome = {};
    const chans = await listChannels(workspaceId, outcome);
    if (chans !== null) return chans;
    const authShaped = outcome.authFailure === true;
    const delay = heal.enumerationRetryDelay(attempt);
    if (delay == null) {
      diag('listChannels gave up ws', String(workspaceId).slice(0, 8), 'after', attempt + 1, 'tries');
      return null;
    }
    if (authShaped) {
      try {
        const s = await auth.ensureFresh();
        if (s) await auth.writeSessionCookies(s);
      } catch (err) {
        diag('listChannels retry refresh error', err && err.message);
      }
    }
    await sleep(delay);
  }
}

module.exports = {
  sleep,
  getCursor,
  setCursor,
  markSeeded,
  seedModeFor,
  shouldSeed,
  notifyStale,
  resetStale,
  isFeatureAvailable,
  apiFetch,
  awaitOrCheap,
  idleAfterAwait,
  sleepOrWake,
  wakeEntry,
  // Re-exported so the listen loop releases the bodies it never reads.
  discardBody,
  isWakeAbort,
  normalizeList,
  listWorkspaces,
  listChannels,
  listChannelsWithRetry,
  // listener-people.js's OWN function objects (one instance of the member caches).
  resolveOperatorUserId: people.resolveOperatorUserId,
  displayNameFor: people.displayNameFor,
  refreshNameCache: people.refreshNameCache,
};
