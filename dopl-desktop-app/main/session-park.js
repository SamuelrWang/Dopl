// session-park.js — idle-park + resume machinery.
//
// Leaf deps (io / store / diag / Notification) required at the top; ENGINE handles (live
// registry, SDK loader, option assembly, consumer loop, dispatch, startSession) injected via
// bind(). The BEGIN/END PURE block references those as free vars, so
// test/session-park.test.mjs slices it and drives it with fakes.
//
// ⚠ SECURITY: parked resume and recreated-shell resume BOTH assemble SDK options through the
// engine's OWN buildSdkOptions — the SAME path a fresh launch uses (allowedTools shadow rule,
// canUseTool gate, scrubbed env, disallowedTools, settingSources:[], permissionMode 'default').
// NO divergent option assembly, NO new auto-approval; `options.resume = retained sdkSessionId`
// is the only difference from a cold launch. feedInbound stays bound to the stored counterparty.

const io = require('./session-io');
const store = require('./session-store');
const { Notification } = require('electron');
const { newAgentId, isAgentId } = require('./agent-id'); // one random id per INSTANCE
const { diag } = require('./diag');

// ─── BEGIN SESSION-PARK-PURE (injectable; unit-tested via source extraction) ──────

let deps = null;

// The engine binds its internals here at load (sessions, getSdk, buildSdkOptions, consume,
// dispatch, startSession, hasLiveSession,
// settleSession). Read at CALL time, so bind order at module load does not matter.
function bind(d) {
  deps = d || null;
}

// ⚠ Profiles a persisted record may legitimately carry. Anything else (missing, corrupt, from a
// future version) recreates as read_only — fail restrictive.
const KNOWN_PROFILES = new Set(['full', 'dopl_only', 'read_only']);

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
function contextFromRecord(rec) {
  const r = rec || {};
  return {
    channelName: r.channelName || null,
    taskTitle: r.taskTitle || null,
    authorName: r.counterpartyName || null,
    channelId: r.channelId || null,
    workspaceId: r.workspaceId || null,
  };
}

// Resume a PARKED session IN PLACE: the session object survived park (registry entry and
// window alive), only its live SDK query was torn down.
// ⚠ Rebuild the abort controller + push iterator SYNCHRONOUSLY so the pushInbound / pushTurn
// effect the reducer queues right after lands on the FRESH iterator. resumeSdkId feeds
// options.resume, continuing the SAME sdk session.
function resumeParked(s) {
  if (!deps || !s || s.settled || s.resuming) return;
  s.resuming = true;
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
  // ⚠ ASSUMPTION: the SDK restarts total_cost_usd from 0 on a resumed query, so resetting the
  // delta baseline preserves the running cap total in state.costUsd (the cap keeps enforcing
  // across park AND crash/resume). Revisit if the SDK ever continues the cumulative total.
  s.lastTotalCost = 0;
  // ⚠ THE SAME ASSUMPTION, THE SAME RESET, ONE LINE APART ON PURPOSE. `result.usage` restarts
  // from zero on the resumed query exactly like `total_cost_usd`, so its delta baseline drops
  // here too; `s.tokensSpent` (the accumulated figure the Agents tab shows) is deliberately NOT
  // touched — it is the lifetime spend and a park is not a new agent.
  s.lastTotalTokens = 0;
  startResumedConsumer(s);
}

async function startResumedConsumer(s) {
  let sdk;
  try {
    sdk = await deps.getSdk();
  } catch (err) {
    diag('session-park: resume sdk unavailable', err && err.message);
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
    const q = sdk.query({ prompt: s.pushIterator, options: deps.buildSdkOptions(s) });
    s.query = q;
    s.resuming = false;
    deps.consume(s, q); // fire-and-forget consumer loop
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
  let sdk;
  try { sdk = await deps.getSdk(); } catch (_) { return false; }
  // ⚠ Re-check AFTER the await: a reopen shell or racing launch may have created this slot
  // during getSdk, and startSession would overwrite the Map entry and orphan that window.
  if (deps.hasLiveSession(slot)) return false;
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
  }, sdk);
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
