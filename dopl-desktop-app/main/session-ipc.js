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
const attended = require('./attended-handoff'); // F-118: "Open in Claude Code" on the consent card
// FIX 1: the pre-consent registry is where a posture picked BEFORE Accept is stored. Required
// directly, like `attended` above and for the same reason — the ENTRY comes from the engine's
// injected getConsentBySender, so the frozen §B.3 resolution contract is untouched; only the
// write lands here. session-consent requires nothing back, so there is no cycle.
const sessionConsent = require('./session-consent');
// v2.9: the canonical mode tables live with the gate that resolves them (session-profiles).
const { normalizeToolMode, normalizeMessageMode } = require('./session-profiles');
// 2026-08-02: the canonical MODEL enum lives with the option assembly that spends it.
const { normalizeModel, modelArg } = require('./session-model');
const peerPost = require('./session-peer-post'); // v2.8: the operator's own peer-addressed post
// §3.2: the composer pill's resting row names this session, and the name is the ledger's
// (F-142's one derivation), not a second one minted per window. session-summary requires
// nothing back, so there is no cycle.
const sessionSummary = require('./session-summary');
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

  // §3.2: THE HANDLE THIS WINDOW IS WEARING, for the composer pill's resting row
  // ("Message flint"). READ-ONLY in the strongest sense available here: it resolves the
  // session from event.sender like every other handler, calls no dispatch, and deliberately
  // does NOT touch() the LRU — a window asking its own name is not the operator using it, and
  // letting it defer a park would make a passive read a lifecycle event.
  //
  // A PULL, NOT A REPLAYED EVENT. A handle is fixed for the life of the session KEY (that is
  // what makes it survive a park, a lazy resume and a P2 recreate, F-142), so one read at mount
  // is correct and a window reload simply re-reads. Riding `init` instead would have put it in
  // the replay ring and made three emit sites responsible for remembering it.
  ipcMain.handle('session:agent-name', (e) => {
    const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
    return { name: s ? sessionSummary.nameForSession(s) : null };
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
  // ⚠ `session:close-task` was handled here and is DELETED (wiring plan Phase 4, 2026-08-18)
  // along with the renderer's close panel, the reducer's `close_task` branch and the server's
  // close route. Threads do not close; what this window ends is the AGENT ('session:end').

  // ── v2.9 THE TWO AXES, replacing the single `session:set-auto-approve` channel (which is
  // DELETED, not aliased — the renderer ships in the same bundle, so there is no version to
  // stay compatible with). Both are bound from event.sender like every other handler, and both
  // coerce FAIL-CLOSED twice: once in the preload, once here against session-profiles' own
  // tables, so an unknown value can only ever land on the MOST RESTRICTIVE member of its axis.
  //
  // AXIS A — tool permissions. It touches NOTHING about message flow: no drainInbound, no
  // outbound resolution. That separation is the invariant, enforced again in grantDecision.
  ipcMain.handle('session:set-tool-mode', (e, p) => modeChange(e, 'tools', normalizeToolMode(p && p.mode), (s, mode) => {
    engine.dispatch(s, { type: 'set_tool_mode', mode });
  }));

  // AXIS B — message flow. This is where v2.5 D4's drain moved: switching INCOMING to
  // automatic must not strand a message already held at the gate behind a control that says
  // it flows (drainInbound self-guards — it no-ops unless an inbound opt-in is armed, and
  // when nothing is held). Nothing here can approve a work tool.
  //
  // FIX L1 (2026-08-02): the drain is handed in SEPARATELY from the dispatch, because the two
  // have different failure meanings. See modeChange — a dispatch that throws changed nothing, a
  // drain that throws happens AFTER main already switched the axis.
  ipcMain.handle('session:set-message-mode', (e, p) => modeChange(e, 'messages', normalizeMessageMode(p && p.mode), (s, mode) => {
    engine.dispatch(s, { type: 'set_message_mode', mode });
  }, (s) => gate.drainInbound(s)));

  // ── THE MODEL, per session (2026-08-02). A third control in the status strip, beside the two
  // axes and deliberately NOT a third axis: a model is not a permission, so this touches no
  // grant, no gate, no drain, and nothing in session-profiles. It is bound from event.sender
  // like every handler here and coerced FAIL-CLOSED twice (preload, then here) against the same
  // frozen enum, because the value ends up as `--model <argv>` on a child process.
  ipcMain.handle('session:set-model', (e, p) => modelChange(e, normalizeModel(p && p.model)));

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

  // ── F-118 ATTENDED HANDOFF: answer this request with the operator's OWN Claude Code.
  // Resolved from the pre-consent window like every other handler, and the payload carries
  // NOTHING (there is no argument to forge): attended-handoff reads the card's own ids and
  // display names off the registry entry.
  //
  // IT RESOLVES NOTHING ON THE SERVER. No decideConsent, no submitDecision, no watcher poke,
  // no dispatch, no spawn. The consent row stays PENDING, so Accept is still answerable
  // underneath and still behaves exactly as it does today; the renderer marks the card
  // handled-attended locally on the {ok} this returns.
  ipcMain.handle('session:attended-handoff', (e) => {
    const c = engine.getConsentBySender && engine.getConsentBySender(e && e.sender);
    if (!c) return { ok: false, reason: 'no-card' };
    try {
      return attended.open(c);
    } catch (err) {
      diag('session-ipc: attended-handoff error', err && err.message);
      return { ok: false, reason: 'error' };
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

// FIX 1 (2026-08-02) — ONE resolution order for BOTH axes, and the reason the pre-consent
// selects were dead. They ran `withSession`, which resolves ONLY the live-session registry;
// a pre-consent window lives in session-consent's registry instead, so main answered
// {ok:false} for every change made before Accept — and the preload discarded that promise, so
// the select moved, nothing behind it did, and the spawn then emitted manual/ask and visibly
// dragged it back. The order now is:
//
//   LIVE SESSION   dispatch through the reducer, exactly as before. {ok:true} carries main's
//                  own post-dispatch pair, so the renderer stamps what was ENFORCED.
//   CONSENT CARD   getConsentBySender (the same resolver the attended handoff uses) and store
//                  the pick on that card's entry, which startSession consumes on adopt.
//   NEITHER        {ok:false}. That is a real answer now: the renderer reverts the select to
//                  main's last confirmed value and says so (FIX 2), instead of leaving a
//                  control claiming a posture nothing is enforcing.
//
// FIX L1 (2026-08-02) — AND {ok:false} MUST MEAN "MAIN DID NOT TAKE IT". `apply` used to be one
// callback carrying BOTH the reducer dispatch and AXIS B's drain, so a drainInbound that threw
// returned {ok:false} for a change main had already made: the renderer then reverted the select
// over a posture the gate was enforcing, which is the exact lie FIX 2 exists to remove, pointing
// the other way. The two steps are separate arguments now. Only `apply` can fail the call; a
// throw from `after` is diagnosed and the answer still reports main's own post-dispatch pair.
function modeChange(e, axis, mode, apply, after) {
  const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
  // THE POSTURE DIAG LINE (2026-08-02), the twin of session-io's gate verdict line. Between the
  // two, "the operator never moved the control", "the control moved and main refused it" and
  // "main took it and the gate still asked" are three different shapes in listener.log instead
  // of one silence. Deliberately THIN and logged BEFORE the branch, so an unknown sender (no
  // session prefix) is visible too: the AXIS, the already-coerced VALUE, and an 8-char session
  // prefix to join on. NEVER prompt text, a drafted body, or a full id — listener.log is plaintext.
  diag('session posture:', axis + '=' + mode, 'session=' + String((s && s.sessionId) || '').slice(0, 8));
  if (s) {
    touch(s);
    try {
      apply(s, mode);
    } catch (err) {
      diag('session-ipc: mode handler error', err && err.message); // nothing was applied
      return { ok: false };
    }
    // The mode is ALREADY on the session from here down, so nothing below may answer {ok:false}.
    if (after) {
      try { after(s); } catch (err) { diag('session-ipc: mode drain error', err && err.message); }
    }
    return { ok: true, tool: s.state && s.state.toolMode, message: s.state && s.state.messageMode };
  }
  const c = engine.getConsentBySender && engine.getConsentBySender(e && e.sender);
  if (!c) return { ok: false };
  const armed = sessionConsent.armModes(c, axis, mode);
  if (!armed) return { ok: false }; // a decided / adopted card cannot be re-armed
  return { ok: true, tool: armed.tools, message: armed.messages };
}

// THE MODEL CHANGE. Same three-sender resolution order as modeChange above (live session ->
// consent card -> {ok:false}, which the renderer reverts on), and a SEPARATE function rather
// than a third axis of that one, because the two differ where it matters:
//
//   NOT REDUCER STATE. `s.model` is a session-OBJECT field like `s.profile`. buildSdkOptions is
//   its single reader, so there is no decision for the state machine to make and no effect to
//   execute; routing it through the reducer would have added a state field nothing consults.
//   LIVE, WHERE THE SDK ALLOWS IT. Query.setModel switches the running child for its NEXT
//   response. A parked, held or pre-consent session has no query at all — the value still lands,
//   and the resume/spawn assembles with it, because every shape re-enters buildSdkOptions. A
//   RUNNING query whose SDK has no setModel is the third case, and it is DEFERRED (FIX L2).
//
// The {ok:true} carries main's OWN post-change value, so the select stamps what was recorded.
function modelChange(e, model) {
  const s = engine.getSessionBySender && engine.getSessionBySender(e && e.sender);
  diag('session posture:', 'model=' + model, 'session=' + String((s && s.sessionId) || '').slice(0, 8));
  if (s) {
    touch(s);
    s.model = model;
    // Fire-and-forget, and NEVER fatal: a switch the CLI refuses leaves the session running on
    // the model it already had, which is exactly what `s.model` will re-request on the next
    // resume. undefined is the SDK's own "go back to the default".
    //
    // FIX L2 (2026-08-02) — DEFERRED IS NOT LIVE, and the wire has to say which one it was. A
    // RUNNING query on an SDK build with no `setModel` used to answer a bare {ok:true} and echo
    // the same event a real switch echoes, so nothing downstream could tell "the child is on it
    // now" from "the child keeps the old model until the next resume". It answers {deferred:true}
    // now and the echo is the PENDING shape: `choice` still moves the picker, which is the
    // operator's ASK and the only thing that select has ever shown, while `pending` marks that no
    // running child was switched. What is REALLY running stays the header's liveModel, fed by the
    // per-turn `context` event and by `init` — this path does not touch it and never did. A
    // session with NO query at all is not deferred: nothing is running to disagree with it.
    let deferred = false;
    try {
      const live = s.query && s.query.setModel;
      if (live) Promise.resolve(s.query.setModel(modelArg(model) || undefined)).catch((err) => diag('session-ipc: setModel rejected', err && err.message));
      else if (s.query) deferred = true;
    } catch (err) {
      diag('session-ipc: setModel threw', err && err.message);
    }
    if (deferred) diag('session-ipc: setModel unavailable, model deferred to the next assembly');
    if (engine.emitToSession) {
      engine.emitToSession(s, deferred ? { type: 'model', choice: model, pending: true } : { type: 'model', choice: model });
    }
    return deferred ? { ok: true, deferred: true, model: model } : { ok: true, model: model };
  }
  const c = engine.getConsentBySender && engine.getConsentBySender(e && e.sender);
  if (!c) return { ok: false };
  const armed = sessionConsent.armModel(c, model);
  if (!armed) return { ok: false }; // a decided / adopted card cannot be re-armed
  return { ok: true, model: armed.model };
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
