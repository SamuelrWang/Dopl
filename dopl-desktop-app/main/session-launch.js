// THE SPAWN FUNNEL — `launch`, its two lanes, and the three questions asked before one.
//
// ⚠ SPLIT OUT OF `main/session-engine.js` ON 2026-08-21, under the hard 500-line §2 cap. The
// multiplayer wave gave that file the agent-id mint, the SPAWN-IDLE branch and the fan-out
// bookkeeping, and it went over — and a file at the cap does not just stop growing, it stops
// being CORRECTABLE, which is the state F-226 was taken out of one wave earlier.
//
// THE SEAM IS REASON-TO-CHANGE. `session-engine.js` is the imperative shell: it owns the SDK
// query, the effect table, the reducer dispatch and the teardown, and it changes when a session's
// RUNTIME changes. This file owns what happens BEFORE one exists — who may spawn, what id it
// wears, which refusals a caller gets and in what shape — and it changes when the spawn POLICY
// changes. They shared a file because `launch` calls `startSession`, and that is an injected
// handle now, exactly as `session-park.js` takes it.
//
// ⚠ THE REFUSAL SHAPES ARE THE CONTRACT AND THEY ARE UNCHANGED. `{skipped:'disabled'}`,
// `{skipped:'auth-hold'}`, `{skipped:'busy'}`, `{skipped:'cap'}`, `{skipped:'no-sdk'}` — every
// one has a caller that answers the peer with it (`trigger.js`) or reports it to the operator
// (`session-ipc-ops.js`). Deleting a shape here turns a refusal into a peer waiting forever.
//
// ⚠ NO ELECTRON, NO SDK HANDLE. Everything the funnel cannot compute is injected via `bind()`:
// the registry, `acquireRuntime`, `startSession`, and the two registry reads. `test/session-engine-slot
// .test.mjs` slices `launch` out of THIS file and drives the real control flow against fakes.

const store = require('./session-store');
const { newAgentId, isAgentId } = require('./agent-id'); // one random id per INSTANCE
const sessionWindowless = require('./session-windowless'); // the concurrency + cost ceiling
const launchBudget = require('./launch-budget'); // 2026-08-31: the CHAINED-launch ceiling over TIME
// 2026-09-01 (D1): `windowlessFloorRefusal` — the ONE launch-blocking question this funnel asks of
// the runtime's own declaration (`contract.js › LAUNCH_BLOCKING[3]`). ⚠ PURE: `session-profiles.js`
// is the electron-free module two suites slice standalone, so this pulls nothing new into the
// funnel and `test/session-engine-slot.test.mjs` injects it like every other module binding.
const profiles = require('./session-profiles');
const { diag } = require('./diag');

let deps = { sessions: null, acquireRuntime: null, startSession: null, liveOnThread: null, sessionOn: null };

/**
 * The engine binds its registry and the two handles this file may not require here at load.
 * ⚠ `bind` REBUILDS `deps` FROM A LITERAL, so a handle the engine passes and this list omits is
 * DROPPED SILENTLY — the same trap `session-reopen.js › bind` records, where the drop wore the
 * face of a guard firing correctly. Add the field HERE whenever the engine's call grows one.
 */
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    acquireRuntime: (d && d.acquireRuntime) || null,
    startSession: (d && d.startSession) || null,
    liveOnThread: (d && d.liveOnThread) || null,
    sessionOn: (d && d.sessionOn) || null,
  };
}

async function launch(a) {
  if (!a.windowless) return { skipped: 'disabled' }; // ⚠ THE ONLY SPAWN SHAPE LEFT IS WINDOWLESS (F-228)
  // ⚠ MINT THE INSTANCE ID HERE, AT THE ONE SPAWN FUNNEL (2026-08-21). Every lane goes through
  // `launch`, so minting here guarantees no session can exist without an address. A caller may
  // hand one in (a resume re-uses its own) but may not invent a shape: `isAgentId` refuses
  // anything that is not `agent-id.js`'s charset and a fresh one is minted instead.
  const agentId = isAgentId(a.agentId) ? a.agentId : newAgentId();
  const slot = { channelId: a.channelId, taskId: a.taskId, agentId: agentId };
  const key = store.slotKey(slot);
  // H1 (LOW): a HELD slot (sign-in wait) answers auth-hold, never busy — post the truth.
  // ⚠ IT ASKS ABOUT THE THREAD, NOT THIS SLOT, AND THAT IS THE POINT. A fresh instance id can
  // never collide with a live slot, so a slot-scoped auth check would answer false forever and
  // the caller would launch a second doomed session on a machine with no Claude credential.
  if (isAuthHeldSession({ channelId: a.channelId, taskId: a.taskId, agentId: (deps.liveOnThread(slot)[0] || {}).agentId || null })) return { skipped: 'auth-hold' };
  // ⚠ THERE IS NO `busy` REFUSAL ANY MORE (2026-08-21, ruling 2). It read `hasLiveSession(slot)`
  // and it WAS the one-agent-per-thread law: a peer's follow-up on a thread this machine was
  // already working got "I'm still finishing a previous request, please resend", and the
  // operator could not put a second agent on their own thread at all. Multiplayer is exactly the
  // removal of that law; MAX_CONCURRENT_SESSIONS below is what still bounds the machine.
  // ⚠ `trigger.js` STILL HANDLES `skipped: 'busy'` and must keep doing so — the cap and the
  // post-await re-check both land there, and deleting it leaves a peer waiting forever.
  // THE CONCURRENCY CEILING. ⚠ ONE BRANCH, because there is one spawn shape (the early return
  // above). It used to be two: a WINDOW budget that an adoptable pre-consent card was net-zero
  // against and that freed an untouched parked shell before refusing (AUDIT D4), and this one.
  // Both the adopt and the eviction went with the window (F-228), so a refusal here is plain —
  // there is nothing to reclaim, and `MAX_CONCURRENT_SESSIONS` is a COST ceiling as much as a
  // concurrency one (INVARIANTS §11: every per-session bound multiplies against it).
  if (sessionWindowless.liveCount(deps.sessions) >= sessionWindowless.MAX_CONCURRENT_SESSIONS) return { skipped: 'cap' };
  // ── ⚠ THE CHAINED-LAUNCH BUDGET (2026-08-31, Samuel's agent-chaining ruling) ────────────────
  // ⚠ SPENT ONLY BY A CHAINED SPAWN, AND THE CONDITION IS THE WHOLE SCOPE STATEMENT: the operator's
  // own New Agent button, a peer-triggered responder, a resume and a recreate all pass no flag and
  // are not counted. It bounds the ONE lane that can grow without a generation bound — see
  // `launch-budget.js` for why the concurrency ceiling directly above is not a bound over TIME.
  // ⚠ AFTER THE CONCURRENCY CHECK AND BEFORE THE SDK AWAIT, so a refused chained launch spends no
  // budget, no SDK handle and no slot; `cap` is the same word both ceilings answer with, on
  // purpose (the seven-word wire vocabulary is closed).
  if (a.launchChain === true && !launchBudget.spend(a.channelId)) {
    diag('session-launch: chained launch over budget', String(a.channelId || '').slice(0, 8));
    return { skipped: 'cap' };
  }
  let rt;
  // ── ⚠ THE RUNTIME THIS SPAWN RUNS ON (2026-08-31, port wave D) ────────────────────────────
  //
  // ⚠ IT IS FORWARDED, NEVER INVENTED, exactly like `model` and `launchDepth` below. Absent —
  // and every lane except the operator's own button passes nothing — resolves to the DEFAULT
  // adapter (`main/runtime/index.js › DEFAULT_ID`, the first registered), so a session record
  // written before the port and every wake, resume and recreate lands on the runtime it always
  // ran on. That is what makes "behaviour byte-identical for existing sessions" a property of
  // the funnel rather than a hope.
  // ⚠ IT IS NOT A CONTAINMENT INPUT, and that is why it may travel this way where `toolProfile`
  // may not. `main/channel-runtime.js`'s header carries the whole argument: every adapter
  // re-derives its own deny lists and Axis-A vocabulary, `contract.js › sealAdapter` refuses to
  // register one that cannot, and the four gate steps before Axis A are core's on all of them.
  // ⚠ AN UNKNOWN ID IS THE DEFAULT, NOT A REFUSAL — `resolve` fails closed toward "the runtime
  // this build actually ships" rather than stranding a session with no way to end it.
  try { rt = await deps.acquireRuntime(a.runtime); } catch (err) {
    // ⚠ THE SKIP CODE IS THE WIRE AND DOES NOT CHANGE. `trigger.js` and the directive lane both
    // branch on `'no-sdk'`, and it means "this machine has no agent runtime" on every runtime —
    // renaming it would be a vocabulary change dressed as a cleanup.
    diag('session-engine: agent runtime unavailable', err && err.message);
    return { skipped: 'no-sdk' };
  }
  if (hasLiveSession(slot)) return { skipped: 'busy' }; // FIX #7: re-check after await — a slot-scoped check now, so only an id collision (unreachable) trips it
  // ── ⚠ THE WINDOWLESS TOOL FLOOR, AS A LAUNCH REFUSAL (2026-09-01, D1) ─────────────────────
  //
  // `contract.js › LAUNCH_BLOCKING[3]`. `capability.js › floorWindowlessTool`'s header has always
  // said `windowlessFloor: null` REFUSES THE WINDOWLESS LAUNCH — but nothing anywhere refused it:
  // the predicate silently handed back the session's own stored mode, which starts at the
  // NARROWEST member and resets to it on park, on a session with no gate surface. Every tool call
  // denied, no error, and the agent reporting it cannot read files the prompt told it to read.
  //
  // ⚠ HERE, AND HERE IS THE POINT. It is after `acquireRuntime` (so the runtime is known and
  // usable) and BEFORE `startSession` (so nothing is registered, no id is spent, no slot is held,
  // and there is no rollback to get wrong — contrast the auth hold below, which must
  // `sessions.delete`). This whole file is the "what happens before a session exists" seam.
  // ⚠ EVERY LAUNCH THROUGH THIS FUNNEL IS WINDOWLESS (`a.windowless` is checked at the top, F-228),
  // so no windowed shape is caught by this; the refusal is still asked of the windowless question
  // rather than of the adapter, because a runtime with no floor is perfectly launchable WITH a gate.
  // ⚠ `'disabled'` AND NOT AN EIGHTH WIRE WORD, AND THAT IS A DECISION RATHER THAN A SHORTCUT.
  // `launch-directive-wire.js › REFUSAL_REASONS` is not a local list: the SAME seven words are
  // `schema-launch.ts › LaunchRefusalReasonSchema`, `service-launch.ts › LAUNCH_REFUSAL_REASONS`,
  // `use-agents-panel.ts › launchRefusalText`'s copy map, and a column CHECK in a deployed
  // migration. Minting a word here would put this tree one word ahead of a constraint that
  // REJECTS it at rest — a refusal that fails to record itself. `'disabled'` is the existing
  // local-only code for "this build will not run this spawn shape", it is the documented
  // exception in `launch-directive-wire.test.mjs`, and `refusalFor` maps it to `no-bridge`.
  // ⚠ THE SPECIFIC SENTENCE IS THEREFORE THE DIAG'S JOB, and that is where it belongs anyway:
  // the diag is local-only, so it is the one surface allowed to name a runtime (`trigger.js ›
  // skippedHint`'s header carries that rule). ⚠ IF A FUTURE WAVE WANTS THIS DISTINGUISHABLE ON
  // THE WIRE, the change is five files plus a migration, not this line.
  const floorRefusal = profiles.windowlessFloorRefusal(a.runtime);
  if (floorRefusal) {
    diag('session-launch: windowless launch refused —', floorRefusal);
    return { skipped: 'disabled' };
  }
  // ── ⚠ AXIS B'S COLLAPSE WARNING (2026-09-01, D3) ──────────────────────────────────────────
  //
  // `capability.js › axisBOpScoped` was DECLARED, documented in the strongest terms, and read by
  // nothing: no core branch, no UI warning, no launch refusal. This is its consumer.
  // ⚠ A WARNING AND NOT A REFUSAL, DELIBERATELY. The failure direction is CLOSED — input the gate
  // cannot read fails `postFieldsOk`, `grantDecision` answers `'gate'`, and a windowless gate is a
  // DENY — so the agent is broken and the boundary holds. Refusing here would take a registered
  // adapter off the only spawn shape this tree has over a failure that cannot leak anything;
  // whether such a runtime may SHIP is a release decision, exactly like `interruptRefusal`'s.
  // ⚠ AND IT IS NOT AN `if` AROUND THE LAUNCH. The line goes out and the spawn continues.
  const opScopedWarning = profiles.axisBOpScopedWarning(a.runtime);
  if (opScopedWarning) diag('session-launch: Axis B is not op-scoped on this runtime —', opScopedWarning);
  const s = await deps.startSession({
    key,
    agentId,
    channelId: a.channelId,
    taskId: a.taskId,
    workspaceId: a.workspaceId,
    side: a.side,
    profile: a.toolProfile,
    mode: a.mode,
    context: a.context,
    counterpartyId: a.counterpartyId, // FIX L1: bind the feed to the task's other party
    direct: a.direct, // H2: the server's is_direct flag, for the outbound card's recipient line
    firstMessage: a.firstMessage, // startSession frames it inside the per-session nonce fence
    // H2: the posture a HUMAN chose for THIS launch, and the only way one reaches a spawn.
    // `trigger.js` passes the arm it consumed on a consent-approved responder launch;
    // `session-ipc-ops.js › sessions:launch` passes the channel's durable posture. Anything
    // that passes nothing inherits the reducer's manual/ask.
    // ⚠ `adoptsConsent` RODE HERE and is gone (F-228): it named the ONE spawn allowed to spend
    // the pre-consent card's entry-keyed arm, and there is no card.
    startModes: a.startModes,
    // ⚠ THE MODEL, FORWARDED AND NEVER INVENTED (2026-08-22, Samuel's model-selection ruling).
    // The funnel had no `model` field at all, so `startSession`'s `sessionModel.normalizeModel
    // (spec.model)` could only ever answer 'default' on every lane that goes through here — the
    // per-session picker's value had one producer left (a resume's stored record) and no way in
    // from a launch. It is coerced at the construction site and again at `buildSdkOptions`, the
    // last step before a child process can see it, so a bad value here is 'default', never argv.
    model: a.model,
    windowless: a.windowless === true, // 2026-08-20: no window, ever, on this shape
    // ⚠ THE LAUNCH DEPTH — F-320's RECURSION BOUND, and this funnel FORWARDS it without inventing
    // one (2026-08-25). Exactly ONE caller passes `0` and it is the New Agent button
    // (`session-launch-op.js › launchFromButton`, where a human is at the keyboard); the directive
    // lane, the peer-triggered responder, a resume and a recreate all pass nothing and land at
    // `session-own-launch.js › MAX_LAUNCH_DEPTH`, which is the fail-CLOSED direction: a lane that
    // forgets this field loses the right to launch agents rather than gaining it. ⚠ DO NOT give it
    // a `|| 0` default here — that inverts the whole bound in one character.
    launchDepth: a.launchDepth,
    // ⚠ …AND THE CHANNEL'S CHAINING SETTING, FORWARDED THE SAME WAY AND WITH THE SAME RULE
    // (2026-08-31). Exactly ONE caller passes it — `launch-directives.js › spawn`, which reads
    // `channel-prefs.js › getAgentChain` per directive — and every other lane passes nothing,
    // which reads FALSE and keeps the one-generation bound. ⚠ DO NOT give it a `|| true` or read
    // the store here: an ambient read at the funnel would hand the flag to the peer-triggered
    // wake, the resume and the recreate as well, which is precisely the re-arming shape
    // `channel-prefs.js`'s H2 block exists to refuse.
    launchChain: a.launchChain === true,
    // 2026-08-21 ruling 3: SPAWN IDLE. Registers the agent with prepared context and starts no
    // query; the first inbound message for this agent is what launches it.
    parkedShell: a.idle === true,
    operatorArmed: a.operatorArmed === true,
    triggerSeq: a.triggerSeq, // the ask's seq — the outbound bridge's seq-join floor
  }, rt);
  if (!s) return { skipped: 'disabled' };
  if (s.authHold === true) return { skipped: 'auth-hold' };
  // ⚠ THE AGENT ID IS PART OF THE ANSWER (2026-08-21): a SPAWN-IDLE launch has no work in
  // flight, so what the caller needs back is the ADDRESS it just created.
  return { sessionId: s.sessionId, agentId: agentId };
}

function launchResponderSession(a) {
  return launch({ ...a, side: 'responder', firstMessage: a.message });
}
function launchRequesterSession(a) {
  return launch({ ...a, side: 'requester', firstMessage: a.goal });
}

// ⚠ WITH NO `agentId` THIS ASKS ABOUT THE THREAD, NOT A SLOT (2026-08-21). Its production
// readers want "is anything already running here"; `launch()` re-checks the exact slot, because
// a fresh instance id can never collide and a second agent on a busy thread must not read busy.
function hasLiveSession(a) {
  if (a && a.agentId) {
    const s = deps.sessions.get(store.slotKey(a));
    return !!(s && !s.settled);
  }
  return deps.liveOnThread(a).length > 0;
}

// H1 (LOW) — is the session occupying this (channel, task) slot HELD on the sign-in action
// rather than actually working? The registry cannot tell the difference on its own, and the
// caller's "busy" copy ("I'm still finishing a previous request") is a lie when the truth is
// "nothing is running and nobody can start it until someone signs in on that Mac".
function isAuthHeldSession(a) {
  const s = deps.sessions.get(store.slotKey(a));
  return !!(s && !s.settled && s.state && s.state.authHeld === true);
}

// FIX L1: the counterparty this session was launched against. ⚠ IT NO LONGER FENCES THE FEED
// (2026-08-21, the fan-out ruling — see `session-dispatch.js`); it survives as the session's
// DISPLAY binding (the outbound card's recipient line) and because a resume persists it.
function counterpartyFor(a) {
  const s = deps.sessionOn(a);
  return s ? (s.counterpartyId || null) : null;
}

module.exports = {
  bind,
  launch,
  launchResponderSession,
  launchRequesterSession,
  hasLiveSession,
  isAuthHeldSession,
  counterpartyFor,
};
