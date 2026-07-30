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
const channelDirs = require('./channel-dirs');
const gate = require('./session-gate'); // v2.5 D1: the inbound gate owns the decision
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

  // ── v2.5 D1: the inbound gate decision (Accept / Accept for this task / Decline).
  // Bound from event.sender like every other handler; the decision string is coerced
  // in the preload and re-validated FAIL-CLOSED in gate.decideInbound (anything that
  // is not an explicit accept declines). FIX F10: the old accept-only channel alias is
  // DELETED — nothing called it, and it invited a decision carrying no pendingId (which
  // used to skip the head check in gate.decideInbound entirely, see FIX F9).
  // This one does NOT go through withSession: it reports the gate's OWN verdict, so the
  // renderer can stamp the card only when main really took the decision (no session, or a
  // pendingId that does not name the head -> {ok:false} and the card stays answerable).
  ipcMain.handle('session:inbound-decision', (e, p) => {
    const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
    if (!s) return { ok: false };
    touch(s);
    try {
      return { ok: gate.decideInbound(s, p && p.pendingId, p && p.decision) === true };
    } catch (err) {
      diag('session-ipc: inbound-decision error', err && err.message);
      return { ok: false };
    }
  });

  ipcMain.handle('session:interrupt', (e) => withSession(e, (s) => engine.dispatch(s, { type: 'interrupt' })));
  ipcMain.handle('session:end', (e) => withSession(e, (s) => engine.dispatch(s, { type: 'end' })));
  ipcMain.handle('session:close-task', (e, p) => withSession(e, (s) => engine.dispatch(s, { type: 'close_task', outcome: p && p.outcome, summary: p && p.summary })));

  // ── Item 10: per-session auto-approve toggle. Bound from event.sender like every
  // other handler; the enabled flag is coerced to a strict boolean. The reducer does
  // the permission-gate drain + auto_approve echo — main stays authoritative on the
  // flip. v2.5 D4: the toggle now covers INBOUND too, so anything already held at the
  // gate is fed right away instead of sitting behind a switch that says otherwise
  // (drainInbound no-ops when the toggle went OFF, or when nothing is held).
  ipcMain.handle('session:set-auto-approve', (e, p) => withSession(e, (s) => {
    engine.dispatch(s, { type: 'set_auto_approve', enabled: !!(p && p.enabled) });
    gate.drainInbound(s);
  }));

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

  // ── Item 5: the folder pill. LABEL ONLY crosses back — the REAL resolved dir
  // short-form (resolvedDirLabel, never null now, defaults "~/Downloads"); the abs path
  // never enters the renderer (§H-9). channelId comes from the authoritative session/
  // consent. folder-clear stays for compat but the UI no longer calls it (item 5).
  ipcMain.handle('session:folder-get', (e) => folderReply(e, (t) => channelDirs.resolvedDirLabel(t.channelId)));
  ipcMain.handle('session:folder-choose', (e) => folderReply(e, async (t) => {
    await channelDirs.promptAndSetChannelDir(t.channelId); // user-driven native picker
    return channelDirs.resolvedDirLabel(t.channelId);
  }));
  ipcMain.handle('session:folder-clear', (e) => folderReply(e, (t) => {
    channelDirs.clearChannelDir(t.channelId);
    return channelDirs.resolvedDirLabel(t.channelId); // back to the ~/Downloads default
  }));
}

// FIX #7: mark a session as one the OPERATOR has actually used. Every handler here is
// driven by a click or a keystroke in that window (the folder chip is the one exception and
// does not route through withSession), so this is the honest signal for "not just a shell
// something opened on their behalf". session-park's LRU eviction refuses to close a touched
// window when it needs to free a slot in the shared window budget. Memory only.
function touch(s) {
  if (s) s.operatorTouched = true;
}

function withSession(e, fn) {
  const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
  if (!s) return { ok: false };
  touch(s);
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
