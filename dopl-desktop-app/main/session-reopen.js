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
//   reopenByTask({channelId,taskId}) — the MAIN-window bridge target (item 2): the web
//     passes (channelId, taskId), NEVER the internal sessionId; we resolve the live
//     session by key and show()+focus() its window. P2 (v1.7.4): when NO live session
//     survives, fall back to recreateParkedShell — a durable record + a retained
//     sdkSessionId recreates a dormant, resumable window instead of the old dead end.

const store = require('./session-store');

// ─── BEGIN SESSION-REOPEN-PURE (injectable; unit-tested via source extraction) ────

let deps = { sessions: null, refreshTray: function () {}, recreateParkedShell: null };

// The engine binds its in-memory `sessions` Map + tray-refresh + the P2 shell builder
// here at load.
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    refreshTray: (d && d.refreshTray) || function () {},
    recreateParkedShell: (d && d.recreateParkedShell) || null,
  };
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

// Item 2 + P2: resolve the live session for (channel, task) and show its window (a pure
// window show() — starts NO query, runs NO gated tool, §H-4). When there is no live
// session — the old "No live session to reopen" dead end — fall back to
// recreateParkedShell: a durable record with a retained sdkSessionId recreates a parked,
// resumable shell (returns {ok:true}); a truly-closed task returns {ok:false}. May
// return a Promise (the fallback is async); the IPC handler awaits it.
function reopenByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  if (!deps.sessions) return { ok: false };
  const s = deps.sessions.get(store.sessionKey(channelId, taskId));
  if (s && !s.settled && s.win && !s.win.isDestroyed()) { showLive(s); return { ok: true }; }
  if (deps.recreateParkedShell) return deps.recreateParkedShell({ channelId, taskId });
  return { ok: false };
}

// ─── END SESSION-REOPEN-PURE ──────────────────────────────────────────────────────

module.exports = { bind, listLiveSessions, reopenWindow, reopenByTask };
