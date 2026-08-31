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
const appVersion = require('./app-version');
const heal = require('./listener-heal');
const { fetchWithAuthRepair, discardBody } = require('./api-repair');
const budget = require('./listener-budget'); // poll budgets + what an abort means (split 2026-08-30)
const { API_BASE, LISTENER, REALTIME } = require('./config');
const { diag } = require('./diag');

const store = new Store();
const nameCache = new Map(); // userId -> displayName, refreshed once per reconcile
const avatarUrlCache = new Map(); // userId -> avatarUrl (item 1/5/6), refreshed with the name cache

/**
 * ⚠ THE ONLY TWO CACHES IN `main/` WITH NO BOUND AT ALL (2026-08-30, swept out during the 17 GB
 * dev incident): no cap, no TTL, no `delete`, no `clear` — every member of every workspace ever
 * enumerated stayed for the life of the process. Every comparable structure here already carries
 * one (`avatar-cache.js › MAX_CACHE`, `legacy-threads.js › LEGACY_THREAD_CAP`,
 * `session-wake-tiers.js › MAX_CHANNELS`, `version-skew.js › SEEN_CAP`, `agent-names.js ›
 * MAX_NAMES`). ⚠ NOT what ate the 17 GB — that was `session-narration.js`'s per-flush fan-out
 * and abandoned `fetch` bodies — and bounded anyway, so nobody has to re-derive "how many members
 * could this operator see" the next time a workspace is added.
 * ⚠ OLDEST-OUT (insertion order) IS THE RIGHT EVICTION rather than an LRU because
 * `refreshNameCache` REWRITES every member it sees once per reconcile: a still-watched
 * workspace's members are re-inserted continuously, one the operator left never is. A miss is
 * not a failure — `displayNameFor` answers 'A teammate'. Pinned by test/listener-name-cache.test.mjs.
 */
const MAX_CACHED_MEMBERS = 1000;

function cacheMember(cache, userId, value) {
  if (cache.has(userId)) cache.delete(userId); // re-insert so the order is "last seen"
  cache.set(userId, value);
  while (cache.size > MAX_CACHED_MEMBERS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

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

// A PER-CHANNEL TEAM-AGENT COUNT lived here (FIX B1): the last known number of this
// operator's summoned agents in a channel, persisted beside the cursors because
// `targeting.classify` gated the "address to act" law on it and a roster read could fail.
// Summoning is gone (channels rollback §1) and so is the law, the count and its two
// accessors. Any `teamAgents` key still in the store is inert; nothing reads it.

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

// ⚠ WRAPPED, NOT RE-EXPORTED BARE, so a blown budget is OBSERVABLE: "this channel quietly
// stopped answering" is precisely the failure the 17 GB incident had no log line for. The
// DECISION stays pure next door; only the diagnostic lives here.
function isWakeAbort(err, signal, channelId) {
  if (budget.isWakeAbort(err, signal)) return true;
  if (err && err.name === 'AbortError') {
    diag('await budget expired', String(channelId || '?').slice(0, 8), '— backing off');
  }
  return false;
}

// ⚠ THE TWO TIMEOUT SELECTORS + THEIR NAMED FLOORS LEFT FOR `listener-budget.js` ON 2026-08-30
// (the 17 GB dev incident), with `isWakeAbort` — the one question this loop's catch block has to
// answer correctly. Read that file for the floors' argument and the abort-classification story;
// it is dependency-free, so its test `require`s it instead of slicing it out of here.
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

// NOTE (Round B): the per-channel `pendingConsent` store + its getPending / setPending /
// clearPending helpers were removed, and their replacement has now been removed too.
// ⚠ THE REPLACEMENT WAS `consent-watcher.js`'s `channelWatched` / `channelSettled` stores (a
// durable inbound consent row plus a no-replay settled set), and the whole inbound lane is
// DELETED — 2026-08-22, Samuel's ruling; `main/trigger.js`'s header carries it. THREE dead
// electron-store keys therefore survive on shipped machines and are simply ignored:
// `pendingConsent`, `channelWatched`, `channelSettled`. Nothing reads any of them; a reader
// added back would resurrect a decision surface that no longer exists.

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
// ONE attempt. Split out of apiFetch so the 401 repair below can run it twice
// with a jar it repaired in between — every call re-reads `getAuthCookie()`, so
// the retry genuinely carries a different credential. The request itself is
// unchanged: same headers, same abort wiring, same timeout semantics the
// long-poll depends on.
async function sendOnce(pathname, opts) {
  const { method = 'GET', workspaceId, body, timeoutMs, signal } = opts;
  const cookie = await auth.getAuthCookie();
  // Q10: this build's version rides on the TRANSPORT (see api.js for the same
  // line, and app-version.js for why the header — not the body — carries it).
  // channel-post.js posts every task lifecycle event and headless reply through
  // here, so those are the messages a peer can read a version off.
  const headers = { Accept: 'application/json', ...appVersion.versionHeaders() };
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

// THE REPAIR THE LISTENER NEVER HAD (the 1.8.x Channels outage). This file kept
// its own bare cookie fetch while api.js was given a 401 repair, so on the
// bundled SPA — where nothing keeps the Supabase cookie jar fresh and
// `getAuthCookie()` only repairs an EMPTY jar, never a STALE one — every Channels
// call died on an expired credential: listWorkspaces, listChannels, the `/await`
// long-polls, channel-post's lifecycle posts, the roster, threads, consent. It
// recovered only when some other api.js caller happened to 401 and repair the
// shared jar first. api-repair.js is now the ONE copy of that rule (force one
// single-flighted rotation, write it back to the jar, retry EXACTLY once); the
// send above stays ours, because the abort signal and the timeouts are.
//
// An abort between the two attempts (a wake kick, our own timeout) rejects out of
// here as AbortError exactly as before — channelLoop still reads that as turnover.
function apiFetch(pathname, opts = {}) {
  return fetchWithAuthRepair('listener', pathname, () => sendOnce(pathname, opts));
}

// Health-gated await. Healthy → a cheap immediate catch-up (tiny timeoutMs, no
// held function); unhealthy → today's EXACT held long-poll (same URL + same
// fetch options, so the fallback is byte-for-byte). See the CHEAP-AWAIT block.
function awaitOrCheap(entry, since, healthy, signal) {
  const timeoutMs = budget.awaitTimeoutFor(healthy, REALTIME.CHEAP_AWAIT_TIMEOUT_MS, LISTENER.AWAIT_TIMEOUT_MS);
  const fetchMs = budget.fetchTimeoutFor(healthy, REALTIME.CHEAP_FETCH_TIMEOUT_MS, LISTENER.AWAIT_FETCH_TIMEOUT_MS);
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

// NULL means "could not ask" (401 / non-OK), NOT "you are in no workspaces".
// reconcile treats null as abort-this-pass and keeps every existing loop; an
// empty array would prune them all.
//
// THE 401 BRANCH LOGGED NOTHING, and that silence is why the 1.8.x outage was
// invisible for hours. It is the FIRST call of every reconcile pass and its
// failure returns before presence, realtime, identity resolution and every
// channel loop — so a subsystem that was entirely dead produced only `reconcile
// self-heal: retrying …` every 30s, with no line anywhere naming the cause. A
// subsystem that dies must say so: every exit from this function is now on the
// record, and the 401 one says what it costs.
async function listWorkspaces() {
  const res = await apiFetch('/api/workspaces', { timeoutMs: 15000 });
  // ⚠ RELEASE BEFORE EVERY EARLY RETURN (2026-08-30). Both exits below abandoned the
  // `Response`, and an unread undici body counts as IN FLIGHT — socket and TLS state never
  // return to the pool (api-repair.js › discardBody). The success path reads `res.json()`
  // and was fine; the 401 branch — the one a stale credential puts EVERY pass on — leaked
  // once per reconcile, up to twice a minute, for the life of the process.
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

// Q4 (b): returns an ARRAY of channels, or NULL when this workspace could NOT be
// enumerated (401 / 5xx / network / unparseable). The null is load-bearing: the
// old contract returned [] for every failure, so reconcile could not tell "this
// workspace has no channels" from "I never got an answer" — and the prune step
// then silently killed every loop for a workspace whose read failed inside an
// expired-token window (the 02:18 incident). A 404 is different: it is a real,
// stable answer meaning the Channels feature is not deployed, so it stays [].
// FIX S6 — was the LAST listChannels failure AUTH-shaped? The retry ladder used to
// run the session-refresh dance after EVERY failure, so a 500 or a dropped socket
// rotated the Supabase refresh token and rewrote the cookie jar for no reason.
// Combined with the (then) clear-then-set writeback, a transient 5xx across N loops
// was the amplification path that ended in clearSession(). Set on every call and read
// immediately by listChannelsWithRetry, which awaits listChannels serially.
let lastChannelsAuthFailure = false;

async function listChannels(workspaceId) {
  const short = String(workspaceId).slice(0, 8);
  lastChannelsAuthFailure = false;
  let res;
  try {
    res = await apiFetch('/api/channels', { workspaceId, timeoutMs: 15000 });
  } catch (err) {
    diag('listChannels error ws', short, err && err.message);
    return null;
  }
  // ⚠ Same rule as listWorkspaces above, and here it is AMPLIFIED: listChannelsWithRetry
  // runs this up to three times per workspace per pass.
  if (res.status === 404) { discardBody(res); featureAvailable = false; return []; }
  if (res.status === 401) { discardBody(res); lastChannelsAuthFailure = true; notifyStale(); diag('listChannels 401 ws', short); return null; }
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

// Bounded retry ladder around listChannels (heal.ENUM_RETRY_DELAYS_MS). A
// transient failure used to drop the workspace for the whole 5-minute reconcile
// period — or, at 02:18, until the next reboot. Serial and short: at most two
// extra tries for ONE workspace, never concurrent, so this cannot storm (F-072).
// An AUTH-shaped retry first repairs the session, because the observed failure WAS an
// expired-token window and a refresh is exactly what fixes it.
//
// FIX S6: only a 401 gets that repair now. A refresh cannot fix a 500, a timeout or a
// dropped socket, and running it anyway rotated the refresh token (Supabase rotates on
// use) and rewrote the cookie jar on every transient blip — the write half of the
// amplification loop this round closes. A non-auth failure just backs off and retries.
async function listChannelsWithRetry(workspaceId) {
  for (let attempt = 0; ; attempt += 1) {
    const chans = await listChannels(workspaceId);
    if (chans !== null) return chans;
    const authShaped = lastChannelsAuthFailure;
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

// The member's remote avatar URL (Google photo etc.), cached from the members DTO
// for the session window's main-fetched data: URI pipeline (avatar-cache.js). Null
// when unknown. NEVER handed to the renderer as a URL — only as a bounded data: URI.
function avatarUrlFor(userId) {
  return (userId && avatarUrlCache.get(userId)) || null;
}

async function refreshNameCache(ws) {
  // Canonical `{slug}-{publicId}` segment resolves by publicId (no legacy-slug
  // redirect event). Cookie-authed (withUserAuth); X-Workspace-Id is harmless.
  //
  // GUARDED, like its twins (channel-listener.js reconcile, channel-context.resolve),
  // which both yield null on a DTO missing either half. This one interpolated blind:
  // a workspace with no `publicId` produced `slug-undefined`, which 404s, and the
  // whole name+avatar cache for that workspace then stayed empty — so every peer
  // rendered as "A teammate" with only a `namecache miss 404` line to explain it.
  const segment = ws && ws.slug && ws.publicId ? `${ws.slug}-${ws.publicId}` : null;
  if (!segment) {
    diag('namecache skip — workspace DTO has no slug/publicId', (ws && ws.id) || '?');
    return;
  }
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
        if (dn) cacheMember(nameCache, mem.userId, dn);
        // Cache the avatar URL alongside the name (covers the operator AND every peer,
        // since the members list includes the operator). Consumed only by avatar-cache.
        if (mem.avatarUrl) cacheMember(avatarUrlCache, mem.userId, mem.avatarUrl);
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
  discardBody, // re-exported so channelLoop releases the bodies it never reads (api-repair.js)
  isWakeAbort, // …and classifies an abort, logging a blown budget (listener-budget.js)
  normalizeList,
  listWorkspaces,
  listChannels,
  listChannelsWithRetry,
  resolveIdentity,
  displayNameFor,
  avatarUrlFor,
  refreshNameCache,
};
