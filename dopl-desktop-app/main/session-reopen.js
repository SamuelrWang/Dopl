// The operator's controls over their OWN live agents, resolved against the engine's registry (injected via
// bind(); no cycle): reopen, pause/end, the live posture, the live model and the direct 1:1 lane, plus the
// quit guard. `taskId` is the wire spelling of `thread`. The PURE block's module-scope deps are free vars.

const store = require('./session-store');
const { floorWindowlessMessage } = require('./session-profiles');
const framing = require('./session-seed');
const privateTurn = require('./session-private');
const directedTurn = require('./session-directed');
const runtimeRegistry = require('./runtime');
const runtimeCopy = runtimeRegistry.copy;
// The auth re-probe (P4-06), required lazily.
const authReprobe = {
  reprobesOnWake: (s) => require('./session-auth').reprobesOnWake(s),
  reprobeHeld: (s) => require('./session-auth').reprobeHeld(s),
};

// ─── BEGIN SESSION-REOPEN-PURE (injectable; unit-tested via source extraction) ────

let deps = { sessions: null, refreshTray: function () {}, openAgentWindow: null, dispatch: null };

// `bind` rebuilds `deps` from a literal: a handle the engine passes and this list omits is dropped silently,
// and the drop reads as a guard firing (it once made `reopenByTask` refuse every live session).
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    refreshTray: (d && d.refreshTray) || function () {},
    openAgentWindow: (d && d.openAgentWindow) || null,
    dispatch: (d && d.dispatch) || null,
  };
}

// One agent out of a thread: an `agentId` resolves EXACTLY (a wrong or dead id answers nothing — "pause my
// agent" must never pause another); no id takes the OLDEST live agent on the thread. Exported so
// `session-answer-permission.js` never restates it.
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

// PURE READ — one row per live session for the updater's restart prompt and the Agents tab; fields, never handles.
function listLiveSessions() {
  const out = [];
  if (!deps.sessions) return out;
  for (const s of deps.sessions.values()) {
    if (s.settled) continue;
    out.push({
      sessionId: s.sessionId,
      key: s.key,
      channelId: s.channelId || null,
      workspaceId: s.workspaceId || null,
      taskId: s.taskId || '',
      agentId: s.agentId || null,
      runtimeId: s.runtimeId || null,
      channelName: (s.context && s.context.channelName) || null,
      taskTitle: (s.context && s.context.taskTitle) || null,
      status: (s.state && s.state.phase) || null,
    });
  }
  return out;
}

// The one reopen path: a LIVE session opens the agent window; anything else refuses (`no-session`). `segment`
// comes from the caller, the only layer holding the workspace slug.
function reopenByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  if (!deps.sessions) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  if (!deps.openAgentWindow) return { ok: false };
  // The agent id comes from the resolved session, so one agent never gets a second window.
  return deps.openAgentWindow({
    segment: String((a && a.segment) || ''), channelId, taskId, agentId: String(s.agentId || ''),
  });
}

// Pause and End on MY OWN agent, through the same dispatch (a second stop path is a second set of teardown
// bugs): pause interrupts the turn, end is terminal and touches no thread. Own-agents-only by construction.
const CONTROL_EVENTS = { pause: 'interrupt', end: 'end' };

function controlByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const type = Object.prototype.hasOwnProperty.call(CONTROL_EVENTS, a && a.action) ? CONTROL_EVENTS[a.action] : null;
  if (!type || !deps.sessions || !deps.dispatch) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  try {
    // An end's reason is forwarded, never validated here: `session-effects.js › endReasonOf` owns the set.
    deps.dispatch(s, type === 'end' && a && a.reason ? { type: type, reason: a.reason } : { type: type });
  } catch (_) {
    return { ok: false };
  }
  return { ok: true };
}

// The live posture on a running session: the reducer's own set_* event (it coerces and echoes), applied from
// the next gate decision. Nothing pending is re-decided. It widens supervision, never containment (the
// profile is checked first).
function setModeByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const axis = a && a.axis;
  if (!deps.sessions || !deps.dispatch) return { ok: false };
  if (axis !== 'tools' && axis !== 'messages') return { ok: false, reason: 'bad-axis' };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  const pinned = !!a && a.pinned === true;
  // C2: read in THIS session's words; a pinned pick is clamped to the channel's value for its runtime.
  const pick = privateTurn.pickForSession(s, axis, a && a.mode, pinned);
  // The windowless floor AFTER the clamp: no accept surface, so the IN half may not drop below auto (F-236).
  const mode = axis === 'messages' && s.windowless === true ? floorWindowlessMessage(pick.mode) : pick.mode;
  try {
    deps.dispatch(s, { type: axis === 'tools' ? 'set_tool_mode' : 'set_message_mode', mode: mode, pinned: pinned });
  } catch (_) {
    return { ok: false };
  }
  const st = s.state || {};
  // Main's post-dispatch values, never an echo of the ask.
  return { ok: true, tools: st.toolMode, messages: st.messageMode, clamped: pick.clamped };
}

// Switch a running agent's model on its own runtime (resolved on that runtime's roster; an unknown pick is
// refused with a sentence). Grants nothing and reaches no gate decision.
async function setModelByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  if (!deps.sessions) return { ok: false };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // A runtime that cannot switch live refuses with a sentence; recording a pick nothing applied would be a lie.
  const descriptor = runtimeRegistry.descriptorFor(s.runtimeId);
  const liveSwitchRefusal = runtimeCopy.liveModelSwitchRefusal(descriptor);
  if (liveSwitchRefusal) return { ok: false, reason: 'unsupported', detail: liveSwitchRefusal };
  const picked = typeof (a && a.model) === 'string' ? a.model.trim() : '';
  const rt = typeof runtimeRegistry.runtimeFor === 'function' ? runtimeRegistry.runtimeFor(s.runtimeId) : null;
  const resolved = rt && typeof rt.modelArg === 'function'
    ? rt.modelArg(picked) : { ok: true, arg: picked, id: picked };
  if (!resolved || !resolved.ok) {
    return { ok: false, reason: 'no-model', detail: (resolved && resolved.reason) || '' };
  }
  const arg = resolved.arg;
  try {
    // A live handle with no model verb is a refusal, not a no-op; a session with no query (spawn-idle, parked)
    // just records the pick for its first turn.
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
  // Record `s.model` only AFTER the switch was accepted: the next launch spec reads it.
  s.model = resolved.id || picked;
  return { ok: true, model: s.model };
}

// ── THE DIRECT 1:1 LANE: the operator (or, via `directed`, one of their agents) talks to their own agent.
// It dispatches the existing `steer` (one wake path), bypasses the inbound gate (this is not inbound), resolves
// against main's registry (own agents only), and frames the text with the session nonce: operator authority,
// or DATA for a direction.
function messageByTask(a) {
  const channelId = String((a && a.channelId) || '');
  const taskId = String((a && a.taskId) || '');
  const text = String((a && a.text) || '').trim();
  const directed = directedTurn.readDirected(a);
  if (!text || !deps.sessions || !deps.dispatch) return { ok: false };
  if (directed === false) return { ok: false, reason: 'no-session' };
  const s = resolveSession(a, channelId, taskId);
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // Cross-account fence (F-373): the registry outlives a sign-out; an unstamped session fails closed.
  if (directed && s.operatorUserId !== directed.operatorUserId) return { ok: false, reason: 'no-session' };
  // A held session has no query to feed: refuse (or, for a runtime with no in-app sign-in, re-probe first).
  if (s.state && s.state.authHeld === true) {
    if (!authReprobe.reprobesOnWake(s)) return { ok: false, reason: 'auth-hold' };
    return authReprobe.reprobeHeld(s).then((released) => (released ? messageByTask(a) : { ok: false, reason: 'auth-hold' }));
  }
  try {
    // Read BEFORE the dispatch (it moves activity to working). `priority: 'next'` queues or joins the running
    // turn rather than interrupting it.
    const inFlight = privateTurn.turnInFlight(s.state);
    const framed = (directed ? framing.frameDirectedTurn : framing.frameOperatorTurn)(s.nonce, text);
    deps.dispatch(s, {
      type: 'steer',
      text: framed,
      rawText: text,
      private: true,
      // A caption only, unverified: nothing may gate on it (F-376a).
      directed: !!directed, senderAgentId: (directed && directed.senderAgentId) || null,
      priority: 'next',
    });
    // AFTER the dispatch (F-372): a wake resets both windows. `framed` lets a joined push pay its turn back.
    privateTurn.openPrivateTurn(s, inFlight, framed);
    if (directed) directedTurn.armAndOpen(s, directed, inFlight, framed);
  } catch (_) {
    return { ok: false };
  }
  return { ok: true };
}

// C-8: the sessions a quit would orphan are the ones HOLDING A LIVE CHILD — everything unsettled except a parked
// session (its query is torn down), including one idle between turns.
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

// What the quit dialog names, one row per session a quit would kill.
function listOrphanRisk() {
  return liveChildSessions().map((s) => ({
    key: s.key,
    agentId: s.agentId || null,
    channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null,
    counterpartyName: s.counterpartyName || null,
    working: !!(s.state && s.state.activity !== 'idle' && s.state.activity !== 'awaiting_peer'),
  }));
}

// End every child-holding session through the reducer's calm `inactive` terminal (no second teardown); one
// throwing session must never block a quit.
function endLiveSessions() {
  if (!deps.dispatch) return 0;
  let ended = 0;
  for (const s of liveChildSessions()) {
    try { deps.dispatch(s, { type: 'inactive' }); ended += 1; } catch (_) { /* never block a quit */ }
  }
  return ended;
}

// ─── END SESSION-REOPEN-PURE ──────────────────────────────────────────────────────

module.exports = { bind, listLiveSessions, reopenByTask, controlByTask, setModeByTask, setModelByTask, messageByTask, listOrphanRisk, endLiveSessions, resolveSession };
