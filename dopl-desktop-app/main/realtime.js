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
// THE CREDENTIAL RULE (1.7.6 field failure: zero SUBSCRIBED, ~1700 bare
// CHANNEL_ERRORs, push dead, every loop silently on the 45s poll backstop).
// Realtime authorizes postgres_changes with the USER JWT from setAuth, and it dies
// either way you get that wrong:
//   • STALE JWT — the old getAccessToken() preferred the stored deep-link blob,
//     which nothing refreshes while the renderer keeps the cookie jar fresh, so it
//     expired ~1h after sign-in and every rejoin re-sent the same dead token;
//   • NO JWT — realtime-js then joins with the URL apikey, i.e. as `anon`, which
//     cannot evaluate the published tables' RLS (42501, `permission denied for
//     function is_current_workspace_member`) and crashes the project's whole CDC
//     pipeline, killing push for every client, web included.
// So auth.getAccessTokenInfo() picks the freshest of {stored blob, cookie} and
// rotates when both are stale, applyAuth() AWAITS the async v2 setAuth, and a
// missing credential FAILS CLOSED (poll rather than poison push).
//
// SECURITY: the token goes to setAuth() only, NEVER to the log — only its source
// ('stored' / 'cookie' / 'refreshed') and remaining lifetime are logged.

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

// ─── BEGIN SUB-ERROR (pure; unit-tested via source extraction) ────────────────
// realtime-js calls `subscribe((status, err) => …)` with a SECOND argument on
// failure: the server's join-error payload. v2.1 dropped it, so every failure
// logged the bare word CHANNEL_ERROR and the field evidence could not tell
// "expired JWT" from "joined as anon and RLS refused" from "table not in the
// publication" — 1700 identical lines that named no cause. This normalizes
// whatever realtime-js hands over (Error, {reason}, {message}, string, nested
// cause) into ONE short reason string, and classifies whether it is a credential
// refusal, which is the only class a token rotation can fix.
// Pure: strings/objects in, string/boolean out. No ws/electron/network refs.

// Belt-and-braces: a server message must never smuggle a credential into the
// plaintext log, so strip anything JWT- or publishable-key-shaped first.
function redactSecrets(s) {
  return String(s)
    .replace(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '<jwt>')
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '<apikey>');
}

function describeSubscribeError(err) {
  if (err == null) return 'no-payload';
  if (typeof err === 'string') return redactSecrets(err).slice(0, 200) || 'empty';
  const parts = [];
  if (err.message) parts.push(String(err.message));
  if (err.reason && String(err.reason) !== String(err.message)) parts.push(String(err.reason));
  if (err.cause) {
    const c = typeof err.cause === 'string' ? err.cause : err.cause.reason || err.cause.message || '';
    if (c && !parts.includes(String(c))) parts.push(`cause=${c}`);
  }
  if (parts.length === 0) {
    try { return redactSecrets(JSON.stringify(err)).slice(0, 200); } catch (_) { return 'unserializable'; }
  }
  return redactSecrets(parts.join(' | ')).slice(0, 200);
}

// Does this reason mean "your credential was refused"? Those are fixable by
// rotating the token; a bad filter or an unpublished table is not.
function isAuthFailure(reason) {
  return /jwt|token|expired|unauthor|forbidden|not authorized|permission denied|40[13]/i.test(
    String(reason || '')
  );
}
// ─── END SUB-ERROR ───────────────────────────────────────────────────────────

// ── Live Realtime client (the electron/network boundary) ─────────────────────
let client = null;
let getToken = null;
let getTokenInfo = null;
let onInsertCb = null;
let onHealthCb = null;
let coalescer = null;
let started = false;
// null (not false) so the FIRST health evaluation always logs: "unhealthy from the
// very first subscribe" is exactly the state that used to be invisible.
let lastHealthy = null;
// Which credential the WS is currently authenticated with — kind + remaining life
// only, NEVER the token. 'none' means we have no user JWT and must not subscribe.
let cred = { kind: 'none', fresh: false, secondsLeft: null };
let lastBreakerState = 'closed';
// The workspaces the listener WANTS subscribed, kept separate from the ones we
// actually joined: with no credential we deliberately join none and retry later.
let desiredWorkspaces = new Set();
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

// One-line, token-free snapshot of the transport: breaker state, the credential
// kind in use, and every ws sub's state. Makes "is push actually up, and if not
// why" answerable from listener.log alone.
function describeState() {
  const parts = [`breaker=${breaker.getState()}`, `cred=${cred.kind}`, `fresh=${cred.fresh}`,
    `subs=${subscribedCount()}/${subs.size}`, `want=${desiredWorkspaces.size}`];
  for (const [wsId, s] of subs) parts.push(`${String(wsId).slice(0, 8)}:${s.subscribed ? 'up' : 'down'}`);
  return parts.join(' ');
}

// Log every breaker transition: without this, "closed" vs "open" was pure
// inference from the reconnect cadence.
function logBreaker(where) {
  const s = breaker.getState();
  if (s === lastBreakerState) return;
  diag('realtime breaker', `${lastBreakerState}->${s}`, `(${where})`, describeState());
  lastBreakerState = s;
}

function emitHealth() {
  const h = isHealthy();
  if (h === lastHealthy) return;
  lastHealthy = h;
  diag('realtime health', h ? 'healthy' : 'unhealthy', describeState());
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
        if (!breaker.isClosed()) { breaker.maybeHalfOpen(); logBreaker('reconnect probe'); return REALTIME.BREAKER_COOLDOWN_MS; }
        return [1000, 2000, 5000, 10000][Math.min(tries - 1, 3)] || 10000;
      },
    });
    await applyAuth();
    return client;
  })().catch((err) => { clientReady = null; throw err; }); // don't poison future inits
  return clientReady;
}

// Read the freshest available credential and hand it to the WS.
//
// Two hard-won rules live here:
//  1. AWAIT setAuth. In realtime-js v2 it is `async` (it resolves the accessToken
//     callback and pushes the new token to joined channels), so a fire-and-forget
//     call is a subscribe-before-auth race waiting to happen.
//  2. FAIL CLOSED with no user JWT: realtime-js would join as `anon` on the URL
//     apikey, and an anon subscriber crashes the project's CDC pipeline (42501 on
//     is_current_workspace_member), killing push for EVERY client. Polling is a
//     cheap fallback; poisoning push for everyone is not. An EXPIRED token is
//     different — Realtime rejects it at join and creates no subscription row, so
//     we still send it and let the logged reason say so.
async function applyAuth() {
  if (!client) return cred;
  let info = null;
  try {
    if (getTokenInfo) {
      info = await getTokenInfo();
    } else if (getToken) {
      const token = await getToken();
      info = { kind: token ? 'unknown' : 'none', token: token || null, fresh: !!token, secondsLeft: null, reason: 'no-metadata' };
    }
  } catch (err) {
    diag('realtime setAuth error', err && err.message);
  }
  const next = info
    ? { kind: info.kind, fresh: !!info.fresh, secondsLeft: info.secondsLeft == null ? null : Math.round(info.secondsLeft) }
    : { kind: 'none', fresh: false, secondsLeft: null };
  if (next.kind !== cred.kind || next.fresh !== cred.fresh) {
    // The credential SOURCE and its remaining life — never the token value.
    diag('realtime auth', `kind=${next.kind}`, `fresh=${next.fresh}`,
      `expires_in=${next.secondsLeft == null ? '?' : `${next.secondsLeft}s`}`, `pick=${(info && info.reason) || '-'}`);
  }
  cred = next;
  if (!info || !info.token) {
    diag('realtime auth MISSING — holding off subscribe (an anon join breaks push for every client)');
    return cred;
  }
  try {
    await client.setAuth(info.token);
  } catch (err) {
    diag('realtime setAuth error', err && err.message);
  }
  return cred;
}

function hasCredential() {
  return cred.kind !== 'none';
}

function onInsert(wsId, payload) {
  const chId = payload && payload.new && payload.new.channel_id;
  // DIAG: every INSERT that actually reaches us, BEFORE coalesce — the ground
  // truth that push is delivering for this ws. Silence here + a healthy sub =
  // the break is upstream (RLS/filter), not in the wake wiring.
  diag('realtime insert', String(wsId).slice(0, 8), 'ch', chId ? String(chId).slice(0, 8) : '-');
  if (chId && coalescer) coalescer.mark(chId);
}

// The per-ws subscribe outcome. On failure this logs the CONCRETE cause: the
// server's own reason, which credential kind we used, and whether rotating the
// token could fix it. Repeats collapse to one short line so a permanent failure
// cannot bury the rest of the log (it previously emitted 1700 bare CHANNEL_ERRORs
// that named nothing).
function onStatus(wsId, status, err) {
  const s = subs.get(wsId);
  if (!s) return;
  const short = String(wsId).slice(0, 8);
  if (status === 'SUBSCRIBED') {
    s.subscribed = true;
    s.lastReason = null;
    diag('realtime sub', short, 'SUBSCRIBED', `cred=${cred.kind}`);
    breaker.onSuccess();
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    s.subscribed = false;
    const reason = describeSubscribeError(err);
    if (reason === s.lastReason && status === s.lastStatus) {
      diag('realtime sub', short, status, '(same reason as above)');
    } else {
      diag('realtime sub', short, status, `cred=${cred.kind}`, `fresh=${cred.fresh}`,
        `authFailure=${isAuthFailure(reason)}`, `reason=${reason}`);
    }
    s.lastReason = reason;
    s.lastStatus = status;
    breaker.onFailure();
    scheduleResubscribe(wsId); // don't leave an errored sub silently dead
  } else {
    diag('realtime sub', short, status);
  }
  logBreaker(`sub ${status}`);
  emitHealth();
}

function addChannel(wsId) {
  if (subs.has(wsId)) return;
  // Register BEFORE subscribing: a status callback that fires synchronously would
  // otherwise find no entry and be dropped by onStatus, losing the ONLY diagnostic
  // we get for a failed join.
  const entry = { channel: null, subscribed: false, resubTimer: null, lastReason: null, lastStatus: null };
  subs.set(wsId, entry);
  entry.channel = client
    .channel(`dopl-desktop:${wsId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'channel_messages', filter: `workspace_id=eq.${wsId}` },
      (payload) => onInsert(wsId, payload)
    )
    // Take BOTH callback args: realtime-js passes the join-error payload second,
    // and dropping it is what made every failure read as a bare CHANNEL_ERROR.
    .subscribe((status, err) => onStatus(wsId, status, err));
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
function start({ getAccessToken, getAccessTokenInfo, onInsert: onInsertHandler, onHealthChange } = {}) {
  if (started) return;
  // Prefer the metadata-bearing reader: it tells us WHICH source the JWT came from
  // and how long it has left, which is what the auth diagnostics print. The plain
  // token reader stays supported so an older caller still works.
  getTokenInfo = getAccessTokenInfo || null;
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
  desiredWorkspaces = new Set((ids || []).filter(Boolean));
  reconcileChannels();
}

// ─── BEGIN JOIN-GATE (pure; unit-tested via source extraction) ───────────────
// Which workspaces may be JOINED right now. Absolute rule: with no user JWT we
// join NOTHING, because realtime-js would join as `anon` and an anon subscriber
// crashes the project's CDC pipeline for every client. Pure, so "fail closed" is
// a truth table instead of a comment — and so the ordering contract (a join only
// ever happens after applyAuth has produced a credential) is testable.
function joinableSet(hasCred, desired) {
  return hasCred ? new Set(desired || []) : new Set();
}
// ─── END JOIN-GATE ───────────────────────────────────────────────────────────

// Bring the JOINED set in line with the DESIRED set, gated on the credential; we
// wait for refreshAuth() to bring one rather than joining as `anon`.
function reconcileChannels() {
  const authed = hasCredential();
  const desired = joinableSet(authed, desiredWorkspaces);
  if (!authed && desiredWorkspaces.size) {
    diag('realtime subscribe deferred', `${desiredWorkspaces.size} ws`, 'waiting for a user JWT');
  }
  for (const wsId of Array.from(subs.keys())) if (!desired.has(wsId)) removeChannel(wsId);
  for (const wsId of desired) addChannel(wsId);
  emitHealth(); // snapshot the transport even when no sub ever calls back (cred=none)
}

// Re-apply the latest access token (called after the listener refreshes on 401,
// and once per reconcile) so the WS keeps a valid JWT. A fresh token is pushed to
// every still-joined channel by setAuth; any sub that had ERRORED (e.g. its JWT
// expired mid-flight) is rejoined now that auth is fresh, so it never stays
// silently dead while another ws keeps global health green.
function refreshAuth() {
  if (!started || !client) return;
  applyAuth()
    .then(() => {
      // A credential may have arrived since the last reconcile: join anything we
      // refused to subscribe while unauthenticated, then rejoin errored subs.
      reconcileChannels();
      for (const [wsId, s] of subs) if (!s.subscribed) scheduleResubscribe(wsId);
    })
    .catch((err) => diag('realtime refreshAuth error', err && err.message));
}

function stop() {
  started = false;
  for (const wsId of Array.from(subs.keys())) removeChannel(wsId);
  try { if (client) client.disconnect(); } catch (_) { /* best-effort */ }
  client = null;
  clientReady = null;
  coalescer = null;
  desiredWorkspaces = new Set();
  cred = { kind: 'none', fresh: false, secondsLeft: null };
  emitHealth();
}

module.exports = {
  start,
  stop,
  setWorkspaces,
  refreshAuth,
  isHealthy,
  isWorkspaceHealthy,
  snapshot: describeState,
};
