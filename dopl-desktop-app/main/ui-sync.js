// ui-sync.js — THE BUNDLED SPA'S LIVE-UPDATE FEED (Phase 3).
//
// WHAT THIS IS. The SPA renderer has no network: CSP `connect-src 'none'`, no
// Supabase config, no tokens (ui-bridge.js owns the HTTP seam), so
// `src/shared/realtime/shared-channel-registry.ts` short-circuits to a no-op the
// moment it sees `window.dopl`. This module is the other half: MAIN watches
// postgres_changes for the CONTENT tables of the workspace the renderer is currently
// viewing and forwards coalesced `{ workspaceId, table }` events over
// `dopl:sync-event`; the renderer's registry turns those into the same refetch
// signals the web fires. One websocket and one subscription set per client, instead
// of the ~96 per-component channels that ate >80% of DB exec time.
//
// WHAT IT DELIBERATELY DOES NOT WATCH. `channel_messages`, `channel_agents` and
// `agent_presence` are the CHANNELS EXEMPTION (DESKTOP-MIGRATION-PLAN.md, Phase 3):
// agent delivery is latency-critical push, it was never the cost problem at 1–2
// subscriptions per client, and main/realtime.js + main/realtime-agents.js already
// own them with their own breaker, coalescer and health model. Binding them here
// would double every wake and put the listener's transport behind THIS module's
// join. See LISTENER_OWNED_TABLES — the exclusion is a checked constant.
//
// THE CREDENTIAL RULE, inherited verbatim from realtime.js. Realtime authorizes
// postgres_changes with the USER JWT from setAuth. With NO JWT realtime-js joins on
// the URL apikey — as `anon` — which cannot evaluate the published tables' RLS and
// crashes the project's whole CDC pipeline, killing push for EVERY client, web
// included. So a missing credential FAILS CLOSED (no join, retry on the ladder), and
// setAuth is AWAITED before subscribe because in v2 it is async and fire-and-forget
// is a subscribe-before-auth race. A STALE JWT is the other half of that field
// failure: the token rotates roughly hourly under auth-tokens.js, so it is re-read
// and re-applied on every join, on wake, and on a slow recheck timer — never
// captured once at start().
//
// SECURITY. The token reaches setAuth() and NOWHERE else: never retained in a module
// variable, never logged, never sent over IPC. Only the join outcome and its
// redacted reason (realtime-core.describeSubscribeError) reach listener.log.
//
// TRUST MODEL. An event is a DOORBELL, never content. The only field read out of a
// payload is `workspace_id`, and only as a guard that a late frame from a channel we
// already left cannot be attributed to the workspace now being viewed. The renderer
// answers by refetching through the authed API, which re-runs the server-side
// visibility gate — nothing downstream may start trusting `payload.new`.
//
// TOPIC DISCIPLINE. `RealtimeClient.channel(topic)` returns the EXISTING channel for
// a topic it still knows, and `removeChannel()` forgets it only after the leave push
// settles — so reusing a topic across a reconnect hands back the old,
// already-subscribed channel whose `.subscribe()` silently no-ops (and whose `.on()`
// throws, because v2 fixes the binding list at JOIN time). Topics are therefore
// generation-unique and every binding is attached BEFORE subscribe, exactly as
// shared-channel-registry.ts argues.
//
// NOT WIRED YET — see dopl-desktop-app/WIRING.md.

const { RealtimeClient } = require('@supabase/realtime-js');
const WebSocket = require('ws');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');
// Reused, not re-implemented: these are the same normalizers the listener's
// transport uses, and they already redact JWT/apikey-shaped text out of a server
// message before it can reach the plaintext log.
const { describeSubscribeError, isAuthFailure } = require('./realtime-core');
const { diag } = require('./diag');

// ─── BEGIN UI-SYNC-PURE (no electron/require refs below) ─────────────────────
// Every decision this module makes — which tables to bind, which topic string to
// join under, when a burst becomes one send, how long to wait before retrying, and
// whether a given frame may be forwarded — is a pure function of injected values,
// so the truth table is testable without a socket, a clock or a BrowserWindow.
// Sliced verbatim by test/ui-sync.test.mjs.

// THE CONTENT TABLES. Each is (a) in the `supabase_realtime` publication and (b)
// carries the `workspace_id` column the `workspace_id=eq.<id>` filter needs — both
// verified against supabase/migrations before this list was written (knowledge_*
// 20260501030000; skills/skill_files 20260502100200; workflows 20260610200000;
// workflow_steps 20260716210000; ontology_*/chats/chat_folders 20260717000000;
// channels/channel_members 20260725120000; channel_consent_requests 20260726100000).
// An unpublished table would fail the WHOLE join — realtime authorizes every binding
// at join time and refuses the channel if any one is refused — so one wrong name
// costs every table's live updates, not just its own.
const SYNC_TABLES = Object.freeze([
  'knowledge_bases',
  'knowledge_folders',
  'knowledge_entries',
  'skills',
  'skill_files',
  'workflows',
  'workflow_steps',
  'ontology_clusters',
  'ontology_objects',
  'ontology_memberships',
  'ontology_relationships',
  'chats',
  'chat_folders',
  'channel_consent_requests',
  'channels',
  'channel_members',
]);

// The channels exemption, as data. These ARE published and this module could bind
// them — it must not. main/realtime.js (messages) and main/realtime-agents.js
// (roster) own them, and agent_presence is a ~30s-per-listener heartbeat whose churn
// has no business waking a content refetch.
const LISTENER_OWNED_TABLES = Object.freeze([
  'channel_messages',
  'channel_agents',
  'agent_presence',
]);

// A burst of writes to one (workspace, table) — an agent importing 40 knowledge
// entries, a workflow save that rewrites every step — must cost ONE refetch signal,
// not one per row. 250ms swallows a multi-statement transaction and stays
// imperceptible.
const COALESCE_MS = 250;

// Reconnect ladder, mirroring shared-channel-registry.ts's. Capped: a machine that
// is offline for a week must retry forever without ever hammering (F-072).
const RECONNECT_DELAYS_MS = Object.freeze([500, 1000, 2000, 4000, 8000, 15000]);

// How often a LIVE connection re-reads and re-applies the access token. The JWT
// rotates roughly hourly under auth-tokens.js and realtime keeps authorizing rejoins
// with whatever setAuth last received, so a connection that outlives its token
// silently stops rejoining. Cheap: setAuth on an unchanged token is a no-op.
const AUTH_RECHECK_MS = 5 * 60 * 1000;

// MODULE-scoped, never reset by a teardown — see shared-channel-registry.ts's
// generation-counter comment. A per-connection counter would restart at 1 after
// stop()/start() and mint a byte-identical topic while realtime-js may still
// remember the leaving channel, whose subscribe() then silently no-ops.
let topicSeq = 1;

function nextTopic(workspaceId) {
  return `dopl-ui-sync-${workspaceId}-g${topicSeq++}`;
}

// Delay before the Nth consecutive retry (0-based), holding the ladder's ceiling.
function backoffMs(attempt) {
  const n = Number.isFinite(Number(attempt)) ? Math.max(0, Math.floor(Number(attempt))) : 0;
  return RECONNECT_DELAYS_MS[Math.min(n, RECONNECT_DELAYS_MS.length - 1)];
}

// The one field ever read out of a payload. Both shapes are accepted (realtime-js
// normalizes the wire's `record` to `new`); `old` is last so a DELETE still names
// its workspace when replica identity carries it. null is NOT an error — under the
// default replica identity a DELETE's old record is the primary key alone.
function payloadWorkspaceId(payload) {
  const p = payload || {};
  for (const rec of [p.new, p.record, p.old, p.old_record]) {
    const id = rec && rec.workspace_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

// May this frame become a renderer event? Four gates, each guarding a real failure:
//   • STARTED/WATCHED — a frame arriving during teardown must not send into a window
//     the caller has already let go of;
//   • GENERATION — the leave push settles asynchronously, so a channel we just left
//     keeps delivering for a beat, and attributing its events to the workspace the
//     user just switched TO is a wrong-workspace refetch;
//   • TABLE — only a table we deliberately bound, so the channels exemption is
//     refused on the way OUT too and cannot be lost to a stray binding;
//   • WORKSPACE — a payload naming a different workspace is refused; one naming none
//     is forwarded (the server-side filter already scoped the binding, and dropping
//     those would silently break every DELETE).
function shouldForward(state, event) {
  const s = state || {};
  const e = event || {};
  if (!s.started || !s.watched) return false;
  if (e.generation !== s.generation) return false;
  if (!SYNC_TABLES.includes(e.table)) return false;
  if (e.workspaceId != null && e.workspaceId !== s.watched) return false;
  return true;
}

// Collapse a burst into at most one send per (workspace, table) per window. One
// shared timer, not one per key: a transaction touching six tables should produce
// six sends in ONE flush, not six staggered ones. `timers` is injectable for tests.
function createSyncCoalescer(windowMs, onFlush, timers) {
  const T = timers || { setTimeout, clearTimeout };
  const pending = new Map(); // `${workspaceId}|${table}` -> { workspaceId, table }
  let timer = null;
  function flush() {
    timer = null;
    const batch = Array.from(pending.values());
    pending.clear();
    // One bad send must not drop the rest of the batch.
    for (const item of batch) { try { onFlush(item); } catch (_err) { /* noop */ } }
  }
  function mark(workspaceId, table) {
    if (!workspaceId || !table) return;
    pending.set(`${workspaceId}|${table}`, { workspaceId, table });
    if (!timer) timer = T.setTimeout(flush, windowMs);
  }
  // Drop everything queued WITHOUT sending — a workspace switch must not deliver
  // the old workspace's pending signals into the new view.
  function cancel() {
    if (timer) {
      T.clearTimeout(timer);
      timer = null;
    }
    pending.clear();
  }
  return { mark, flush, cancel, size: () => pending.size };
}

// What a (re)SUBSCRIBED owes the renderer. Events during a disconnect are simply
// gone — postgres_changes has no replay — so a fresh join means "you may have missed
// anything": one refetch signal per table, exactly the catch-up
// shared-channel-registry.ts fires on its own SUBSCRIBED. NOT coalesced: a reconnect
// must reach the UI now, and the batch is deduped by construction.
function catchUpBatch(workspaceId, tables) {
  if (!workspaceId) return [];
  return (tables || SYNC_TABLES).map((table) => ({ workspaceId, table }));
}
// ─── END UI-SYNC-PURE ────────────────────────────────────────────────────────

const SYNC_EVENT = 'dopl:sync-event';

// ── Live state (the electron/network boundary) ───────────────────────────────
let client = null;
let started = false;
let getWindowFn = null;
let getTokenFn = null;
let watched = null; // the workspace the renderer is viewing; null = nothing
let generation = 0; // bumped by every watch() and every connect attempt
let channel = null;
let subscribed = false;
let attempt = 0;
let connecting = false;
let reconnectTimer = null;
let authTimer = null;
let coalescer = null;

const short = (id) => String(id == null ? '-' : id).slice(0, 8);

function describeState() {
  return `watched=${short(watched)} gen=${generation} subscribed=${subscribed} `
    + `attempt=${attempt} tables=${SYNC_TABLES.length}`;
}

// The ONE place an event crosses into the renderer. `getWindow` is called at SEND
// time, never captured: the SPA window is rebuilt on reopen, and a window that is
// gone (or whose webContents is torn down mid-send) must fail closed rather than
// throw up into a realtime callback.
function sendToWindow(item) {
  let win = null;
  try { win = getWindowFn ? getWindowFn() : null; } catch (_err) { return false; }
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  const wc = win.webContents;
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
  try {
    wc.send(SYNC_EVENT, { workspaceId: item.workspaceId, table: item.table });
  } catch (err) {
    diag('ui-sync send error', err && err.message);
    return false;
  }
  return true;
}

function ensureClient() {
  if (client) return client;
  client = new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, {
    params: { apikey: SUPABASE_ANON_KEY },
    transport: WebSocket,
    // The socket's own ladder, same shape as the channel-level one below.
    reconnectAfterMs: (tries) => backoffMs(Math.max(0, tries - 1)),
  });
  return client;
}

// Read the freshest credential and hand it to the WS. Returns true only when a real
// user JWT was applied; false FAILS CLOSED (see the credential rule in the header —
// an anon join breaks push for every client, so no credential means no join).
// The token is never stored and never logged.
async function applyAuth(reason) {
  if (!client) return false;
  let token = null;
  try {
    token = getTokenFn ? await getTokenFn() : null;
  } catch (err) {
    diag('ui-sync auth error', reason, (err && err.message) || String(err));
    return false;
  }
  if (!token) {
    diag('ui-sync auth MISSING —', reason, '— holding off subscribe (an anon join breaks push for every client)');
    return false;
  }
  try {
    // AWAIT: setAuth is async in v2 (it resolves the accessToken callback and pushes
    // the token to joined channels). Fire-and-forget is a subscribe-before-auth
    // race, and an unauthenticated RLS-gated subscribe is a green-but-silent channel.
    await client.setAuth(token);
  } catch (err) {
    diag('ui-sync setAuth error', (err && err.message) || String(err));
    return false;
  }
  return true;
}

function clearReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function releaseChannel() {
  subscribed = false;
  if (!channel) return;
  // Already gone is fine; the generation guard makes any late frame inert anyway.
  try { if (client) client.removeChannel(channel); } catch (_err) { /* noop */ }
  channel = null;
}

function scheduleReconnect() {
  if (!started || !watched || reconnectTimer) return;
  const delay = backoffMs(attempt);
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function onChange(myGen, table, payload) {
  const state = { started, watched, generation };
  const event = { workspaceId: payloadWorkspaceId(payload), table, generation: myGen };
  if (!shouldForward(state, event)) return;
  // Always emitted under the WATCHED id — that is the key the renderer's registry
  // is subscribed on. The payload's id was a guard, not the routing key.
  if (coalescer) coalescer.mark(watched, table);
}

function sendCatchUp(workspaceId) {
  const batch = catchUpBatch(workspaceId);
  let sent = 0;
  for (const item of batch) if (sendToWindow(item)) sent += 1;
  diag('ui-sync catch-up', short(workspaceId), `sent=${sent}/${batch.length}`);
}

function onStatus(myGen, status, err) {
  // Stale-generation noise — including the CLOSED our own releaseChannel emits —
  // must never drive this state machine or count as a live failure.
  if (!started || myGen !== generation) return;
  if (status === 'SUBSCRIBED') {
    subscribed = true;
    attempt = 0; // realtime-js also rejoins on its own timer; drop our pending retry
    clearReconnect();
    diag('ui-sync sub', short(watched), 'SUBSCRIBED', describeState());
    sendCatchUp(watched);
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    subscribed = false;
    const reason = describeSubscribeError(err);
    diag('ui-sync sub', short(watched), status, `authFailure=${isAuthFailure(reason)}`,
      `reason=${reason}`, describeState());
    scheduleReconnect();
  }
}

// One join attempt for the currently-watched workspace. Single-flight (`connecting`)
// because the auth read is async and two overlapping attempts would leave an orphan
// channel joined under a topic nothing holds a reference to.
function connect() {
  if (!started || !watched || connecting) return;
  connecting = true;
  const myGen = ++generation;
  const wsId = watched;
  releaseChannel();
  ensureClient();
  (async () => {
    const authed = await applyAuth('join');
    // start()/stop()/watch() may all have run while we awaited the token.
    if (!started || myGen !== generation || watched !== wsId) return;
    if (!authed) { scheduleReconnect(); return; }
    // CRITICAL ORDER: every binding attached BEFORE subscribe. v2 fixes the binding
    // list at JOIN time and a late `.on()` throws; the whole table set therefore
    // rides one channel, and sharing happens in the renderer, never by re-binding.
    let chan = client.channel(nextTopic(wsId));
    for (const table of SYNC_TABLES) {
      chan = chan.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `workspace_id=eq.${wsId}` },
        (payload) => onChange(myGen, table, payload)
      );
    }
    // Take BOTH callback args: realtime-js passes the join-error payload second, and
    // dropping it is what turns every failure into a bare CHANNEL_ERROR naming
    // nothing (the 1.7.6 field failure realtime.js documents).
    channel = chan.subscribe((status, err) => onStatus(myGen, status, err));
  })()
    .catch((err) => {
      diag('ui-sync connect error', (err && err.message) || String(err));
      scheduleReconnect();
    })
    .finally(() => {
      connecting = false;
      // A watch() that landed while we were awaiting the token left the desired
      // workspace with no channel — pick it up now instead of waiting for a retry
      // that nothing scheduled. Bounded: the miss can only happen once per await.
      if (started && watched && !channel && !reconnectTimer) connect();
    });
}

function armAuthRecheck() {
  if (authTimer || !started) return;
  authTimer = setInterval(() => {
    if (!started || !client || !watched) return;
    // Re-apply whatever the token authority holds NOW. A rotation lands on the live
    // socket without a rejoin; an expired-and-unrenewable credential logs and the
    // next CHANNEL_ERROR puts us on the ladder.
    applyAuth('rotate').catch((err) => diag('ui-sync auth recheck error', err && err.message));
  }, AUTH_RECHECK_MS);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the feed. Idempotent. `getWindow()` returns the live SPA BrowserWindow (or
 * null) and is called at SEND time; `getAccessToken()` returns a currently-valid
 * Supabase access JWT (main/auth-tokens.js) and is called at every JOIN — neither is
 * captured once. Nothing is subscribed until `watch()` names a workspace.
 */
function start(opts = {}) {
  if (started) return;
  getWindowFn = typeof opts.getWindow === 'function' ? opts.getWindow : null;
  getTokenFn = typeof opts.getAccessToken === 'function' ? opts.getAccessToken : null;
  started = true;
  coalescer = createSyncCoalescer(COALESCE_MS, sendToWindow);
  armAuthRecheck();
  diag('ui-sync start', describeState());
  if (watched) connect();
}

/**
 * Switch the watched workspace (null unwatches and leaves the channel). The old
 * channel's queued signals are DROPPED rather than delivered into the new view, and
 * the generation bump makes every in-flight frame from it inert.
 */
function watch(workspaceId) {
  const next = workspaceId ? String(workspaceId) : null;
  if (next === watched) return;
  diag('ui-sync watch', short(watched), '->', short(next));
  watched = next;
  generation += 1;
  attempt = 0;
  clearReconnect();
  if (coalescer) coalescer.cancel();
  releaseChannel();
  if (started && watched) connect();
}

/**
 * powerMonitor 'resume' / 'unlock-screen'. The machine may have slept through a whole
 * token lifetime and through a socket death the OS never surfaced as an error, so
 * this rejoins from scratch with a freshly-read credential rather than trusting a
 * connection that looks live. The ladder resets: a wake is a new situation.
 */
function onWake() {
  if (!started || !watched) return;
  diag('ui-sync wake —', describeState());
  attempt = 0;
  clearReconnect();
  connect();
}

/** Tear everything down (quit / sign-out). Safe to call when never started. */
function stop() {
  started = false;
  generation += 1; // invalidate every in-flight callback before releasing
  clearReconnect();
  if (authTimer) clearInterval(authTimer);
  authTimer = null;
  if (coalescer) coalescer.cancel();
  coalescer = null;
  releaseChannel();
  try { if (client) client.disconnect(); } catch (_err) { /* best-effort */ }
  client = null;
  attempt = 0;
  connecting = false;
}

module.exports = {
  start,
  stop,
  watch,
  onWake,
  snapshot: describeState,
  SYNC_EVENT,
  // The table list and the pure decision core — exported for callers (and the
  // renderer-side contract test) that need the rule, not the socket.
  SYNC_TABLES,
  LISTENER_OWNED_TABLES,
  COALESCE_MS,
  RECONNECT_DELAYS_MS,
  AUTH_RECHECK_MS,
  nextTopic,
  backoffMs,
  payloadWorkspaceId,
  shouldForward,
  createSyncCoalescer,
  catchUpBatch,
};
