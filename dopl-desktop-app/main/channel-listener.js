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
// pipeline to trigger.js. This file keeps the long-poll loop, channel-set
// reconciliation, and the public start/stop/restart/status/setHandlers surface.

const { Notification } = require('electron');
const auth = require('./auth');
const spawner = require('./session-spawner');
const presence = require('./presence');
const io = require('./listener-io');
const targeting = require('./targeting');
const trigger = require('./trigger');
const taskNotify = require('./task-notify');
const watcher = require('./consent-watcher');
const sessionEngine = require('./session-engine');
const realtime = require('./realtime');
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

// ── v2.2 session-window dispatch (checked BEFORE classify → consent, §A.2) ────
// The three pre-classify routes (feedLiveSession, maybeOpenRequesterSession,
// maybeSurfaceRequesterReply) live in session-dispatch.js — extracted to keep this
// file ≤500 and to make room for item 3's secondary path. All SHORT-CIRCUIT when
// window-mode is OFF, so the classify path below stays byte-for-byte legacy behavior.
const sessionDispatch = require('./session-dispatch');

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
        // v2.2 session-window dispatch, checked BEFORE classify → consent (§A.2):
        //   1. feed a LIVE session's next turn; 2. auto-open a REQUESTER window on my
        //   own create_task; 3. reopen a SETTLED-yet-resumable requester on a peer reply.
        //   All no-op when window-mode is OFF (byte-for-byte legacy classify below).
        if (sessionDispatch.feedLiveSession(entry, m, myUserId)) continue;
        if (await sessionDispatch.maybeOpenRequesterSession(entry, m, myUserId)) continue;
        if (await sessionDispatch.maybeSurfaceRequesterReply(entry, m, myUserId)) continue;
        const verdict = targeting.classify(m, entry, myUserId);
        diag(
          'msg', entry.channel.id.slice(0, 8), 'seq', m.seq, 'kind', m.kind,
          'authorKind', m.authorKind, 'author', String(m.authorUserId || '').slice(0, 8),
          'me', myUserId ? String(myUserId).slice(0, 8) : 'NULL',
          'members', Number(entry.channel && entry.channel.memberCount) || '?',
          'to', targeting.metaStr(m, 'to_user_id') ? String(targeting.metaStr(m, 'to_user_id')).slice(0, 8) : '-',
          'verdict', verdict
        );
        if (verdict === 'trigger') await trigger.handleTrigger(entry, m);
        else if (verdict === 'fyi') trigger.sendFyi(entry, m);
        // Feature 4 (requester side): a reply in one of MY interactive tasks —
        // passive notify only. No consent row, no watcher record, no spawn.
        else if (verdict === 'task-reply') taskNotify.notifyTaskReply(entry, m);
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
  if (!auth.isSignedIn()) {
    myUserId = null; // force re-resolve on next sign-in
    stopLoops();
    presence.setWorkspaces([]); // stop heartbeating when signed out
    if (REALTIME.ENABLED) realtime.setWorkspaces([]); // drop the WS subscriptions
    watcher.reset(); // FIX 1: drop in-memory pending records + zero the tray count
    setStatus();
    return;
  }
  let workspaces;
  try {
    workspaces = await io.listWorkspaces();
  } catch (err) {
    console.error('[listener] listWorkspaces error:', err && err.message);
    setStatus();
    return;
  }
  if (workspaces === null) { setStatus(); return; } // 401 handled

  const desired = new Map();
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
    let chans = [];
    try {
      chans = await io.listChannels(ws.id);
    } catch (err) {
      console.error('[listener] listChannels error:', err && err.message);
    }
    for (const c of chans) {
      if (!c || !c.id) continue;
      if (c.archivedAt) continue;
      desired.set(c.id, { workspaceId: ws.id, workspaceSegment, channel: c });
    }
  }

  // Feature 5: presence heartbeats target every member workspace (not just ones
  // with channels) so the web shows this operator's agent as listening.
  presence.setWorkspaces(workspaces.map((w) => w && w.id).filter(Boolean));
  // Push: refresh the WS JWT (else ~1h expiry silently kills push) + resubscribe.
  if (REALTIME.ENABLED) { realtime.refreshAuth(); realtime.setWorkspaces(workspaces.map((w) => w && w.id).filter(Boolean)); }

  // H2: resolve the operator identity before any loop can evaluate classify().
  if (!myUserId) {
    const firstWs = desired.size ? desired.values().next().value.workspaceId : undefined;
    myUserId = await io.resolveIdentity(firstWs);
    // Item 1: hand the operator identity to the engine so the self avatar resolves.
    sessionEngine.setSelfIdentity(myUserId);
  }

  // Stop loops for channels no longer desired.
  for (const [id, entry] of loops) {
    if (!desired.has(id)) {
      entry.stop = true;
      loops.delete(id);
    }
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

function setStatus() {
  if (onStatus) {
    try { onStatus(status()); } catch (_) { /* tray may be gone */ }
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
      getAccessToken: auth.getAccessToken,
      onInsert: wakeChannel,
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
function restart() {
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
  stopLoops();
  watcher.stop(); // Round B: stop the async consent poll loop
  presence.stop(); // Feature 5: stop heartbeating on shutdown
  realtime.stop(); // Push transport: close the Realtime WS
  setStatus();
}

module.exports = { start, stop, restart, wake, status, setHandlers, listWatchedChannels };
