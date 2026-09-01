// Session engine — the imperative shell.
//
// Owns ONE agent-runtime query per live session and executes the pure session-reducer's
// side-effect-free effect descriptors. ⚠ WHICH runtime is `main/runtime/index.js`'s answer.
//
// ⚠ THREE THINGS THIS HEADER USED TO DESCRIBE ARE DELETED (2026-08-20, F-228): the CONSENT
// REFLOW (a pre-consent window running no agent work until Accept, then ADOPTED by
// launchResponderSession), REOPEN (live windows hide-on-close + tray reopen, with
// render-process-gone as the crash signal), and the renderer->main IPC that lived in
// session-ipc.js. Every session is WINDOWLESS; `s.win` is null and every emit no-ops on it.
// SEAM: this file imports NO electron at all — that was true when an injected factory created
// windows and is trivially true now. SECURITY: settingSources:[] always, so the
// global allow-list can never shadow a gated tool; the dopl bearer stays in the in-memory mcpServers
// object (never logged, never on argv, never on disk since C1).

const crypto = require('crypto');
const { newAgentId, isAgentId } = require('./agent-id'); // 2026-08-21: one random id per INSTANCE
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const avatarCache = require('./avatar-cache');
const sessionReopen = require('./session-reopen');
const sessionSummary = require('./session-summary'); // §3.3: THE session-pill projection
const sessionPark = require('./session-park');
const framing = require('./prompt-framing');
// `session-close-task.js` was required here (the `closeTask` effect) and is DELETED — threads
// do not close (wiring plan Phase 4, 2026-08-18). The §2 split's point stands: no HTTP dep here.
const sessionAuth = require('./session-auth'); // Q6 preflight + in-window sign-in
const { initialSessionState, sessionReducer, idleTimeout } = require('./session-reducer');
const sessionEffects = require('./session-effects'); // 2026-08-22: `terminalBody` — a terminal says why
const { floorWindowlessMessage } = require('./session-profiles'); // AXIS B's windowless floor (F-236)
const runtimeRegistry = require('./runtime'); const acquireRuntime = runtimeRegistry.acquire; // THE REGISTRY — the only place an adapter is named
const sessionQuery = require('./session-query'); const { buildLaunchSpec, startQuery, consume } = sessionQuery; // §3 split: the launch spec + the query lifecycle (H1)
const sessionNarration = require('./session-narration'); // 2026-08-20: the agent window's work lane (F-212)
const sessionModel = require('./session-model'); // the frozen model enum (argv), coerced here too
const sessionGate = require('./session-gate'); // v2.5 D1: the inbound message gate
const sessionWindowless = require('./session-windowless'); // §2 split: the windowless spawn shape
// 2026-08-21: the multiplayer ADDRESSING reads — (channel, thread) names a GROUP of this
// operator's agents, and an empty thread id names the CHANNEL-LEVEL ones. Pure reads over the
// registry this file owns; bound below like every other injected helper.
const agentHistory = require('./agent-history'); // 2026-08-22: what an ended agent leaves, for 7 days
const sessionMetrics = require('./session-metrics'); // ...and what it cost, frozen with it
const sessionPrivate = require('./session-private'); // 2026-08-22: the 1:1 turn's window
const sessionDirected = require('./session-directed'); // 2026-08-31: the DIRECTED turn's capture
const sessionRegistry = require('./session-registry');
const { liveOnThread, agentIdsOnThread, agentIdsInChannel, sessionOn, noteSiblings } = sessionRegistry;
// §2 SPLIT (2026-08-22): the TERMINAL — teardown order, the history freeze, and the read of a
// dead agent's ring. Injected below like every other engine handle; it never requires back.
const sessionTeardown = require('./session-teardown');
const { settle, narrationFor } = sessionTeardown;
// §2 SPLIT (2026-08-22): how a held `canUseTool` promise is resolved, and — the reason it moved —
// WHAT THE AGENT IS TOLD when the answer is no. A windowless auto-deny is not a decision.
const sessionPermissions = require('./session-permissions');
const { denyPendingPermissions, resolvePerm } = sessionPermissions;
// ...and the SPAWN FUNNEL: what happens before a session exists (mint an id, ask the three
// refusal questions, hand to startSession). Split off this file at the §2 cap on 2026-08-21.
const sessionLaunch = require('./session-launch');
const { launch, launchResponderSession, launchRequesterSession, hasLiveSession, counterpartyFor } = sessionLaunch;

// settings.js owns the window-mode switch + caps; required defensively so the engine still
// loads if it is momentarily absent (unit/E2E harnessing), defaulting to ON.
let settings = null;
try { settings = require('./settings'); } catch (_) { /* absent -> defaults (window-mode ON) */ }

const sessions = new Map(); // sessionKey -> live session object (in-memory only)
let lifecycle = { onLaunched: null, onEnded: null };
let selfUserId = null; // operator's own user id (item 1: the self avatar); set by channel-listener
function setSelfIdentity(id) { selfUserId = id || null; }

function readCaps() {
  return settings ? { turnCap: settings.getTurnCap(), idleMs: settings.getIdleTtlMs(), costCapUsd: settings.getCostCapUsd() } : {};
}

// Rebuild the tray after a session is hidden / reopened / settled. Lazy-required so the engine holds no top-level tray dependency (tray requires nothing back).
function refreshTray() { try { require('./tray').refresh(); } catch (_) { /* tray optional */ } }

// Resume machinery (session-park.js) is fed the engine handles it can't require: the registry, the runtime acquire (it THROWS where the old SDK loader threw — `main/runtime/index.js › acquire` carries that argument, and why it is neither the binary probe nor the credential one), buildLaunchSpec (the v1.9 security path, NEVER duplicated), plus consume/dispatch/startSession. Hoisted, so bind order does not matter.
// ⚠ FOUR HANDLES LEFT WITH THE SHELL-RECREATE FAMILY (2026-08-20, F-228): `windowFactoryReady`,
// `atWindowCap`, `loadHistory` and `settleSession` all existed for a lane that opened a window,
// and `resolveChannelContext` fed the record-less shell alone.
sessionPark.bind({
  sessions, acquireRuntime, buildLaunchSpec, consume, dispatch, startSession, hasLiveSession,
  emit,
});
// §3 split: session-query owns the query LIFECYCLE (the assembly is the runtime's since 2026-08-31) and needs the engine's dispatch + replay-aware quiet emit; neither module requires back into the engine.
sessionQuery.bind({ dispatch, emitQuiet, scheduleIdle }); // C-4: startQuery arms the launch watchdog through the ONE timer
// Q6: same injection for the preflight + in-window sign-in. `startQuery` is the SHARED deferred
// launch (session-query), so an auth hold never assembles a second query and inherits H1's
// supersede-before-relaunch; `denyPending` fail-closes before it parks.
sessionAuth.bind({ sessions, acquireRuntime, startQuery, dispatch, emit, denyPending: denyPendingPermissions });
// v2.5 D1/D3: same for the inbound gate + history loader (neither imports back into the engine).
sessionGate.bind({ sessions, dispatch });
// Reopen helpers (session-reopen.js): live registry + tray refresh + the P2 shell fallback (item 2).
sessionReopen.bind({ sessions, refreshTray, dispatch, openAgentWindow: (t) => require('./agent-window').openAgentWindow(t) }); // C-8: quit ends live sessions through the reducer; 2026-08-20: a live session's VIEW is the agent window
// §3.3: the pill projection reads the SAME registry (it derives, it never mutates); index.js arms its push.
sessionSummary.bind({ sessions, endedRecords: agentHistory.listEnded }); sessionNarration.bind({ sessions }); sessionRegistry.bind({ sessions });
sessionLaunch.bind({ sessions, acquireRuntime, startSession, liveOnThread, sessionOn }); // the funnel cannot require the engine back // ...and the narration ring + the addressing reads take the same registry
// §2 SPLIT: the terminal takes the registry, the durable projection, the fail-closed sweep, the
// tray refresh and the address read. `baseRecord` is assigned below, so this bind is hoisted past
// it deliberately — `bind` stores the reference and `settle` reads it at CALL time.
sessionTeardown.bind({ sessions, baseRecord: (s) => io.baseRecord(s), denyPendingPermissions, refreshTray, sessionOn });

const baseRecord = io.baseRecord; // durable-record projection (session-io.js)

// FIX F1 (v2.7): dispatch REPORTS whether an effect resolved a LIVE canUseTool promise (only
// resolvePerm knows; a park's denyPending may have fail-closed the requestId already). ⚠ session-ipc is deleted; it
// turns that into the {ok} the renderer's optimistic stamp is gated on; other callers ignore it.
function dispatch(s, event) {
  // ⚠ A TURN ENDED: spend one of the PRIVATE WINDOW (2026-08-22). HERE, at the one dispatch
  // funnel, rather than as a reducer effect: the window is a fact about the SESSION OBJECT, not
  // reducer state, so it survives a park/resume like the nonce and no SDK event can forge it.
  if (event && event.type === 'result') sessionPrivate.closePrivateTurn(s);
  if (event && (event.type === 'steer' || event.type === 'inbound_arrived')) s.awaitingDirective = false;
  const { state, effects } = sessionReducer(s.state, event);
  s.state = state; sessionSummary.noteActivity(s, event); sessionNarration.note(s, event); sessionDirected.observe(s, event); // §3.3: the pill's state + detail, the agent window's work lane, and the DIRECTED turn's reply capture (2026-08-31) — all off the ONE funnel
  let resolvedLive = false;
  for (const eff of effects) resolvedLive = runEffect(s, eff) === true || resolvedLive;
  return resolvedLive;
}

function runEffect(s, eff) {
  switch (eff.type) {
    case 'emit': emit(s, eff.payload); break;
    // FIX #9: a park saves the FULL record (cap counters); other flips set the phase only. The EFFECT's
    // phase is authoritative — s.state.phase reads 'awaiting_inbound' when a park lands with a message
    // still held (FIX #6), which would look LIVE on the next boot.
    case 'persist':
      if (eff.phase === 'parked') store.saveRecord({ ...baseRecord(s), phase: eff.phase });
      else store.setRecordPhase(s.key, eff.phase);
      break;
    case 'scheduleIdle': scheduleIdle(s); break;
    // FIX F1: the ONLY effect with a return value — did a live resolver really take it?
    case 'resolvePermission':
      return resolvePerm(s, eff.requestId, eff.decision);
    // io.withSeed gives the FIRST turn of a fresh (nothing-to-resume) shell its full framing plus the D3 history seed, once; a normal turn passes through.
    // ⚠ BOTH PUSHES REFRESH THE SIBLING ROSTER FIRST (2026-08-21). `io.withSeed` may build this
    // session's FIRST TURN right here — a SPAWN-IDLE agent has none until its first message
    // arrives — and that turn's multiplayer paragraph names the operator's other agents in this
    // channel. Reading the registry at push time is what makes the list true rather than a
    // snapshot of who was running when New Agent was clicked.
    // ⚠ `eff.addressing` is the @agent-id verdict for THIS message and THIS agent, parsed
    // desktop-side by `session-dispatch.js` (agent ids are not channel members, so the server's
    // mention resolver correctly fails closed on them and must keep doing so).
    case 'pushTurn':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, eff.text), eff.priority === 'now' ? 'now' : undefined));
      break;
    case 'pushInbound':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, io.frameContinuation(s.nonce, eff.message, eff.authorName, eff.addressing))));
      break;
    case 'interruptQuery': // ⚠ ON A RUNTIME THAT DECLARES NO INTERRUPT THIS SILENTLY DOES NOTHING, and the honest two-line log for it DID NOT FIT — this file is AT the 500-line cap with no headroom, which is F-388 demonstrated rather than asserted. `main/runtime/capability.js › interruptRefusal` holds the sentence; the SPA hides the control and the launch surface warns with it (design §3.2). Add the log when this file splits.
      try { if (s.query && s.query.interrupt) s.query.interrupt().catch(() => {}); } catch (_) { /* best effort */ }
      break;
    // ⚠ BOTH OF THESE ALSO CLOSE THE PRIVATE WINDOW (2026-08-22). The depth is spent by a turn's
    // `result`, and a TORN-DOWN QUERY OWES NO RESULTS: its consume loop is superseded by the
    // `s.query !== q` guard, so the +1 (or +2) it was carrying is never paid off and the NEXT
    // private turn opens on top of a depth that should have been zero. That is the leak behind
    // the posture degradation — a session that had been paused once held its outbound widening
    // withdrawn for turns nobody asked to be private.
    case 'abortQuery':
      sessionPrivate.resetPrivateTurn(s);
      sessionDirected.resetDirected(s); // 2026-08-31: a stray `result` must not report a partial answer
      try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
      try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
      break;
    case 'denyPending': // P1: DENY every awaited canUseTool promise (fail closed) before a
      sessionPrivate.resetPrivateTurn(s);
      sessionDirected.resetDirected(s); // same rule as abortQuery above
      denyPendingPermissions(s, 'Session paused'); // park's abort — no resolver may dangle
      break;
    case 'clearIdle': if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; } break;
    case 'resumeQuery': sessionPark.resumeParked(s); break; // P1 lazy resume: the SAME object
    case 'lifecycle': runLifecycle(s, eff.kind, eff.extra, eff.body); break;
    case 'settle': settle(s, eff.outcome, eff.keepWindow === true); break; // a `closeTask` case sat above this one until Phase 4 (2026-08-18)
    default: diag('session-engine: unknown effect', eff && eff.type);
  }
}

// ⚠ `denyPendingPermissions` MOVED TO `main/session-permissions.js` (2026-08-22, the §2 cap). It
// is unchanged: fail-close every awaited promise, then drop both maps.
// A hidden window RESHOWS on anything that needs the operator: a gated tool request, a
// `counterparty` reply, a HELD inbound, or an outbound post awaiting Send (v2.7 L3).
const RESHOW_TYPES = new Set(['permission_request', 'counterparty', 'inbound_pending', 'outbound_gate']);
function emit(s, payload) {
  // 2026-08-20: a WINDOWLESS session's pending gate bridges to a consent row (outbound post) or denies — session-windowless.js owns the policy.
  if (sessionWindowless.claimGate(s, payload, (rid, d) => dispatch(s, { type: 'permission_decision', requestId: rid, decision: d }))) {
    // ⚠ WHICH DENIAL COPY a claimed gate deserves is `session-windowless.js`'s to stamp since
    // 2026-08-31, not the engine's: a `permission_request` now HOLDS behind a notification, and
    // only that file knows whether the banner was shown, expired unanswered (`noteGateTimeout`),
    // or had no surface at all (`noteAutoDenied`) — the engine can no longer tell, so it stamps
    // nothing. Stamping here again would mislabel a real human decision as never-asked.
    return;
  }
  if (!s.win || s.win.isDestroyed()) return;
  if (s.windowHidden && payload && RESHOW_TYPES.has(payload.type)) {
    try { s.win.show(); } catch (_) { /* best effort */ }
    s.windowHidden = false;
    refreshTray();
  }
  emitQuiet(s, payload);
}

// The same delivery WITHOUT the reshow check (C6): an auto-allowed post resolves its own card with
// no operator involvement, so it must never pop a hidden window open.
function emitQuiet(s, payload) {
  if (!s.win || s.win.isDestroyed()) return;
  s.replay.deliver(payload);
}
function scheduleIdle(s) {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  const t = idleTimeout(s.state); // M2: {ms,type} — a PARKED session waits on the abandonment bound
  s.idleTimer = setTimeout(() => { if (!s.settled) dispatch(s, { type: t.type }); }, t.ms);
}

// ⚠ `resolvePerm` MOVED WITH IT, AND ITS DENIAL COPY IS WHY (2026-08-22, Samuel's ruling). It
// answered every deny with `'Denied by operator'`, including the WINDOWLESS auto-deny where nobody
// was asked; that sentence cost ~8 messages of wasted agent diagnosis and two operator escalations
// in live testing. `session-permissions.js` carries the argument and the two messages.
function runLifecycle(s, kind, extra, body) {
  const info = { channelId: s.channelId, taskId: s.taskId, workspaceId: s.workspaceId, side: s.side, sessionId: s.sessionId, key: s.key, sdkSessionId: s.sdkSessionId }; // FIX #2: key+sdkSessionId (cycle) -> echoTargets dedup
  try {
    if (kind === 'task_started') {
      if (lifecycle.onLaunched) lifecycle.onLaunched(info);
    } else if (lifecycle.onEnded) {
      // P3: `body` is the calm one-liner a capped/ended lifecycle carries (undefined -> the handler derives one).
      lifecycle.onEnded(info, kind, extra || {}, body);
    }
  } catch (err) { diag('session-engine: lifecycle handler error', err && err.message); }
}

// ⚠ `settle(s, outcome, keepWindow)` STOOD HERE AND MOVED TO `main/session-teardown.js`
// (2026-08-22, the §2 cap). Nothing about it changed: it is still the ONE teardown every terminal
// reaches, still runs the C3 fail-closed sweep before the abort, and still freezes the narration
// ring into `agent-history` before the registry entry disappears. The engine executes it through
// the `settle` effect exactly as before. Its sibling, `session-close-task.js`'s status flip, was
// deleted with thread closing (Phase 4, 2026-08-18).
function setLifecycleHandlers(h) { lifecycle = { onLaunched: h && h.onLaunched, onEnded: h && h.onEnded }; }

// ⚠ `narrationFor(a)` MOVED WITH IT, for the reason its own docblock now states: it is the one
// read whose correctness depends on what `settle` wrote a moment earlier.
// Build the session object, open (or ADOPT) its window, start the query (launch + resume). The per-session nonce is
// minted HERE so the first turn's fence + every fed-inbound continuation share the SAME token (else injected content
// forges it). v2.x: the CONCRETE channel + workspace UUIDs are merged into the context here — the framing reads only the context, while every spawn shape carries the ids on its spec (fresh responder/requester, parked resume, recreated shell).
async function startSession(spec, rt) {
  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');
  // H2 — THE ONLY WAY A STORED POSTURE REACHES A SPAWN. It used to be an AMBIENT read of a
  // durable, channel-wide preference (channel-context.startingModes), and startSession is the
  // single construction site for EVERY spawn shape, so that read re-armed the posture on shapes
  // involving no human decision at all — a peer-driven wake, a crash resume, a requester
  // auto-open — and bypass/auto_both picked once on one card became a standing, clickless grant
  // for the whole channel. It is HANDED IN now, per launch, by a caller executing a decision a
  // human is making right now; anything that passes nothing inherits the reducer's manual/ask.
  //
  // ⚠ THE PRE-CONSENT CARD WAS A SECOND POSTURE SOURCE AND IT IS GONE (2026-08-20, F-228).
  // Its two selects lived in the session window; `session-ipc` stored the pick on that card's
  // own registry entry and this line consumed it, keyed by the entry. With no card there is
  // ONE source left — `spec.startModes`, handed in per launch by a caller executing a decision
  // a human is making right now — which is the shape H2 always wanted and the card was the
  // exception to. `spec.adoptsConsent` went with it.
  //
  // FIX 4 SURVIVES AND IS NOW THE WHOLE RULE — OPERATOR-ARMED IS THE ONE THING THAT REACHES A
  // PARKED SHELL. A shell is normally woken by something that is NOT the approving human, so it
  // refuses a handed-in posture unless an explicit `operatorArmed` says a human chose it just
  // now; a bare recreate, reopen, resume or wake sets neither.
  const armedModes = spec.startModes;
  const operatorArmed = spec.operatorArmed === true;
  const startModes = armedModes && (!spec.parkedShell || operatorArmed)
    ? { toolMode: armedModes.tools, messageMode: armedModes.messages }
    : {};
  const state = initialSessionState({ mode: spec.mode, side: spec.side, ...readCaps(), ...startModes });
  // ⚠ THE WINDOWLESS MESSAGE FLOOR, AT THE ONE CONSTRUCTION SITE (2026-08-22, F-236's last hole).
  // Both LAUNCH lanes already derive their message axis through `channel-prefs.js ›
  // windowlessMessageMode`, so for them this is a no-op. What it fixes is every shape that hands
  // in NOTHING and inherits the reducer's `ask`: a crash resume above all (`session-park.js ›
  // startResume`), which came back BELOW the floor on a session with no accept surface — so
  // `session-gate.js › enqueue` held the peer's next reply forever with no drain left to release
  // it. Same SHARED rule both lanes call; never a second spelling.
  if (spec.windowless === true) state.messageMode = floorWindowlessMessage(state.messageMode);
  // P2: a reopen fallback opens a PARKED SHELL — a live window, NO SDK query yet. It boots
  // parked so a lazy wake (P1) resumes it; baseRecord persists s.state.phase = 'parked'.
  // FIX #9 / AUDIT D3: the running cap budget rehydrates on EVERY resume shape. It used to sit
  // inside the parkedShell branch below, so a crash then opt-in resume (session-park.startResume)
  // would have reset a spent turn/cost budget to zero even once the counters were passed.
  state.turns = Number(spec.turns) || 0;
  state.costUsd = Number(spec.costUsd) || 0;
  // ⚠ `parkedShell` HAS A PRODUCER AGAIN, AND IT IS THE SPAWN-IDLE LANE (2026-08-21, ruling 3).
  // "New Agent" registers an agent with prepared context and sends NO first SDK turn. The PARKED
  // shape already had every piece: `parked: true` makes `wakeEffects` fire `resumeQuery` on the
  // first fed turn, `freshRun`/`freshFraming` below make that turn carry the FULL framing, and
  // the `parkedShell` guard in `startModes` above is unchanged (a woken shell still refuses a
  // posture no human armed; this lane sets `operatorArmed` because the click IS the human).
  if (spec.parkedShell) { state.phase = 'parked'; state.parked = true; state.activity = 'parked'; }
  const context = { ...(spec.context || {}), channelId: spec.channelId, workspaceId: spec.workspaceId };
  // ⚠ `firstTurn` IS STILL '' FOR A PARKED SHELL, AND THE GOAL IS NO LONGER LOST WITH IT
  // (2026-08-22). `session-query.js › startQuery` is the ONE pusher of this field and a
  // spawn-idle session never runs it, so anything put here would be dropped; `launchGoal` below
  // carries `spec.firstMessage` to the WAKE turn instead, where `session-seed.js › takeFraming`
  // fences it as that turn's request body. Its docblock carries the whole argument.
  // ⚠ `profile` SPREAD AT THE CALL, NEVER ONTO `s.context` — `session-seed.js › takeFraming` owns that argument, and the 2026-08-31 half about why THIS site lacked it.
  const firstTurn = spec.parkedShell ? ''
    : spec.rawFirstTurn ? spec.rawFirstTurn
      : framing.buildFencedTurn({ side: spec.side, message: spec.firstMessage, context: { ...context, profile: spec.profile }, nonce });
  const s = {
    key: spec.key,
    sessionId,
    sdkSessionId: spec.resumeSdkId || null,
    runtimeId: (rt && rt.id) || runtimeRegistry.DEFAULT_ID, // WHICH RUNTIME DRIVES THIS SESSION (2026-08-31) — ⚠ STAMPED AT SPAWN, NEVER READ LIVE: the conversation handle, the tool vocabulary and the Axis-A modes all belong to ONE runtime, so a park or crash-resume must not land on another. Absent => the default
    channelId: spec.channelId,
    taskId: spec.taskId || '',
    workspaceId: spec.workspaceId,
    side: state.side,
    profile: spec.profile, launchDepth: spec.launchDepth, launchChain: spec.launchChain === true, // ...and the LAUNCH-DEPTH stamp (2026-08-25, F-320): a containment input like the profile beside it, normalized fail-closed at the gate — ABSENT IS THE CAP, so only a lane that says "a human started this" (0) can launch agents (session-own-launch.js). `launchChain` is the CHANNEL's chaining setting (2026-08-31, Samuel's ruling), stamped the same way and `=== true` here so absent reads FALSE and the one-generation bound stands
    // Item 9: human tool-profile label for the renderer's posture line (passed on init).
    profileLabel: require('./tool-profiles').profileLabel(spec.profile),
    mode: state.mode,
    counterpartyId: spec.counterpartyId || null, // FIX L1: the task's other party
    // D2 — THE BINDING. 'pair' is every shape that exists today and is the default by
    // construction: only a launch that explicitly asks for 'room' widens the inbound feed
    // and the window history past one counterparty. `agentId` is the channel_agents row a
    // TEAM session runs as; it is half of the slot key and rides into the framing.
    bind: spec.bind === 'room' ? 'room' : 'pair',
    // THE AGENT INSTANCE ID (2026-08-21). Never null on a real session — `launch()` mints one.
    // Third segment of `s.key`, the name the pill wears, the handle an operator @-mentions, and
    // the token stamped into every post this session makes.
    agentId: spec.agentId || null,
    // H2: is this session's channel a DIRECT (1:1) one? The server addresses an
    // unaddressed post there (`resolveDirectPeer`), so the outbound card names the
    // recipient instead of saying none was named. `=== true` only — a launch shape that
    // does not carry the flag degrades to the channel-level wording, never to a guess.
    direct: spec.direct === true,
    // O-6: the counterparty display name labels the agent's op=post ("Sent to X").
    counterpartyName: (spec.context && (spec.context.authorName || spec.context.targetName)) || null,
    // THE MODEL (2026-08-02). Same precedence as the posture above and read behind the SAME
    // `adoptsConsent` gate (FIX 1b), for the same reason: the pre-consent card the human was
    // looking at WINS (single use, entry-scoped), and a durable record's stored pick is the
    // fallback every other shape carries. Coerced against the frozen enum HERE, so a hand-edited
    // store can only land on 'default'. NOT reducer state: buildSdkOptions is its one reader.
    model: sessionModel.normalizeModel(spec.model),
    state,
    context, // display identity + the channel/workspace ids the framing addresses
    nonce,
    firstTurn,
    resumeSdkId: spec.resumeSdkId || null,
    startedAt: Date.now(),
    lastTotalCost: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pendingInbound: [], // bounded FIFO of held interactive inbound replies
    // FIX F2/F3: a parked shell with NOTHING to resume starts a BRAND-NEW sdk session and buildSdkOptions sets no
    // system prompt, so its first turn must carry the full v1.9 framing (role, SECURITY RULES, delivery instruction)
    // or the agent answers nowhere and the peer gets nothing. `freshFraming` is the ONE-SHOT marker io.withSeed consumes, `freshRun` its stable twin.
    freshRun: spec.parkedShell === true && !spec.resumeSdkId,
    freshFraming: spec.parkedShell === true && !spec.resumeSdkId,
    // ⚠ THE LAUNCH GOAL, HELD FOR THE WAKE TURN (2026-08-22). `takeFraming` fences it as that
    // turn's request body when there is no channel transcript to seed. Stamped only where it can
    // be read — a non-parked spawn already pushed `firstTurn` and must not carry a second copy.
    launchGoal: spec.parkedShell === true ? String(spec.firstMessage == null ? '' : spec.firstMessage) : '',
    // ⚠ THE SPAWN-IDLE WAKE FLAG (2026-08-22, Samuel's ruling). TRUE while this agent is
    // registered, addressable and UNDIRECTED: the fan-out feeds it nothing but a message naming
    // its own agent id, and a 1:1 `sessions:message` wakes it too. `dispatch` above clears it on
    // either lane. ⚠ NOT `freshFraming` overloaded — that is a ONE-SHOT marker about whether a
    // TURN carries the framing, consumed by the first turn built; this is read on EVERY message
    // and answers whether anything may reach the agent at all.
    awaitingDirective: spec.parkedShell === true,
    idleTimer: null,
    settled: false, windowHidden: false,
    lastInboundSeq: Number.isFinite(Number(spec.triggerSeq)) ? Number(spec.triggerSeq) : null,
    // ⚠ THE SELF-FILTER FOR FAN-OUT (2026-08-21). Every `dopl_channel op=post` this session makes
    // is stamped with a client_msg_id naming this instance (`session-outbound-tag.js`) and
    // recorded here, which is how `session-dispatch.feedLiveSession` fans a message out to every
    // live agent on a thread EXCEPT its author. Bounded there (MAX_OWN_POST_IDS): it is one of
    // the per-session structures that multiply against MAX_CONCURRENT_SESSIONS.
    ownPostIds: new Set(),
    // ⚠ REHYDRATED, NOT ZEROED (2026-08-22). It WAS `0` on every session object while `agentId`
    // is persisted and re-used by a resume, so a crash+resume re-minted `agent-<id>-1, 2, …` —
    // client_msg_ids the server already holds, whose idempotency short-circuit then discards the
    // resumed agent's replies. `resumedPostSeq` adds slack for the posts a crash hid.
    ownPostSeq: store.resumedPostSeq(spec.ownPostSeq),
    win: null, query: null, abortController: null, pushIterator: null,
  };
  // 🔒 **WHOSE SESSION THIS IS — the cross-account stamp (adversarial review, 2026-08-31).**
  // Written ONCE, at registration, and never rewritten: the registry is process-lifetime and a
  // sign-out does NOT clear it, so operator A's live agent survives B signing in on the same
  // Mac. The PRIVATE DIRECT LANE resolves a target by `(channel, thread, agent)` against this
  // registry, so without a stamp B's direction could reach A's session and ship A's private
  // turn text back to B. Same guard, same reason, as `session-state-push.js › trackOrigin`.
  s.operatorUserId = selfUserId || null;
  noteSiblings(s); // the framing's multiplayer paragraph, current as of registration
  sessions.set(s.key, s); sessionSummary.touch(); // §3.3: REGISTRATION IS A PROJECTION MOVE — the pill must not wait for the SDK's first dispatch (§11)
  store.saveRecord(baseRecord(s)); // phase 'launching' until system/init flips it
  // The spawn SURFACE. ⚠ THERE IS ONLY ONE LEFT AND IT IS NONE (2026-08-20, F-228): the window
  // branch went with the renderer it painted into. Kept as a call rather than inlined because
  // the ROLLBACK below is the contract — a surface that cannot be attached un-registers the
  // session, and that is a property worth keeping a seam for.
  if (!sessionWindowless.attachSurface(s, spec)) {
    sessions.delete(s.key); sessionSummary.touch(); // ...and a ROLLBACK is one too: the registration above already scheduled a flush
    return null;
  }
  emit(s, { type: 'modes', tool: state.toolMode, message: state.messageMode }); // v3.1: the header must state the PRESET posture, not the defaults
  emit(s, { type: 'model', choice: s.model }); // ...and WHICH MODEL, so the third select never claims a pick nothing applied
  // Item 1/5/6 + C5: avatars reach the renderer ONLY as `avatars` events (the replay ring splits a warm one off `init`).
  s.selfAvatar = avatarCache.cachedForUser(selfUserId);
  s.peerAvatar = avatarCache.cachedForUser(s.counterpartyId);
  avatarCache.resolveForSession(s, { selfUserId, peerUserId: s.counterpartyId }, (p) => emit(s, p));
  // FIX (v2.x): pin the INITIATING ask at the TOP (display only; io returns null for a
  // parked/resumed shell). Emitted, NEVER pushed to the iterator; rides the replay ring.
  const reqItem = io.initialRequestPayload(s.side, spec.firstMessage, s.counterpartyName);
  if (reqItem) emit(s, reqItem);
  // A WINDOWLESS spawn cannot hold on sign-in (the recovery UI wrote to a window):
  // roll back so launch() reports auth-hold and the caller answers honestly.
  // ⚠ IT RUNS BEFORE THE SPAWN-IDLE RETURN BELOW, AND THAT ORDER IS THE FIX (2026-08-22). The
  // `parkedShell` branch returned FIRST, so New Agent on a signed-out machine answered
  // `{sessionId, agentId}` — a SUCCESS — and `launch`'s `{skipped:'auth-hold'}` was unreachable
  // on the one lane an operator reaches by clicking. Spawn-idle starts no query, but it is still
  // a spawn, and the credential question is about the MACHINE, not about the first turn.
  if (spec.windowless && sessionAuth.holdIfNoCredential(s)) { sessions.delete(s.key); sessionSummary.touch(); return { authHold: true }; }
  // Q6 PREFLIGHT: a machine with no Claude Code sign-in can only produce a dead session, so HOLD the
  // launch on the sign-in action instead. Nothing is settled, echoed, or thrown away; the request runs
  // the moment sign-in succeeds.
  if (sessionAuth.holdIfNoCredential(s)) return s;
  // ⚠ SPAWN IDLE — THE ONE SHAPE THAT REGISTERS AND STARTS NOTHING (2026-08-21, ruling 3). Not
  // "build the query and hold the prompt": a held query is a live `claude` child holding this
  // session's pre-approved `dopl_channel` access with nobody watching it, the orphan shape
  // C3/C-8 exist to prevent. There is no child at all. The session IS registered, so it has a
  // pill, a slot against MAX_CONCURRENT_SESSIONS, an id to be @-mentioned at, pause/end and a
  // durable record; `wakeEffects` starts the query on the first fed turn.
  // ⚠ THE TIMER IS ARMED DELIBERATELY: `idleTimeout` reads `parked === true` and answers the
  // ABANDONMENT bound, so an agent nobody messages ends on its own. Nothing else would arm one
  // here — every other arming site is a reducer effect, and no reducer event has run yet.
  if (spec.parkedShell) {
    scheduleIdle(s);
    diag('session spawned IDLE (no query until the first message)', 'agent', String(s.agentId || ''), 'thread', String(s.taskId || '').slice(0, 8));
    return s;
  }
  await startQuery(s, rt);
  return s;
}

// The inbound gate lives in session-gate.js (v2.5 D1): `feedInbound` enqueues a counterparty
// turn on a live or parked session. Its HOLD half went with the surface that answered a hold
// (F-228) — a windowless session's message axis is floored at auto_inbound, so nothing holds.
// ⚠ THE CONSENT REFLOW (item 8) IS DELETED — 2026-08-20, F-228. `openConsentWindow` minted a
// PRE-CONSENT WINDOW on every inbound request: a window per thread, before anyone had looked at
// it, running no agent work until Accept and then ADOPTED by launchResponderSession. The
// decision surfaces are inline on the channels page now (INVARIANTS §6), so there is no card to
// open, adopt, close or release, and `session-consent.js` went with the renderer it painted into.
// Resume machinery (offerResume/startResume/resume) lives in session-park. init(): register the
// renderer->main IPC once, then settle any session live/awaiting when the app died — post the
// interrupted echo and, when the SDK session id survives, offer an opt-in resume (never auto).
async function init() {
  // ⚠ NO IPC TO REGISTER (2026-08-20, F-228). `session-ipc.js` bound 15 handlers resolved from
  // `event.sender` against a session's own window; no session has a webContents any more, so the
  // whole `session:*` sender-binding regime is deleted. INVARIANTS §11 now describes ONE regime.
  const records = store.loadRecords();
  for (const key of Object.keys(records)) {
    const rec = records[key];
    // P1: a 'dormant' (parked) record is EXEMPT from the interrupted echo — it was paused on
    // purpose and stays resumable via P2. Only a live/awaiting record that died echoes.
    if (!rec || store.reloadDisposition(rec.phase) !== 'resume') continue;
    store.setRecordPhase(key, 'ended');
    runLifecycle({ channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId, side: rec.side, sessionId: rec.sessionId, key, sdkSessionId: store.getSdkSessionId(key) }, 'task_failed', { interrupted: true }, sessionEffects.terminalBody({ interrupted: true })); // FIX #2: same key+sdk id dedupes with a same-cycle crash echo
    const sdkId = store.getSdkSessionId(key);
    if (sdkId) sessionPark.offerResume(rec, sdkId);
  }
  // AUDIT D5: bound the durable record set (retention policy + protections in session-store). AFTER
  // the scan above, so an interrupted record still echoes and offers its resume before it can age out.
  try { store.pruneRecords({ keep: new Set(sessions.keys()) }); } catch (err) { diag('session-engine: prune failed', err && err.message); }
}

module.exports = {
  init,
  setLifecycleHandlers,
  setSelfIdentity, // item 1: the operator's user id for the self avatar (channel-listener)
  launchResponderSession,
  launchRequesterSession,
  hasLiveSession,
  counterpartyFor,
  // 2026-08-21 multiplayer: (channel, thread) names a GROUP of sessions, not one.
  liveOnThread,
  agentIdsOnThread,
  agentIdsInChannel,
  sessionOn,
  // The three session-team.js exports (`summonTeamSession`, `wakeTeamSession`,
  // `acceptsInboundFrom`) went with summoning — docs/ENGINEERING.md §18 F-141 carries that
  // story, including why the inert room-vs-pair slot shape stayed. The LAST of them left its
  // line behind here, and `module.exports` is EVALUATED, so requiring this module threw
  // `ReferenceError: sessionTeam is not defined` — no engine, no windows, no sessions.
  // test/main-exports-defined.test.mjs now pins every main export against what its file binds.
  feedInbound: sessionGate.feedInbound, // v2.5 D1 — the inbound gate (live or parked)
  listLiveSessions: sessionReopen.listLiveSessions, listOrphanRisk: sessionReopen.listOrphanRisk, endLiveSessions: sessionReopen.endLiveSessions, // item 10 tray + C-8 quit guard
  reopenByTask: sessionReopen.reopenByTask, controlByTask: sessionReopen.controlByTask, setModeByTask: sessionReopen.setModeByTask, messageByTask: sessionReopen.messageByTask,
  setModelByTask: sessionReopen.setModelByTask, // 2026-08-22: the LIVE model switch (Query.setModel)
  // ⚠ IT TAKES AN ADDRESS, NOT A KEY (2026-08-21). It used to be `(k) => ringFor(sessions.get(k))`
  // and its ONE caller built `${channelId}:${taskId}` by hand — a second, now-wrong statement of
  // the key format sitting in the IPC layer. It takes `{channelId, taskId, agentId?}` and goes
  // through `sessionOn`, so the ambiguity rule is stated once and the key format stays private.
  narrationFor, // item 2 + Phase 5 pause/end + F-212's 1:1 lane and work lane — the MAIN-window bridge (channel-dir-ipc)
};
