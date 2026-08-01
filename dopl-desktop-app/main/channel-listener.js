// Background Channels listener.
//
// For every non-archived channel the signed-in user can see, runs an
// authenticated long-poll (`/api/channels/[id]/await`) with a persisted `since`
// cursor and capped-exponential reconnect backoff. New human messages from
// other users trigger a native consent prompt; only on explicit approval does
// session-spawner run a Claude session and post the reply back with an
// idempotent client_msg_id. One active session per channel.
//
// Auth is via forwarded Supabase cookies (see auth.js for why not a bearer).
// No renderer IPC is added — consent is a main-process native dialog.
//
// SPLIT NOTE (§2 refactor): this file was 914 lines. The I/O layer moved to
// listener-io.js, targeting/handoff to targeting.js, and the consent→spawn→reply
// pipeline to trigger.js; per-message dispatch (the session-window routes,
// classify, and the verdict outcomes) moved to listener-messages.js when Q10
// needed one more line and this file was sitting exactly on the cap. What is
// left is the long-poll loop, channel-set reconciliation, and the public
// start/stop/restart/status/setHandlers surface.

const { Notification } = require('electron');
const auth = require('./auth');
const spawner = require('./session-spawner');
const presence = require('./presence');
const io = require('./listener-io');
const targeting = require('./targeting');
const trigger = require('./trigger');
// Per-message dispatch (the three session-window routes, classify, and the three
// verdict outcomes) lives in listener-messages.js — extracted at the 500-line cap.
const messages = require('./listener-messages');
const channelAgents = require('./channel-agents'); // D2: my summons + the agent roster
const watcher = require('./consent-watcher');
const sessionEngine = require('./session-engine');
const realtime = require('./realtime');
const heal = require('./listener-heal');
const { LISTENER, REALTIME } = require('./config');

// Console output is invisible for a GUI-launched app, and the trigger path has
// several deliberate silent skips (fail-closed identity, missing CLI, targeting
// verdicts, FYI muted, sign-in flow states). The shared diag() appends one-line
// diagnostics to userData/listener.log so those decisions are observable in the
// field. Never log tokens.
const { diag } = require('./diag');

let running = false;
let onStatus = null; // tray callback
let refreshTimer = null;
let cliWarned = false;
let myUserId = null; // resolved operator identity (H2); null until known
let reconciling = null; // in-flight reconcile promise (M1 re-entrancy guard)
let onPendingCb = null; // tray pending-count callback (from index.js handlers)
const loops = new Map(); // channelId -> loop entry
// Q4 fix 2: the last workspace set we successfully enumerated, so a `want=0`
// realtime state can be repaired without waiting for a pass that may fail.
let lastGoodWorkspaceIds = [];
// Bounded, coalesced "re-ask later" scheduling for the two self-heal paths
// (loop=miss re-enumeration, unenumerated-workspace retry). See listener-heal.js.
const healer = heal.createReconcileHealer({ run: () => reconcile(), log: diag });

// ── Per-channel long-poll loop ──────────────────────────────────────────────
async function channelLoop(entry) {
  while (running && !entry.stop) {
    const since = io.getCursor(entry.channel.id);
    // Push transport (v2.1): when realtime is HEALTHY, awaitOrCheap does a cheap
    // immediate catch-up + a wake-interruptible long idle; when UNHEALTHY or
    // disabled it collapses to today's held long-poll — byte-for-byte.
    // PER-WORKSPACE (v2.2): trust push only when THIS entry's own workspace sub is
    // subscribed — not a global >=1-sub flag. A loop whose ws errored while another
    // ws stayed up would otherwise think push is healthy and wait on wakes that
    // never come (green globally, silent for the ws that matters).
    const healthy = REALTIME.ENABLED && realtime.isWorkspaceHealthy(entry.workspaceId);
    entry.dirty = false;
    // Per-iteration controller so a wake (powerMonitor OR a realtime INSERT) can
    // abort an in-flight poll and force an immediate re-await from the cursor.
    const awaitCtrl = new AbortController();
    entry.awaitCtrl = awaitCtrl;
    let res;
    try {
      res = await io.awaitOrCheap(entry, since, healthy, awaitCtrl.signal);
    } catch (err) {
      entry.awaitCtrl = null;
      // AbortError is either our own fetch timeout (normal long-poll turnover) or
      // a wake() kick — both just re-await immediately with the current cursor.
      if (err && err.name === 'AbortError') continue;
      await backoff(entry);
      continue;
    }
    entry.awaitCtrl = null;

    if (res.status === 404) {
      // L2: a single channel's await 404 means THIS channel is gone (deleted /
      // left), not that the whole Channels feature is down. Drop just this loop —
      // do NOT flip the global featureAvailable flag. reconcile() re-adds it if
      // the channel reappears. (Whole-feature 404 is caught in listChannels.)
      entry.stop = true;
      // Compare-and-delete: a stale loop's 404 must not evict a healthy
      // replacement entry for the same channel. If a drop→reappear reconcile has
      // already replaced this entry, loops.get() points at the new one — leave it.
      if (loops.get(entry.channel.id) === entry) loops.delete(entry.channel.id);
      return;
    }
    if (res.status === 401) {
      io.notifyStale();
      // ensureFresh/writeSessionCookies swallow their own errors, but never let a
      // surprise rejection escape and kill this loop permanently.
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
    // healthy + drained keeps paging fast; healthy + caught up → the long idle.
    const drained = msgs.length > 0;

    if (entry.seedMode) {
      // Drain history quietly until caught up to the tip, then go live. Avoids
      // replaying a backlog as consent prompts on first watch.
      //
      // L1 (known v1 limitation, documented): a genuine trigger that lands in the
      // very first await window while we're still seeding is absorbed into this
      // cursor advance and won't prompt. Accepted for v1 — suppressing the
      // first-watch backlog outweighs the rare missed first live message.
      if (maxSeq > since) io.setCursor(entry.channel.id, maxSeq);
      if (data.timedOut || msgs.length === 0) {
        io.markSeeded(entry.channel.id);
        entry.seedMode = false;
      }
    } else {
      for (const m of msgs) {
        if ((m.seq || 0) > io.getCursor(entry.channel.id)) io.setCursor(entry.channel.id, m.seq);
        // One message, one outcome — the routes, classify, and the verdict
        // outcomes are listener-messages.js. Awaited, so a trigger's consent +
        // spawn still serializes ahead of the next message in this page.
        await messages.dispatchMessage(entry, m, myUserId);
      }
      if (msgs.length === 0 && maxSeq > since) io.setCursor(entry.channel.id, maxSeq);
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

// ── Channel-set reconciliation ──────────────────────────────────────────────
// M1: reconcile is NOT re-entrant — the startup call and the deep-link restart()
// (+3s timer) can both await the network and then both start loops for the same
// channel (dup long-polls + double consent dialogs). Coalesce concurrent calls
// onto one in-flight promise; subsequent callers await the running pass.
function reconcile() {
  if (reconciling) return reconciling;
  reconciling = reconcileInner()
    .catch((err) => console.error('[listener] reconcile error:', err && err.message))
    .finally(() => {
      reconciling = null;
    });
  return reconciling;
}

async function reconcileInner() {
  if (!running) return;
  // Q4 fix 1: the gate is cookie-aware and ASYNC here. ensureSignedIn() re-reads
  // the cookie jar (and repairs a dead session blob from it) before answering, so
  // a boot whose encrypted blob rotted while the web cookies stayed valid no
  // longer skips the entire listener — which is what left `want=0` wedged.
  if (!(await auth.ensureSignedIn())) {
    myUserId = null; // force re-resolve on next sign-in
    stopLoops();
    presence.setWorkspaces([]); // stop heartbeating when signed out
    if (REALTIME.ENABLED) realtime.setWorkspaces([]); // drop the WS subscriptions
    watcher.reset(); // FIX 1: drop in-memory pending records + zero the tray count
    lastGoodWorkspaceIds = [];
    diag('reconcile: signed out (no blob, no cookie session) — listener idle');
    setStatus();
    return;
  }
  // FIX S4: jar and blob name DIFFERENT users, and `myUserId` is cached for the process's
  // life — so drop that cache while the conflict lasts (auth-state.js refuses to adopt).
  if (auth.identityMismatch()) myUserId = null;
  // Q4 fix 2c: push wedged at want=0 while we hold a live credential. Re-apply the
  // last known-good workspace set NOW, before an enumeration that may itself fail.
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
  } catch (err) {
    diag('reconcile: listWorkspaces error —', err && err.message);
    workspaces = null;
  }
  // A workspace list we never got is the same class of failure as a channel list
  // we never got: retry it soon instead of idling until the 5-minute timer.
  if (workspaces === null) { healer.onEnumerationFailure(1); setStatus(); return; }

  const desired = new Map();
  const failedWorkspaces = new Set(); // enumeration never answered for these
  for (const ws of workspaces) {
    if (!ws || !ws.id) continue;
    // Feature B/C: refresh the userId->displayName cache once per workspace per
    // reconcile so notification copy has requester + target names.
    await io.refreshNameCache(ws);
    // H-3: no trust refresh here any more. Trust is evaluated server-side on
    // every consent create (the row is born 'auto_allowed'), so there is nothing
    // to cache and no window in which a revoked rule keeps auto-allowing.
    // Canonical URL segment for the notification deep-link (Feature B).
    const workspaceSegment = ws.slug && ws.publicId ? `${ws.slug}-${ws.publicId}` : null;
    // Q4 fix 2b: null = "never got an answer" (after the bounded retry ladder), so
    // this workspace is NOT treated as empty — its loops survive the prune below
    // and one follow-up reconcile is scheduled. Dropping it silently is exactly
    // what left samuels-workspace unwatched from 02:18 until the next reboot.
    const chans = await io.listChannelsWithRetry(ws.id);
    if (chans === null) {
      failedWorkspaces.add(ws.id);
      diag('reconcile: channel enumeration FAILED ws', ws.slug || String(ws.id).slice(0, 8),
        '— keeping existing loops, retry scheduled');
      continue;
    }
    for (const c of chans) {
      if (!c || !c.id) continue;
      if (c.archivedAt) continue;
      desired.set(c.id, { workspaceId: ws.id, workspaceSegment, channel: c });
    }
  }

  // Feature 5: presence heartbeats target every member workspace (not just ones
  // with channels) so the web shows this operator's agent as listening.
  const wsIds = workspaces.map((w) => w && w.id).filter(Boolean);
  // FIX S8: the EMPTY set too. `if (wsIds.length)` kept the last non-empty set forever for
  // an operator who left every workspace, so shouldReapplyWorkspaces re-subscribed push to
  // them every 5 minutes in perpetuity. A successful enumeration of nothing is an ANSWER.
  lastGoodWorkspaceIds = wsIds; // the want=0 repair source above
  presence.setWorkspaces(wsIds);
  // Push: refresh the WS JWT (else ~1h expiry silently kills push) + resubscribe.
  if (REALTIME.ENABLED) { realtime.refreshAuth(); realtime.setWorkspaces(wsIds); }

  // H2: resolve the operator identity before any loop can evaluate classify().
  if (!myUserId) {
    const firstWs = desired.size ? desired.values().next().value.workspaceId : undefined;
    myUserId = await io.resolveIdentity(firstWs);
    // Item 1: hand the operator identity to the engine so the self avatar resolves.
    sessionEngine.setSelfIdentity(myUserId);
  }

  // Stop loops for channels no longer desired — EXCEPT those belonging to a
  // workspace we failed to enumerate, whose absence from `desired` means nothing.
  for (const [id, entry] of loops) {
    if (desired.has(id)) continue;
    if (heal.keepLoopOnPrune(entry.workspaceId, failedWorkspaces)) continue;
    entry.stop = true;
    loops.delete(id);
  }
  // Start loops for newly-seen channels; refresh metadata for existing. The
  // in-flight guard above means this runs serialized, but we still re-check
  // loops.get(id) right before starting so a loop is never double-started.
  for (const [id, d] of desired) {
    const existing = loops.get(id);
    if (!existing) {
      const entry = {
        channel: d.channel,
        workspaceId: d.workspaceId,
        workspaceSegment: d.workspaceSegment,
        stop: false,
        attempts: 0,
        // Seed (suppress backlog) ONLY on a channel's first-ever watch. An
        // already-seeded channel — proven by its persisted seeded flag — starts
        // LIVE so messages that landed while the app was quit/asleep surface as
        // real triggers instead of being swallowed. See io.seedModeFor.
        seedMode: io.shouldSeed(id),
        // FIX B1: the "address to act" law must be armed BEFORE the first roster read.
        teamAgents: io.getTeamAgentCount(id), // last known; 0 for a channel never known to have any
        rosterKnown: false, // flipped by channel-agents.js on a SUCCESSFUL read this run
      };
      loops.set(id, entry);
      // Fire-and-forget: a thrown loop must not become an unhandledRejection that
      // silently kills that channel. Log + drop it so the next reconcile (5-min
      // timer, or a wake) re-creates a fresh loop.
      channelLoop(entry).catch((err) => {
        diag('channelLoop crashed', id.slice(0, 8), err && err.message);
        entry.stop = true;
        // Compare-and-delete: a stale crash must not evict a healthy replacement.
        // Race: reconcile drops C (transient listChannels hiccup) → stops+deletes
        // E1; C reappears → reconcile creates E2, loops.set(C, E2); E1's in-flight
        // await then resolves and its final pass throws → this .catch runs. Without
        // the guard it would loops.delete(C) and evict the healthy E2, so the next
        // reconcile starts E3 while E2 still polls = two loops / double consent.
        if (loops.get(id) === entry) loops.delete(id);
      });
      // Crash-recovery for parked / in-flight consent is handled GLOBALLY and once
      // by consent-watcher.resume() at start — durable server rows + the web
      // Pending Requests list replace the old per-channel replay + orphan sweep.
    } else {
      existing.channel = d.channel;
      existing.workspaceId = d.workspaceId;
      existing.workspaceSegment = d.workspaceSegment;
    }
  }
  // D2: read every watched channel's agent roster and start any of MY rows that are still
  // `summoned`. Deliberately the LAST thing a pass does and deliberately not awaited — a
  // slow roster read must never delay channel watching — and single-flight per channel, so
  // this pass and a realtime doorbell can never both summon the same row.
  channelAgents.reconcileAll(loops, myUserId);
  // One bounded follow-up pass when a workspace never answered; no-op otherwise.
  healer.onEnumerationFailure(failedWorkspaces.size);
  setStatus();
}

function stopLoops() {
  for (const entry of loops.values()) entry.stop = true;
  loops.clear();
}

// ── Public API ──────────────────────────────────────────────────────────────
function status() {
  if (!running) return 'Listener: off';
  if (!auth.isSignedIn()) return 'Listener: signed out';
  if (!io.isFeatureAvailable()) return 'Listener: waiting for Channels';
  const n = loops.size;
  return `Listener: watching ${n} channel${n === 1 ? '' : 's'}`;
}

// The tray gets the status STRING plus the signed-out FACT as a boolean; it used to get only
// the string and re-derive the fact with /signed out/i (one copy edit from a vanished sign-in
// affordance). `running === false` is "off", not "signed out".
function setStatus() {
  if (onStatus) {
    try { onStatus(status(), { signedOut: running && !auth.isSignedIn() }); } catch (_) { /* tray may be gone */ }
  }
}

// Round C: the channels currently being watched, for the tray "Channel folders"
// submenu (id + name only — never cursors/tokens/workspace internals). Sorted by
// name for a stable menu.
function listWatchedChannels() {
  const out = [];
  for (const entry of loops.values()) {
    if (!entry || !entry.channel || !entry.channel.id) continue;
    out.push({ id: entry.channel.id, name: entry.channel.name || 'Channel' });
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}

// Register window-control callbacks (from index.js) used when a notification is
// clicked: openChannel(workspaceSegment) shows the window + navigates the webview.
// Delegates to targeting.js, which owns the handoff used by trigger.js/FYI.
// onPending({count,segment}) drives the tray "Pending: N" item + click target.
function setHandlers(h) {
  targeting.setHandlers(h);
  if (h && h.onPending) {
    onPendingCb = h.onPending;
    watcher.start({ resolvers: trigger.resolvers, onPendingCount: onPendingCb });
  }
}

function start(statusCb, h) {
  onStatus = statusCb || onStatus;
  if (h) targeting.setHandlers(h);
  if (h && h.onPending) onPendingCb = h.onPending;
  if (running) { reconcile(); return; }
  running = true;
  presence.start(); // Feature 5: heartbeat (self-gates on sign-in + workspace set)
  // Push transport (v2.1): open the Realtime WS — onInsert wakes the one changed
  // channel; onHealthChange nudges loops when push flips on/off.
  if (REALTIME.ENABLED) {
    realtime.start({
      // getAccessTokenInfo also reports WHICH source the JWT came from and how
      // much life it has left, so a failed subscribe can name its cause.
      getAccessTokenInfo: auth.getAccessTokenInfo,
      getAccessToken: auth.getAccessToken,
      onInsert: wakeChannel,
      // D2: a `channel_agents` INSERT is a doorbell for the ROSTER, not for messages — it
      // re-reads that one channel's agents (channel-agents.js owns the read + the summon).
      onAgentInsert: (id) => channelAgents.wakeChannel(loops.get(id)),
      onHealthChange: onRealtimeHealth,
    });
  }
  // Round B: the async consent watcher — decoupled from the long-poll loop. It
  // polls each pending consent row off-loop and dispatches to trigger.resolvers
  // (spawn / review / echo). Idempotent; resumes durable pending records once.
  watcher.start({ resolvers: trigger.resolvers, onPendingCount: onPendingCb });
  spawner.claudeAvailable().then((ok) => {
    diag('claudeAvailable at start:', ok);
    if (!ok && !cliWarned) {
      cliWarned = true;
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Dopl',
            body: 'Claude CLI not found on PATH. Channel auto-responses stay off until it is installed.',
          }).show();
        }
      } catch (_) { /* best-effort */ }
    }
  });
  reconcile();
  refreshTimer = setInterval(reconcile, LISTENER.CHANNEL_REFRESH_MS);
  setStatus();
}

// Re-run reconciliation now (e.g. right after a fresh sign-in).
// Called on sign-in AND on sign-out (index.js `onSignedOut`), i.e. exactly when the
// identity behind every cached lookup may have changed. channel-context caches a
// channel's name + counterparty for a minute; without this, signing out and back in
// as a DIFFERENT account could resolve the previous operator's channel identity for
// up to that minute. Cheap, and the only caller `forget()` needs.
function restart() {
  try { require('./channel-context').forget(); } catch (_) { /* cache is optional */ }
  if (!running) { start(onStatus); return; }
  reconcile();
}

// Fast catch-up after the Mac wakes / the screen unlocks (wired from index.js
// via powerMonitor). Three cheap steps:
//   1. Abort every in-flight long-poll so each loop re-awaits from its persisted
//      cursor immediately — a message that arrived while asleep surfaces within
//      seconds instead of waiting for the current ~50s await to time out.
//   2. Kick the presence heartbeat (wake also means the network may have
//      changed; beat now so the web shows the agent back online promptly).
//   3. reconcile() to pick up channels joined while asleep — single-flight, so a
//      resume+unlock double-fire coalesces onto one pass.
// A wake left a loop mid-backoff is untouched (no awaitCtrl); it recovers on its
// own capped-backoff schedule. Debounced by the caller (index.js) so rapid
// resume/unlock pairs collapse.
function wake() {
  if (!running) { start(onStatus); return; }
  for (const entry of loops.values()) {
    try { if (entry.awaitCtrl) entry.awaitCtrl.abort(); } catch (_) { /* already gone */ }
  }
  presence.wake();
  reconcile();
}

// A realtime channel_messages INSERT: wake ONLY that channel's loop (abort its
// cheap await + resolve its idle) so it catches up now. Coalesced in realtime.js
// (one wake/channel/burst); io.wakeEntry no-ops on a channel with no loop.
function wakeChannel(channelId) {
  const entry = loops.get(channelId);
  // DIAG: every wake the transport fires, and whether a live loop caught it
  // (hit) or the channel has no loop yet (miss) — closes the trace INSERT→wake.
  diag('realtime wake', String(channelId).slice(0, 8), `(loop=${entry ? 'hit' : 'miss'})`);
  // Q4 fix 2a: a miss means push is delivering for a channel our channel SET does
  // not know about — a stale set, not a stale message. Re-enumerate instead of
  // letting it persist to reboot. Bounded: the healer admits ONE reconcile per
  // window and swallows every further miss inside it (F-072, no storm).
  if (!entry) { healer.onLoopMiss(channelId); return; }
  io.wakeEntry(entry);
}

// Push health flipped: nudge every loop to re-evaluate now, so a drop to the
// long-poll doesn't wait out a caught-up loop's 5-min idle before held-polling.
function onRealtimeHealth(_healthy) {
  for (const entry of loops.values()) io.wakeEntry(entry);
}

function stop() {
  running = false;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  healer.stop(); // cancel any pending self-heal retry
  stopLoops();
  watcher.stop(); // Round B: stop the async consent poll loop
  presence.stop(); // Feature 5: stop heartbeating on shutdown
  realtime.stop(); // Push transport: close the Realtime WS
  setStatus();
}

module.exports = { start, stop, restart, wake, status, setHandlers, listWatchedChannels };
