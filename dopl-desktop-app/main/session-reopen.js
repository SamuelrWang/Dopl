// Session reopen helpers (v2.2 Session Window, item 2 + item 10; v1.7.4 P2 fallback).
//
// Extracted from session-engine.js purely to keep that AT-CAP file under 500 lines
// (contract §O-7 / F-09c). These read the engine's LIVE-session registry, which the
// engine injects once via bind() at load — this module holds NO electron/SDK handle
// and never imports back into the engine (no cycle). session-store is required only
// for the (channel,task) key; it is a free var inside the PURE block so
// test/session-reopen.test.mjs slices the block and injects a fake store + deps.
//
//   listLiveSessions()          — the tray "Sessions" submenu source (item 10).
//   reopenWindow(sessionId)     — reopen a hidden live window by internal id (tray).
//   reopenByTask({channelId,taskId}) — the MAIN-window bridge target (item 2), behind the
//     web "Open session" button: the web passes (channelId, taskId), NEVER the internal
//     sessionId; we resolve the live session by key and show()+focus() its window. P2
//     (v1.7.4): when NO live session survives, fall back to recreateParkedShell — a durable
//     record recreates a dormant, resumable window instead of the old dead end.
//
// v3.0 VOCABULARY: this opens a SESSION (this member's own window) on a shared THREAD, and
// it starts NOTHING. Both branches are window-only: show()+focus(), or a PARKED shell with
// no query. The agent wakes on a steer or an accepted inbound, never on this call. The
// `Task` in the name and the `taskId` argument are the wire spelling of `thread`.
// Pinned by test/open-session-no-query.test.mjs.

const store = require('./session-store');

// ─── BEGIN SESSION-REOPEN-PURE (injectable; unit-tested via source extraction) ────

let deps = { sessions: null, refreshTray: function () {}, recreateParkedShell: null, keptWindow: null, dispatch: null };

// The engine binds its in-memory `sessions` Map + tray-refresh + the P2 shell builder
// here at load, plus (§3.3) the ENDED-session window lookup below.
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    refreshTray: (d && d.refreshTray) || function () {},
    recreateParkedShell: (d && d.recreateParkedShell) || null,
    // C-8: the engine's own dispatch, so the quit teardown ENDS sessions through the reducer
    // rather than growing a second teardown beside `settle`.
    dispatch: (d && d.dispatch) || null,
    // session-summary.keptWindow: the surviving window of an ABANDONED session, or null.
    // Optional — a mid-wave engine that has not wired it simply falls through to the
    // recreate, which is what this call did before the branch existed.
    keptWindow: (d && d.keptWindow) || null,
  };
}

// Show a live window (reveals a hidden one or fronts a visible one), clear the hidden
// flag, and refresh the tray so its "Sessions" submenu reflects the change.
function showLive(s) {
  try { s.win.show(); s.win.focus(); } catch (_) { /* best effort */ }
  s.windowHidden = false;
  deps.refreshTray();
}

// PURE READ — the tray's "Sessions" submenu source (item 10) and, since D1, the accounting
// surface a chips UI will list from. One row PER KEY, never per channel: with N concurrent
// sessions in one channel the channel name alone no longer identifies a row, so the key and
// its (channel, thread/agent) parts ride along with the live `status`.
//   status = the reducer's phase for a live session ('launching' / 'running' / 'awaiting_*' /
//            'parked'), so a parked shell reads as parked instead of as work in flight.
// Nothing here mutates, and no live handle (window, query, iterator) is exposed.
function listLiveSessions() {
  const out = [];
  if (!deps.sessions) return out;
  for (const s of deps.sessions.values()) {
    if (s.settled) continue;
    out.push({
      sessionId: s.sessionId,
      key: s.key,
      channelId: s.channelId || null,
      taskId: s.taskId || '',
      channelName: (s.context && s.context.channelName) || null,
      taskTitle: (s.context && s.context.taskTitle) || null,
      status: (s.state && s.state.phase) || null,
      hidden: !!s.windowHidden,
    });
  }
  return out;
}

// Reopen a hidden live window by internal sessionId (its renderer + transcript are
// intact — no replay). Returns true if found + shown, else false.
function reopenWindow(sessionId) {
  if (!deps.sessions) return false;
  for (const s of deps.sessions.values()) {
    if (s.sessionId !== sessionId || !s.win || s.win.isDestroyed()) continue;
    showLive(s);
    return true;
  }
  return false;
}

// Item 2 + P2: resolve the live session for (channel, task) and show its window (a pure
// window show() — starts NO query, runs NO gated tool, §H-4). When there is no live session,
// fall back to recreateParkedShell, which recreates a parked shell from the durable record —
// and, since Q6b, opens one seeded from the CHANNEL when this machine has no record at all.
// May return a Promise (the fallback is async); the IPC handler awaits it.
//
// THE VERDICT (read by the web thread card):
//   { ok: true }                    a window is open for this thread. Live, recreated from a
//                                   record, or built from the channel — all three are "opened",
//                                   and the web card must show NO note for any of them.
//   { ok: false, reason: 'no-thread' }  this operator cannot open this channel at all (not a
//                                   member, gone, or signed out). THE one note case.
//   { ok: false, reason: 'busy' }   the window budget is spent and nothing could be freed; a
//                                   retry after closing a window will work.
//   { ok: false }                   the window layer is not wired yet (mid-wave). Generic.
//
// §3.3 — THE ENDED-BUT-KEPT WINDOW, checked BETWEEN those two branches. An abandoned session
// settles out of the registry while its window stays open (session-effects' M2b: an end nobody
// watched happen must not make a transcript vanish), so the live lookup misses it and the
// recreate below would answer an "Open" on its session pill by building a FRESH parked shell —
// a different session wearing a dead one's name, over the top of the very transcript the
// operator was trying to read. The retained window IS the answer, and showing it goes through
// the same showLive as every other branch: ONE reopen path, one IPC, no second machinery.
function reopenByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  if (!deps.sessions) return { ok: false };
  const s = deps.sessions.get(store.sessionKey(channelId, taskId));
  if (s && !s.settled && s.win && !s.win.isDestroyed()) { showLive(s); return { ok: true }; }
  const kept = deps.keptWindow ? deps.keptWindow(channelId, taskId) : null;
  // No `windowHidden` flag and no tray refresh to do — the entry left the registry when it
  // settled, so this is a plain reveal of a window nothing else is tracking.
  if (kept && !kept.isDestroyed()) { try { kept.show(); kept.focus(); } catch (_) { /* best effort */ } return { ok: true }; }
  // `fromChannel` is what separates an operator CLICK from the inbound gate's own use of the same
  // builder: only a click may open a shell for a thread this machine holds no record of.
  if (deps.recreateParkedShell) return deps.recreateParkedShell({ channelId, taskId, fromChannel: true });
  return { ok: false };
}

// ── THE AGENTS TAB'S TWO CONTROLS: PAUSE and END, on MY OWN agent ────────────────
//
// Wiring plan Phase 5 (2026-08-18). The Agents tab and the agent view let the operator pause or
// end an agent from the MAIN window, where before those two verbs existed only inside that
// session's own window (`session:interrupt` / `session:end`, session-ipc.js, resolved from
// event.sender). This is the SAME PAIR reached by the SAME dispatch — nothing about running a
// session is re-implemented here, and deliberately so: a second stop path is a second set of
// teardown bugs.
//
//   pause  -> { type: 'interrupt' }  the session window's send-button PAUSE MORPH, verbatim
//             (renderer/session/session.html: "pausing the agent is the send button's pause
//             morph"). Stops the turn in flight; the session stays live, resumable and named.
//   end    -> { type: 'end' }        the window's "End session" button, verbatim. Terminal.
//             It ends the AGENT and touches no thread — a thread has no finished state
//             (INVARIANTS §5, wiring plan Phase 4).
//
// ⚠ OWN AGENTS ONLY, AND THAT IS FREE HERE RATHER THAN ENFORCED. The registry holds only
// sessions THIS machine is running for THIS operator, so a key that resolves is by construction
// the caller's own. There is no cross-machine control op and this is not the seam to add one:
// a peer's paused agent is rendered from PRESENCE on the reading side (MAPPING.md), never
// driven from here.
// ⚠ RESOLVED BY (channel, thread) like `reopenByTask`, never by `sessionId` — that id is
// ephemeral across a park+recreate and is a React key on the wire, not an address.
// ⚠ SETTLED AND RETAINED-ENDED SESSIONS ANSWER `{ ok: false }`: an ended session's pill outlives
// its registry entry (the retention rule), so "the card is on screen" does not mean "there is
// something left to stop". Fail closed rather than dispatching into a settled object.
const CONTROL_EVENTS = { pause: 'interrupt', end: 'end' };

function controlByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const type = Object.prototype.hasOwnProperty.call(CONTROL_EVENTS, a && a.action)
    ? CONTROL_EVENTS[a.action]
    : null;
  if (!type || !deps.sessions || !deps.dispatch) return { ok: false };
  const s = deps.sessions.get(store.sessionKey(channelId, taskId));
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  try {
    deps.dispatch(s, { type: type });
  } catch (_) {
    return { ok: false };
  }
  return { ok: true };
}

// ── C-8: THE SESSIONS A QUIT WOULD ORPHAN, AND HOW THEY ARE ENDED ────────────────
//
// THE DEFECT (audit C-8). `before-quit` stopped the listener and nothing else — it never
// iterated the registry, never aborted a controller, and never flushed the state push.
// Repo-wide the only `.kill(` is the auth pty. So every live `sdk.query()` left a bundled
// `claude` child running, still holding this session's PRE-APPROVED `dopl_channel` MCP
// access, able to go on posting into the channel after the app it belonged to was gone. The
// crash path already fixes exactly this (session-engine's C3 teardown); the quit path never
// reached it.
//
// THE PREDICATE IS "HOLDS A LIVE CHILD", NOT "IS WORKING". A parked session's query is torn
// down (that IS what a park does), so it orphans nothing and is left alone — settling it
// would rewrite its durable phase for no benefit. Everything else that is not settled owns a
// child, INCLUDING one sitting between turns at activity 'idle': its push iterator is open
// and the process is alive. Reading the pill state here would have quietly spared exactly
// those, which are the majority of the orphans.
function liveChildSessions() {
  const out = [];
  if (!deps.sessions) return out;
  for (const s of deps.sessions.values()) {
    if (!s || s.settled) continue;
    if (s.state && s.state.parked === true) continue;
    out.push(s);
  }
  return out;
}

// What the quit dialog names. One row per session the quit is about to kill, identified the
// way a human recognises it — the thread's title and the channel it lives in, not a count.
// `working` is the F-142 pill distinction ("is an agent mid-turn"), carried so the dialog can
// say which of them is actually doing something right now.
function listOrphanRisk() {
  return liveChildSessions().map((s) => ({
    key: s.key,
    channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null,
    counterpartyName: s.counterpartyName || null,
    working: !!(s.state && s.state.activity !== 'idle' && s.state.activity !== 'awaiting_peer'),
  }));
}

// END every session holding a child, through the reducer. `inactive` is C-5's calm terminal:
// it aborts the query (which is what kills the child), posts the "went inactive" status note
// so the waiting peer's card stops pulsing, and settles — the SAME treatment an eviction or a
// launch timeout gets, rather than a second teardown written for quit. Returns how many were
// ended. Each dispatch is independently guarded: one throwing session must never be able to
// stop a quit (fail OPEN on quitting is the rule).
function endLiveSessions() {
  if (!deps.dispatch) return 0;
  let ended = 0;
  for (const s of liveChildSessions()) {
    try { deps.dispatch(s, { type: 'inactive' }); ended += 1; } catch (_) { /* never block a quit */ }
  }
  return ended;
}

// ─── END SESSION-REOPEN-PURE ──────────────────────────────────────────────────────

module.exports = { bind, listLiveSessions, reopenWindow, reopenByTask, controlByTask, listOrphanRisk, endLiveSessions };
