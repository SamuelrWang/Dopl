// Session reopen helpers (v2.2 Session Window, item 2 + item 10).
//
// Extracted from session-engine.js purely to keep that AT-CAP file under 500 lines
// (contract §O-7 / F-09c). These read the engine's LIVE-session registry, which the
// engine injects once via bind() at load — this module holds NO electron/SDK handle
// and never imports back into the engine (no cycle). session-store is required only
// for the (channel,task) key.
//
//   listLiveSessions()          — the tray "Sessions" submenu source (item 10).
//   reopenWindow(sessionId)     — reopen a hidden live window by internal id (tray).
//   reopenByTask({channelId,taskId}) — the MAIN-window bridge target (item 2): the
//     web passes (channelId, taskId), NEVER the internal sessionId; we resolve the
//     live session by key and show()+focus() its window (hidden OR visible). Returns
//     {ok:false} when no live session exists — a SETTLED task is not reopenable.

const store = require('./session-store');

let deps = { sessions: null, refreshTray: () => {} };

// The engine binds its in-memory `sessions` Map + tray-refresh here at load.
function bind(d) {
  deps = { sessions: (d && d.sessions) || null, refreshTray: (d && d.refreshTray) || (() => {}) };
}

// Show a live window (reveals a hidden one or fronts a visible one), clear the hidden
// flag, and refresh the tray so its "Sessions" submenu reflects the change.
function showLive(s) {
  try { s.win.show(); s.win.focus(); } catch (_) { /* best effort */ }
  s.windowHidden = false;
  deps.refreshTray();
}

function listLiveSessions() {
  const out = [];
  if (!deps.sessions) return out;
  for (const s of deps.sessions.values()) {
    if (s.settled) continue;
    out.push({ sessionId: s.sessionId, channelName: (s.context && s.context.channelName) || null, hidden: !!s.windowHidden });
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

// Item 2: resolve the live session for (channel, task) and show its window. A missing
// registry, no live session, a settled session, or a destroyed window all → {ok:false}
// (the web card already renders a settled transcript; the button reports "no live
// session"). Starts NO query and runs NO gated tool — a pure window show() (§H-4).
function reopenByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  if (!deps.sessions) return { ok: false };
  const s = deps.sessions.get(store.sessionKey(channelId, taskId));
  if (!s || s.settled || !s.win || s.win.isDestroyed()) return { ok: false };
  showLive(s);
  return { ok: true };
}

module.exports = { bind, listLiveSessions, reopenWindow, reopenByTask };
