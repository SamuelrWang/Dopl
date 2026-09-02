// session-park.js — idle-park + resume machinery.
//
// Leaf deps (io / store / diag / Notification) required at the top; ENGINE handles (live
// registry, SDK loader, option assembly, consumer loop, dispatch, startSession) injected via
// bind(). The BEGIN/END PURE block references those as free vars, so
// test/session-park.test.mjs slices it and drives it with fakes.
//
// ⚠ SECURITY: parked resume and recreated-shell resume BOTH assemble SDK options through the
// engine's OWN buildLaunchSpec — the SAME path a fresh launch uses (allowedTools shadow rule,
// canUseTool gate, scrubbed env, disallowedTools, settingSources:[], permissionMode 'default').
// NO divergent option assembly, NO new auto-approval; `options.resume = retained sdkSessionId`
// is the only difference from a cold launch. feedInbound stays bound to the stored counterparty.

const io = require('./session-io');
const store = require('./session-store');
// 2026-08-22: the PRIVATE TURN's window. A resume rebuilds the query, so the depth the old one
// was carrying is owed by nobody — see `session-private.js › resetPrivateTurn`.
const privateTurn = require('./session-private');
// 2026-08-31: the DIRECTED turn's capture. ⚠ Required AT MODULE SCOPE — the SESSION-PARK-PURE
// block may not reference `require(` and its suite asserts so.
const directedTurn = require('./session-directed');
// 2026-08-22, F-272: the concurrency + cost ceiling. `session-launch.js` takes it the same way
// and for the same reason — the number lives in ONE place and every spawn shape asks it.
const sessionWindowless = require('./session-windowless');
const { Notification } = require('electron');
const { newAgentId, isAgentId } = require('./agent-id'); // one random id per INSTANCE
const { diag } = require('./diag');
const sessionCredential = require('./session-credential'); // the container lock (plan §4.4 B1)
// 2026-08-31 (port wave D): the RESUME capability, read off the runtime's descriptor. ⚠ Required
// AT MODULE SCOPE for `directedTurn`'s reason — the PURE block may not reference `require(` — and
// it names no vendor: `capability.js` is the one module allowed to interpret a descriptor's nulls.
const runtimeRegistry = require('./runtime');
const runtimeCapability = runtimeRegistry.capability;

// ─── BEGIN SESSION-PARK-PURE (injectable; unit-tested via source extraction) ──────

let deps = null;

// The engine binds its internals here at load (sessions, acquireRuntime, buildLaunchSpec, consume,
// dispatch, startSession, hasLiveSession,
// settleSession). Read at CALL time, so bind order at module load does not matter.
function bind(d) {
  deps = d || null;
}

// ⚠ Profiles a persisted record may legitimately carry. Anything else (missing, corrupt, from a
// future version) recreates as read_only — fail restrictive.
// ⚠ A SECOND COPY OF `tool-profiles.js › KNOWN_PROFILES`, KEPT BECAUSE THE PURE BLOCK MAY NOT
// `require` (see this section's own sentinel note) AND HELD EQUAL BY A TEST rather than by
// discipline — `test/channel-agent-profile.test.mjs`. It is not cosmetic drift: a profile missing
// here does not fail closed loudly, it silently RECREATES every parked session carrying it at
// `read_only`, which reads as an agent that has quietly lost its tools.
// ⚠ `channel_agent` joined on 2026-09-02 (ruling B7).
const KNOWN_PROFILES = new Set(['full', 'dopl_only', 'channel_agent', 'read_only']);

function knownProfile(p) {
  return KNOWN_PROFILES.has(p) ? p : 'read_only';
}

// Rebuild the session CONTEXT from a durable record so a reopened window keeps its identity
// (peer name, channel, task title) instead of a bare "Session" header. `authorName` is what
// startSession derives counterpartyName from. Display-only strings — they never re-enter the
// prompt (a resume passes its own rawFirstTurn).
// ⚠ EXCEPT channelId / workspaceId, which ARE prompt input: a recreated shell with nothing to
// resume builds its first turn from this context (io.takeFraming -> prompt-framing
// .deliverySection), and without them the session knows only the channel's display name and
// cannot address dopl_channel.
// ⚠ AND `template`, SINCE 2026-08-23 (F-288) — A NAME-ONLY STUB, ON PURPOSE.
// `context.template` is a spawn-time capture, and this function is the ONLY thing standing
// between a crash resume and a session that reports no template at all: `session-summary.js ›
// liveSummary` reads `ctx.template && ctx.template.name`, `templateName` sits in
// `session-telemetry.js › STATE_FIELDS`, and a null there bypasses the cadence floor and ERASES
// `channel_sessions.template_name` under a still-running agent.
// ⚠ THE STUB IS SUFFICIENT AND THE BODY IS DELIBERATELY ABSENT. `instructions` / `fields` /
// `knowledgeBases` have exactly one consumer — `prompt-framing-template.js › templateRoleFraming`,
// reached through the one-shot `session-seed.js › takeFraming` — and a resume never runs it
// (`session-engine.js` sets `freshFraming: spec.parkedShell === true && !spec.resumeSdkId`, and
// `startResume` always passes `resumeSdkId`). The SDK resume carries the original ROLE block.
// ⚠ SO A CONSUMER THAT LATER READS `template.instructions` OFF A LIVE SESSION MUST NOT ASSUME IT
// IS THERE. That is the cost of the stub, stated rather than discovered.
function contextFromRecord(rec) {
  const r = rec || {};
  return {
    channelName: r.channelName || null,
    taskTitle: r.taskTitle || null,
    authorName: r.counterpartyName || null,
    channelId: r.channelId || null,
    workspaceId: r.workspaceId || null,
    template: r.templateName ? { name: r.templateName } : null,
  };
}

// Resume a PARKED session IN PLACE: the session object survived park (registry entry and
// window alive), only its live SDK query was torn down.
// ⚠ Rebuild the abort controller + push iterator SYNCHRONOUSLY so the pushInbound / pushTurn
// effect the reducer queues right after lands on the FRESH iterator. resumeSdkId feeds
// options.resume, continuing the SAME conversation.
function resumeParked(s) {
  if (!deps || !s || s.settled || s.resuming) return;
  // ── ⚠ RESUME IS A DECLARED CAPABILITY, AND AN UNVERIFIED METER REFUSES IT (2026-08-31) ─────
  //
  // ⚠ THE COST CAP IS WHAT IS AT STAKE, NOT THE RESUME. Two lines below, this function zeroes
  // `s.lastTotalCost` and `s.lastTotalTokens` because it ASSUMES the runtime restarts its
  // cumulative total on a resumed conversation. A runtime that CONTINUES the total instead makes
  // every subsequent delta negative; `session-io.js` clamps it to zero; `session-state.js ›
  // costCapReached` is fed by that one number and is therefore never reached. The budget control
  // stops existing with no error, no log and no symptom until a bill arrives — which is why
  // `capability.js › canResume` refuses rather than hides, and why a COLD launch is unaffected.
  // ⚠ IT REFUSES IN PLACE AND LEAVES THE SESSION PARKED. There is nothing to tear down (no query
  // was rebuilt yet) and a parked session is a resumable one the moment the answer lands, so the
  // operator's next wake retries. The reason is logged as a SENTENCE rather than a code, because
  // an operator is who has to read it.
  const refusal = runtimeCapability.resumeRefusal(runtimeRegistry.descriptorFor(s.runtimeId));
  if (refusal) {
    diag('session-park: resume refused —', refusal);
    return;
  }
  s.resuming = true;
  // ⚠ THE PRIVATE WINDOW DOES NOT SURVIVE THE TORN-DOWN QUERY (2026-08-22). The depth is spent by
  // each turn's `result`, and the results this session was still owed died with the query the park
  // aborted — so a resume that inherited the depth would gate the OUT half of Axis B for turns
  // nobody made private. The park's own `abortQuery` effect resets it too; both, because a resume
  // can also follow a crash, where no effect ran.
  privateTurn.resetPrivateTurn(s);
  // 2026-08-31: same rule, same edge — a rebuilt query owes no results, so a directed
  // capture carried across a resume would attach the NEXT turn's text to a direction that
  // never got one. Dropped; the row lazy-expires.
  directedTurn.resetDirected(s);
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  s.resumeSdkId = s.sdkSessionId || s.resumeSdkId || null;
  // ⚠ A resumed query mints a FRESH sdkSessionId at its own system/init. Drop the old one now
  // so a pre-init crash's lifecycle clientMsgId falls back to the per-session-object sessionId
  // instead of colliding with the prior cycle's terminal event and hiding a post-cap crash.
  s.sdkSessionId = null;
  // ⚠ SYNCHRONOUSLY supersede the torn-down query's consume loop so its `s.query !== q` guard
  // trips — otherwise a late non-abort rejection from the OLD query crashes this session.
  s.query = null;
  // ⚠ ASSUMPTION: the runtime restarts its cumulative cost from 0 on a resumed query, so resetting
  // the delta baseline preserves the running cap total in state.costUsd (the cap keeps enforcing
  // across park AND crash/resume).
  // ⚠ IT IS A DECLARED CAPABILITY SINCE 2026-08-31, NOT A COMMENT ANYBODY HAS TO FIND:
  // `descriptor.session.usageResetsOnResume`. An `'unverified'` answer REFUSES the resume (a cold
  // launch is unaffected), because a runtime that CONTINUES the total makes every delta negative,
  // clamps it to zero in `session-io.js › applyCoreEvents`, and stops the cost cap ever firing —
  // silently, with no symptom until a bill arrives.
  s.lastTotalCost = 0;
  // ⚠ THE SAME ASSUMPTION, THE SAME RESET, ONE LINE APART ON PURPOSE. `result.usage` restarts
  // from zero on the resumed query exactly like `total_cost_usd`, so its delta baseline drops
  // here too; `s.tokensSpent` (the accumulated figure the Agents tab shows) is deliberately NOT
  // touched — it is the lifetime spend and a park is not a new agent.
  s.lastTotalTokens = 0;
  startResumedConsumer(s);
}

async function startResumedConsumer(s) {
  let rt;
  try {
    // ⚠ THE SESSION'S OWN RUNTIME, NOT THE DEFAULT (2026-08-31, port wave D). `s.runtimeId` is
    // stamped at spawn and never re-read live, precisely so a park cannot land a conversation on
    // a different vendor: the handle in `s.resumeSdkId` is one runtime's and means nothing to
    // another. Absent (every session record written before the port) resolves to the default,
    // which is the runtime those sessions actually ran on.
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
    // 🔒 THE CONTAINER LOCK (plan §4.4 B1) — the SECOND of the two query-start sites; the first
    // is `session-query.js › startQuery`, whose comment carries the argument for why there are
    // two. A resumed session almost always carries its stamp already (park keeps the credential
    // on purpose: `resumeParked` works on the SAME object, and a released one would come back as
    // a session that 401s on its first tool call). The case this site exists for is a WOKEN
    // SPAWN-IDLE SHELL, which was registered without ever starting a query and so has none.
    await sessionCredential.ensureContainerCredential(s, diag);
    // ⚠ `resume`, NOT `start`, AND THE SECOND ARGUMENT IS THE HANDLE BEING SUPERSEDED. On the
    // runtime registered today a resume is a fresh child carrying the conversation id, so that
    // argument is ignored; a runtime that RE-ATTACHES to a live conversation needs it, and
    // declaring the signature now is what keeps that from being a core change later.
    const q = rt.resume(deps.buildLaunchSpec(s), s.query);
    s.query = q;
    s.resuming = false;
    deps.consume(s, q, rt); // fire-and-forget consumer loop
  } catch (err) {
    diag('session-park: resume start failed', err && err.message);
    s.resuming = false;
    if (!s.settled) deps.dispatch(s, { type: 'crash' });
  }
}

// ⚠ THE SHELL-RECREATE FAMILY IS DELETED — 2026-08-20, F-228.
//
// `recreateParkedShell` and `openFromChannel` both did ONE thing that no longer exists: open a
// WINDOW. A dormant shell in the registry with no query running was a way to show the operator
// a transcript and let them type into it; the transcript surface is the channels page now and
// the agent view is `main/agent-window.js`, neither of which needs a session object to exist
// before it can paint. `evictIdleShell` and `atCapAfterEvict` went with them — they were LRU
// relief for the WINDOW budget, and the windowless lane's ceiling
// (`session-windowless.js › MAX_CONCURRENT_SESSIONS`) is a plain refusal with no eviction.
//
// ⚠ WHAT THIS CHANGES FOR THE OPERATOR, STATED RATHER THAN DISCOVERED: `reopenByTask` on a
// session that is NOT live used to fall through here and mint a v1 session window. It now
// refuses. That is the retirement working as ruled (INVARIANTS §11 — no session window is ever
// minted), and the refusal is honest where the old path was not: `recreateParkedShell`'s first
// line answered `{ ok: true }` for a live session it did not rebuild, which is the swallow
// F-212 was filed about.
//
// The RESUME family below is untouched and is a different thing entirely: it resumes a session
// that already exists, with no window anywhere in it.

// ⚠ THE REQUEST LIFECYCLE STRIP IS DELETED — 2026-08-20, F-228. `armRequestStatus` and
// `noteRequestStatus` maintained one line of WINDOW CHROME saying what had happened to the
// request the operator typed (sent / accepted / declined / replied), armed only for the
// operator's own `desktop-ui` creates. Its surface went with the window and its two callers
// were `session-dispatch` routes 2 and 4, deleted in the same change. What the strip reported
// is on the channels page: the thread card carries the peer's decision as a receipt row
// (INVARIANTS §5), which is a shared statement rather than one machine's chrome.

// ── Shared resume machinery ──────────────────────────────────────────────────────

// Offer an opt-in resume from the startup interrupted-notice (init crash scan). ⚠ Never
// auto-reopens — a user click drives the resume.
function offerResume(rec, sdkSessionId) {
  try {
    if (!Notification || (Notification.isSupported && !Notification.isSupported())) return;
    const n = new Notification({ title: 'Resume session', body: 'A Dopl session was interrupted. Click to resume it.' });
    n.on('click', () => {
      resume(rec, sdkSessionId).catch((err) => diag('session-park: resume failed', err && err.message));
    });
    n.show();
  } catch (err) {
    diag('session-park: offerResume failed', err && err.message);
  }
}

// Shared resume: reopen a settled task resuming its SDK session with a given first turn.
async function startResume(rec, sdkSessionId, rawFirstTurn) {
  // ⚠ THE ONE SPAWN THAT DOES NOT GO THROUGH `session-launch.js › launch`, SO IT MINTS THE
  // INSTANCE ID ITSELF (2026-08-22). It used to pass `rec.agentId || null` straight through, and
  // a PRE-MULTIPLAYER record on a shipped operator's disk has no `agentId` at all — every record
  // written before 2026-08-21. A resumed session with `agentId: null` is not merely unaddressable:
  // `session-summary.js › nameOf` answers `''` for it, `session-state-push.js` files that as
  // `name: ""`, and the server's `SESSION_NAME_RE` 400s THE WHOLE ARRAY. `retryable(400)` is
  // false, so the digest is never recorded and every later push for that workspace fails
  // identically — `read_sessions` answers `[]` for the machine, live sessions included, for the
  // life of the run. Same charset rule `launch()` applies, and for the same reason: a caller may
  // hand an id in, but may not invent a shape.
  const agentId = isAgentId(rec.agentId) ? rec.agentId : newAgentId();
  // ⚠ AND THE MINT IS WRITTEN BACK ONTO THE RECORD, which is what keeps the check-then-act guard
  // below EXACT for a legacy record. `offerResume` holds this same object in its click handler,
  // so without this a second click mints a SECOND id, finds no live slot, and starts a second
  // session resuming the SAME `sdkSessionId`. In-memory only — nothing persists `rec`.
  rec.agentId = agentId;
  // ⚠ The record's OWN slot, all three parts. Re-deriving the key from (channel, thread) alone
  // resumes onto a DIFFERENT session from the one that crashed — which under multiplayer
  // (2026-08-21) is not an edge case but the normal shape: a thread routinely holds several of
  // this operator's agents, and only `rec.agentId` says which one this record is.
  const slot = { channelId: rec.channelId, taskId: rec.taskId, agentId: agentId };
  if (deps.hasLiveSession(slot)) return false;
  // ── ⚠ THE CONCURRENCY CEILING APPLIES TO A RESUME TOO (2026-08-22, F-272) ────────────────
  //
  // ⚠ IT DID NOT, AND THE GAP WAS EXACTLY ONE SESSION WIDE. This function guarded
  // `hasLiveSession(slot)` — "is THIS slot taken" — and never `liveCount`, so a machine sitting
  // at all six could resume a seventh. Two producers could reach it: the startup crash scan's
  // opt-in notification (`offerResume`, which the operator can click at any moment, including
  // one when six agents are already running) and the sign-in relaunch path behind it.
  //
  // ⚠ ENFORCED RATHER THAN DOCUMENTED AS HEADROOM, and the choice was deliberate. The argument
  // for +1 is that a resume RESTORES work the operator already started, so it is not new load —
  // but `MAX_CONCURRENT_SESSIONS` IS A COST CEILING, not only a concurrency one (INVARIANTS §11:
  // the narration ring, the pending-inbound queue, the gated-body ledger and the retained-ended
  // set are each N times it), and a resumed session costs a full `claude` child exactly like a
  // fresh one. A documented +1 is also not a bound: nothing stops a second crash record being
  // resumed at 7, then 8 — the guard that was missing is the only thing that ever said no.
  // ⚠ AND SAMUEL RULED THE NUMBER STAYS AT SIX for the multi-machine wave. Letting one lane
  // quietly exceed it is that ruling being overridden by an omission.
  //
  // ⚠ THE REFUSAL SHAPE IS THIS FUNCTION'S EXISTING `false`, and the VOCABULARY is `launch()`'s
  // `cap` — said in the log rather than returned, because `startResume` answers a boolean and
  // widening it to a skip shape would change a contract two callers read for no gain. The
  // operator's notification click simply does not resume, which is what `false` already means
  // for every other refusal here.
  if (sessionWindowless.liveCount(deps.sessions) >= sessionWindowless.MAX_CONCURRENT_SESSIONS) {
    diag('session-park: resume refused — cap', `(${sessionWindowless.MAX_CONCURRENT_SESSIONS} live)`);
    return false;
  }
  // ⚠ THE SAME RESUME REFUSAL AS `resumeParked`, AT THE OTHER RESUME SHAPE (2026-08-31). This one
  // rebuilds the session from the DURABLE RECORD, so the runtime comes off `rec.runtimeId`
  // (`session-store.js › durableSessionRecord`) rather than off a live object. `false` is this
  // function's existing refusal shape and the notification click simply does not resume —
  // widening it would change a contract two callers read, for no gain.
  const resumeRefusal = runtimeCapability.resumeRefusal(runtimeRegistry.descriptorFor(rec.runtimeId));
  if (resumeRefusal) {
    diag('session-park: resume refused —', resumeRefusal);
    return false;
  }
  let rt;
  try { rt = await deps.acquireRuntime(rec.runtimeId); } catch (_) { return false; }
  // ⚠ Re-check AFTER the await: a reopen shell or racing launch may have created this slot
  // during the runtime probe, and startSession would overwrite the Map entry and orphan that window.
  if (deps.hasLiveSession(slot)) return false;
  // ⚠ AND THE CAP AFTER IT TOO, for the same reason `launch()` re-checks its slot: acquiring the
  // runtime is wide enough for a peer wake or the operator's own button to have taken the last slot.
  if (sessionWindowless.liveCount(deps.sessions) >= sessionWindowless.MAX_CONCURRENT_SESSIONS) {
    diag('session-park: resume refused — cap (taken during the runtime probe)');
    return false;
  }
  const s = await deps.startSession({
    key: store.slotKey(slot),
    channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId,
    // ⚠ A resumed session keeps its AGENT INSTANCE ID, else it comes back as a stranger:
    // a different slot, a different pill, a different @-mention address, and every message
    // already addressed to the old id would stop reaching it.
    agentId: agentId, bind: rec.bind === 'room' ? 'room' : 'pair',
    // ⚠ FAIL RESTRICTIVE. A raw stored profile lets a missing /
    // corrupt / future-version value fall through normalizeProfile's global fallback and resume
    // at FULL access — the most permissive profile, from the least trustworthy input.
    side: rec.side, profile: knownProfile(rec.profile), mode: rec.mode,
    // ⚠ A RESUMED SESSION IS WINDOWLESS, AND SAYING SO IS LOAD-BEARING (2026-08-22). It used to
    // pass nothing, so `spec.windowless` was undefined on every crash resume: the credential
    // preflight's ROLLBACK branch (`startSession`: `spec.windowless && holdIfNoCredential`) could
    // not fire, and — the symptom that was actually reached — `startSession`'s AXIS B floor did
    // not apply, so the session came back at the reducer's `ask` on a shape with NO ACCEPT
    // SURFACE. `session-gate.js › enqueue` then HELD the peer's next reply with nothing left able
    // to release it (F-236, from the one lane that never derived its own posture).
    // ⚠ IT IS NOT A POSTURE AND MUST NOT BECOME ONE: H2 still forbids a resume handing in
    // `startModes`, and this passes none — the floor is a fact about having no surface, applied
    // by the construction site to whatever the reducer's defaults were.
    windowless: true,
    counterpartyId: rec.counterpartyId || null, direct: rec.direct === true, // L1 binding + the DM flag
    context: contextFromRecord(rec), rawFirstTurn, resumeSdkId: sdkSessionId,
    // ⚠ Rehydrate the running cap budget. Without both counters a
    // session that burned 23 of 24 turns, crashed and was resumed starts again at zero, so
    // every crash+resume mints a fresh turn AND cost budget.
    turns: rec.turns, costUsd: rec.costUsd,
    // ⚠ AND THE OUTBOUND POST COUNTER, for the same class of reason and a different symptom
    // (2026-08-22). `session-outbound-tag.js › nextOwnPostId` stamps every post
    // `agent-<agentId>-<n>` and `n` counts from `s.ownPostSeq` — which `startSession` used to
    // initialise at 0 on EVERY session object while the agent id is persisted and re-used right
    // above. A crash+resume therefore re-minted `agent-<id>-1, 2, …`: client_msg_ids the server
    // already stored before the crash, so its idempotency short-circuit SILENTLY DISCARDED the
    // resumed agent's replies and answered the old rows. `startSession` adds slack on top of
    // this; see its `ownPostSeq` line.
    ownPostSeq: rec.ownPostSeq,
    model: rec.model, // the operator's model pick, coerced by startSession
  }, rt);
  return !!s;
}

async function resume(rec, sdkSessionId) { // opt-in resume from the interrupted notice
  const nudge = 'The session was resumed after an interruption. Continue where you left off and await the next channel reply.';
  return startResume(rec, sdkSessionId, nudge);
}

// ⚠ A peer reply NEVER resumes a session on its own. session-dispatch routes it to the engine's
// inbound gate, which recreates a parked shell and HOLDS the reply for the operator's Accept;
// the accept then takes the ordinary lazy-resume path above.

// ─── END SESSION-PARK-PURE ────────────────────────────────────────────────────────

module.exports = {
  bind,
  resumeParked,
  offerResume,
  startResume,
  resume,
};
