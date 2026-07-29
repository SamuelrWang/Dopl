// Channels listener — I/O layer (persistence + HTTP + identity + name cache).
//
// SPLIT NOTE (§2 refactor): extracted from channel-listener.js so that file
// could come under the 500-line cap. This module owns the cursor / seed /
// pending-consent stores, the listener's authenticated fetch + list helpers, the
// operator-identity resolution, and the requester/target display-name cache. It
// also owns the two HTTP-status flags those helpers set (`featureAvailable`,
// `staleNotified`) and the stale-session notification, so listWorkspaces /
// listChannels stay self-contained and this module never has to import back into
// channel-listener.js (no import cycle).
//
// Auth is via forwarded Supabase cookies (see auth.js for why not a bearer).

const { Notification } = require('electron');
const Store = require('electron-store');
const auth = require('./auth');
const { API_BASE, LISTENER, REALTIME } = require('./config');
const { diag } = require('./diag');

const store = new Store();
const nameCache = new Map(); // userId -> displayName, refreshed once per reconcile

let featureAvailable = true; // false once /api/channels 404s (feature not deployed)
let staleNotified = false; // one-shot guard for the "session expired" notification

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cursor + seed persistence ──────────────────────────────────────────────
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
// THE seed-vs-missed decision, isolated as a pure function so
// test/seed-decision.test.mjs can lock it without electron-store.
//
// Returns true → the channel loop starts in SEED mode (drain history quietly,
// no prompts); false → LIVE mode (every foreign message classified →
// trigger/fyi).
//
// Rule: seed mode is reserved for the VERY FIRST watch of a channel — the
// persisted `seeded` flag is false. Once the first backlog drain reaches the tip
// (markSeeded), the channel is NEVER re-seeded, so on a later run — a full
// quit+relaunch, or a wake after sleep — it starts LIVE and messages that
// arrived while the app was gone surface as real triggers instead of being
// swallowed as backlog. This is what makes offline catch-up correct.
//
// The persisted cursor deliberately does NOT flip a channel to live on its own:
// a channel interrupted MID-seed (seeded flag never set, cursor partially
// advanced through a large first-watch history) must keep seeding so the
// untouched remainder is not replayed as a burst of consent prompts. Only the
// seeded flag — set once the drain catches up to the tip — flips it to live.
// (Second arg is the cursor, accepted and intentionally ignored, so the test can
// assert cursor-independence.)
function seedModeFor(seeded /* , cursor */) {
  return !seeded;
}
// ─── END SEED-DECISION ───────────────────────────────────────────────────────

// ─── BEGIN CHEAP-AWAIT (pure; unit-tested via source extraction) ─────────────
// Push-transport loop helpers. When realtime is HEALTHY the loop does a cheap
// immediate catch-up (a tiny `/await` timeout → the server returns after one DB
// read, no held function) then a long interruptible idle a wake resolves early.
// When UNHEALTHY every value collapses to the held long-poll so the fallback
// path is BYTE-FOR-BYTE today's behavior (see awaitOrCheap / idleAfterAwait).
// Pure: no electron / store / fetch refs; timers are Node globals (injectable).

// The `/await?timeoutMs=` value: cheap when healthy, else today's held timeout.
function awaitTimeoutFor(healthy, cheapMs, heldMs) {
  return healthy ? cheapMs : heldMs;
}
// Our own fetch-abort timeout: short when healthy, else today's held value.
function fetchTimeoutFor(healthy, cheapMs, heldMs) {
  return healthy ? cheapMs : heldMs;
}
// The idle wait AFTER a cycle. Unhealthy → today's short gap between held polls
// (byte-for-byte). Healthy + still draining a batch → the same short gap (keep
// paging fast). Healthy + caught up → the LONG idle, which a wake interrupts.
function idleWaitFor(healthy, drained, idleGapMs, longIdleMs) {
  if (!healthy) return idleGapMs;
  return drained ? idleGapMs : longIdleMs;
}
// Interruptible sleep: resolves after `ms`, OR early when wakeEntry(entry) is
// called (a realtime INSERT wake). Stores the resolver on the entry so a wake
// settles it; clears the timer on either path. `timers` injectable for tests.
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
// Wake a channel: coalesce a burst to one catch-up (dirty flag), resolve any
// in-flight idle sleep, and abort any in-flight cheap await so it re-awaits from
// the cursor immediately. Safe to call whatever the entry is mid-doing.
function wakeEntry(entry) {
  if (!entry) return;
  entry.dirty = true;
  if (entry.sleepWaker) entry.sleepWaker();
  try { if (entry.awaitCtrl) entry.awaitCtrl.abort(); } catch (_) { /* already gone */ }
}
// ─── END CHEAP-AWAIT ─────────────────────────────────────────────────────────

// Whether a channel loop should start in seed mode, from persisted state.
function shouldSeed(channelId) {
  return seedModeFor(isSeeded(channelId), getCursor(channelId));
}

// NOTE (Round B): the per-channel `pendingConsent` store + its getPending /
// setPending / clearPending helpers were removed. Consent is now a DURABLE server
// row watched by consent-watcher.js, whose own persisted `channelWatched` /
// `channelSettled` stores are the crash-recovery + no-replay source of truth. Any
// legacy `pendingConsent` key left in electron-store is dead and simply ignored.

// ── Stale-session notification + feature-availability flag ───────────────────
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
// channelLoop resets this after a successful await so a later expiry re-notifies.
function resetStale() {
  staleNotified = false;
}
function isFeatureAvailable() {
  return featureAvailable;
}

// ── HTTP ────────────────────────────────────────────────────────────────────
async function apiFetch(pathname, opts = {}) {
  const { method = 'GET', workspaceId, body, timeoutMs, signal } = opts;
  const cookie = await auth.getAuthCookie();
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // One controller aborts the request. It fires on our own timeout AND on an
  // optional caller signal (the wake kick uses this to cut a healthy long-poll
  // short so it re-awaits from the persisted cursor immediately). Either way the
  // fetch rejects with AbortError, which the caller treats as a turnover.
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

// Health-gated await. Healthy → a cheap immediate catch-up (tiny timeoutMs, no
// held function); unhealthy → today's EXACT held long-poll (same URL + same
// fetch options, so the fallback is byte-for-byte). See the CHEAP-AWAIT block.
function awaitOrCheap(entry, since, healthy, signal) {
  const timeoutMs = awaitTimeoutFor(healthy, REALTIME.CHEAP_AWAIT_TIMEOUT_MS, LISTENER.AWAIT_TIMEOUT_MS);
  const fetchMs = fetchTimeoutFor(healthy, REALTIME.CHEAP_FETCH_TIMEOUT_MS, LISTENER.AWAIT_FETCH_TIMEOUT_MS);
  return apiFetch(
    `/api/channels/${entry.channel.id}/await?since=${since}&timeoutMs=${timeoutMs}`,
    { workspaceId: entry.workspaceId, timeoutMs: fetchMs, signal }
  );
}

// The idle wait after a cycle. Healthy + caught up → an interruptible long sleep
// (a realtime wake resolves it early); otherwise today's plain IDLE_GAP sleep.
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

async function listWorkspaces() {
  const res = await apiFetch('/api/workspaces', { timeoutMs: 15000 });
  if (res.status === 401) { notifyStale(); return null; }
  if (!res.ok) return [];
  return normalizeList(await res.json(), 'workspaces');
}

async function listChannels(workspaceId) {
  const res = await apiFetch('/api/channels', { workspaceId, timeoutMs: 15000 });
  if (res.status === 404) { featureAvailable = false; return []; }
  if (res.status === 401) { notifyStale(); return []; }
  if (!res.ok) return [];
  featureAvailable = true;
  return normalizeList(await res.json(), 'channels');
}

// ── Identity ─────────────────────────────────────────────────────────────────
// Resolve the operator's own user id so we never self-trigger. Layered so it
// works for BOTH deep-link sessions (stored JWT) and cookie-only web sign-ins
// (H2): (1) stored session blob, (2) the Supabase auth cookie's JWT `sub`,
// (3) the /api/workspaces/me whoami endpoint as a last resort.
async function resolveIdentity(preferWorkspaceId) {
  let id = auth.getUserId();
  diag('identity tier1 (stored blob):', id ? 'hit' : 'miss');
  if (!id) {
    id = await auth.getUserIdFromCookies();
    diag('identity tier2 (cookie jwt):', id ? 'hit' : 'miss');
  }
  if (!id) {
    try {
      const res = await apiFetch('/api/workspaces/me', {
        workspaceId: preferWorkspaceId,
        timeoutMs: 15000,
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.userId) id = d.userId;
      }
      diag('identity tier3 (whoami):', res.ok ? `hit ${res.status}` : `miss ${res.status}`);
    } catch (err) {
      diag('identity tier3 (whoami): error', err && err.message);
    }
  }
  return id || null;
}

// ── Display-name cache (Feature B/C) ─────────────────────────────────────────
// Requester + target names for notification copy. Filled once per workspace per
// reconcile from the workspace members listing. Falls back to 'A teammate'.
function displayNameFor(userId) {
  return (userId && nameCache.get(userId)) || 'A teammate';
}

async function refreshNameCache(ws) {
  // Canonical `{slug}-{publicId}` segment resolves by publicId (no legacy-slug
  // redirect event). Cookie-authed (withUserAuth); X-Workspace-Id is harmless.
  const segment = `${ws.slug}-${ws.publicId}`;
  try {
    const res = await apiFetch(`/api/workspaces/${encodeURIComponent(segment)}/members`, {
      workspaceId: ws.id,
      timeoutMs: 15000,
    });
    if (!res.ok) {
      diag('namecache miss', res.status, 'ws', ws.slug);
      return;
    }
    const members = normalizeList(await res.json(), 'members');
    for (const mem of members) {
      if (mem && mem.userId) {
        const dn = mem.displayName || mem.email || null;
        if (dn) nameCache.set(mem.userId, dn);
      }
    }
    diag('namecache loaded', members.length, 'ws', ws.slug);
  } catch (err) {
    diag('namecache error', err && err.message);
  }
}

module.exports = {
  sleep,
  getCursor,
  setCursor,
  isSeeded,
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
  normalizeList,
  listWorkspaces,
  listChannels,
  resolveIdentity,
  displayNameFor,
  refreshNameCache,
};
