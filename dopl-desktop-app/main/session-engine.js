// Session engine — the imperative shell.
//
// Owns ONE agent-runtime query per live session and executes the pure session-reducer's
// side-effect-free effect descriptors. ⚠ WHICH runtime is `main/runtime/index.js`'s answer.
//
// Three things this header used to describe are deleted (2026-08-20, F-228): the CONSENT REFLOW,
// REOPEN (live windows hide-on-close + tray reopen), and the renderer->main IPC in session-ipc.js.
// Every session is WINDOWLESS; `s.win` is null and every emit no-ops on it.
// SEAM: this file imports NO electron at all. SECURITY: settingSources:[] always, so the global
// allow-list can never shadow a gated tool; the dopl bearer stays in the in-memory mcpServers
// object (never logged, never on argv, never on disk since C1).

const crypto = require('crypto');
const { newAgentId, isAgentId } = require('./agent-id'); // 2026-08-21: one random id per INSTANCE
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const avatarCache = require('./avatar-cache');
const sessionReopen = require('./session-reopen');
const sessionAnswerPermission = require('./session-answer-permission'); // the held-gate answer — a `session-reopen` sibling that file had no room for (2026-09-17)
const sessionSummary = require('./session-summary'); // §3.3: THE session-pill projection
const sessionPark = require('./session-park'); const sessionBoot = require('./session-boot'); // F-694: what a DORMANT record becomes at app start — Idle or Ended, never NOTHING (that file carries the incident and the whole argument)
const framing = require('./prompt-framing');
// `session-close-task.js` was required here (the `closeTask` effect) and is DELETED — threads
// do not close (wiring plan Phase 4, 2026-08-18). The §2 split's point stands: no HTTP dep here.
const sessionAuth = require('./session-auth'); const mcpGuard = require('./mcp-connect-guard'); // Q6 preflight + in-window sign-in; F-692's MCP-connect ACT half (kill / retry once / end visibly)
const { initialSessionState, sessionReducer, idleTimeout } = require('./session-reducer');
const sessionEffects = require('./session-effects'); // 2026-08-22: `terminalBody` — a terminal says why
const { floorWindowlessMessage } = require('./session-profiles'); // AXIS B's windowless floor (F-236)
const runtimeRegistry = require('./runtime'); const acquireRuntime = runtimeRegistry.acquire; // THE REGISTRY — the only place an adapter is named
const sessionQuery = require('./session-query'); const { buildLaunchSpec, startQuery, consume } = sessionQuery; // §3 split: the launch spec + the query lifecycle (H1)
const sessionNarration = require('./session-narration'); // 2026-08-20: the agent window's work lane (F-212)
// ⚠ `require('./session-model')` LEFT HERE ON 2026-09-21 (U5). This file coerced EVERY session's
// model through the DEFAULT runtime's alias table, so a Codex id normalized to that runtime's "no
// pick" member and reached the Codex launch spec as the literal string `default`. The coercion is
// the SELECTED ADAPTER's now — `runtimeRegistry.capability.launchModelPick` over its own declared
// descriptor — and core names no vendor and no id.
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
const { liveOnThread, agentIdsOnThread, sessionOn, noteSiblings } = sessionRegistry;
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

// ⚠ THE HOST SEAMS — the settings read (`readCaps`), the tray rebuild and the LIFECYCLE ECHO
// (`runLifecycle` / `setLifecycleHandlers`, and the handler pair they hold) — live in
// `session-engine-host.js` (§2 SPLIT, 2026-09-14). Unchanged, and still exported from here.
const { readCaps, refreshTray, runLifecycle, setLifecycleHandlers } = require('./session-engine-host');

const sessions = new Map(); // sessionKey -> live session object (in-memory only)
let selfUserId = null; // operator's own user id (item 1: the self avatar); set by channel-listener
function setSelfIdentity(id) { selfUserId = id || null; }

// Resume machinery (session-park.js) is fed the engine handles it cannot require: the registry, the
// runtime acquire (it THROWS where the old SDK loader threw), buildLaunchSpec (the v1.9 security
// path, NEVER duplicated), plus consume/dispatch/startSession. Hoisted, so bind order does not
// matter. Four handles left with the shell-recreate family (2026-08-20, F-228):
// `windowFactoryReady`, `atWindowCap`, `loadHistory` and `settleSession`.
sessionPark.bind({
  sessions, acquireRuntime, buildLaunchSpec, consume, dispatch, startSession, hasLiveSession,
  emit, preflightMcp: sessionQuery.preflightMcp, // F-696: the RESUME lane warms `/api/mcp` too — a boot re-park resumes against a route nothing in this process has touched — and the same call carries the settled re-check
}); sessionBoot.bind({ sessions, runLifecycle, scheduleIdle }); // F-694: the boot pass takes the registry it re-registers into, the lifecycle runner a VISIBLE end needs, and the timer that arms a re-parked session's abandonment bound. It starts no query and acquires no runtime, so it takes neither
// §3 split: session-query owns the query LIFECYCLE (the assembly is the runtime's since 2026-08-31) and needs the engine's dispatch + replay-aware quiet emit; neither module requires back into the engine.
sessionQuery.bind({ dispatch, emitQuiet, scheduleIdle }); // C-4: startQuery arms the launch watchdog through the ONE timer
// Q6: same injection for the preflight + in-window sign-in, and F-692's MCP guard below it on the
// same terms. `startQuery` is the SHARED deferred launch (session-query), so neither assembles a
// second query and both inherit H1's supersede-before-relaunch; `denyPending` fail-closes first.
sessionAuth.bind({ sessions, acquireRuntime, startQuery, dispatch, emit, denyPending: denyPendingPermissions });
mcpGuard.bind({ acquireRuntime, startQuery, dispatch, emit, denyPending: denyPendingPermissions, resumeParked: sessionPark.resumeParked, abortInFlight: sessionQuery.abortInFlight }); // F-692: an init message saying the `dopl` MCP server did not connect re-runs the launch ONCE, then ends the session visibly. No registry — it acts on the one session whose stream reported it
// v2.5 D1/D3: same for the inbound gate + history loader (neither imports back into the engine).
sessionGate.bind({ sessions, dispatch });
// Reopen helpers (session-reopen.js): live registry + tray refresh + the P2 shell fallback (item 2).
sessionReopen.bind({ sessions, refreshTray, dispatch, openAgentWindow: (t) => require('./agent-window').openAgentWindow(t) }); // C-8: quit ends live sessions through the reducer; 2026-08-20: a live session's VIEW is the agent window
sessionAnswerPermission.bind({ resolveSession: sessionReopen.resolveSession, dispatch }); // 2026-09-17: the operator's answer to ONE held gate, through `session-reopen`'s OWN address resolver (never a copy) and this funnel, so it lands as a `permission_decision` like every other one
// §3.3: the pill projection reads the SAME registry (it derives, it never mutates); index.js arms its push.
sessionSummary.bind({ sessions, endedRecords: agentHistory.listEnded }); sessionNarration.bind({ sessions }); sessionRegistry.bind({ sessions });
sessionLaunch.bind({ sessions, acquireRuntime, startSession, liveOnThread, sessionOn }); // the funnel cannot require the engine back // ...and the narration ring + the addressing reads take the same registry
// §2 SPLIT: the terminal takes the registry, the durable projection, the fail-closed sweep, the
// tray refresh and the address read. `baseRecord` is assigned below, so this bind is hoisted past
// it deliberately — `bind` stores the reference and `settle` reads it at CALL time.
sessionTeardown.bind({ sessions, baseRecord: (s) => io.baseRecord(s), denyPendingPermissions, refreshTray, sessionOn });

const baseRecord = io.baseRecord; // durable-record projection (session-io.js)

// FIX F1 (v2.7): dispatch REPORTS whether an effect resolved a LIVE canUseTool promise (only
// resolvePerm knows; a park's denyPending may have fail-closed the requestId already). Callers
// other than the renderer's optimistic-stamp gate ignore it.
function dispatch(s, event) {
  // A TURN ENDED: spend one of the PRIVATE WINDOW (2026-08-22). Here, at the one dispatch funnel,
  // rather than as a reducer effect: the window is a fact about the SESSION OBJECT, not reducer
  // state, so it survives a park/resume like the nonce and no SDK event can forge it.
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
    // THE ENDED LINE IS MINTED HERE, NOT IN `emit` (2026-09-06, A9). `emit` returns early on a
    // windowless session and on a destroyed window, and the work stream must still record WHY the
    // session ended: the ring is frozen into the 7-day history by the `settle` that follows, and
    // that history is what an ended agent's window is served from.
    case 'emit':
      if (eff.payload && eff.payload.type === 'ended') sessionNarration.noteEnded(s, eff.payload);
      emit(s, eff.payload);
      break;
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
    // io.withSeed gives the FIRST turn of a fresh (nothing-to-resume) shell its full framing plus
    // the D3 history seed, once; a normal turn passes through.
    // BOTH PUSHES REFRESH THE SIBLING ROSTER FIRST (2026-08-21): `io.withSeed` may build this
    // session's FIRST TURN right here — a SPAWN-IDLE agent has none until its first message arrives
    // — and that turn's multiplayer paragraph names the operator's other agents in this channel, so
    // reading the registry at push time is what makes the list true.
    // `eff.addressing` is the @agent-id verdict for THIS message and THIS agent, parsed
    // desktop-side by `session-dispatch.js` (agent ids are not channel members, so the server's
    // mention resolver correctly fails closed on them and must keep doing so).
    case 'pushTurn':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, eff.text), eff.priority === 'now' ? 'now' : undefined));
      break;
    case 'pushInbound':
      noteSiblings(s);
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, io.frameContinuation(s.nonce, eff.message, eff.authorName, eff.addressing, eff.authorNote))));
      break;
    case 'interruptQuery': // ⚠ ON A RUNTIME THAT DECLARES NO INTERRUPT THIS SILENTLY DOES NOTHING, and the honest two-line log for it DID NOT FIT — this file is AT the 500-line cap with no headroom, which is F-388 demonstrated rather than asserted. `main/runtime/capability.js › interruptRefusal` holds the sentence; the SPA hides the control and the launch surface warns with it (design §3.2). Add the log when this file splits.
      try { if (s.query && s.query.interrupt) s.query.interrupt().catch(() => {}); } catch (_) { /* best effort */ }
      break;
    // BOTH OF THESE ALSO CLOSE THE PRIVATE WINDOW (2026-08-22). The depth is spent by a turn's
    // `result`, and a TORN-DOWN QUERY OWES NO RESULTS — its consume loop is superseded by the
    // `s.query !== q` guard — so the +1 (or +2) it was carrying would never be paid off and the
    // next private turn would open on top of a depth that should have been zero.
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

// `resolvePerm` MOVED WITH IT, AND ITS DENIAL COPY IS WHY (2026-08-22, Samuel's ruling): it
// answered every deny with `'Denied by operator'`, including the WINDOWLESS auto-deny where nobody
// was asked. `session-permissions.js` carries the argument and the two messages.
// `settle(s, outcome, keepWindow)` and `narrationFor(a)` moved to `main/session-teardown.js`
// (2026-08-22, the §2 cap), unchanged: `settle` is still the ONE teardown every terminal reaches,
// still runs the C3 fail-closed sweep before the abort, and still freezes the narration ring into
// `agent-history` before the registry entry disappears.
// Build the session object, attach its surface, start the query (launch + resume). The per-session
// nonce is minted HERE so the first turn's fence and every fed-inbound continuation share the SAME
// token (else injected content forges it). The concrete channel + workspace UUIDs are merged into
// the context here — the framing reads only the context, while every spawn shape carries the ids on
// its spec.
async function startSession(spec, rt) {
  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');
  // H2 — THE ONLY WAY A STORED POSTURE REACHES A SPAWN. It used to be an AMBIENT read of a
  // durable, channel-wide preference, and startSession is the single construction site for EVERY
  // spawn shape, so that read re-armed the posture on shapes involving no human decision at all — a
  // peer-driven wake, a crash resume, a requester auto-open — and bypass/auto_both picked once on
  // one card became a standing, clickless grant for the whole channel. It is HANDED IN now, per
  // launch, by a caller executing a decision a human is making right now; anything that passes
  // nothing inherits the reducer's manual/ask. The pre-consent card was a second posture source and
  // went with F-228 (2026-08-20), along with `spec.adoptsConsent`.
  //
  // FIX 4 SURVIVES AND IS NOW THE WHOLE RULE — OPERATOR-ARMED IS THE ONE THING THAT REACHES A
  // PARKED SHELL. A shell is normally woken by something that is NOT the approving human, so it
  // refuses a handed-in posture unless an explicit `operatorArmed` says a human chose it just now;
  // a bare recreate, reopen, resume or wake sets neither.
  const armedModes = spec.startModes;
  const operatorArmed = spec.operatorArmed === true;
  // ⚠ **`native` RIDES THE SAME GATE AS THE PAIR, AND THAT IS THE WHOLE REASON IT IS HERE
  // (2026-09-21, U5).** It carries the SELECTED runtime's own containment/advanced settings —
  // Codex's `sandbox_mode` above all — which had a reader (`runtime/codex/launch-spec.js ›
  // nativePair`) and no producer anywhere in the tree. A settings axis that reaches a spawn is
  // subject to H2 exactly as the tool axis is: handed in per launch by a caller executing a
  // decision a human is making right now, and a parked shell still refuses a posture no human
  // armed. A shape that passes nothing inherits the runtime's own declared defaults.
  const startModes = armedModes && (!spec.parkedShell || operatorArmed)
    ? { toolMode: armedModes.tools, messageMode: armedModes.messages, native: armedModes.native }
    : {};
  const state = initialSessionState({ mode: spec.mode, side: spec.side, ...readCaps(spec), ...startModes });
  // THE WINDOWLESS MESSAGE FLOOR, AT THE ONE CONSTRUCTION SITE (2026-08-22, F-236's last hole).
  // Both LAUNCH lanes already derive their message axis through `channel-prefs.js ›
  // windowlessMessageMode`, so for them this is a no-op. What it fixes is every shape that hands in
  // NOTHING and inherits the reducer's `ask` — a crash resume above all — which came back BELOW the
  // floor on a session with no accept surface, so `session-gate.js › enqueue` held the peer's next
  // reply forever with no drain left to release it. The same SHARED rule, never a second spelling.
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
    // ⚠ COERCED AGAINST THE **SELECTED RUNTIME'S** DECLARED VOCABULARY, NOT A FROZEN ONE (U5).
    // Still the same discipline — fail closed at EVERY boundary, so a hand-edited store can only
    // land on this runtime's "no pick" member — and `buildLaunchSpec` re-coerces once more at the
    // last step before a child process can see it. NOT reducer state.
    model: runtimeRegistry.capability.launchModelPick(
      runtimeRegistry.descriptorFor((rt && rt.id) || null), spec.model
    ),
    // THE AGENT COLOUR THIS SPAWN ASKED FOR (Samuel, 2026-09-13; docs/specs/agent-colors.md). It
    // was forwarded the whole way down the funnel and DROPPED on this literal until then, so
    // `session-summary.js › liveSummary` had no value to report and every push asked for nothing.
    // Not normalized here (two boundary `colorKey`s already do it; a third copy is what INVARIANTS
    // §5's nine-places warning is about) and not reducer state — the SERVER resolves the ask.
    color: spec.color || null,
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
    // THE SPAWN-IDLE WAKE FLAG (2026-08-22, Samuel's ruling). TRUE while this agent is registered,
    // addressable and UNDIRECTED: the fan-out feeds it nothing but a message naming its own agent
    // id, and a 1:1 `sessions:message` wakes it too. Not `freshFraming` overloaded — that is a
    // ONE-SHOT marker about whether a TURN carries the framing; this is read on EVERY message and
    // answers whether anything may reach the agent at all.
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
  // WHOSE SESSION THIS IS — the cross-account stamp (adversarial review, 2026-08-31). Written ONCE
  // at registration and never rewritten: the registry is process-lifetime and a sign-out does NOT
  // clear it, so operator A's live agent survives B signing in on the same Mac. The PRIVATE DIRECT
  // LANE resolves a target by `(channel, thread, agent)` against this registry, so without a stamp
  // B's direction could reach A's session and ship A's private turn text back to B.
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
  // A WINDOWLESS spawn cannot hold on sign-in (the recovery UI wrote to a window): roll back so
  // launch() reports auth-hold and the caller answers honestly. IT RUNS BEFORE THE SPAWN-IDLE
  // RETURN BELOW, AND THAT ORDER IS THE FIX (2026-08-22): the `parkedShell` branch returned FIRST,
  // so New Agent on a signed-out machine answered a SUCCESS and `{skipped:'auth-hold'}` was
  // unreachable on the one lane an operator reaches by clicking.
  const credentialHeld = await sessionAuth.holdIfNoRuntimeCredential(s, rt);
  if (spec.windowless && credentialHeld) { sessions.delete(s.key); sessionSummary.touch(); return { authHold: true }; }
  // Q6 PREFLIGHT: a machine with no credential for the SELECTED runtime can only produce a dead
  // session, so HOLD the launch on that runtime's recovery action. Nothing is settled, echoed, or
  // thrown away; the request runs the moment sign-in succeeds.
  if (credentialHeld) return s;
  // SPAWN IDLE — THE ONE SHAPE THAT REGISTERS AND STARTS NOTHING (2026-08-21, ruling 3). Not
  // "build the query and hold the prompt": a held query is a live `claude` child holding this
  // session's pre-approved `dopl_channel` access with nobody watching it, the orphan shape C3/C-8
  // exist to prevent. There is no child at all. The session IS registered, so it has a pill, a slot
  // against MAX_CONCURRENT_SESSIONS, an id to be @-mentioned at, pause/end and a durable record.
  // The timer is armed deliberately: `idleTimeout` reads `parked === true` and answers the
  // ABANDONMENT bound, and no reducer event has run yet to arm one anywhere else.
  if (spec.parkedShell) {
    scheduleIdle(s);
    diag('session spawned IDLE (no query until the first message)', 'agent', String(s.agentId || ''), 'thread', String(s.taskId || '').slice(0, 8));
    return s;
  }
  await startQuery(s, rt);
  return s;
}

// The inbound gate lives in session-gate.js (v2.5 D1): `feedInbound` enqueues a counterparty turn
// on a live or parked session. Its HOLD half went with the surface that answered a hold (F-228) — a
// windowless session's message axis is floored at auto_inbound, so nothing holds. The CONSENT
// REFLOW went with it: the decision surfaces are inline on the channels page now (INVARIANTS §6),
// so there is no card to open, adopt, close or release.
// Resume machinery (offerResume/startResume/resume) lives in session-park. init(): settle any
// session live/awaiting when the app died — post the interrupted echo and, when the SDK session id
// survives, offer an opt-in resume (never auto).
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
  try { sessionBoot.reparkDormant(); } catch (err) { diag('session-engine: repark failed', err && err.message); } // ⚠ F-694 — AND THE `continue` ABOVE IS WHY THIS LINE EXISTS: `reloadDisposition('parked')` is `'dormant'`, so a PARKED record fell through the loop — neither re-registered (never published, never re-projected, unwakeable) nor ended (no history, no card). `session-boot.js` re-parks it as Idle or ends it visibly; never a third state
  // AUDIT D5: bound the durable record set (retention policy + protections in session-store). AFTER the scan AND the re-park, so an interrupted record still echoes and offers its resume, and a re-parked key is in the registry this prune is handed as `keep`, before anything can age out.
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
  sessionOn,
  // The three session-team.js exports went with summoning (docs/ENGINEERING.md §18 F-141). The last
  // of them left its line behind here, and `module.exports` is EVALUATED, so requiring this module
  // threw `ReferenceError: sessionTeam is not defined` — no engine, no windows, no sessions.
  // test/main-exports-defined.test.mjs now pins every main export against what its file binds.
  feedInbound: sessionGate.feedInbound, // v2.5 D1 — the inbound gate (live or parked)
  listLiveSessions: sessionReopen.listLiveSessions, listOrphanRisk: sessionReopen.listOrphanRisk, endLiveSessions: sessionReopen.endLiveSessions, // item 10 tray + C-8 quit guard
  reopenByTask: sessionReopen.reopenByTask, controlByTask: sessionReopen.controlByTask, setModeByTask: sessionReopen.setModeByTask, messageByTask: sessionReopen.messageByTask,
  setModelByTask: sessionReopen.setModelByTask, // 2026-08-22: the LIVE model switch (Query.setModel)
  answerPermissionByTask: sessionAnswerPermission.answerPermissionByTask, // 2026-09-17: the inline Approve / Deny on a HELD tool call
  // ⚠ IT TAKES AN ADDRESS, NOT A KEY (2026-08-21). It used to be `(k) => ringFor(sessions.get(k))`
  // and its ONE caller built `${channelId}:${taskId}` by hand — a second, now-wrong statement of
  // the key format sitting in the IPC layer. It takes `{channelId, taskId, agentId?}` and goes
  // through `sessionOn`, so the ambiguity rule is stated once and the key format stays private.
  narrationFor, // item 2 + Phase 5 pause/end + F-212's 1:1 lane and work lane — the MAIN-window bridge (channel-dir-ipc)
};
