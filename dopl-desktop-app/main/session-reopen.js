// Session reopen helpers (item 2; rebuilt on the agent window 2026-08-20).
//
// Extracted from session-engine.js purely to keep that AT-CAP file under 500 lines
// (contract §O-7 / F-09c). These read the engine's LIVE-session registry, which the
// engine injects once via bind() at load — this module holds NO electron/SDK handle
// and never imports back into the engine (no cycle). session-store is required only
// for the (channel,task) key; it is a free var inside the PURE block so
// test/session-reopen.test.mjs slices the block and injects a fake store + deps.
//
//   listLiveSessions()          — the updater's restart prompt (what a restart would kill).
//   reopenByTask({channelId,taskId}) — the MAIN-window bridge target (item 2), behind the
//     agent view's "Open window": the web passes (channel, thread), NEVER the internal
//     sessionId, and a LIVE session opens the agent window.
//
// `reopenWindow(sessionId)` went with the tray's "Sessions" submenu (2026-08-20, F-228) — its
// only caller — as did `showLive`.
//
// v3.0 VOCABULARY: this opens a VIEW onto this member's own agent working a shared THREAD, and it
// starts NOTHING. The `Task` in the name and the `taskId` argument are the wire spelling of
// `thread`. Pinned by test/open-session-no-query.test.mjs.

const store = require('./session-store');
// ⚠ AXIS B's WINDOWLESS FLOOR (F-236). One statement of the rule, shared with the launch lane
// (`channel-prefs.js › windowlessMessageMode`); see its docblock for why the floor exists.
const { floorWindowlessMessage } = require('./session-profiles');
// The operator-turn delimiter (2026-08-20). A free var inside the block below, like
// `store`, so the source-extraction test injects both and the block stays free of the
// runtime handles its purity assertion refuses (the header names them).
const framing = require('./session-seed');
// 2026-08-22: the PRIVATE TURN's window. Required at module scope like `store` and `framing`, so
// the source-extraction test injects it and the block stays free of runtime handles.
const privateTurn = require('./session-private');
const directedTurn = require('./session-directed'); // 2026-08-31: attribution + capture
// 2026-08-22: the frozen model enum + the id -> alias seam. A free var inside the block below,
// like `store` and `framing`, so the source-extraction test injects it.
const sessionModel = require('./session-model');
// ⚠ THE RUNTIME'S OWN ANSWER TO "CAN A RUNNING AGENT'S MODEL BE SWITCHED" (2026-09-21, U10). A free
// var inside the PURE block below, like `store` and `framing`, so the source-extraction test
// injects it. Neither require pulls electron — `main/runtime/index.js` is electron-free by
// contract and `runtime-copy.js` requires nothing at all.
const runtimeRegistry = require('./runtime');
const runtimeCapability = runtimeRegistry.capability;
const runtimeCopy = runtimeRegistry.copy;

// ─── BEGIN SESSION-REOPEN-PURE (injectable; unit-tested via source extraction) ────

let deps = { sessions: null, refreshTray: function () {}, openAgentWindow: null, dispatch: null };

// The engine binds its in-memory `sessions` Map + tray-refresh here at load.
//
// `bind` REBUILDS `deps` FROM A LITERAL, so a handle the engine passes and this list omits is
// DROPPED SILENTLY — and the drop reads as the fail-closed guard firing, not as a wiring bug. That
// happened to `openAgentWindow` during the F-228 sweep and `reopenByTask` answered `{ok:false}` on
// every live session. Add the field HERE whenever `sessionReopen.bind({...})` grows one.
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    refreshTray: (d && d.refreshTray) || function () {},
    // agent-window.js › openAgentWindow — the view onto a live WINDOWLESS session
    // (2026-08-20, F-212). Injected rather than required so this module keeps holding no
    // host-bound handle and its source-extraction test keeps working.
    openAgentWindow: (d && d.openAgentWindow) || null,
    // C-8: the engine's own dispatch, so the quit teardown ENDS sessions through the reducer
    // rather than growing a second teardown beside `settle`.
    dispatch: (d && d.dispatch) || null,
  };
}

// ── RESOLVING ONE AGENT OUT OF A THREAD (2026-08-21, Samuel's multiplayer ruling) ────────
//
// `deps.sessions.get(store.sessionKey(channelId, taskId))` is a category error now: (channel,
// thread) names a GROUP of this operator's agents, not one session. Four ops each had their own
// copy of that lookup, which is four places to get the new rule subtly different — so there is one.
//
// THE RULE, chosen to be the COMPATIBLE one:
//   • an `agentId` resolves EXACTLY. A wrong or dead id answers NOTHING and the caller gets
//     `{ok:false, reason:'no-session'}` — "pause my agent" must never pause a different one.
//   • NO `agentId` takes the OLDEST live session on the thread, which is byte-for-byte what every
//     caller got before multiplayer existed, so older renderers and the deep-link lanes keep
//     working. The fix for the newly-ambiguous case is to name the agent.
//
// It stays inside the PURE block on `store`'s terms: the source-extraction test slices this block
// and injects a fake store, so a helper the ops call has to be sliced with them.
function resolveSession(a, channelId, taskId) {
  if (!deps.sessions) return null;
  const agentId = String((a && a.agentId) || '');
  if (agentId) {
    const s = deps.sessions.get(store.slotKey({ channelId: channelId, taskId: taskId, agentId: agentId }));
    return s && !s.settled ? s : null;
  }
  const prefix = store.threadKeyPrefix(channelId, taskId);
  for (const s of deps.sessions.values()) {
    if (s.settled) continue;
    if (String(s.key || '').indexOf(prefix) !== 0) continue;
    return s; // insertion order == spawn order: the oldest live agent on this thread
  }
  return null;
}

// PURE READ — the updater's restart prompt (what a live restart would kill) and the accounting
// surface the Agents tab lists from. One row PER KEY, never per channel: with N concurrent sessions
// in one channel the channel name alone no longer identifies a row, so the key and its (channel,
// thread/agent) parts ride along with the live `status`.
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
      // ⚠ ADDED 2026-08-26 for RULING 5 (`session-park-on-claim.js`), which has to select the
      // sessions belonging to ONE container and had no other way to ask. The projection rule is
      // unchanged: a field, not a handle.
      workspaceId: s.workspaceId || null,
      taskId: s.taskId || '',
      // 2026-08-21: with N agents per thread, (channel, thread) no longer identifies a row.
      agentId: s.agentId || null,
      channelName: (s.context && s.context.channelName) || null,
      taskTitle: (s.context && s.context.taskTitle) || null,
      status: (s.state && s.state.phase) || null,
      // ALWAYS FALSE, AND KEPT AS A WIRE FIELD ON PURPOSE (2026-08-20). `windowHidden` is
      // initialised false and never set; the reshow branch that wrote it went with the session
      // window (F-228). It stays because this shape can cross to an OLDER build during an update,
      // and dropping a field from a wire shape is the change that needs a reason — but nothing may
      // start reasoning from it.
      hidden: false,
    });
  }
  return out;
}

// THE ONE REOPEN PATH (item 2; rebuilt on the agent window, 2026-08-20, F-212's closure).
//
// IT HAS EXACTLY TWO ANSWERS. A LIVE session opens `main/agent-window.js` — its narration, what it
// sent, and a composer that reaches it. Anything else refuses. The branches that went were about
// WINDOWS rather than about agents: the live session's own `show()+focus()`, the retained ENDED
// window (`session-summary.keptWindow`), and the `recreateParkedShell` fallback. Retention itself
// is live (F-234) — the pill is kept; what it cannot be is OPENED, the tombstone-not-handle cost
// that ruling accepted.
//
// A REFUSAL IS THE HONEST ANSWER AND IT USED NOT TO BE: `recreateParkedShell`'s first line answered
// `{ ok: true }` for a live session it had not rebuilt, so the button reported success having
// opened nothing — the swallow F-212 was filed about. `{ ok: false, reason: 'no-session' }` is the
// same shape `controlByTask` returns for the same condition.
//
// `segment` rides in from the caller (`channel-dir-ipc.js`), the only layer that has it: main knows
// the workspace UUID, and a router path needs the SLUG.
function reopenByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  if (!deps.sessions) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  if (!deps.openAgentWindow) return { ok: false }; // mid-wave / harness: fail closed
  // ⚠ THE AGENT ID COMES FROM THE RESOLVED SESSION, NOT FROM THE CALLER (2026-08-21). The
  // window is one-per-agent now, and keying it on what the caller happened to pass would open a
  // second window on the same agent whenever the caller named nothing.
  return deps.openAgentWindow({
    segment: String((a && a.segment) || ''), channelId, taskId, agentId: String(s.agentId || ''),
  });
}

// ── THE AGENTS TAB'S TWO CONTROLS: PAUSE and END, on MY OWN agent ────────────────
//
// Wiring plan Phase 5 (2026-08-18). The Agents tab and the agent view let the operator pause or end
// an agent from the MAIN window, where before those verbs existed only inside that session's own
// window. This is the SAME PAIR reached by the SAME dispatch — a second stop path is a second set
// of teardown bugs.
//
//   pause  -> { type: 'interrupt' }  stops the turn in flight; the session stays live,
//             resumable and named — the same event the session window's send button dispatched
//             as its PAUSE MORPH.
//   end    -> { type: 'end' }        terminal. It ends the AGENT and touches no thread — a
//             thread has no finished state (INVARIANTS §5, wiring plan Phase 4).
//
// OWN AGENTS ONLY, free here rather than enforced: the registry holds only sessions THIS machine is
// running for THIS operator, so a key that resolves is by construction the caller's own. There is
// no cross-machine control op and this is not the seam to add one — a peer's paused agent is
// rendered from PRESENCE on the reading side (INVARIANTS §11).
//
// Resolved by (channel, thread) like `reopenByTask`, never by `sessionId` — that id is ephemeral
// across a park+resume and is a React key on the wire, not an address. Settled and retained-ended
// sessions answer `{ ok: false }`: an ended session's pill outlives its registry entry, so "the
// card is on screen" does not mean "there is something left to stop".
const CONTROL_EVENTS = { pause: 'interrupt', end: 'end' };

function controlByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const type = Object.prototype.hasOwnProperty.call(CONTROL_EVENTS, a && a.action) ? CONTROL_EVENTS[a.action] : null;
  if (!type || !deps.sessions || !deps.dispatch) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  try {
    // ⚠ AN `end`'s REASON IS FORWARDED, NEVER POLICED HERE (2026-09-15): `session-effects.js ›
    // endReasonOf` owns the closed set, and a second one in this file would be a second
    // vocabulary. It labels the end (`park-on-claim` says so); it widens nothing.
    deps.dispatch(s, type === 'end' && a && a.reason ? { type: type, reason: a.reason } : { type: type });
  } catch (_) {
    return { ok: false };
  }
  return { ok: true };
}

// ── THE LIVE PERMISSION POSTURE: BOTH AXES, ON A RUNNING SESSION ─────────────────
//
// Samuel, 2026-08-20. The agent view can move a LIVE session's posture, and it applies from the
// very next gate decision rather than the next launch.
//
// "The next gate" is a fact, not a hope: `session-io.js › grantArgs` reads BOTH axes off `s.state`
// at CALL time, so there is nothing to invalidate and no cache to bust — moving the reducer's state
// IS the change. That is also why this dispatches the reducer's own `set_tool_mode` /
// `set_message_mode` rather than assigning `s.state` directly: the reducer coerces fail-closed and
// emits the `modes` echo, and a second writer to one field is how two readers come to disagree.
//
// IT DOES NOT RE-DECIDE ANYTHING ALREADY PENDING. The reducer's own branch has carried that
// argument since v2.9 — `pendingPermissions` holds requestIds only, so a blanket drain would let
// the TOOL axis answer a MESSAGE operation. Gated calls ARE held locally and routinely since
// 2026-08-31 (`session-windowless.js › bridgeToolGate`), and since 2026-09-17 the operator answers
// them on the agent panel (`session-answer-permission.js`).
//
// THE WINDOWLESS CLAMP BELOW IS F-236's FIX. `channel-prefs.js › windowlessMessageMode` floors both
// LAUNCH lanes, but nothing floored a mode set on a session ALREADY RUNNING — so the agent view's
// Messages select, which offers all four values, could put a windowless session on `ask`.
// `session-gate.js › enqueue` then HOLDS the peer's reply with no accept surface and no drain left
// to release it: the session parks at `awaiting_inbound` forever and the message is invisible to
// the agent permanently, from one gesture in the UI. It lives here rather than at the IPC boundary
// because only this layer has resolved the SESSION and can see whether it is windowless.
//
// IT WIDENS SUPERVISION, NEVER CONTAINMENT — the security shape, and the reason this is a safe op
// to expose. The two axes decide whether the OPERATOR is asked; the PROFILE decides what is
// reachable at all, is checked FIRST, and no posture can widen it. So the worst a forged call can
// do is stop asking about tools the operator's own channel profile already permits.
function setModeByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const axis = a && a.axis;
  if (!deps.sessions || !deps.dispatch) return { ok: false };
  if (axis !== 'tools' && axis !== 'messages') return { ok: false, reason: 'bad-axis' };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // THE WINDOWLESS FLOOR, applied here because only here is the session resolved (F-236). A
  // windowless session has no Accept surface and nothing left that can release a held inbound turn,
  // so the IN half may not drop below auto. It CLAMPS rather than refusing: a refusal would leave
  // the select showing a value main is not enforcing. What comes back is main's post-dispatch truth
  // either way, so the UI renders the floored value rather than the requested one.
  const mode = axis === 'messages' && s.windowless === true ? floorWindowlessMessage(a && a.mode) : (a && a.mode);
  try {
    deps.dispatch(s, { type: axis === 'tools' ? 'set_tool_mode' : 'set_message_mode', mode: mode });
  } catch (_) {
    return { ok: false };
  }
  // ANSWER WITH MAIN'S OWN POST-DISPATCH VALUES, never an echo of what was asked for. The reducer
  // coerces fail-closed, so a renderer that stamped its own request would show a posture nothing is
  // enforcing.
  const st = s.state || {};
  return { ok: true, tools: st.toolMode, messages: st.messageMode };
}

// ── THE LIVE MODEL: SWITCH A RUNNING AGENT'S MODEL (2026-08-22, Samuel's ruling) ─────────────
//
// The SDK really supports this, which is why it is a switch rather than a deferral:
// `Query.setModel(model?: string)` is "only available in STREAMING INPUT MODE", and every session
// here runs in streaming input mode by construction (`sdk.query({ prompt: s.pushIterator, … })`
// takes an async iterable, never a string). So the running child is told, and the change applies
// from the next response.
//
// IT IS RECORDED AS WELL AS APPLIED, and both halves are load-bearing: `s.model` is what
// `session-query.js › buildSdkOptions` reads on the NEXT assembly, so a switch that only called the
// SDK would silently revert the pick the first time the session was rebuilt — and writing without
// calling would report a model the running turn is not using.
//
// The value is coerced TWICE on the way in, exactly like the launch path: the caller speaks the ID
// vocabulary, `aliasForModelId` maps it to the frozen ALIAS enum, and `buildSdkOptions` re-coerces
// at the last step before a child process can see it.
//
// NOT CONTAINMENT, AND NOT SUPERVISION EITHER: it grants nothing, gates nothing and reaches no tool
// decision — `grantDecision` never reads a model. ASYNC, unlike its three neighbours, because the
// SDK call is a promise; it resolves after the switch has been ACCEPTED, and a throw answers
// `{ ok: false }` and leaves `s.model` alone, because a recorded pick nothing applied is a lie.
async function setModelByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  if (!deps.sessions) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // ── ⚠ IS A LIVE SWITCH A THING THIS RUNTIME DOES? (2026-09-21, U10) ──────────────────────
  //
  // ⚠ THIS FUNCTION'S OWN HEADER STATES THE RULE IT WAS BREAKING: *"a recorded pick nothing
  // applied is a lie."* The `setModel` call below is guarded by `typeof … === 'function'`, so on a
  // runtime whose live handle has no model verb NOTHING WAS APPLIED — and the write two lines
  // further down still recorded the alias and answered `{ ok: true }`. That value is what
  // `buildLaunchSpec` reads on the NEXT assembly, so the session came back on a model the operator
  // was told it was already using. It also wrote one runtime's ALIAS onto another runtime's
  // session, which is exactly the cross-vocabulary coercion the adapter seam exists to stop.
  // ⚠ `capability.js › canSwitchModelLive` HAD NO CONSUMER IN `main/` UNTIL THIS. It was declared,
  // mirrored on the web side, and read by nothing — the `axisBOpScoped` shape (D3), one capability
  // along. ⚠ REFUSED WITH A SENTENCE, NEVER SILENTLY: `runtime-copy.js › liveModelSwitchRefusal`
  // names the runtime and says what to do instead, and `'unverified'` and `false` are worded apart
  // because the operator can act on the difference.
  // ⚠ IT REFUSES A CONTROL, NOT A LAUNCH — the boundary `interruptRefusal` draws. A runtime that
  // cannot hot-swap a model is perfectly launchable on any model it offers.
  const descriptor = runtimeRegistry.descriptorFor(s.runtimeId);
  const liveSwitchRefusal = runtimeCopy.liveModelSwitchRefusal(descriptor);
  if (liveSwitchRefusal) return { ok: false, reason: 'unsupported', detail: liveSwitchRefusal };
  const alias = sessionModel.aliasForModelId(a && a.model);
  // 2026-09-06: `modelArg` no longer answers null for `'default'` — it answers the PRODUCT fallback,
  // because "Default" stopped being an option an operator can pick (`session-model.js ›
  // LAUNCH_MODEL_FALLBACK`). So an unrecognised value RESETS this session to the model a fresh
  // launch would spend rather than clearing the override. The `|| undefined` below covers a value
  // that cannot resolve at all, and is what a runtime with no model concept relies on.
  const arg = sessionModel.modelArg(alias);
  try {
    // ⚠ A LIVE SESSION WHOSE HANDLE HAS NO MODEL VERB IS A REFUSAL, NOT A NO-OP (2026-09-21, U10).
    // The declaration above is the runtime's PROMISE; this is the handle in hand disagreeing with
    // it, and recording a switch over either one is the lie this function's header forbids.
    // ⚠ A session with NO QUERY AT ALL is the spawn-idle / parked shape and is untouched: there is
    // nothing running to disagree with, and the recorded pick is what its first turn will spend.
    if (s.query) {
      if (typeof s.query.setModel !== 'function') {
        return { ok: false, reason: 'unsupported', detail: runtimeCopy.liveModelSwitchRefusal(descriptor)
          || `${runtimeCopy.runtimeLabel(descriptor)} did not offer a live model switch on this session.` };
      }
      await s.query.setModel(arg || undefined);
    }
  } catch (_) {
    return { ok: false, reason: 'switch-failed' };
  }
  // ⚠ AFTER the SDK accepted it, never before: `s.model` is what the next assembly reads, so
  // recording a switch that did not land would survive the running query and outlive the error.
  s.model = alias;
  return { ok: true, model: alias };
}

// ── THE DIRECT 1:1 LANE: THE OPERATOR TALKS TO THEIR OWN AGENT ───────────────────
//
// F-212's third lane, closed 2026-08-20 on two questions: does a main-window op that starts a turn
// get pause/end's sender review, and does an out-of-band steer bypass the inbound gate.
//
// 1. IT DISPATCHES THE EXISTING `steer` EVENT, on the existing reducer branch. No new branch, no
//    second wake path — `steer` already wakes a parked session, re-arms the idle TTL and pushes
//    the turn. A second path to "start a turn" is a second set of lifecycle bugs.
//
// 2. IT BYPASSES THE INBOUND GATE, AND THAT IS CORRECT, BECAUSE IT IS NOT INBOUND. Axis B governs
//    COUNTERPARTY turns — words arriving from another member's machine. This is the operator's own
//    keyboard, in a window MAIN created and registered, on their own agent.
//
// 3. RESOLVED BY (channel, thread) AGAINST MAIN'S OWN REGISTRY, never `event.sender` — the agent
//    window is NOT the session's window (a windowless session has none). Resolving by key against a
//    registry holding nothing but this operator's own sessions is what makes it own-agents-only
//    STRUCTURALLY, exactly as pause/end are.
//
// 4. THE TEXT IS DELIMITED WITH THE SESSION'S NONCE AND CARRIES OPERATOR AUTHORITY
//    (`session-seed.js › frameOperatorTurn`, which states why fencing it as DATA would be wrong).
//    A DIRECTION is the inverse — `frameDirectedTurn` (2026-08-31): text another AGENT wrote,
//    fenced as DATA, no operator authority.
//
// 5. THE FAILURE DIRECTION is wider than pause/end's: a forged call makes the operator's OWN agent
//    do work they did not ask for, inside that session's existing profile and containment. It
//    grants no tool, widens no posture, reaches no other machine and cannot post without the
//    outbound gate — more than "an agent that stops" and materially less than a launch, which is
//    why the op is bounded in the preload AND in main and refuses while the version floor blocks.
function messageByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const text = String((a && a.text) || '').trim();
  // ⚠ A DIRECTION (2026-08-31): same op, different SPEAKER (`session-directed.js › readDirected`).
  const directed = directedTurn.readDirected(a);
  if (!text || !deps.sessions || !deps.dispatch) return { ok: false };
  if (directed === false) return { ok: false, reason: 'no-session' };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // 🔒 CROSS-ACCOUNT FENCE (F-373): the registry outlives a sign-out. Fails closed if unstamped.
  if (directed && s.operatorUserId !== directed.operatorUserId) return { ok: false, reason: 'no-session' };
  // H1: a session HELD on the sign-in action has no query to feed — the push would land on
  // a closed iterator and the operator's words would vanish. Refuse and say which, so the
  // composer can tell them to sign in rather than silently eating the message.
  if (s.state && s.state.authHeld === true) return { ok: false, reason: 'auth-hold' };
  try {
    // OPEN THE PRIVATE WINDOW BEFORE THE DISPATCH (2026-08-22, Samuel's ruling), and read the
    // in-flight state while it is still THIS turn's: `openPrivateTurn` looks at `s.state.activity`
    // to decide whether the pushed message becomes the next turn (+1) or queues behind one already
    // running (+2), and the dispatch moves that activity to `working`, so asking afterwards would
    // always read "in flight". While the window is open, Axis B's OUTBOUND widening is withdrawn
    // (`session-private.js` carries the whole argument).
    const inFlight = privateTurn.turnInFlight(s.state); // BEFORE the dispatch — see below
    // `priority: 'next'` — an out-of-band note QUEUES behind the turn in flight rather than
    // interrupting it. 'now' exists (the send button's interrupt morph) and is deliberately not
    // used: the operator asked to say something, not to stop the agent, and Pause is right there.
    // `rawText` rides beside the framed text and is display-only — the work lane shows the operator
    // what they said, and the FRAMED string is a prompt, not a caption. `private: true` tells the
    // lane this steer is the 1:1 lane.
    deps.dispatch(s, {
      type: 'steer',
      text: (directed ? framing.frameDirectedTurn : framing.frameOperatorTurn)(s.nonce, text),
      rawText: text,
      private: true,
      directed: !!directed, senderAgentId: (directed && directed.senderAgentId) || null, // ⚠ ATTRIBUTION — `session-narration.js` reads both. ⚠ THE SECOND IS A CAPTION AND AN UNVERIFIED ONE (F-376a): WHICH of the operator's own agents filed the direction, server-derived from `X-Dopl-Session-Id`, which proves nothing — nothing may gate on it, and the FENCE two lines up (`s.operatorUserId !== directed.operatorUserId`) is untouched by its presence
      priority: 'next',
    });
    // 🔒 AFTER THE DISPATCH (F-372) — a wake RESETS both windows. See `openPrivateTurn`.
    privateTurn.openPrivateTurn(s, inFlight);
    if (directed) directedTurn.armAndOpen(s, directed, inFlight);
  } catch (_) {
    return { ok: false };
  }
  return { ok: true };
}

// ── C-8: THE SESSIONS A QUIT WOULD ORPHAN, AND HOW THEY ARE ENDED ────────────────
//
// `before-quit` stopped the listener and nothing else — it never iterated the registry, never
// aborted a controller, and never flushed the state push. So every live `sdk.query()` left a
// bundled `claude` child running, still holding this session's PRE-APPROVED `dopl_channel` MCP
// access, able to go on posting after the app it belonged to was gone. The crash path already fixes
// exactly this (session-engine's C3 teardown); the quit path never reached it.
//
// THE PREDICATE IS "HOLDS A LIVE CHILD", NOT "IS WORKING". A parked session's query is torn down
// (that IS what a park does), so it orphans nothing and is left alone. Everything else that is not
// settled owns a child, INCLUDING one sitting between turns at activity 'idle': its push iterator
// is open and the process is alive. Reading the pill state here would have spared exactly those,
// which are the majority of the orphans.
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
    agentId: s.agentId || null, // several rows may share a thread — the id is what tells them apart
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

module.exports = { bind, listLiveSessions, reopenByTask, controlByTask, setModeByTask, setModelByTask, messageByTask, listOrphanRisk, endLiveSessions, resolveSession }; // ⚠ `resolveSession` IS EXPORTED SO IT IS NOT COPIED (2026-09-17): `main/session-answer-permission.js` is a sibling of the ops above that this file had no room for, and the ONE thing it must not restate is the multiplayer address rule — see the block over the function
