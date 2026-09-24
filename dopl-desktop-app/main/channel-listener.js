// Background Channels listener: for every channel the operator can see, an authenticated long-poll
// (`/api/channels/[id]/await`) from a persisted cursor with capped-exponential backoff, woken early by
// realtime. Per-message dispatch is `listener-messages.js`; the ask → launch pipeline is `trigger.js`.
// This file keeps the loop, channel-set reconciliation and the start/stop/status surface.
// Auth is forwarded Supabase cookies (auth.js). No renderer IPC. `diag` → userData/listener.log; never
// log tokens.

const { Notification } = require('electron');
const auth = require('./auth');
const spawner = require('./session-spawner');
const claudeRuntime = require('./claude-runtime'); // "can a session run at all" (NOT claudeAvailable)
const presence = require('./presence');
const io = require('./listener-io');
const targeting = require('./targeting');
const messages = require('./listener-messages');
const sessionEngine = require('./session-engine'); const parkOnClaim = require('./session-park-on-claim');
const realtime = require('./realtime');
const heal = require('./listener-heal');
const seedWatch = require('./channel-seed-watch');
const { LISTENER, REALTIME } = require('./config');

const { diag } = require('./diag');

let running = false;
let onStatus = null; // tray callback
let refreshTimer = null;
let cliWarned = false;
let myUserId = null; // resolved operator identity (H2); null until known
let reconciling = null; // in-flight reconcile promise (M1 re-entrancy guard)
const loops = new Map(); // channelId -> loop entry
// The last workspace set enumerated, so push wedged at want=0 can be repaired before a pass that may fail.
let lastGoodWorkspaceIds = [];
const healer = heal.createReconcileHealer({ run: () => reconcile(), log: diag });

// ── Per-channel long-poll loop ──
async function channelLoop(entry) {
  while (running && !entry.stop) {
    const since = io.getCursor(entry.channel.id);
    // Trust push only when THIS entry's workspace subscription is healthy (not a global flag); otherwise
    // fall back to the held long-poll.
    const healthy = REALTIME.ENABLED && realtime.isWorkspaceHealthy(entry.workspaceId);
    entry.dirty = false;
    // A wake (powerMonitor or a realtime INSERT) aborts the in-flight poll and re-awaits at once.
    const awaitCtrl = new AbortController();
    entry.awaitCtrl = awaitCtrl;
    let res;
    try {
      res = await io.awaitOrCheap(entry, since, healthy, awaitCtrl.signal);
    } catch (err) {
      entry.awaitCtrl = null;
      // A wake re-awaits at once; our own expired budget takes the backoff (`listener-budget.js`).
      if (io.isWakeAbort(err, awaitCtrl.signal, entry.channel.id)) continue;
      await backoff(entry);
      continue;
    }
    entry.awaitCtrl = null;
    if (!res.ok) io.discardBody(res); // an abandoned undici body pins its socket (api-repair.js)
    // THIS channel is gone (not the feature): drop just this loop, compare-and-delete so a stale loop
    // never evicts its replacement.
    if (res.status === 404) {
      entry.stop = true;
      if (loops.get(entry.channel.id) === entry) loops.delete(entry.channel.id);
      return;
    }
    if (res.status === 401) {
      io.notifyStale();
      try {
        const s = await auth.ensureFresh();
        if (s) await auth.writeSessionCookies(s);
        if (REALTIME.ENABLED) realtime.refreshAuth(); // keep the WS JWT fresh too
      } catch (err) {
        diag('channelLoop 401 refresh error', err && err.message);
      }
      await backoff(entry);
      continue;
    }
    if (!res.ok) {
      await backoff(entry);
      continue;
    }

    entry.attempts = 0;
    io.resetStale();
    let data;
    try {
      data = await res.json();
    } catch (_) {
      await io.sleep(LISTENER.IDLE_GAP_MS);
      continue;
    }

    const msgs = io.normalizeList(data, 'messages')
      .slice()
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const maxSeq = msgs.reduce((mx, m) => Math.max(mx, m.seq || 0), since);
    const drained = msgs.length > 0;

    // First watch: drain history silently to the tip, then go live (a trigger in that first window is
    // absorbed — an accepted limitation, L1).
    if (entry.seedMode) {
      if (maxSeq > since) io.setCursor(entry.channel.id, maxSeq);
      if (data.timedOut || msgs.length === 0) {
        io.markSeeded(entry.channel.id);
        entry.seedMode = false;
      }
    } else if (await messages.drainPage(entry, msgs, myUserId)) {
      // C-3: a message whose dispatch did not land holds the cursor; back off and re-await from it.
      await messages.deferBackoff(entry);
      continue;
    }
    await io.idleAfterAwait(entry, healthy, drained);
  }
}

async function backoff(entry) {
  const n = entry.attempts || 0;
  const delay = Math.min(LISTENER.BACKOFF_MAX_MS, LISTENER.BACKOFF_BASE_MS * 2 ** n);
  const jitter = Math.floor(Math.random() * 500);
  entry.attempts = n + 1;
  await io.sleep(delay + jitter);
}

// ── Channel-set reconciliation ──
// Not re-entrant (M1): concurrent callers share one in-flight pass, and `heal.watchPass` releases a
// hung pass so the guard can never become a permanent off switch.
function reconcile() {
  if (reconciling) return reconciling;
  reconciling = heal.watchPass(
    reconcileInner().catch((e) => console.error('[listener] reconcile error:', e && e.message)),
    (ms) => diag('reconcile: pass still running after', ms / 1000, 's — RELEASING the',
      'single-flight guard so the next tick can run. The hung pass is abandoned, not cancelled.')
  ).then(() => { reconciling = null; });
  return reconciling;
}

async function reconcileInner() {
  if (!running) return;
  // Cookie-aware: `ensureSignedIn` repairs a dead session blob from the jar before answering.
  if (!(await auth.ensureSignedIn())) {
    forgetOperator(); // force re-resolve on next sign-in
    stopLoops();
    presence.setWorkspaces([]); // stop heartbeating when signed out
    if (REALTIME.ENABLED) realtime.setWorkspaces([]); // drop the WS subscriptions
    lastGoodWorkspaceIds = [];
    diag('reconcile: signed out (no blob, no cookie session) — listener idle');
    setStatus();
    return;
  }
  // FIX S4: jar and blob name different users — drop the cached identity while that lasts.
  if (auth.identityMismatch()) forgetOperator();
  // Push wedged at want=0 with a live credential: re-apply the last good set first.
  if (REALTIME.ENABLED &&
      heal.shouldReapplyWorkspaces(true, realtime.desiredCount(), lastGoodWorkspaceIds.length)) {
    diag('reconcile self-heal: realtime want=0 with a live credential — re-applying',
      lastGoodWorkspaceIds.length, 'workspace(s)');
    realtime.refreshAuth();
    realtime.setWorkspaces(lastGoodWorkspaceIds);
  }
  let workspaces;
  try {
    workspaces = await io.listWorkspaces();
  } catch (err) { diag('reconcile: listWorkspaces error —', err && err.message); workspaces = null; }
  // Nothing enumerated (not "one workspace failed"): presence/realtime keep their last-good sets.
  if (workspaces === null) { healer.onWorkspaceListFailure(); setStatus(); return; }
  healer.noteWorkspaceListOk(); // the list answered — reset its backoff ladder

  const desired = new Map();
  const failedWorkspaces = new Set(); // enumeration never answered for these
  for (const ws of workspaces) {
    if (!ws || !ws.id) continue;
    await io.refreshNameCache(ws);
    const workspaceSegment = ws.slug && ws.publicId ? `${ws.slug}-${ws.publicId}` : null;
    // null = never answered (after the retry ladder): NOT empty — its loops survive the prune and one
    // follow-up pass is scheduled.
    const chans = await io.listChannelsWithRetry(ws.id);
    if (chans === null) {
      failedWorkspaces.add(ws.id);
      diag('reconcile: channel enumeration FAILED ws', ws.slug || String(ws.id).slice(0, 8),
        '— keeping existing loops, retry scheduled');
      continue;
    }
    for (const c of chans) {
      if (!c || !c.id) continue;
      desired.set(c.id, { workspaceId: ws.id, workspaceSegment, channel: c });
    }
  }

  // Presence targets every member workspace. An empty set is an ANSWER too (FIX S8).
  const wsIds = workspaces.map((w) => w && w.id).filter(Boolean);
  lastGoodWorkspaceIds = wsIds; parkOnClaim.noteWorkspaces(workspaces, diag); // ruling 5: a container that gained a PEER stops its sessions
  presence.setWorkspaces(wsIds);
  if (REALTIME.ENABLED) { realtime.refreshAuth(); realtime.setWorkspaces(wsIds); }

  // H2: resolve the operator before any loop can classify (a loop must never self-trigger).
  if (!myUserId) {
    const firstWs = desired.size ? desired.values().next().value.workspaceId : undefined;
    myUserId = await io.resolveOperatorUserId(firstWs);
    sessionEngine.setSelfIdentity(myUserId);
  }

  // Stop loops no longer desired — except a failed workspace's, whose absence means nothing.
  for (const [id, entry] of loops) {
    if (desired.has(id)) continue;
    if (heal.keepLoopOnPrune(entry.workspaceId, failedWorkspaces)) continue;
    entry.stop = true;
    loops.delete(id);
  }
  // Start loops for newly seen channels (re-checked right before starting); refresh the rest.
  for (const [id, d] of desired) {
    const existing = loops.get(id);
    if (!existing) {
      const entry = {
        channel: d.channel,
        workspaceId: d.workspaceId,
        workspaceSegment: d.workspaceSegment,
        stop: false,
        attempts: 0,
        // Seed (suppress the backlog) only on a channel's first-ever watch; a seeded one starts LIVE.
        seedMode: io.shouldSeed(id),
      };
      loops.set(id, entry);
      // A thrown loop is logged and dropped (the next pass re-creates it). Compare-and-delete: a stale
      // crash must not evict a healthy replacement for the same channel.
      channelLoop(entry).catch((err) => {
        diag('channelLoop crashed', id.slice(0, 8), err && err.message);
        entry.stop = true;
        if (loops.get(id) === entry) loops.delete(id);
      });
    } else {
      existing.channel = d.channel;
      existing.workspaceId = d.workspaceId;
      existing.workspaceSegment = d.workspaceSegment;
    }
  }
  // One bounded follow-up pass when a workspace never answered.
  healer.onEnumerationFailure(failedWorkspaces.size);
  setStatus();
  // Last, and guarded (P3-36): seeds agent-created channels from the defaults (`channel-seed-watch.js`).
  try { seedWatch.observeChannels(desired, failedWorkspaces.size === 0, myUserId); }
  catch (err) { diag('seed-watch: pass failed —', err && err.message); }
}

// Drop the operator identity in BOTH places it is held: this cache AND the engine's copy, which every launch lane
// reads for the roster's self-exclusion and the session's operator stamp — else a launch before the next resolve
// runs under the previous account's id.
function forgetOperator() {
  myUserId = null;
  sessionEngine.setSelfIdentity(null);
}

function stopLoops() {
  for (const entry of loops.values()) entry.stop = true;
  loops.clear();
}

// ── Public API ──
function status() {
  if (!running) return 'Listener: off';
  if (!auth.isSignedIn()) return 'Listener: signed out';
  if (!io.isFeatureAvailable()) return 'Listener: waiting for Channels';
  const n = loops.size;
  return `Listener: watching ${n} channel${n === 1 ? '' : 's'}`;
}

// The tray gets the status string and the signed-out FACT (`running === false` is "off", not signed out).
function setStatus() {
  if (onStatus) {
    try { onStatus(status(), { signedOut: running && !auth.isSignedIn() }); } catch (_) { /* tray may be gone */ }
  }
}

// The watched channels for the tray's folder menu: id + name only (a projection; fields come from
// `watchedChannel`).
function listWatchedChannels() {
  return [...loops.values()].filter((e) => e && e.channel && e.channel.id)
    .map((e) => ({ id: e.channel.id, name: e.channel.name || 'Channel' }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// MAIN'S OWN server DTO for one watched channel — the launch lanes' tool-profile source (F-267), so
// they cannot disagree about a channel. Unwatched → null, and the caller fails closed.
function watchedChannel(channelId) {
  return (loops.get(String(channelId || '')) || {}).channel || null;
}

// Notification click handlers (from index.js), owned by targeting.js.
function setHandlers(h) {
  targeting.setHandlers(h);
}

function start(statusCb, h) {
  onStatus = statusCb || onStatus;
  if (h) targeting.setHandlers(h);
  if (running) { reconcile(); return; }
  running = true;
  presence.start(); // Feature 5: heartbeat (self-gates on sign-in + workspace set)
  if (REALTIME.ENABLED) {
    realtime.start({
      getAccessTokenInfo: auth.getAccessTokenInfo,
      getAccessToken: auth.getAccessToken,
      onInsert: wakeChannel,
      onHealthChange: onRealtimeHealth,
    });
  }
  // The startup notice fires only when NOTHING here can run a session (`claude-runtime.js` owns the copy).
  claudeRuntime.checkRuntimeAtStart({
    externalCli: () => spawner.claudeAvailable(),
    log: diag,
    notify: (n) => {
      if (cliWarned) return;
      cliWarned = true;
      try { if (Notification.isSupported()) new Notification(n).show(); } catch (_) { /* best-effort */ }
    },
  }).catch(() => { /* a probe failure must never stop the listener */ });
  reconcile();
  refreshTimer = setInterval(reconcile, LISTENER.CHANNEL_REFRESH_MS);
  setStatus();
}

// Re-reconcile now; on sign-in AND sign-out, since `channel-context`'s cache may name the previous identity.
function restart() {
  try { require('./channel-context').forget(); } catch (_) { /* cache is optional */ }
  if (!running) { start(onStatus); return; }
  reconcile();
}

// Fast catch-up after wake/unlock: abort in-flight polls, beat presence, reconcile. Backoffs are untouched.
function wake() {
  if (!running) { start(onStatus); return; }
  for (const entry of loops.values()) {
    try { if (entry.awaitCtrl) entry.awaitCtrl.abort(); } catch (_) { /* already gone */ }
  }
  presence.wake();
  reconcile();
}

// A realtime INSERT wakes only that channel's loop (coalesced in realtime.js).
function wakeChannel(channelId) {
  const entry = loops.get(channelId);
  diag('realtime wake', String(channelId).slice(0, 8), `(loop=${entry ? 'hit' : 'miss'})`);
  // A miss = a stale channel SET: re-enumerate, bounded to one pass per window (F-072).
  if (!entry) { healer.onLoopMiss(channelId); return; }
  io.wakeEntry(entry);
}

// Push health flipped: nudge every loop to re-evaluate now.
function onRealtimeHealth(_healthy) {
  for (const entry of loops.values()) io.wakeEntry(entry);
}

function stop() {
  running = false;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  healer.stop(); // cancel any pending self-heal retry
  stopLoops();
  const away = presence.stop(); // heartbeat off + a final `away` post (2026-09-08)
  realtime.stop(); // Push transport: close the Realtime WS
  setStatus();
  return away; // quit-guard races it inside its own flush deadline
}

module.exports = { start, stop, restart, wake, status, setHandlers, listWatchedChannels, watchedChannel };
