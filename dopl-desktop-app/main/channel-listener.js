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
const { LISTENER } = require('./config');

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
const loops = new Map(); // channelId -> loop entry

// ── Per-channel long-poll loop ──────────────────────────────────────────────
async function channelLoop(entry) {
  while (running && !entry.stop) {
    const since = io.getCursor(entry.channel.id);
    let res;
    try {
      res = await io.apiFetch(
        `/api/channels/${entry.channel.id}/await?since=${since}&timeoutMs=${LISTENER.AWAIT_TIMEOUT_MS}`,
        { workspaceId: entry.workspaceId, timeoutMs: LISTENER.AWAIT_FETCH_TIMEOUT_MS }
      );
    } catch (err) {
      // AbortError from our own fetch timeout is a normal long-poll turnover.
      if (err && err.name === 'AbortError') continue;
      await backoff(entry);
      continue;
    }

    if (res.status === 404) {
      // L2: a single channel's await 404 means THIS channel is gone (deleted /
      // left), not that the whole Channels feature is down. Drop just this loop —
      // do NOT flip the global featureAvailable flag. reconcile() re-adds it if
      // the channel reappears. (Whole-feature 404 is caught in listChannels.)
      entry.stop = true;
      loops.delete(entry.channel.id);
      return;
    }
    if (res.status === 401) {
      io.notifyStale();
      await auth.ensureFresh().then((s) => s && auth.writeSessionCookies(s));
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
      }
      if (msgs.length === 0 && maxSeq > since) io.setCursor(entry.channel.id, maxSeq);
    }
    await io.sleep(LISTENER.IDLE_GAP_MS);
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

  // H2: resolve the operator identity before any loop can evaluate classify().
  if (!myUserId) {
    const firstWs = desired.size ? desired.values().next().value.workspaceId : undefined;
    myUserId = await io.resolveIdentity(firstWs);
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
        seedMode: !io.isSeeded(id),
      };
      loops.set(id, entry);
      channelLoop(entry);
      // M-6 then M5b: clear dead outbound cards before recovering a pending one.
      trigger.sweepStaleOutbound(entry).then(() => trigger.replayPendingFor(entry));
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

// Register window-control callbacks (from index.js) used when a notification is
// clicked: openChannel(workspaceSegment) shows the window + navigates the webview.
// Delegates to targeting.js, which owns the handoff used by trigger.js/FYI.
function setHandlers(h) {
  targeting.setHandlers(h);
}

function start(statusCb, h) {
  onStatus = statusCb || onStatus;
  if (h) targeting.setHandlers(h);
  if (running) { reconcile(); return; }
  running = true;
  presence.start(); // Feature 5: heartbeat (self-gates on sign-in + workspace set)
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

function stop() {
  running = false;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  stopLoops();
  presence.stop(); // Feature 5: stop heartbeating on shutdown
  setStatus();
}

module.exports = { start, stop, restart, status, setHandlers };
