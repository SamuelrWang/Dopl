// Supabase Realtime push transport (poll→push, v2.1).
//
// The desktop already authenticates as a Supabase user (deep-link JWT or the
// auth cookie). The web ALREADY runs the exact `channel_messages`
// postgres_changes subscription under that JWT with RLS, so the desktop is just
// one more authenticated subscriber — no new table, no server change (F-072).
// This module opens ONE WebSocket, subscribes to INSERTs on channel_messages
// (one Realtime channel per workspace, filtered `workspace_id=eq.<id>`), and on
// an INSERT wakes the matching channel loop so it does a cheap catch-up instead
// of holding a ~50s `/await` long-poll. That is the egress win.
//
// A circuit breaker guards against a WS-flap reconnect storm: consecutive
// subscribe failures OPEN it → isHealthy() goes false → the loops revert to the
// held long-poll and realtime reconnects only on a LONG cooldown. postgres_changes
// is fed by logical replication (it does NOT poll Postgres), so a flap can never
// hammer the DB — the breaker only tames WS reconnect churn.
//
// SECURITY: the access token is passed to setAuth() only; it is NEVER logged.

const { RealtimeClient } = require('@supabase/realtime-js');
const WebSocket = require('ws');
const { SUPABASE_URL, SUPABASE_ANON_KEY, REALTIME } = require('./config');
const { diag } = require('./diag');

// ─── BEGIN BREAKER (pure; unit-tested via source extraction) ─────────────────
// Circuit-breaker state machine guarding Realtime reconnect churn. States:
//   'closed'    — healthy; pushes are trusted, the loop uses the cheap path.
//   'open'      — too many consecutive failures; unhealthy, cooling down.
//   'half-open' — cooldown elapsed; ONE probe is allowed. Success → closed;
//                 failure → open again with a fresh cooldown.
// Pure: no electron / ws / network refs. `now` is injectable for tests.
function createBreaker(opts) {
  const threshold = (opts && opts.threshold) || 4;
  const cooldownMs = (opts && opts.cooldownMs) || 30000;
  const now = (opts && opts.now) || Date.now;
  let state = 'closed';
  let fails = 0;
  let openedAt = 0;

  function open(t) {
    state = 'open';
    openedAt = t;
    fails = threshold;
  }
  // A successful subscribe: from any state, close and clear the failure count.
  function onSuccess() {
    state = 'closed';
    fails = 0;
  }
  // A subscribe failure. In half-open a single failure re-opens immediately;
  // in closed we open once the consecutive count crosses the threshold.
  function onFailure() {
    if (state === 'half-open') { open(now()); return; }
    fails += 1;
    if (fails >= threshold) open(now());
  }
  // Open → half-open once the cooldown has elapsed (call before a probe).
  // Returns true when a probe should be attempted this tick.
  function maybeHalfOpen() {
    if (state === 'open' && now() - openedAt >= cooldownMs) {
      state = 'half-open';
      return true;
    }
    return state === 'half-open';
  }
  function isClosed() { return state === 'closed'; }
  function getState() { return state; }
  return { onSuccess, onFailure, maybeHalfOpen, isClosed, getState };
}
// ─── END BREAKER ─────────────────────────────────────────────────────────────

// ─── BEGIN WAKE-COALESCE (pure; unit-tested via source extraction) ───────────
// Batch a burst of INSERTs into at most ONE wake per channel per window: many
// rows landing together must trigger a single cheap catch-up, not one fetch per
// row. mark(id) adds to a Set and arms a single flush timer; flush() drains the
// unique ids to onFlush and disarms. Pure: `timers` injectable for tests.
function createWakeCoalescer(windowMs, onFlush, timers) {
  const T = timers || { setTimeout, clearTimeout };
  const pending = new Set();
  let timer = null;
  function flush() {
    timer = null;
    const ids = Array.from(pending);
    pending.clear();
    for (const id of ids) {
      try { onFlush(id); } catch (_) { /* one bad wake must not drop the rest */ }
    }
  }
  function mark(id) {
    if (id == null) return;
    pending.add(id);
    if (!timer) timer = T.setTimeout(flush, windowMs);
  }
  function size() { return pending.size; }
  return { mark, flush, size };
}
// ─── END WAKE-COALESCE ───────────────────────────────────────────────────────

// ── Live Realtime client (the electron/network boundary) ─────────────────────
let client = null;
let getToken = null;
let onInsertCb = null;
let onHealthCb = null;
let coalescer = null;
let started = false;
let lastHealthy = false;
const breaker = createBreaker({
  threshold: REALTIME.BREAKER_FAIL_THRESHOLD,
  cooldownMs: REALTIME.BREAKER_COOLDOWN_MS,
});
const subs = new Map(); // wsId -> { channel, subscribed, resubTimer }

function subscribedCount() {
  let n = 0;
  for (const s of subs.values()) if (s.subscribed) n += 1;
  return n;
}

// The loop trusts pushes only when the WS is up (>=1 channel SUBSCRIBED) AND the
// breaker is closed. Any other state → the loop uses the held long-poll. This is
// the GLOBAL view (used only for the health diagnostic + the on-flip nudge).
function isHealthy() {
  return started && breaker.isClosed() && subscribedCount() > 0;
}

// ─── BEGIN WS-HEALTH (pure; unit-tested via source extraction) ───────────────
// THE per-workspace health predicate. A channel loop must trust push for ITS
// workspace ONLY when the transport is started, the breaker is closed, and THAT
// ws's own sub is actually SUBSCRIBED — never merely because SOME OTHER ws is up.
// Global isHealthy() (>=1 sub) would otherwise leave a loop whose own ws errored
// stuck waiting on wakes that can never arrive (the ~3-min-to-consent bug): green
// globally, silent for the ws that matters. Pure over its inputs so the test can
// lock the "one ws errored while another is subscribed" case with no ws/electron.
function wsHealthy(started_, breakerClosed, sub) {
  return !!(started_ && breakerClosed && sub && sub.subscribed);
}
// ─── END WS-HEALTH ───────────────────────────────────────────────────────────

// Per-workspace health the channel loop consults: only this ws's own sub counts.
function isWorkspaceHealthy(wsId) {
  return wsHealthy(started, breaker.isClosed(), subs.get(wsId));
}

function emitHealth() {
  const h = isHealthy();
  if (h === lastHealthy) return;
  lastHealthy = h;
  diag('realtime health', h ? 'healthy' : 'unhealthy');
  try { if (onHealthCb) onHealthCb(h); } catch (_) { /* callback must not throw up */ }
}

// Memoized init: creates the client AND applies the JWT. Returns a single shared
// promise that resolves ONLY AFTER applyAuth() completes, so a concurrent caller
// (setWorkspaces racing start()'s fire-and-forget) can await auth-before-subscribe
// instead of seeing a half-initialized `client` whose setAuth has not landed yet.
let clientReady = null;
function ensureClient() {
  if (clientReady) return clientReady;
  clientReady = (async () => {
    client = new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, {
      params: { apikey: SUPABASE_ANON_KEY },
      transport: WebSocket,
      // Bounded backoff; while the breaker is OPEN, hold the long cooldown so a WS
      // flap cannot storm-reconnect (F-072). A clean SUBSCRIBED closes the breaker
      // and the short ladder resumes.
      reconnectAfterMs: (tries) => {
        if (!breaker.isClosed()) { breaker.maybeHalfOpen(); return REALTIME.BREAKER_COOLDOWN_MS; }
        return [1000, 2000, 5000, 10000][Math.min(tries - 1, 3)] || 10000;
      },
    });
    await applyAuth();
    return client;
  })().catch((err) => { clientReady = null; throw err; }); // don't poison future inits
  return clientReady;
}

async function applyAuth() {
  if (!client || !getToken) return;
  try {
    const token = await getToken();
    if (token) client.setAuth(token);
  } catch (err) {
    diag('realtime setAuth error', err && err.message);
  }
}

function onInsert(wsId, payload) {
  const chId = payload && payload.new && payload.new.channel_id;
  // DIAG: every INSERT that actually reaches us, BEFORE coalesce — the ground
  // truth that push is delivering for this ws. Silence here + a healthy sub =
  // the break is upstream (RLS/filter), not in the wake wiring.
  diag('realtime insert', String(wsId).slice(0, 8), 'ch', chId ? String(chId).slice(0, 8) : '-');
  if (chId && coalescer) coalescer.mark(chId);
}

function onStatus(wsId, status) {
  const s = subs.get(wsId);
  if (!s) return;
  // DIAG: the per-ws subscribe outcome (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT /
  // CLOSED) — the first thing to check when global health is green but one ws
  // is not delivering.
  diag('realtime sub', String(wsId).slice(0, 8), status);
  if (status === 'SUBSCRIBED') {
    s.subscribed = true;
    breaker.onSuccess();
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    s.subscribed = false;
    breaker.onFailure();
    scheduleResubscribe(wsId); // don't leave an errored sub silently dead
  }
  emitHealth();
}

function addChannel(wsId) {
  if (subs.has(wsId)) return;
  const channel = client
    .channel(`dopl-desktop:${wsId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'channel_messages', filter: `workspace_id=eq.${wsId}` },
      (payload) => onInsert(wsId, payload)
    )
    .subscribe((status) => onStatus(wsId, status));
  subs.set(wsId, { channel, subscribed: false, resubTimer: null });
}

function removeChannel(wsId) {
  const s = subs.get(wsId);
  if (!s) return;
  if (s.resubTimer) { clearTimeout(s.resubTimer); s.resubTimer = null; }
  try { if (client) client.removeChannel(s.channel); } catch (_) { /* already gone */ }
  subs.delete(wsId);
}

// Bounded re-subscribe for an errored/closed ws sub: re-apply the JWT then rejoin
// just that one channel. Guarded so it can never storm (F-072): at most ONE
// pending retry per ws, and only while the breaker is CLOSED — an OPEN breaker
// owns recovery via the long reconnect cooldown.
function scheduleResubscribe(wsId) {
  const s = subs.get(wsId);
  if (!s || s.resubTimer || !breaker.isClosed()) return;
  s.resubTimer = setTimeout(() => {
    const cur = subs.get(wsId);
    if (cur) cur.resubTimer = null;
    if (!started || !client || (cur && cur.subscribed)) return; // recovered on its own
    applyAuth()
      .then(() => { removeChannel(wsId); addChannel(wsId); })
      .catch((err) => diag('realtime resubscribe error', err && err.message));
  }, REALTIME.RESUBSCRIBE_MS);
}

// ── Public API ───────────────────────────────────────────────────────────────
function start({ getAccessToken, onInsert: onInsertHandler, onHealthChange } = {}) {
  if (started) return;
  getToken = getAccessToken || null;
  onInsertCb = onInsertHandler || null;
  onHealthCb = onHealthChange || null;
  coalescer = createWakeCoalescer(REALTIME.WAKE_COALESCE_MS, (id) => {
    try { if (onInsertCb) onInsertCb(id); } catch (_) { /* one wake must not kill the rest */ }
  });
  started = true;
  ensureClient().catch((err) => diag('realtime start error', err && err.message));
}

// setWorkspaces(ids): subscribe a channel for each workspace id, drop channels
// for ids no longer present. Called from the listener's reconcile — mirrors the
// web's per-workspace subscription set. AWAITs ensureClient() first: it resolves
// only after setAuth has landed, so a postgres_changes subscribe never authorizes
// before the JWT is set (an unauthenticated RLS-gated subscribe just errors and
// delivers nothing — a prime cause of a green-but-silent ws sub).
async function setWorkspaces(ids) {
  if (!started) return;
  try { await ensureClient(); } catch (err) { diag('realtime setWorkspaces client error', err && err.message); return; }
  if (!started || !client) return; // stop() may have run while we awaited
  const desired = new Set((ids || []).filter(Boolean));
  for (const wsId of subs.keys()) if (!desired.has(wsId)) removeChannel(wsId);
  for (const wsId of desired) addChannel(wsId);
}

// Re-apply the latest access token (called after the listener refreshes on 401,
// and once per reconcile) so the WS keeps a valid JWT. A fresh token is pushed to
// every still-joined channel by setAuth; any sub that had ERRORED (e.g. its JWT
// expired mid-flight) is rejoined now that auth is fresh, so it never stays
// silently dead while another ws keeps global health green.
function refreshAuth() {
  if (!started || !client) return;
  applyAuth()
    .then(() => { for (const [wsId, s] of subs) if (!s.subscribed) scheduleResubscribe(wsId); })
    .catch((err) => diag('realtime refreshAuth error', err && err.message));
}

function stop() {
  started = false;
  for (const wsId of Array.from(subs.keys())) removeChannel(wsId);
  try { if (client) client.disconnect(); } catch (_) { /* best-effort */ }
  client = null;
  clientReady = null;
  coalescer = null;
  emitHealth();
}

module.exports = { start, stop, setWorkspaces, refreshAuth, isHealthy, isWorkspaceHealthy };
