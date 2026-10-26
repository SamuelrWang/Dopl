// Idle-park and resume. Leaf deps are required at the top; the engine's handles are injected via bind(), and the
// PURE block (free vars only, no `require(`) is sliced by the resume suites. Every resume assembles its spec
// through the engine's own `buildLaunchSpec`: the conversation id is the only difference from a cold launch.

const io = require('./session-io');
const store = require('./session-store');
const privateTurn = require('./session-private');
// Module scope, not inside the block: the PURE block may not reference `require(`.
const directedTurn = require('./session-directed');
const sessionWindowless = require('./session-windowless');
// ⚠ TOP-LEVEL ON PURPOSE: the SESSION-PARK-PURE block below is extracted and driven with its
// free variables injected, so it may not contain a `require(` of its own. `electron` left with
// the resume banner (2026-10-09) — the route raises it now and owns the surface choice.
const notificationRoute = require('./notification-route');
const { newAgentId, isAgentId } = require('./agent-id');
const { diag } = require('./diag');
const sessionCredential = require('./session-credential');
const runtimeRegistry = require('./runtime');
const runtimeCapability = runtimeRegistry.capability;
// The block's two shared rules, at module scope because the PURE block may not `require(`.
const toolProfiles = require('./tool-profiles');
const sessionHandles = require('./session-handles');

// ─── BEGIN SESSION-PARK-PURE (injectable; unit-tested via source extraction) ──────

let deps = null;

// Engine handles, read at CALL time (bind order does not matter).
function bind(d) {
  deps = d || null;
}

// The profile a record may resume at: `tool-profiles.js › normalizeProfile`, which fails closed to
// `read_only` (and logs the unknown value). Exported under this name for `session-boot.js`.
function knownProfile(p) {
  return toolProfiles.normalizeProfile(p);
}

/**
 * IS THE MACHINE'S CONCURRENCY CEILING REACHED? (a resume costs a child like a launch).
 *
 * ⚠ ONE SPELLING PER MODULE, 2026-10-11. `startResume` asked this question with the literal
 * `liveCount(...) >= MAX_CONCURRENT_SESSIONS` TWICE — once before the runtime probe and once after it —
 * and `session-launch.js` held a third copy that had never learned the post-await re-check these two
 * already did. The duplication is the mechanism of that divergence, so each side now asks a named
 * helper: `session-launch.js › capReached` there, this one here.
 * ⚠ AND IT IS NOT THE SHARED HELPER, which it should be. Two test harnesses this agent does not own
 * slice SESSION-PARK-PURE and hand-build its free-variable list (`test/main-audit-resume-budget.mjs`
 * injects `sessionWindowless` by name, and `test/session-park.test.mjs` asserts this file still
 * mentions `sessionWindowless.MAX_CONCURRENT_SESSIONS`), so importing `capReached` here breaks both.
 * Unifying the two into one export is a three-file change and is FLAGGED rather than taken.
 */
function atCap() {
  return sessionWindowless.liveCount(deps.sessions) >= sessionWindowless.MAX_CONCURRENT_SESSIONS;
}

// The session CONTEXT rebuilt from a record. channelId/workspaceId ARE prompt input for a shell with nothing to
// resume; `identity` is a name-only stub (F-288) — nothing after spawn reads its body, so a consumer must not
// assume `identity.instructions` is there.
function contextFromRecord(rec) {
  const r = rec || {};
  return {
    channelName: r.channelName || null,
    threadTitle: r.threadTitle || null,
    authorName: r.counterpartyName || null,
    channelId: r.channelId || null,
    workspaceId: r.workspaceId || null,
    // `templateName`: a record parked before the template→identity rename (P3-10).
    identity: (r.identityName || r.templateName) ? { name: r.identityName || r.templateName } : null,
  };
}

// Resume a PARKED session IN PLACE. The new controller and iterator are assigned SYNCHRONOUSLY so the push
// the reducer queues next lands on them.
function resumeParked(s) {
  if (!deps || !s || s.settled || s.resuming) return;
  // Resume is a declared capability; a runtime that has not measured whether its usage resets refuses, and the
  // session stays parked in place for the next wake to retry.
  const descriptor = runtimeRegistry.descriptorFor(s.runtimeId);
  const refusal = runtimeCapability.resumeRefusal(descriptor);
  if (refusal) {
    diag('session-park: resume refused —', refusal);
    return;
  }
  // Decided before any teardown, off the record's word where the session has one.
  const usageZeroes = runtimeCapability.resumeZeroesBaseline(descriptor, s.usageBaseline);
  // Reap the prior child BEFORE assigning fresh handles (assigning them makes the old ones unreachable):
  // a Codex thread has one writer (`-32600`) and dies only on `handle.close()`.
  sessionHandles.teardownHandles(s);
  // A rebuilt query owes no results: the private window and any directed capture reset with it.
  s.resuming = true;
  privateTurn.resetPrivateTurn(s); privateTurn.resetPeerTurn(s);
  directedTurn.resetDirected(s);
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  s.resumeSdkId = s.sdkSessionId || s.resumeSdkId || null;
  // The resumed query mints a fresh id at init; clear the old one so a pre-init crash's clientMsgId cannot collide.
  s.sdkSessionId = null;
  // Supersede the old consume loop synchronously (`s.query !== q`), so a late rejection cannot crash this session.
  s.query = null;
  // The delta baseline pairs with its accumulator: a runtime that RESTARTS its cumulative total on resume zeroes
  // it; one that CONTINUES keeps it, or the first delta re-counts the whole thread. `tokensSpent` is untouched.
  if (usageZeroes) s.lastTotalTokens = 0;
  startResumedConsumer(s);
}

async function startResumedConsumer(s) {
  let rt;
  try {
    // The session's own runtime, never re-chosen: the conversation handle means nothing to another vendor.
    rt = await deps.acquireRuntime(s.runtimeId);
  } catch (err) {
    diag('session-park: resume runtime unavailable', err && err.message);
    s.resuming = false;
    if (!s.settled) deps.dispatch(s, { type: 'crash' });
    return;
  }
  if (s.settled) {
    try { s.pushIterator.close(); } catch (_) { /* best effort */ }
    s.resuming = false;
    return;
  }
  try {
    // The runtime's Dopl credential, as at the first query-start site (`session-query.js › startQuery`).
    if (deps.holdIfNoCredential && (await deps.holdIfNoCredential(s, rt))) { s.resuming = false; return; }
    // The container lock (plan §4.4 B1): the second query-start site; a woken spawn-idle shell has no stamp yet.
    await sessionCredential.ensureContainerCredential(s, diag);
    // The MCP pre-flight runs here too (a boot re-park resumes against a cold route), with its settled re-check (F-696).
    if (deps.preflightMcp && (await deps.preflightMcp(s))) { s.resuming = false; return; }
    if (s.settled) { s.resuming = false; return; }
    // Which lane started this stream, so the MCP guard retries on it (F-696).
    s.launchVia = 'resume';
    const q = rt.resume(deps.buildLaunchSpec(s));
    s.query = q;
    s.resuming = false;
    deps.consume(s, q, rt);
  } catch (err) {
    diag('session-park: resume start failed', err && err.message);
    s.resuming = false;
    if (!s.settled) deps.dispatch(s, { type: 'crash' });
  }
}

// An opt-in resume from the startup interrupted-notice; never auto-reopens.
// ⚠ POPUP ONLY (Samuel's spec, 2026-10-09 — `session_resume`): it fires at app launch, when the
// operator is already looking at Dopl, so it belongs in the app rather than on the lock screen.
// Its button RESUMES, which is allowed here and nowhere else in a toast — see
// `notification-route.js › pendingOpens`: this starts the operator's OWN agent, like the New Agent
// button, and ignoring it leaves the session parked, which is exactly today's behaviour.
// ⚠ The toast is STICKY because this offer is raised ONCE; a four-second one would lose it.
function offerResume(rec, sdkSessionId) {
  notificationRoute.raiseResumeOffer({
    title: 'Resume session',
    body: 'A Dopl session was interrupted.',
    onResume: () => {
      resume(rec, sdkSessionId).catch((err) => diag('session-park: resume failed', err && err.message));
    },
  });
}

/** Rebuild a settled session from its record and resume its conversation. Answers a boolean. */
async function startResume(rec, sdkSessionId, rawFirstTurn) {
  // The one spawn that bypasses `launch()`, so it mints the instance id (a legacy record has none) and writes it
  // back: `offerResume` holds this object, and a second click must find the same slot.
  const agentId = isAgentId(rec.agentId) ? rec.agentId : newAgentId();
  rec.agentId = agentId;
  const slot = { channelId: rec.channelId, threadId: rec.threadId, agentId: agentId };
  // The record's own three-part slot, then the concurrency ceiling (a resume costs a child like a launch).
  if (deps.hasLiveSession(slot)) return false;
  if (atCap()) {
    diag('session-park: resume refused — cap', `(${sessionWindowless.MAX_CONCURRENT_SESSIONS} live)`);
    return false;
  }
  // The same resume refusal as `resumeParked`, off the record's runtime.
  const descriptor = runtimeRegistry.descriptorFor(rec.runtimeId);
  const resumeRefusal = runtimeCapability.resumeRefusal(descriptor);
  if (resumeRefusal) {
    diag('session-park: resume refused —', resumeRefusal);
    return false;
  }
  let rt;
  try { rt = await deps.acquireRuntime(rec.runtimeId); } catch (err) {
    diag('session-park: resume runtime unavailable', err && err.message);
    return false;
  }
  // Re-check the slot AND the cap after the await: a racing launch may have taken either.
  if (deps.hasLiveSession(slot)) return false;
  if (atCap()) {
    diag('session-park: resume refused — cap (taken during the runtime probe)');
    return false;
  }
  const s = await deps.startSession({
    key: store.slotKey(slot),
    channelId: rec.channelId, threadId: rec.threadId, workspaceId: rec.workspaceId,
    // The same instance id, else it comes back as a stranger (slot, pill, @-address).
    agentId: agentId, bind: rec.bind === 'room' ? 'room' : 'pair',
    // Fail restrictive: an unknown stored profile resumes `read_only`, never the stored string.
    side: rec.side, profile: knownProfile(rec.profile), mode: rec.mode,
    // The launch stamps are restored, never minted; absent reads as the cap at the gate.
    launchDepth: rec.launchDepth, launchChain: rec.launchChain === true, operatorTools: rec.operatorTools,
    // Load-bearing: it is what applies Axis B's windowless floor at the construction site (F-236). Not a posture:
    // H2 still forbids a resume handing in `startModes`.
    windowless: true,
    counterpartyId: rec.counterpartyId || null, direct: rec.direct === true,
    context: contextFromRecord(rec), rawFirstTurn, resumeSdkId: sdkSessionId,
    turns: rec.turns,
    // Rehydrated (with slack in startSession) so a resume never re-mints a client_msg_id the server holds.
    ownPostSeq: rec.ownPostSeq,
    model: rec.model,
    dimensions: rec.dimensions || undefined,
  }, rt);
  return !!s;
}

async function resume(rec, sdkSessionId) {
  const nudge = 'The session was resumed after an interruption. Continue where you left off and await the next channel reply.';
  return startResume(rec, sdkSessionId, nudge);
}

// ─── END SESSION-PARK-PURE ────────────────────────────────────────────────────────

module.exports = {
  bind,
  contextFromRecord,
  knownProfile,
  resumeParked,
  offerResume,
  startResume,
  resume,
};
