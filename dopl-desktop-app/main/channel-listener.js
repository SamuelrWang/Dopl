// Background Channels listener.
//
// For every non-archived channel the signed-in user can see, runs an
// authenticated long-poll (`/api/channels/[id]/await`) with a persisted `since` cursor and
// capped-exponential reconnect backoff. An ADDRESSED message from another member raises a native
// notification whose button launches a windowless SDK session; that session posts its own reply
// with an idempotent client_msg_id.
// ⚠ IT SAID "trigger a native consent prompt; only on explicit approval…" and "consent is a
// main-process native dialog" until 2026-08-22 — both described the INBOUND CONSENT LANE, deleted
// (see `trigger.js`'s header): the button LAUNCHES, approving nothing, because there is no row.
// "One active session per channel" went earlier, with the one-agent-per-thread law (2026-08-21
// multiplayer); `MAX_CONCURRENT_SESSIONS` is the bound now.
//
// Auth is via forwarded Supabase cookies (see auth.js for why not a bearer). No renderer IPC.
//
// SPLIT NOTE (§2 refactor): this file was 914 lines. The I/O layer moved to listener-io.js,
// targeting/handoff to targeting.js, and the notify→spawn→reply pipeline to trigger.js;
// per-message dispatch (the ONE surviving route — the other session-window routes are deleted,
// classify, and the verdict outcomes) moved to listener-messages.js when Q10 needed one more line
// and this file was sitting exactly on the cap. What is left is the long-poll loop, channel-set
// reconciliation, and the public start/stop/restart/status/setHandlers surface.

const { Notification } = require('electron');
const auth = require('./auth');
const spawner = require('./session-spawner');
const claudeRuntime = require('./claude-runtime'); // "can a session run at all" (NOT claudeAvailable)
const presence = require('./presence');
const io = require('./listener-io');
const targeting = require('./targeting');
// ⚠ `require('./trigger')` IS DELETED (2026-08-22): its ONE use here was `trigger.resolvers`,
// handed to the consent watcher. The trigger path is reached through `listener-messages.js`.
// Per-message dispatch (⚠ the three session-window routes are GONE, classify, and the three
// verdict outcomes) lives in listener-messages.js — extracted at the 500-line cap.
const messages = require('./listener-messages');
const sessionEngine = require('./session-engine'); const parkOnClaim = require('./session-park-on-claim'); // ...and RULING 5 (plan §4.5)
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
// ⚠ `onPendingCb` IS DELETED (2026-08-22): it carried the tray's "Pending: N" count, written by
// `consent-watcher.js › emitCount` — the INBOUND consent records awaiting a decision. There are
// none (see `trigger.js`'s header), so the count has no producer and the tray item went too.
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
      // ⚠ A WAKE RE-AWAITS AT ONCE; OUR OWN EXPIRED BUDGET TAKES THE LADDER. This branch used to
      // do neither — one undiscriminated `continue` for both, which is what let a merely slow
      // server set the loop's rate. `listener-budget.js › isWakeAbort` carries the whole incident.
      if (io.isWakeAbort(err, awaitCtrl.signal, entry.channel.id)) continue;
      await backoff(entry);
      continue;
    }
    entry.awaitCtrl = null;
    if (!res.ok) io.discardBody(res); // an abandoned undici body pins its socket (api-repair.js)
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
      // replaying a backlog as ask notifications on first watch.
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
    } else if (await messages.drainPage(entry, msgs, myUserId)) {
      // C-3: the page stopped at a message whose dispatch did NOT land, and the persisted
      // cursor is still behind it. Back off and re-await from there rather than taking the
      // normal idle, which would hot-loop on the same message every IDLE_GAP. drainPage
      // owns the whole cursor decision — including the bounded ladder and the loud escape
      // when one message can never be dispatched.
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

// ── Channel-set reconciliation ──────────────────────────────────────────────
// M1: reconcile is NOT re-entrant — the startup call and the deep-link restart()
// (+3s timer) can both await the network and then both start loops for the same
// channel (dup long-polls + double ask notifications). Coalesce concurrent calls
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
    // ⚠ `watcher.reset()` STOOD HERE (FIX 1: drop in-memory pending records + zero the tray
    // count) and went with `consent-watcher.js` on 2026-08-22. There is no in-memory record set
    // to drop on sign-out and no count to zero — the ask notification holds nothing durable.
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
  } catch (err) { diag('reconcile: listWorkspaces error —', err && err.message); workspaces = null; }
  // Nothing was enumerated — NOT "one unenumerated workspace" (listener-heal owns
  // the copy AND the ordering note: presence/realtime keep their last-good sets).
  if (workspaces === null) { healer.onWorkspaceListFailure(); setStatus(); return; }
  healer.noteWorkspaceListOk(); // the list answered — reset its backoff ladder

  const desired = new Map();
  const failedWorkspaces = new Set(); // enumeration never answered for these
  for (const ws of workspaces) {
    if (!ws || !ws.id) continue;
    // Feature B/C: refresh the userId->displayName cache once per workspace per
    // reconcile so notification copy has requester + target names.
    await io.refreshNameCache(ws);
    // H-3: no trust refresh here any more, and since 2026-08-22 no trust READ anywhere on this
    // machine's inbound path — the standing rules whose whole job was to make a row born
    // `auto_allowed` never fired once, and the inbound row is deleted with them.
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
  lastGoodWorkspaceIds = wsIds; parkOnClaim.noteWorkspaces(workspaces, diag); // ...and RULING 5: a container that gained a PEER stops its live sessions
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
        // The entry used to carry `teamAgents` / `rosterKnown` — the tri-state behind the
        // "address to act" law, which disabled the implicit 2-member trigger while this
        // operator had summoned agents in the room. Both are gone with summoning
        // (channels rollback §1), and the implicit 2-member trigger they gated is gone
        // too (2026-08-18) — an unaddressed post now triggers nobody at any count.
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
        // reconcile starts E3 while E2 still polls = two loops / double notification.
        if (loops.get(id) === entry) loops.delete(id);
      });
      // ⚠ NO CRASH-RECOVERY PASS FOR AN ASK ANY MORE (2026-08-22). This pointed at
      // `consent-watcher.resume()`, which reloaded durable inbound records so a request parked
      // across a quit stayed answerable. The record went with the row: an ask nobody acted on is
      // not acted on, and the message is still in the thread for the operator to launch from.
    } else {
      existing.channel = d.channel;
      existing.workspaceId = d.workspaceId;
      existing.workspaceSegment = d.workspaceSegment;
    }
  }
  // A pass used to end by reading every watched channel's agent roster and starting any of
  // this operator's rows that were still `summoned`. Summoning is gone (channels rollback
  // §1), and with it the only reason this listener ever read that table.
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

// Round C: the channels currently being watched, for the tray "Channel folders" submenu (id +
// name only — never cursors/tokens/workspace internals). Sorted by name for a stable menu.
// ⚠ IT IS A PROJECTION AND MUST STAY ONE — a caller needing a FIELD takes `watchedChannel` below.
function listWatchedChannels() {
  return [...loops.values()].filter((e) => e && e.channel && e.channel.id)
    .map((e) => ({ id: e.channel.id, name: e.channel.name || 'Channel' }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// MAIN'S OWN FULL RECORD for ONE watched channel — the server DTO `reconcile` stored on the loop
// entry, and the same object `trigger.js` hands `targeting.resolveToolProfile` on the responder
// lane, so the two launch lanes cannot disagree about one channel. ONE reader:
// `session-ipc-ops.js › sessions:launch` (F-267). Unwatched -> null; that caller fails closed.
function watchedChannel(channelId) {
  return (loops.get(String(channelId || '')) || {}).channel || null;
}

// Register window-control callbacks (from index.js) used when a notification is
// clicked: openChannel(workspaceSegment) shows the window + navigates the webview.
// Delegates to targeting.js, which owns the handoff used by trigger.js/FYI.
// ⚠ `onPending({count,segment})` WAS THE SECOND HANDLER AND IS DELETED (2026-08-22) — it drove
// the tray "Pending: N" item, whose only producer was the inbound consent watcher.
function setHandlers(h) {
  targeting.setHandlers(h);
}

function start(statusCb, h) {
  onStatus = statusCb || onStatus;
  if (h) targeting.setHandlers(h);
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
      onHealthChange: onRealtimeHealth,
    });
  }
  // ⚠ `watcher.start({ resolvers: trigger.resolvers, … })` IS DELETED (2026-08-22): it ran the
  // consent poll loop that drove the INBOUND lane's spawn / decline / expiry resolvers off this
  // loop. The ask is a notification, and its Launch button calls `trigger` directly.
  // 2026-08-04: warn ONLY when NOTHING here can run a session. The old notice fired
  // on the EXTERNAL-CLI probe and told most installs their channel auto-responses
  // were off while the bundled binary answered fine. claude-runtime.js owns that
  // distinction and the copy; this injects the surfaces and decides nothing.
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

// Re-run reconciliation now (e.g. right after a fresh sign-in). Called on sign-in AND on sign-out
// (index.js `onSignedOut`), i.e. exactly when the identity behind every cached lookup may have
// changed. channel-context caches a channel's name + counterparty for a minute; without this,
// signing out and back in as a DIFFERENT account could resolve the previous operator's channel
// identity for up to that minute. Cheap, and the only caller `forget()` needs.
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
// A wake left a loop mid-backoff is untouched (no awaitCtrl); it recovers on its own capped-backoff
// schedule. Debounced by the caller (index.js) so rapid resume/unlock pairs collapse.
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
  // ⚠ `watcher.stop()` went with the consent poll loop (2026-08-22) — there is no second timer
  // family left in this module to tear down.
  presence.stop(); // Feature 5: stop heartbeating on shutdown
  realtime.stop(); // Push transport: close the Realtime WS
  setStatus();
}

module.exports = { start, stop, restart, wake, status, setHandlers, listWatchedChannels, watchedChannel };
