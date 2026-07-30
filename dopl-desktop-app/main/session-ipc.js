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
// v2.9: the canonical mode tables live with the gate that resolves them (session-profiles).
const { normalizeToolMode, normalizeMessageMode } = require('./session-profiles');
const peerPost = require('./session-peer-post'); // v2.8: the operator's own peer-addressed post
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

  // ── v2.8: the OPERATOR's own words, addressed to the peer's agent (an `@their-agent`
  // tag in the composer). This is NOT a steer: it never calls engine.dispatch, so it cannot
  // resume a parked session, re-arm the idle timer, open a permission request or touch a
  // grant. The session is resolved from event.sender like every other handler; the post
  // itself is fire-and-forget (the renderer learns the outcome from the operator_post /
  // operator_post_result events the module emits over the SAME session:event stream).
  ipcMain.handle('session:send-peer', (e, p) => {
    const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
    if (!s) return { ok: false };
    // DO NOT FIX F11 (contract, with the tradeoff named): touch() only bumps the LRU stamp, so
    // a peer post from a PARKED shell delays that shell's eviction without resuming it. That is
    // the documented contract and arguably the right call (the operator just used this window,
    // so it is the last one they want reclaimed) — the cost is that a parked shell kept alive by
    // posts alone holds its LRU slot against a fresh session. No lifecycle state changes here.
    touch(s);
    peerPost.send(s, String((p && p.text) || ''), engine.emitToSession)
      .catch((err) => diag('session-ipc: send-peer error', err && err.message));
    return { ok: true };
  });

  // FIX F1 (v2.7): report the TRUTH, not "the session exists". withSession answered
  // {ok:true} whenever a live session was found, even when NO live resolver was awaiting
  // this requestId (a park's denyPending already fail-closed it), so a Send click racing a
  // park stamped a denied post 'sent' forever — the park's permission_resolved{deny} echo
  // no-ops, because markOutboundDecided only touches a card still 'pending'. engine.dispatch
  // now returns whether a live canUseTool promise was really resolved, exactly like the
  // inbound gate's decideInbound verdict below, and the renderer's res.ok===false path leaves
  // the card answerable. FIX F7 belt: a requestId this session is not tracking is never
  // dispatched at all, so an undefined grant name can never reach allowForTask.
  ipcMain.handle('session:permission', (e, p) => {
    const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
    if (!s) return { ok: false };
    touch(s);
    const requestId = p && p.requestId;
    if (!requestId || !s.pendingNames.has(requestId)) return { ok: false };
    try {
      return { ok: engine.dispatch(s, {
        type: 'permission_decision',
        requestId,
        decision: p && p.decision,
        name: s.pendingNames.get(requestId),
      }) === true };
    } catch (err) {
      diag('session-ipc: permission error', err && err.message);
      return { ok: false };
    }
  });

  // ── v2.5 D1: the inbound gate decision (Accept / Accept for this session / Decline).
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

  // ── v2.9 THE TWO AXES, replacing the single `session:set-auto-approve` channel (which is
  // DELETED, not aliased — the renderer ships in the same bundle, so there is no version to
  // stay compatible with). Both are bound from event.sender like every other handler, and both
  // coerce FAIL-CLOSED twice: once in the preload, once here against session-profiles' own
  // tables, so an unknown value can only ever land on the MOST RESTRICTIVE member of its axis.
  //
  // AXIS A — tool permissions. It touches NOTHING about message flow: no drainInbound, no
  // outbound resolution. That separation is the invariant, enforced again in grantDecision.
  ipcMain.handle('session:set-tool-mode', (e, p) => withSession(e, (s) => {
    engine.dispatch(s, { type: 'set_tool_mode', mode: normalizeToolMode(p && p.mode) });
  }));

  // AXIS B — message flow. This is where v2.5 D4's drain moved: switching INCOMING to
  // automatic must not strand a message already held at the gate behind a control that says
  // it flows (drainInbound self-guards — it no-ops unless an inbound opt-in is armed, and
  // when nothing is held). Nothing here can approve a work tool.
  ipcMain.handle('session:set-message-mode', (e, p) => withSession(e, (s) => {
    engine.dispatch(s, { type: 'set_message_mode', mode: normalizeMessageMode(p && p.mode) });
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
