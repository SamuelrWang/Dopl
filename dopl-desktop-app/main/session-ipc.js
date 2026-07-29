// Renderer -> main IPC for the session window (v2.0 Session Window, Track T3).
//
// ALL session:* handlers live here — moved out of session-engine.js so the engine
// stays under the 500-line §2 cap, and to home the NEW consent-decision + folder
// handlers next to the rest. The sessionId is NEVER trusted from the payload: every
// handler re-derives the live session / pre-consent window from event.sender via the
// engine lookups injected by register() (the frozen §B.3 contract). Text args were
// already coerced to primitives in the preload; we re-validate defensively here.
//
// The engine registers this ONCE (from session-engine.init) with an `internals`
// bundle — getSessionBySender / getConsentBySender / dispatch / decideConsent — so
// this module never require()s session-engine (no import cycle). channel-dirs is the
// EXISTING label-only helper: only the abbreviated label crosses back to the
// renderer, never the absolute path (§H-9).

const { ipcMain } = require('electron');
const io = require('./session-io');
const channelDirs = require('./channel-dirs');
const { diag } = require('./diag');

let engine = null; // { getSessionBySender, getConsentBySender, dispatch, decideConsent }
let bound = false;

function register(internals) {
  engine = internals || {};
  if (bound) return;
  bound = true;

  // ── Live-session handlers (unchanged §B.3 shapes) ──────────────────────────
  ipcMain.handle('session:send', (e, p) => withSession(e, (s) =>
    engine.dispatch(s, { type: 'steer', text: String((p && p.text) || ''), priority: p && p.priority })));

  ipcMain.handle('session:permission', (e, p) => withSession(e, (s) => engine.dispatch(s, {
    type: 'permission_decision',
    requestId: p && p.requestId,
    decision: p && p.decision,
    name: s.pendingNames.get(p && p.requestId),
  })));

  ipcMain.handle('session:release-inbound', (e) => withSession(e, (s) => {
    const pend = io.shiftInbound(s);
    if (!pend) return;
    engine.dispatch(s, { type: 'inbound_released', message: pend.message, authorName: pend.authorName });
    const next = s.pendingInbound[0]; // surface the next held reply, if any
    if (next) engine.dispatch(s, { type: 'inbound_arrived', pendingId: next.pendingId, message: next.message, authorName: next.authorName });
  }));

  ipcMain.handle('session:interrupt', (e) => withSession(e, (s) => engine.dispatch(s, { type: 'interrupt' })));
  ipcMain.handle('session:end', (e) => withSession(e, (s) => engine.dispatch(s, { type: 'end' })));
  ipcMain.handle('session:close-task', (e, p) => withSession(e, (s) => engine.dispatch(s, { type: 'close_task', outcome: p && p.outcome, summary: p && p.summary })));

  // ── Item 8: the pre-consent Accept / Deny — resolved from the window, not the id.
  ipcMain.handle('session:consent-decision', (e, p) => {
    const decision = p && p.decision === 'accept' ? 'accept' : 'deny';
    try {
      return engine.decideConsent(e && e.sender, decision);
    } catch (err) {
      diag('session-ipc: consent-decision error', err && err.message);
      return { ok: false };
    }
  });

  // ── Item 7: the folder chip. LABEL ONLY crosses back (the abs path never enters
  // the renderer, §H-9); channelId comes from the authoritative session/consent.
  ipcMain.handle('session:folder-get', (e) => folderReply(e, (t) => channelDirs.liveChannelDirLabel(t.channelId)));
  ipcMain.handle('session:folder-choose', (e) => folderReply(e, async (t) => {
    await channelDirs.promptAndSetChannelDir(t.channelId); // user-driven native picker
    return channelDirs.liveChannelDirLabel(t.channelId);
  }));
  ipcMain.handle('session:folder-clear', (e) => folderReply(e, (t) => {
    channelDirs.clearChannelDir(t.channelId);
    return channelDirs.liveChannelDirLabel(t.channelId); // null after clear
  }));
}

function withSession(e, fn) {
  const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
  if (!s) return { ok: false };
  try {
    fn(s);
  } catch (err) {
    diag('session-ipc: handler error', err && err.message);
  }
  return { ok: true };
}

// Resolve the target window (live session FIRST, else a pre-consent window) so the
// folder chip works in BOTH the consent state and a running session.
function targetForSender(sender) {
  const s = engine.getSessionBySender && engine.getSessionBySender(sender);
  if (s && s.win) return { channelId: s.channelId, win: s.win };
  const c = engine.getConsentBySender && engine.getConsentBySender(sender);
  if (c && c.win) return { channelId: c.channelId, win: c.win };
  return null;
}

async function folderReply(e, compute) {
  const t = targetForSender(e && e.sender);
  if (!t) return { label: null };
  let label = null;
  try {
    label = await compute(t);
  } catch (err) {
    diag('session-ipc: folder error', err && err.message);
  }
  label = label || null;
  // Re-emit so the header updates even though the invoke also returns the label.
  try {
    if (t.win && !t.win.isDestroyed()) t.win.webContents.send('session:event', { type: 'folder', label });
  } catch (_) { /* window gone */ }
  return { label };
}

module.exports = { register };
