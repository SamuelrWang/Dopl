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
const subs = new Map(); // wsId -> { channel, subscribed }

function subscribedCount() {
  let n = 0;
  for (const s of subs.values()) if (s.subscribed) n += 1;
  return n;
}

// The loop trusts pushes only when the WS is up (>=1 channel SUBSCRIBED) AND the
// breaker is closed. Any other state → the loop uses the held long-poll.
function isHealthy() {
  return started && breaker.isClosed() && subscribedCount() > 0;
}

function emitHealth() {
  const h = isHealthy();
  if (h === lastHealthy) return;
  lastHealthy = h;
  diag('realtime health', h ? 'healthy' : 'unhealthy');
  try { if (onHealthCb) onHealthCb(h); } catch (_) { /* callback must not throw up */ }
}

async function ensureClient() {
  if (client) return;
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

function onInsert(payload) {
  const chId = payload && payload.new && payload.new.channel_id;
  if (chId && coalescer) coalescer.mark(chId);
}

function onStatus(wsId, status) {
  const s = subs.get(wsId);
  if (!s) return;
  if (status === 'SUBSCRIBED') {
    s.subscribed = true;
    breaker.onSuccess();
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    s.subscribed = false;
    breaker.onFailure();
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
      onInsert
    )
    .subscribe((status) => onStatus(wsId, status));
  subs.set(wsId, { channel, subscribed: false });
}

function removeChannel(wsId) {
  const s = subs.get(wsId);
  if (!s) return;
  try { if (client) client.removeChannel(s.channel); } catch (_) { /* already gone */ }
  subs.delete(wsId);
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
// web's per-workspace subscription set.
function setWorkspaces(ids) {
  if (!started || !client) return;
  const desired = new Set((ids || []).filter(Boolean));
  for (const wsId of subs.keys()) if (!desired.has(wsId)) removeChannel(wsId);
  for (const wsId of desired) addChannel(wsId);
}

// Re-apply the latest access token (called after the listener refreshes on 401)
// so the WS keeps a valid JWT without a full reconnect.
function refreshAuth() {
  if (started) applyAuth();
}

function stop() {
  started = false;
  for (const wsId of Array.from(subs.keys())) removeChannel(wsId);
  try { if (client) client.disconnect(); } catch (_) { /* best-effort */ }
  client = null;
  coalescer = null;
  emitHealth();
}

module.exports = { start, stop, setWorkspaces, refreshAuth, isHealthy };
