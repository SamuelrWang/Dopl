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
// ⚠ `reopenWindow(sessionId)` WENT WITH THE TRAY'S "Sessions" SUBMENU (2026-08-20, F-228) —
// its only caller — as did `showLive`, which revealed a hidden session window.
//
// v3.0 VOCABULARY: this opens a VIEW onto this member's own agent working a shared THREAD, and
// it starts NOTHING. The agent wakes on a steer or an accepted inbound, never on this call. The
// `Task` in the name and the `taskId` argument are the wire spelling of `thread`.
// Pinned by test/open-session-no-query.test.mjs.

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

// ─── BEGIN SESSION-REOPEN-PURE (injectable; unit-tested via source extraction) ────

let deps = { sessions: null, refreshTray: function () {}, openAgentWindow: null, dispatch: null };

// The engine binds its in-memory `sessions` Map + tray-refresh here at load.
//
// ⚠ `bind` REBUILDS `deps` FROM A LITERAL, so a handle the engine passes and this list omits
// is DROPPED SILENTLY — and the drop reads as the fail-closed guard firing, not as a wiring
// bug. That happened to `openAgentWindow` during the F-228 sweep and `reopenByTask` answered
// `{ok:false}` on every live session, which is exactly what a legitimately unopenable session
// looks like. Add the field HERE whenever the engine's `sessionReopen.bind({...})` grows one.
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
// ⚠ EVERY OP IN THIS FILE USED TO DO `deps.sessions.get(store.sessionKey(channelId, taskId))`,
// AND THAT LOOKUP IS NOW A CATEGORY ERROR: (channel, thread) names a GROUP of this operator's
// agents, not one session. Four ops (reopen / pause+end / setMode / message) each had their own
// copy of it, which is four places to get the new rule subtly different — so there is one.
//
// THE RULE, and it is chosen to be the COMPATIBLE one:
//   • an `agentId` resolves EXACTLY. A wrong or dead id answers NOTHING and the caller gets
//     `{ok:false, reason:'no-session'}` — "pause my agent" must never pause a different one.
//   • NO `agentId` takes the OLDEST live session on the thread. That is byte-for-byte what
//     every caller got before multiplayer existed (there was only ever one), so an older
//     renderer, the tray and the deep-link lanes keep working. It is only ever ambiguous in the
//     case that could not previously arise, and the fix for that case is to name the agent —
//     which every op on the bridge now can.
//
// ⚠ IT STAYS INSIDE THE PURE BLOCK, on `store`'s terms: the source-extraction test slices this
// block and injects a fake store, so a helper the ops call has to be sliced with them.
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
// surface the Agents tab lists from. ⚠ The tray's "Sessions" submenu was its first reader and
// is deleted (F-228); the prompt is not, and a restart mid-turn still kills a spawned session. One row PER KEY, never per channel: with N concurrent
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
      // 2026-08-21: with N agents per thread, (channel, thread) no longer identifies a row.
      agentId: s.agentId || null,
      channelName: (s.context && s.context.channelName) || null,
      taskTitle: (s.context && s.context.taskTitle) || null,
      status: (s.state && s.state.phase) || null,
      // ⚠ ALWAYS FALSE, AND KEPT AS A WIRE FIELD ON PURPOSE (2026-08-20). `windowHidden` is
      // initialised false and never set: the reshow branch that wrote it went with the session
      // window (F-228). Its one consumer is the updater's restart prompt, which does not read
      // it. It stays because this shape crosses to a caller that may be an OLDER build during
      // an update, and dropping a field from a wire shape is the change that needs a reason —
      // but nothing may start reasoning from it.
      hidden: false,
    });
  }
  return out;
}

// THE ONE REOPEN PATH (item 2; rebuilt on the agent window, 2026-08-20, F-212's closure).
//
// ⚠ IT HAS EXACTLY TWO ANSWERS NOW. A LIVE session opens `main/agent-window.js` — a real view
// onto it: its narration, what it sent, and a composer that reaches it. Anything else refuses.
// The branches that went are the ones that were about WINDOWS rather than about agents:
//   • the live-session `show()+focus()` of its OWN window — no session has one;
//   • the retained ENDED window (`session-summary.keptWindow`) — a retained end has no window
//     to reveal. ⚠ Retention itself is LIVE again since 2026-08-20 (F-234): the pill is kept
//     unconditionally, bounded by MAX_ENDED. What it cannot be is OPENED, which is the
//     tombstone-not-handle cost that ruling accepted;
//   • the `recreateParkedShell` fallback, which minted a v1 session window from a durable
//     record, or from the channel when no record existed.
//
// ⚠ A REFUSAL IS THE HONEST ANSWER AND IT USED NOT TO BE. `recreateParkedShell`'s first line
// answered `{ ok: true }` for a live session it had not rebuilt, so the button reported success
// having opened nothing — the swallow F-212 was filed about. `{ ok: false, reason: 'no-session' }`
// is the same shape `controlByTask` already returns for the same condition, and the panel words
// it with `AGENT_CONTROL_REFUSED`.
//
// ⚠ `segment` rides in from the caller (`channel-dir-ipc.js`), which is the only layer that has
// it: main knows the workspace UUID, and a router path needs the SLUG.
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
    segment: String((a && a.segment) || ''),
    channelId,
    taskId,
    agentId: String(s.agentId || ''),
  });
}

// ── THE AGENTS TAB'S TWO CONTROLS: PAUSE and END, on MY OWN agent ────────────────
//
// Wiring plan Phase 5 (2026-08-18). The Agents tab and the agent view let the operator pause or
// end an agent from the MAIN window, where before those two verbs existed only inside that
// session's own window (`session:interrupt` / `session:end`, both deleted with it). This is the
// SAME PAIR reached by the SAME dispatch — nothing about running a session is re-implemented
// here, and deliberately so: a second stop path is a second set of teardown bugs.
//
//   pause  -> { type: 'interrupt' }  stops the turn in flight; the session stays live,
//             resumable and named. ⚠ It is the same reducer event the session window's send
//             button dispatched as its PAUSE MORPH — the verb outlived the surface (F-228).
//   end    -> { type: 'end' }        terminal, and likewise the old "End session" event.
//             It ends the AGENT and touches no thread — a thread has no finished state
//             (INVARIANTS §5, wiring plan Phase 4).
//
// ⚠ OWN AGENTS ONLY, AND THAT IS FREE HERE RATHER THAN ENFORCED. The registry holds only
// sessions THIS machine is running for THIS operator, so a key that resolves is by construction
// the caller's own. There is no cross-machine control op and this is not the seam to add one:
// a peer's paused agent is rendered from PRESENCE on the reading side (INVARIANTS §11), never
// driven from here.
// ⚠ RESOLVED BY (channel, thread) like `reopenByTask`, never by `sessionId` — that id is
// ephemeral across a park+resume and is a React key on the wire, not an address.
// ⚠ SETTLED AND RETAINED-ENDED SESSIONS ANSWER `{ ok: false }`: an ended session's pill outlives
// its registry entry (the retention rule), so "the card is on screen" does not mean "there is
// something left to stop". Fail closed rather than dispatching into a settled object.
// ⚠ THAT CASE IS REACHABLE AGAIN SINCE 2026-08-20 (F-234). Retention gated on a live WINDOW,
// which no session has had since the F-228 retirement, so nothing was retained and this
// sentence described a state that could not occur. It occurs now — an abandoned agent holds
// its pill — so this refusal is the one an operator actually meets.
const CONTROL_EVENTS = { pause: 'interrupt', end: 'end' };

function controlByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const type = Object.prototype.hasOwnProperty.call(CONTROL_EVENTS, a && a.action)
    ? CONTROL_EVENTS[a.action]
    : null;
  if (!type || !deps.sessions || !deps.dispatch) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  try {
    deps.dispatch(s, { type: type });
  } catch (_) {
    return { ok: false };
  }
  return { ok: true };
}

// ── THE LIVE PERMISSION POSTURE: BOTH AXES, ON A RUNNING SESSION ─────────────────
//
// Samuel, 2026-08-20. The agent view can move a LIVE session's posture, and it applies from
// the very next gate decision rather than the next launch.
//
// ⚠ WHY "THE NEXT GATE" IS A FACT AND NOT A HOPE. `session-io.js › grantArgs` reads BOTH
// axes off `s.state` at CALL time — its own comment says so ("Both axes are read LIVE …: a
// mode changed mid-turn applies to the next call"). So there is nothing to invalidate and no
// cache to bust: moving the reducer's state IS the change. That is also why this dispatches
// the reducer's own `set_tool_mode` / `set_message_mode` rather than assigning `s.state`
// directly — the reducer coerces fail-closed (`coerceMode`) and emits the `modes` echo, and a
// second writer to the same field is how two readers come to disagree about one posture.
//
// ⚠ WHAT IT DOES NOT DO: RE-DECIDE ANYTHING ALREADY PENDING. The reducer's own branch has
// carried that argument since v2.9 — `pendingPermissions` holds requestIds only, so it cannot
// tell a queued Bash from a queued `op=open`, and a blanket drain would let the TOOL axis
// answer a MESSAGE operation. ⚠ IN THE WINDOWLESS SHAPE THE QUESTION IS MOOT ANYWAY, which is
// worth stating because it is not obvious: `session-windowless.js › claimGate` DENIES a gated
// tool immediately (`setImmediate(() => decide(rid, 'deny'))`) and bridges an outbound post to
// a consent row the server decides. Nothing is ever HELD locally waiting for a posture to
// change, so "re-evaluate pending gates" has no pending gates to re-evaluate. The inbound
// half's `drainInbound` went with the v1 purge for the same reason (`session-gate.js`: a
// windowless session's message axis is floored at `auto_inbound`, so the queue never holds).
//
// ⚠ AND THAT FLOOR USED TO BE A LAUNCH-ONLY FACT, WHICH MADE THE SENTENCE ABOVE FALSE FROM
// THIS VERY FUNCTION (2026-08-20, F-236). `channel-prefs.js › windowlessMessageMode` floors
// both LAUNCH lanes, but nothing floored a mode set on a session ALREADY RUNNING — so the
// agent view's Messages select, which offers all four values, could put a windowless session
// on `ask`. `session-gate.js › enqueue` then HOLDS the peer's reply with no accept surface
// and no drain left to release it (F-228 deleted `decideInbound` / `drainQueue` /
// `drainInbound` together): the session parks at `awaiting_inbound` forever, `noteGatedBody`
// records the body, and seed/history both filter it out — the message is invisible to the
// agent permanently. One gesture from the UI. THE CLAMP BELOW IS THE FIX, and it lives here
// rather than at the IPC boundary because only this layer has resolved the SESSION and can
// see whether it is windowless.
//
// ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT — the security shape, and the reason this is a
// safe op to expose. The two axes decide whether the OPERATOR is asked; the PROFILE decides
// what is reachable at all, is checked FIRST, and no posture can widen it
// (`session-profiles.js`: `SESSION_HARD_DENY` is unconditional, and `bypass` is a POSITIVE
// allow-list — an unclassified tool gates in every mode, `bypass` included). So the worst a
// forged call can do is stop asking about tools the operator's own channel profile already
// permits: exactly the authority the durable launch posture hands the same operator at spawn
// (`channel-prefs.js`), exercised a few minutes later on a session already running.
function setModeByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const axis = a && a.axis;
  if (!deps.sessions || !deps.dispatch) return { ok: false };
  if (axis !== 'tools' && axis !== 'messages') return { ok: false, reason: 'bad-axis' };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // ⚠ THE WINDOWLESS FLOOR, APPLIED HERE BECAUSE ONLY HERE IS THE SESSION RESOLVED (F-236).
  // A windowless session has no Accept surface and nothing left that can release a held
  // inbound turn, so the IN half may not drop below auto. It CLAMPS rather than refusing: the
  // operator asked for less supervision on the OUT half in the `auto_outbound` case and gets
  // exactly that, and a refusal would leave the select showing a value main is not enforcing
  // — the lie the note below is about. What comes back is main's post-dispatch truth either
  // way, so the UI renders the floored value rather than the requested one.
  const mode = axis === 'messages' && s.windowless === true
    ? floorWindowlessMessage(a && a.mode)
    : (a && a.mode);
  try {
    deps.dispatch(s, {
      type: axis === 'tools' ? 'set_tool_mode' : 'set_message_mode',
      mode: mode,
    });
  } catch (_) {
    return { ok: false };
  }
  // ⚠ ANSWER WITH MAIN'S OWN POST-DISPATCH VALUES, never an echo of what was asked for. The
  // reducer coerces fail-closed, so a renderer that stamped its own request would show a
  // posture nothing is enforcing — the exact lie the deleted session window's selects earned
  // a fix for twice.
  const st = s.state || {};
  return { ok: true, tools: st.toolMode, messages: st.messageMode };
}

// ── THE DIRECT 1:1 LANE: THE OPERATOR TALKS TO THEIR OWN AGENT ───────────────────
//
// F-212's third lane, closed 2026-08-20. The entry parked it on a security decision and
// named exactly what that decision had to cover: *"a main-window op that starts a turn
// needs the `mainOnly` review that `sessions:pause`/`sessions:end` got, plus a ruling on
// whether an out-of-band steer bypasses the inbound gate."* Both answers, in order:
//
// 1. ⚠ IT DISPATCHES THE EXISTING `steer` EVENT, ON THE EXISTING REDUCER BRANCH. No new
//    branch, no second wake path, no second way to start a turn — `steer` already wakes a
//    parked session (`resumeQuery`), re-arms the idle TTL and pushes the turn. A SECOND
//    path to "start a turn" is a second set of lifecycle bugs, which is the same argument
//    `controlByTask` above makes for the two stop verbs.
//
// 2. ⚠ IT BYPASSES THE INBOUND GATE, AND THAT IS CORRECT, BECAUSE IT IS NOT INBOUND.
//    AXIS B governs COUNTERPARTY turns — words arriving from another member's machine.
//    This is the operator's own keyboard, in a window MAIN created and registered, on
//    their own agent. `session:send` was always an ungated steer for exactly this reason;
//    what changed is only WHICH window may send one, and that is the same widening Samuel
//    already ruled on for the pop-out (option (a), the app-window registry).
//
// 3. ⚠ RESOLVED BY (channel, thread) AGAINST MAIN'S OWN REGISTRY — never `event.sender`.
//    That is not a preference: the old `session:send` binding re-derived the session from
//    the sender's webContents, which cannot work here because the agent window is NOT the
//    session's window (a windowless session has none). Resolving by key against a registry
//    that holds nothing but this operator's own sessions is what makes it own-agents-only
//    STRUCTURALLY, exactly as pause/end are.
//
// 4. ⚠ THE TEXT IS DELIMITED WITH THE SESSION'S NONCE AND CARRIES OPERATOR AUTHORITY —
//    `session-seed.js › frameOperatorTurn`, which states why fencing it as DATA would be
//    the wrong move. The body is bounded by the caller and stripped of forged fence lines;
//    it is never rewritten.
//
// 5. ⚠ THE FAILURE DIRECTION, STATED PLAINLY BECAUSE IT IS WIDER THAN PAUSE/END'S. A
//    forged call makes the operator's OWN agent do work they did not ask for, inside that
//    session's existing profile and containment. It grants no tool, widens no posture,
//    reaches no other machine, and cannot post without the outbound gate. That is more
//    than "an agent that stops" and materially less than a launch — and it is the reason
//    the op is bounded in the preload AND in main, and refuses while the version floor is
//    blocking, like every other window-minting or turn-starting op.
function messageByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const text = String((a && a.text) || '').trim();
  if (!text || !deps.sessions || !deps.dispatch) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // H1: a session HELD on the sign-in action has no query to feed — the push would land on
  // a closed iterator and the operator's words would vanish. Refuse and say which, so the
  // composer can tell them to sign in rather than silently eating the message.
  if (s.state && s.state.authHeld === true) return { ok: false, reason: 'auth-hold' };
  try {
    // ⚠ OPEN THE PRIVATE WINDOW BEFORE THE DISPATCH (2026-08-22, Samuel's ruling), and read the
    // in-flight state while it is still THIS turn's. `openPrivateTurn` looks at `s.state
    // .activity` to decide whether the pushed message becomes the next turn (+1) or queues
    // behind one already running (+2); the dispatch below moves that activity to `working`, so
    // asking afterwards would always read "in flight" and over-cover by a turn every time.
    // While the window is open, AXIS B's OUTBOUND widening is withdrawn — a post the agent
    // attempts reaches the outbound consent gate instead of auto-sending
    // (`session-private.js` carries the whole argument).
    privateTurn.openPrivateTurn(s);
    // `priority: 'next'` — an out-of-band note QUEUES behind the turn in flight rather
    // than interrupting it. 'now' exists (it is the send button's interrupt morph) and is
    // deliberately not used: the operator asked to say something, not to stop the agent,
    // and Pause is right there for the other intent.
    // ⚠ `rawText` RIDES BESIDE THE FRAMED TEXT and is display-only: the work lane shows the
    // operator what they said (`session-narration.js › entryFor`, kind `private-in`), and the
    // FRAMED string is a prompt, not a caption. `private: true` is what tells the lane this
    // steer is the 1:1 lane rather than any other steer.
    deps.dispatch(s, {
      type: 'steer',
      text: framing.frameOperatorTurn(s.nonce, text),
      rawText: text,
      private: true,
      priority: 'next',
    });
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

module.exports = { bind, listLiveSessions, reopenByTask, controlByTask, setModeByTask, messageByTask, listOrphanRisk, endLiveSessions };
