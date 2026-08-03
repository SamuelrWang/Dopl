// ui-sync.js — THE BUNDLED SPA'S LIVE-UPDATE FEED (Phase 3).
//
// WHAT THIS IS. The SPA renderer has no network (CSP `connect-src 'none'`, no Supabase
// config, no tokens — ui-bridge.js owns the HTTP seam), so
// `src/shared/realtime/shared-channel-registry.ts` short-circuits to a no-op the moment
// it sees the SPA bridge. This is the other half: MAIN watches postgres_changes for the
// CONTENT tables of the workspace the renderer is viewing and forwards coalesced
// `{ workspaceId, table }` events over `dopl:sync-event`, which that registry turns into
// the same refetch signals the web fires — one websocket per client instead of ~96
// per-component channels eating >80% of DB time.
//
// THE CHANNELS EXEMPTION (DESKTOP-MIGRATION-PLAN.md Phase 3) is about the LISTENER
// MODULES: realtime.js + realtime-agents.js keep their own sockets, breakers and health
// model for AGENT delivery — nothing here touches them. The UI feed watches
// channel_messages/channel_agents/agent_presence TOO (web parity: messages appear live,
// roster/presence dots update) on ITS OWN socket; the first dogfood proved excluding
// them left the app's channel transcript frozen until a manual refetch.
//
// THE CREDENTIAL RULE, inherited verbatim from realtime.js. Realtime authorizes
// postgres_changes with the USER JWT from setAuth. With NO JWT realtime-js joins on
// the URL apikey — as `anon` — which cannot evaluate the published tables' RLS and
// crashes the project's whole CDC pipeline, killing push for EVERY client, web
// included. So a missing credential FAILS CLOSED (no join, retry on the ladder); setAuth
// is AWAITED before subscribe (async in v2 — fire-and-forget is a subscribe-before-auth
// race); and since the token rotates roughly hourly under auth-tokens.js it is re-read on
// every join, on wake, on refreshAuth() and on a slow recheck, never captured once at
// start(). The token reaches setAuth() and nowhere else: never retained, never logged,
// never sent over IPC — only the join outcome and its redacted reason are logged.
//
// TRUST MODEL. An event is a DOORBELL, never content. The only field read out of a
// payload is `workspace_id`, and only as a guard that a late frame from a channel we
// already left is not attributed to the workspace now being viewed. The renderer answers
// by refetching through the authed API, which re-runs the server-side visibility gate —
// nothing may start trusting `payload.new`.
//
// TOPIC DISCIPLINE. `channel(topic)` returns the EXISTING channel for a topic
// realtime-js still knows, and `removeChannel()` forgets it only after the leave push
// settles — so reusing a topic across a reconnect hands back the old, already-subscribed
// channel whose `.subscribe()` silently no-ops (and whose `.on()` throws, since v2 fixes
// the binding list at JOIN time). Topics are therefore generation-unique and every
// binding is attached BEFORE subscribe, as shared-channel-registry.ts argues.
//
// WIRED by main/shell-mode.js's SPA service wiring (start + the auth fan-out).

const { RealtimeClient } = require('@supabase/realtime-js');
const WebSocket = require('ws');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');
// Reused, not re-implemented: the listener's own normalizers, which already redact
// JWT/apikey-shaped text out of a server message before it reaches the log.
const { describeSubscribeError, isAuthFailure } = require('./realtime-core');
const { diag } = require('./diag');

// ─── BEGIN UI-SYNC-PURE (no electron/require refs below) ─────────────────────
// Every decision — which tables to bind, which topic to join under, when a burst becomes
// one send, how long to wait, whether a frame may be forwarded — is a pure function of
// injected values, testable without a socket, clock or BrowserWindow. Sliced verbatim by
// test/ui-sync.test.mjs.

// THE CONTENT TABLES — the UNION of every table the SPA's feature hooks watch
// (src/features/*/client/realtime.ts) minus the listener-owned ones below. That union is
// the contract: a table a hook watches but this list omits is a page that never updates
// live, so test/ui-sync.test.mjs re-derives it from those files and checks each name
// against supabase/migrations for publication AND a `workspace_id` column — following
// RENAMES (skill_versions was skill_file_versions) and BARE `DROP TABLE`s, not just
// `ALTER PUBLICATION … DROP`. Not ceremony: `skill_files` sat here until review caught
// 20260716064733 dropping the table while its 20260502100200 publication ADD stayed —
// and ONE dead name makes realtime refuse the whole channel, i.e. no live updates at all.
const SYNC_TABLES = Object.freeze([
  'knowledge_bases', 'knowledge_folders', 'knowledge_entries',
  'skills', 'skill_versions',
  'workflows', 'workflow_steps', 'workflow_step_edges',
  'workflow_knowledge_bases', 'workflow_skills',
  'ontology_clusters', 'ontology_objects', 'ontology_memberships',
  'ontology_relationships',
  'chats', 'chat_messages', 'chat_folders',
  'channel_consent_requests', 'channels', 'channel_members',
  'channel_messages', 'channel_agents', 'agent_presence',
]);

// Historically the channels exemption excluded the three listener tables from this feed;
// the UI needs them (see header), so the set is empty — retained because the coverage
// contract test unions it with SYNC_TABLES.
const LISTENER_OWNED_TABLES = Object.freeze([]);

// A burst on one (workspace, table) — an agent importing 40 knowledge entries — must cost
// ONE refetch signal, not one per row. 250ms swallows a multi-statement transaction and
// stays imperceptible.
const COALESCE_MS = 250;

// Reconnect ladder, mirroring shared-channel-registry.ts's. Capped: a machine offline for
// a week must retry forever without ever hammering (F-072).
const RECONNECT_DELAYS_MS = Object.freeze([500, 1000, 2000, 4000, 8000, 15000]);

// BACKSTOP re-read of the access token on a live connection (refreshAuth() is the prompt
// path). Realtime keeps authorizing rejoins with whatever setAuth last received, so a
// connection outliving its token silently stops rejoining.
const AUTH_RECHECK_MS = 5 * 60 * 1000;

// A join holds a single-flight latch across an AWAITED token read, and getAccessToken()
// can refresh in line (an HTTP call). A machine sleeping mid-flight leaves that promise
// pending FOREVER — latch closed, no timer, feed dead until quit. So the read is raced
// against this deadline; a timeout is "no credential".
const AUTH_READ_TIMEOUT_MS = 20_000;

// MODULE-scoped, never reset by a teardown — see shared-channel-registry.ts's generation
// counter. A per-connection one would restart at 1 after stop()/start() and mint a
// byte-identical topic while realtime-js still holds the leaving channel (no-op subscribe).
let topicSeq = 1;

function nextTopic(workspaceId) { return `dopl-ui-sync-${workspaceId}-g${topicSeq++}`; }

// Delay before the Nth consecutive retry (0-based), holding the ladder's ceiling.
function backoffMs(attempt) {
  const v = Number(attempt);
  const n = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  return RECONNECT_DELAYS_MS[Math.min(n, RECONNECT_DELAYS_MS.length - 1)];
}

// The one field ever read out of a payload. Both shapes accepted (realtime-js
// normalizes `record` to `new`); `old` last so a DELETE still names its workspace
// when replica identity carries it. null is NOT an error — under the default replica
// identity a DELETE's old record is the primary key alone.
function payloadWorkspaceId(payload) {
  const p = payload || {};
  for (const rec of [p.new, p.record, p.old, p.old_record]) {
    const id = rec && rec.workspace_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

// May this frame become a renderer event? Four gates, each guarding a real failure:
// STARTED/WATCHED — a frame arriving during teardown must not send into a window the
// caller let go of. GENERATION — the leave push settles asynchronously, so a channel we
// just left keeps delivering for a beat, and attributing that to the workspace switched
// TO is a wrong-workspace refetch. TABLE — only a table we deliberately bound, so the
// channels exemption is refused on the way OUT too. WORKSPACE — a payload naming a
// DIFFERENT workspace is refused; one naming none is forwarded (the server filter
// already scoped the binding; dropping those breaks every DELETE).
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
// shared timer, not one per key: a transaction touching six tables produces six
// sends in ONE flush. `timers` is injectable for tests.
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
  // Drop the queue WITHOUT sending — a workspace switch must not deliver the old
  // workspace's pending signals into the new view.
  function cancel() {
    if (timer) T.clearTimeout(timer);
    timer = null;
    pending.clear();
  }
  return { mark, flush, cancel, size: () => pending.size };
}

// What a (re)SUBSCRIBED owes the renderer: events during a disconnect are simply gone
// (postgres_changes has no replay), so a fresh join means "you may have missed
// anything". ONE event with an EMPTY table, not one per table — the registry implements
// exactly that contract (shared-channel-registry.ts: `if (e.table &&
// !s.tables.has(e.table)) continue`, so an empty table fires EVERY subscriber). The
// per-table batch instead made each hook refetch once per table it watches: five
// refetches for the workflows page on every reconnect or wake, a self-inflicted burst on
// the very DB this phase exists to unload. NOT coalesced — a reconnect must reach the UI
// now.
function catchUpBatch(workspaceId) {
  if (!workspaceId) return [];
  return [{ workspaceId, table: '' }];
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
let connectingGen = 0; // WHICH attempt owns the `connecting` latch (see connect())
let reconnectTimer = null;
let authTimer = null;
let coalescer = null;

const short = (id) => String(id == null ? '-' : id).slice(0, 8);

function describeState() {
  return `watched=${short(watched)} gen=${generation} subscribed=${subscribed} `
    + `attempt=${attempt} tables=${SYNC_TABLES.length}`;
}

// The ONE place an event crosses into the renderer. `getWindow` is called at SEND time,
// never captured: the SPA window is rebuilt on reopen, and a dead window (or webContents
// torn down mid-send) must fail closed, not throw into a realtime callback.
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
  if (client) return client; // one socket for the life of the process
  client = new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, {
    params: { apikey: SUPABASE_ANON_KEY },
    transport: WebSocket,
    reconnectAfterMs: (tries) => backoffMs(Math.max(0, tries - 1)),
  });
  return client;
}

// getAccessToken() bounded by a deadline. A timeout resolves NULL rather than
// throwing, so it lands on the same fail-closed path a missing credential does.
function readTokenWithDeadline() {
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      diag('ui-sync auth read timed out after', `${AUTH_READ_TIMEOUT_MS}ms`, '— failing closed');
      resolve(null);
    }, AUTH_READ_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(() => getTokenFn()), deadline])
    .finally(() => clearTimeout(timer));
}

// Read the freshest credential and hand it to the WS. True only when a real user JWT
// was applied; false FAILS CLOSED (the header's credential rule — an anon join breaks
// push for every client). The token is never stored and never logged.
async function applyAuth(reason) {
  if (!client) return false;
  let token = null;
  try {
    // RACED, never awaited bare: a read hanging across a sleep would otherwise strand
    // the single-flight latch with no timer to reopen it.
    token = getTokenFn ? await readTokenWithDeadline() : null;
  } catch (err) {
    diag('ui-sync auth error', reason, (err && err.message) || String(err));
    return false;
  }
  if (!token) {
    diag('ui-sync auth MISSING —', reason, '— holding off subscribe (an anon join breaks push for every client)');
    return false;
  }
  try {
    // AWAIT: setAuth is async in v2. Fire-and-forget is a subscribe-before-auth race,
    // and an unauthenticated RLS-gated subscribe is a green-but-silent channel.
    await client.setAuth(token);
  } catch (err) {
    diag('ui-sync setAuth error', (err && err.message) || String(err));
    return false;
  }
  return true;
}

function clearReconnect() { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; }

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
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

function onChange(myGen, table, payload) {
  const state = { started, watched, generation };
  const event = { workspaceId: payloadWorkspaceId(payload), table, generation: myGen };
  if (!shouldForward(state, event)) return;
  // Always emitted under the WATCHED id — the key the renderer's registry is subscribed
  // on. The payload's id was a guard, not the routing key.
  if (coalescer) coalescer.mark(watched, table);
}

function sendCatchUp(workspaceId) {
  let sent = 0;
  for (const item of catchUpBatch(workspaceId)) if (sendToWindow(item)) sent += 1;
  diag('ui-sync catch-up', short(workspaceId), `sent=${sent}`);
}

function onStatus(myGen, status, err) {
  // Stale-generation noise — including the CLOSED our own releaseChannel emits —
  // must never drive this state machine or count as a live failure.
  if (!started || myGen !== generation) return;
  if (status === 'SUBSCRIBED') {
    subscribed = true;
    attempt = 0;
    clearReconnect(); // realtime-js rejoins on its own timer; drop our pending retry
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

// One join attempt for the watched workspace. Single-flight (`connecting`) because
// the auth read is async and two overlapping attempts orphan a joined channel.
function connect() {
  if (!started || !watched || connecting) return;
  connecting = true;
  const myGen = ++generation;
  connectingGen = myGen; // this attempt now owns the latch
  const wsId = watched;
  releaseChannel();
  ensureClient();
  (async () => {
    const authed = await applyAuth('join');
    // start()/stop()/watch() may all have run while we awaited the token.
    if (!started || myGen !== generation || watched !== wsId) return;
    if (!authed) { scheduleReconnect(); return; }
    // CRITICAL ORDER: every binding attached BEFORE subscribe. v2 fixes the binding
    // list at JOIN time and a late `.on()` throws, so the whole table set rides one
    // channel and sharing happens in the renderer, never by re-binding.
    let chan = client.channel(nextTopic(wsId));
    for (const table of SYNC_TABLES) {
      chan = chan.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `workspace_id=eq.${wsId}` },
        (payload) => onChange(myGen, table, payload)
      );
    }
    // Take BOTH callback args: realtime-js passes the join-error payload second, and
    // dropping it turns every failure into a bare CHANNEL_ERROR naming nothing.
    channel = chan.subscribe((status, err) => onStatus(myGen, status, err));
  })()
    .catch((err) => {
      diag('ui-sync connect error', (err && err.message) || String(err));
      scheduleReconnect();
    })
    .finally(() => {
      // ONLY THE OWNER MAY RELEASE. onWake() force-clears the latch and starts a NEWER
      // attempt while this one's token read is still pending (the 20s deadline
      // guarantees it resolves after wake); an unguarded release then cleared the latch
      // the newer attempt holds and spawned a THIRD connect whose ++generation
      // invalidated the healthy in-flight rejoin — and under uniform read latency those
      // chains keep invalidating each other, so SUBSCRIBED never lands. `generation`
      // cannot stand in for ownership: watch() bumps it too, and skipping the release on
      // that would wedge the latch closed forever.
      if (connectingGen !== myGen) return;
      connecting = false;
      // A watch() that landed while we awaited the token left the desired workspace with
      // no channel — pick it up now, not on a retry nothing scheduled.
      if (started && watched && !channel && !reconnectTimer) connect();
    });
}

function armAuthRecheck() {
  if (authTimer || !started) return;
  authTimer = setInterval(() => {
    if (!started || !client || !watched) return;
    // Backstop rotation: lands on the live socket without a rejoin. An unrenewable
    // credential logs and the next CHANNEL_ERROR puts us on the ladder.
    applyAuth('rotate').catch((err) => diag('ui-sync auth recheck error', err && err.message));
  }, AUTH_RECHECK_MS);
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Start the feed. Idempotent. `getWindow()` returns the live SPA BrowserWindow (or
 *  null), called at SEND time; `getAccessToken()` returns a valid Supabase access JWT
 *  (main/auth-tokens.js), called at every JOIN — neither is captured once. Nothing
 *  subscribes until `watch()` names a workspace. */
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

/** Switch the watched workspace (null unwatches). The old channel's queued signals are
 *  DROPPED, not delivered into the new view, and the generation bump makes every
 *  in-flight frame from it inert. */
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

/** The workspace the feed is watching (null = nothing). Read by the auth fan-out so a
 *  same-operator sign-out → sign-in can put it back: stop() clears `watched` on purpose,
 *  and the renderer's registry dedupes on module state it never re-issues from. */
function watchedWorkspace() { return watched; }

/** powerMonitor 'resume' / 'unlock-screen'. The machine may have slept through a whole
 *  token lifetime and a socket death the OS never surfaced, so this rejoins from scratch
 *  with a fresh credential instead of trusting a connection that looks live. */
function onWake() {
  if (!started || !watched) return;
  diag('ui-sync wake —', describeState());
  attempt = 0;
  // Belt-and-braces with the raced token read: a latch left closed by a promise the
  // OS froze mid-sleep is exactly what a wake can clear.
  connecting = false;
  clearReconnect();
  connect();
}

/**
 * Re-apply the current credential to the LIVE socket and rejoin if the channel is down.
 * The auth fan-out (main/shell-mode.js) calls this on a 'signed-in' transition (every
 * successful refresh emits one) so a rotation lands at once rather than up to
 * AUTH_RECHECK_MS later. Safe to call any time.
 */
function refreshAuth() {
  if (!started || !client || !watched) return;
  applyAuth('rotate')
    .then((ok) => {
      if (ok && !subscribed && !reconnectTimer) connect();
    })
    .catch((err) => diag('ui-sync refreshAuth error', err && err.message));
}

/** Tear everything down (quit / sign-out). Safe when never started. `watched` is
 *  CLEARED: a later start() must not silently rejoin the previous session's workspace
 *  before the renderer re-issues its watch — after a sign-out that is another user's.
 *  Only the auth fan-out's SAME-OPERATOR replay may put it back (watchedWorkspace). */
function stop() {
  started = false;
  watched = null;
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
  start, stop, watch, onWake, refreshAuth, watchedWorkspace,
  snapshot: describeState,
  SYNC_EVENT,
  // The table list and pure core — for callers that need the rule, not the socket.
  SYNC_TABLES, LISTENER_OWNED_TABLES,
  COALESCE_MS, RECONNECT_DELAYS_MS, AUTH_RECHECK_MS, AUTH_READ_TIMEOUT_MS,
  nextTopic, backoffMs, payloadWorkspaceId, shouldForward,
  createSyncCoalescer, catchUpBatch,
};
