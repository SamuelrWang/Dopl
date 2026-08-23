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
//
// WAKE-ONLY TRUST MODEL (Q8, 2026-07-31). A push is a DOORBELL, never content.
// The only field this module ever reads out of an INSERT payload is
// `channel_id` — a routing key — and the woken loop then refetches over the
// AUTHED long-poll, which re-runs the server-side visibility gate. Nothing
// downstream may start trusting `payload.new.body` / `.metadata`: realtime
// payloads are RLS-filtered but they are not the authorization path, and the
// whole design bets that a wake carries no authority. `wakeChannelId()` (in
// `realtime-core.js`) is the single extraction point, and it is deliberately
// indifferent to which OTHER columns the payload happens to carry.
//
// EGRESS: because the payload is ignored, every byte past the routing key is
// waste that Supabase meters — today ~1.6 KB per insert per subscriber (the
// ~880-byte row plus Realtime's per-column type metadata) to deliver ~36 bytes
// of signal. The fix is one publication statement on the SERVER (a column list
// on `channel_messages`), NOT a client change; this module is already written
// so that flipping it is a no-op here. `wakeBytes` in the state line is the
// before/after measurement — OPT-IN since FIX L7, see MEASURE_WAKE_BYTES below.
// See docs/REFACTOR-FINDINGS.md F-091 for the SQL (NOT applied — prod
// publication changes are Samuel's to run).

const { RealtimeClient } = require('@supabase/realtime-js');
const WebSocket = require('ws');
const { SUPABASE_URL, SUPABASE_ANON_KEY, REALTIME } = require('./config');
const { diag } = require('./diag');
// The pure cores (breaker, wake coalescer, wake-payload extraction, subscribe-
// error normalization, health + join gates) live in a sibling so they stay
// importable by the node --test slicer and this file stays under the line cap.
const {
  createBreaker,
  createWakeCoalescer,
  wakeChannelId,
  wakePayloadBytes,
  describeSubscribeError,
  isAuthFailure,
  wsHealthy,
  joinableSet,
} = require('./realtime-core');
// A second realtime channel used to ride beside this one: the `channel_agents` ROSTER
// doorbell (realtime-agents.js), deliberately outside this module's breaker, health
// calculation and wake coalescer. Nothing writes that table any more (channels rollback §1),
// so a subscription to it would deliver nothing forever.

// ── Live Realtime client (the electron/network boundary) ─────────────────────
let client = null;
let getToken = null;
let getTokenInfo = null;
let onInsertCb = null;
let onDirectiveCb = null;
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
// Q8 measurement: how many wakes this process has taken and what they cost in
// bytes off the Supabase egress meter. Read out of the state line, never used
// for a decision.
//
// FIX L7 — THE BYTE COUNT IS OPT-IN. `wakePayloadBytes` JSON.stringify's the
// WHOLE realtime payload on every insert, purely to feed a counter nothing
// decides on. That is permanent CPU and garbage on the hot wake path, sized by
// the very payload F-091 exists to shrink (today up to ~4.5 KB a row), for a
// number that only matters while verifying that narrowing. `DOPL_WAKE_BYTES=1`
// turns it on for that window; otherwise the wake path never serializes
// anything and the state line reports `wakeBytes=off`. The wake COUNT is free
// and stays unconditional.
const MEASURE_WAKE_BYTES = process.env.DOPL_WAKE_BYTES === '1';
let wakeCount = 0;
let wakeBytes = 0;
const breaker = createBreaker({
  threshold: REALTIME.BREAKER_FAIL_THRESHOLD,
  cooldownMs: REALTIME.BREAKER_COOLDOWN_MS,
});
const subs = new Map(); // wsId -> { channel, subscribed, resubTimer }

// ── ⚠ THE SECOND POSTGRES_CHANGES BINDING (2026-08-22, the orchestrator launch lane) ────────
//
// `channel_launch_directives` INSERTs ride the SAME per-workspace WebSocket and the SAME
// Realtime channel as `channel_messages` — a second `.on('postgres_changes', …)` before
// `.subscribe()`, not a second socket and not a second breaker.
//
// ⚠ GATED ON THE OPERATOR'S LOCAL TOGGLE, AND THAT IS A BLAST-RADIUS DECISION AS MUCH AS A
// CONSENT ONE. Supabase evaluates every binding at JOIN time, so a binding naming a table that
// does not exist yet — a build newer than its project's migrations, the ordinary state of a dev
// tree mid-wave — errors the WHOLE channel and `channel_messages` wakes die with it. Default-OFF
// means almost every install never adds the binding and cannot be hurt by the lane's absence
// server-side. A machine that HAS opted in and hits it DEGRADES rather than breaks: `onStatus`
// marks the sub down, the breaker opens, and the loops fall back to the held long-poll exactly
// as for any other subscribe failure.
// ⚠ A BINDING CAN ONLY BE ADDED BEFORE `.subscribe()`, so a flip REBUILDS the joined channels.
let bindDirectives = false;

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

// Per-workspace health the channel loop consults: only this ws's own sub counts.
function isWorkspaceHealthy(wsId) {
  return wsHealthy(started, breaker.isClosed(), subs.get(wsId));
}

// One-line, token-free snapshot of the transport: breaker state, the credential
// kind in use, and every ws sub's state. Makes "is push actually up, and if not
// why" answerable from listener.log alone.
function describeState() {
  const parts = [`breaker=${breaker.getState()}`, `cred=${cred.kind}`, `fresh=${cred.fresh}`,
    `subs=${subscribedCount()}/${subs.size}`, `want=${desiredWorkspaces.size}`,
    `wakes=${wakeCount}`, `wakeBytes=${MEASURE_WAKE_BYTES ? wakeBytes : 'off'}`];
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
  const chId = wakeChannelId(payload);
  wakeCount += 1;
  // DIAG: every INSERT that actually reaches us, BEFORE coalesce — the ground
  // truth that push is delivering for this ws. Silence here + a healthy sub =
  // the break is upstream (RLS/filter), not in the wake wiring.
  const parts = ['realtime insert', String(wsId).slice(0, 8), 'ch',
    chId ? String(chId).slice(0, 8) : '-'];
  // L7: the Q8 size measurement — a wake should cost a few hundred bytes, not a
  // whole row — but only while someone is measuring (DOPL_WAKE_BYTES=1). It is
  // the one thing on this path that touches the payload beyond the routing key.
  if (MEASURE_WAKE_BYTES) {
    const bytes = wakePayloadBytes(payload);
    wakeBytes += bytes;
    parts.push(`bytes=${bytes}`);
  }
  diag(...parts);
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

// ⚠ A DIRECTIVE FRAME IS **NOT** WAKE-ONLY — the one exception to the trust model at the top of
// this file, named here rather than discovered. The doorbell rule holds for messages because the
// woken loop refetches over the authed long-poll; a directive has no such refetch, the row IS
// the message. So this module still reads NOTHING out of the payload: it hands `payload.new`
// straight to `main/launch-directives.js`, which re-checks `operator_user_id` locally (the
// filter is WORKSPACE-wide, so a colleague's frame arrives here too) and CLAIMS the row over an
// authenticated route before acting on a field of it. **The claim is the authorization path;
// this frame only makes it prompt.**
function onDirective(wsId, payload) {
  const row = payload && payload.new;
  if (!row || !onDirectiveCb) return;
  // The id PREFIX only — a directive carries a free-text goal, and this log is a support
  // artifact. `launch-directives.js` owns what may be said about one.
  diag('realtime directive', String(wsId).slice(0, 8), 'row', String(row.id || '').slice(0, 8));
  try { onDirectiveCb(wsId, row); } catch (_) { /* one directive must not kill the socket */ }
}

function addChannel(wsId) {
  if (subs.has(wsId)) return;
  // Register BEFORE subscribing: a status callback that fires synchronously would
  // otherwise find no entry and be dropped by onStatus, losing the ONLY diagnostic
  // we get for a failed join.
  const entry = { channel: null, subscribed: false, resubTimer: null, lastReason: null, lastStatus: null };
  subs.set(wsId, entry);
  let ch = client
    .channel(`dopl-desktop:${wsId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'channel_messages', filter: `workspace_id=eq.${wsId}` },
      (payload) => onInsert(wsId, payload)
    );
  // ⚠ SECOND, AND ONLY WHEN THE OPERATOR HAS ARMED THE LANE — see `bindDirectives` above for
  // why the gate is here and not in the handler.
  if (bindDirectives) {
    ch = ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'channel_launch_directives', filter: `workspace_id=eq.${wsId}` },
      (payload) => onDirective(wsId, payload)
    );
  }
  // Take BOTH callback args: realtime-js passes the join-error payload second,
  // and dropping it is what made every failure read as a bare CHANNEL_ERROR.
  entry.channel = ch.subscribe((status, err) => onStatus(wsId, status, err));
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
function start({ getAccessToken, getAccessTokenInfo, onInsert: onInsertHandler, onAgentChange: onAgentChangeHandler, onHealthChange } = {}) {
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

/**
 * ARM OR DISARM the directive binding, and take the handler with it. One caller:
 * `main/launch-directives.js`, at start and on every flip of the local toggle.
 *
 * ⚠ THE HANDLER RIDES HERE RATHER THAN IN `start()`'s OPTIONS, and it is the better shape as
 * well as the only available one: the handler and the subscription that feeds it are armed by
 * the SAME call, so neither can exist without the other. (`channel-listener.js`, which calls
 * `start()`, sat at 499 lines against the hard 500-line §1 cap.) The message wake path is
 * untouched.
 *
 * ⚠ IT REBUILDS THE JOINED CHANNELS — a `postgres_changes` binding can only be added BEFORE
 * `.subscribe()`. One rejoin per workspace on a rare, operator-driven flip, and in exchange a
 * machine that never opts in never names the table on the wire. Idempotent.
 * ⚠ IT DOES NOT TOUCH THE BREAKER: a rejoin takes the same `onStatus` path as any other, so a
 * flip on a project without the table degrades to the long-poll rather than failing loudly.
 */
function setDirectives(on, handler) {
  const next = on === true;
  onDirectiveCb = next && typeof handler === 'function' ? handler : null;
  if (next === bindDirectives) return;
  bindDirectives = next;
  diag('realtime directives', next ? 'ARMED' : 'disarmed', '— rejoining', subs.size, 'ws');
  if (!started || !client) return; // the next addChannel will read the new value
  for (const wsId of Array.from(subs.keys())) { removeChannel(wsId); addChannel(wsId); }
  emitHealth();
}

function stop() {
  started = false;
  bindDirectives = false;
  onDirectiveCb = null;
  for (const wsId of Array.from(subs.keys())) removeChannel(wsId);
  try { if (client) client.disconnect(); } catch (_) { /* best-effort */ }
  client = null;
  clientReady = null;
  coalescer = null;
  desiredWorkspaces = new Set();
  cred = { kind: 'none', fresh: false, secondsLeft: null };
  wakeCount = 0;
  wakeBytes = 0;
  emitHealth();
}

module.exports = {
  start,
  stop,
  setWorkspaces,
  setDirectives, // 2026-08-22: arm/disarm the launch-directive binding on the SAME per-ws WS
  refreshAuth,
  isHealthy,
  isWorkspaceHealthy,
  desiredCount: () => desiredWorkspaces.size, // Q4: the `want=` count reconcile self-heals on
  // 2026-08-22: the workspaces push WANTS, for the directive backstop — it polls exactly the
  // ones this module is trying and failing to keep a healthy sub on. A COPY, never the live Set:
  // the reconcile owns membership and a caller must not be able to edit it.
  desiredWorkspaceIds: () => [...desiredWorkspaces],
  snapshot: describeState,
};
