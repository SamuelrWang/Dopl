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
const { diag } = require('./diag');

// ─── BEGIN SESSION-PARK-PURE (injectable; unit-tested via source extraction) ──────

let deps = null;

// The engine binds its internals here at load (sessions, getSdk, buildSdkOptions, consume,
// dispatch, startSession, hasLiveSession, windowFactoryReady, atWindowCap, loadHistory,
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

// The reopenByTask fallback: no live session for (channel,task), so recreate a PARKED SHELL in
// the registry from the durable record. startSession opens a fresh window and leaves the
// session dormant until a lazy wake. One shell per key — startSession sets the Map entry
// synchronously before its first await, so a rapid second call sees it and opens no second
// window. A retained sdkSessionId is NOT required: a record with no resumable sdk session still
// opens, shows the channel history, and starts a FRESH seeded session on the first typed turn.
async function recreateParkedShell(a) {
  if (!deps || !deps.windowFactoryReady()) return { ok: false };
  // ⚠ The record's OWN slot, exactly as startResume resolves it. Keying on (channel, thread)
  // alone looks a TEAM record (agentId set, taskId '') up under `channelId + ':'`, where its
  // record was never written — and can collide with a real thread's record. slotKey is
  // byte-for-byte sessionKey(channelId, taskId) when no agentId is present.
  const key = store.slotKey(a);
  const existing = deps.sessions.get(key);
  if (existing && !existing.settled) return { ok: true };
  const rec = store.getRecord(key);
  const sdkId = store.getSdkSessionId(key);
  // No durable record + an operator CLICK (`fromChannel`) => build the shell from the CHANNEL.
  // ⚠ The INBOUND GATE deliberately does NOT pass that flag: a peer whose thread has no record
  // here must never pop a window on this Mac.
  if (!rec && a && a.fromChannel === true) return openFromChannel(a, key);
  if (!rec) return { ok: false };
  // ⚠ Same shared window budget launch() / openConsentWindow() enforce; at the cap, free one
  // slot first, then fail restrictive.
  if (atCapAfterEvict()) return { ok: false, reason: 'busy' };
  const s = await deps.startSession({
    key, channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId,
    // ⚠ FAIL RESTRICTIVE: a missing/unknown stored profile resumes read_only, never the
    // permissive `full` normalizeProfile would pick.
    side: rec.side, profile: knownProfile(rec.profile), mode: rec.mode,
    // ⚠ A reopened TEAM record must come back AS its agent with its room binding, or the shell
    // re-keys onto the thread slot and its next saveRecord erases the record's agent identity.
    agentId: rec.agentId || null, bind: rec.bind === 'room' ? 'room' : 'pair',
    counterpartyId: rec.counterpartyId || null, direct: rec.direct === true, // L1 binding + the DM flag the outbound card names from
    context: contextFromRecord(rec), resumeSdkId: sdkId || null,
    // Rehydrate the running cap budget so a turn/cost-capped session continues from where it
    // capped instead of getting a fresh budget.
    turns: rec.turns, costUsd: rec.costUsd,
    // The operator's model pick. Not a widening — a model is not a permission and reaches no
    // gate — so unlike a posture it rides every recreate. startSession coerces it against the
    // frozen enum, so a corrupt record reopens on the CLI default, never on junk.
    model: rec.model,
    parkedShell: true, // window opens, NO query starts (lazy resume)
  }, null);
  if (!s) return { ok: false };
  // ⚠ Record the body that POPPED this gate BEFORE the read. The listener advanced its cursor
  // past that message, so the fetch window always contains it; recording here keeps it out of
  // BOTH the rendered history and the fresh run's seed, so it appears exactly once — as the
  // actionable Accept/Decline card. Idempotent with session-gate.enqueue's own noteGatedBody.
  if (a && a.holdBody) io.noteGatedBody(s, a.holdBody);
  // ⚠ AWAITED, not fire-and-forget: unawaited, an operator who types first gets a cold fresh
  // run with the thread arriving as turn 2 BELOW their own bubble, and a fetch resolving after
  // a racing system/init drops the seed. A failed fetch is one calm notice. Guarded so a
  // mid-wave engine that has not wired it opens the shell as before.
  if (deps.loadHistory) {
    try { await deps.loadHistory(s); } catch (_) { /* calm: the shell carries on */ }
  }
  return { ok: true };
}

// The RECORD-LESS shell. Everything a durable record would carry is resolved from the channel
// (channel-context.resolve, injected): workspace, header name, and — for a DIRECT channel ONLY
// — the counterparty the L1 binding and the history lanes need. ⚠ A group channel resolves no
// counterparty and that null passes through unchanged; the shell is never bound to a guess.
// ⚠ FAIL RESTRICTIVE: no record means no stored profile, so knownProfile(undefined) resolves
// READ_ONLY. `side` is 'requester' — the operator opened this window, so what they type is
// their own goal. NO query runs (parkedShell), so opening posts nothing: no session record the
// peer can see, no lifecycle event, no task_started.
async function openFromChannel(a, key) {
  if (!deps.resolveChannelContext) return { ok: false }; // mid-wave engine: fail closed
  if (atCapAfterEvict()) return { ok: false, reason: 'busy' }; // the SAME shared window budget
  const channelId = String((a && a.channelId) || '');
  const ctx = await deps.resolveChannelContext(channelId);
  if (!ctx || !ctx.workspaceId) return { ok: false, reason: 'no-thread' };
  if (deps.hasLiveSession({ channelId, taskId: String((a && a.taskId) || '') })) return { ok: true };
  const s = await deps.startSession({
    key, channelId, taskId: String((a && a.taskId) || ''), workspaceId: ctx.workspaceId,
    side: 'requester', profile: knownProfile(undefined), mode: 'interactive',
    counterpartyId: ctx.counterpartyId || null, direct: ctx.direct === true, // channel-context reads is_direct off the DTO
    context: { channelName: ctx.channelName || null, taskTitle: null, authorName: ctx.counterpartyName || null,
      channelId: channelId, workspaceId: ctx.workspaceId },
    resumeSdkId: null, turns: 0, costUsd: 0,
    parkedShell: true, // the window opens; the agent starts on the first typed turn
  }, null);
  if (!s) return { ok: false };
  if (deps.loadHistory) {
    try { await deps.loadHistory(s); } catch (_) { /* calm: the shell carries on */ }
  }
  return { ok: true };
}

// ── THE REQUEST LIFECYCLE STRIP ──────────────────────────────────────────────────
// What happened to the request the operator sent, as one line in the window chrome. Every state
// is read off events ALREADY on the wire and none starts anything: 'sent' when the window
// opens, the peer's task_started is 'accepted', a task_failed carrying the calm `declined` flag
// is 'declined', the peer's first reply is 'replied'. ⚠ Rides the session object and leaves as
// a DISPLAY payload, never a reducer event, so nothing here can wake a parked shell, push a
// turn or resolve a permission.
// It exists because the session cannot answer this: Accept and Decline arrive as task_started /
// task_failed MILESTONES, and every listener route gates on kind === 'message'.
//
// ⚠ MONOTONIC, never a downgrade. Messages are read a page at a time, so an out-of-order
// task_started must not walk the strip back from "Reply received". Only a strictly higher rank
// paints.
// ⚠ ARMED, NOT AMBIENT. `requestStatus` is set ONLY by armRequestStatus, whose one caller is
// the requester route's `desktop-ui` arm — every other session reads undefined and notes
// nothing. That is what keeps the line meaning "the request I typed".
const REQUEST_STATUS_RANK = { sent: 0, accepted: 1, declined: 2, replied: 3 };

// Rank of a status word, else undefined. ⚠ OWN-PROPERTY check, never a bare index: a plain
// object literal answers a FUNCTION for 'constructor' / 'toString', which is neither undefined
// nor `<=` any number, so both would pass the monotonic guard and stamp themselves on the strip.
function requestRank(status) {
  if (typeof status !== 'string') return undefined;
  return Object.prototype.hasOwnProperty.call(REQUEST_STATUS_RANK, status) ? REQUEST_STATUS_RANK[status] : undefined;
}

// Open the strip at 'sent' on the session in this (channel, thread) slot. SLOT-KEYED because
// the caller is the listener route, which has the slot and not the registry entry. TRUE only
// when a strip was actually armed — ⚠ re-arming would walk an 'accepted' line back to 'sent' on
// a message read twice.
function armRequestStatus(a) {
  if (!deps || !deps.sessions) return false;
  const key = store.sessionKey(String((a && a.channelId) || ''), String((a && a.taskId) || ''));
  const s = deps.sessions.get(key);
  if (!s || s.settled) return false;
  if (requestRank(s.requestStatus) !== undefined) return false;
  s.requestStatus = 'sent';
  deps.emit(s, { type: 'request_status', status: 'sent' });
  return true;
}

// Advance the strip on a session that has one. TRUE only when it moved; an unarmed session, a
// settled one, an unknown status and a backwards one all answer false and change nothing.
function noteRequestStatus(a, status) {
  if (!deps || !deps.sessions) return false;
  const next = requestRank(status);
  if (next === undefined) return false;
  const key = store.sessionKey(String((a && a.channelId) || ''), String((a && a.taskId) || ''));
  const s = deps.sessions.get(key);
  if (!s || s.settled) return false;
  const now = requestRank(s.requestStatus);
  if (now === undefined || next <= now) return false;
  s.requestStatus = status;
  deps.emit(s, { type: 'request_status', status });
  return true;
}

// Shared cap-relief check: TRUE when the window budget is still spent after an eviction
// attempt, so every caller keeps its fail-restrictive skip. ⚠ Must be called by launch() and
// openConsentWindow() as well as recreateParkedShell — a recreated shell never leaves the
// registry on its own, and the gate creates shells from an inbound message alone, so a handful
// of peer replies to old tasks can own the whole budget permanently and starve real triggers
// down to headless. Not at the cap => no eviction attempted at all.
function atCapAfterEvict() {
  if (!deps || !deps.atWindowCap || !deps.atWindowCap()) return false;
  if (!evictIdleShell()) return true;
  return deps.atWindowCap() === true;
}

// Free ONE window slot by settling the least-recently-created PARKED shell the operator never
// interacted with. The evicted task stays fully reopenable (durable record survives, settle
// retains the sdkSessionId for every outcome but completed/failed), so this drops a dormant
// window, never a conversation. ⚠ NEVER takes a shell that is live, is holding an inbound card,
// or that the operator has touched (session-ipc stamps operatorTouched on every renderer-driven
// handler).
// ⚠ MUST go through the REDUCER (`dispatch({type:'inactive'})`), never `deps.settleSession` —
// settle is teardown only, runs no reducer and emits no lifecycle, so an eviction would post
// NOTHING and leave the requester on the other machine watching "Working…" forever. The
// `inactive` event runs the ordinary endEffects set: abort, calm task_progress note, `ended`
// emit, then settle.
function evictIdleShell() {
  if (!deps || !deps.sessions || !deps.dispatch) return false;
  let victim = null;
  for (const s of deps.sessions.values()) {
    if (!s || s.settled || !s.state) continue;
    if (s.state.parked !== true) continue; // only a dormant shell is evictable
    if (s.operatorTouched === true) continue; // never close a window the operator used
    // ⚠ Nor one with ANY unanswered message: the head's card (hasPendingInbound) or a reply
    // queued behind it. The queue is memory-only, so evicting loses them.
    if (s.state.hasPendingInbound === true) continue;
    if (s.pendingInbound && s.pendingInbound.length) continue;
    if (!victim || (s.startedAt || 0) < (victim.startedAt || 0)) victim = s;
  }
  if (!victim) return false;
  diag('session-park: evicting an untouched parked shell for the window budget');
  try { deps.dispatch(victim, { type: 'inactive' }); } catch (err) {
    diag('session-park: evict failed', err && err.message);
    return false;
  }
  return true;
}

// Paint a recreated parked shell. No SDK system/init lands (no query runs), so the init the
// renderer needs is synthesized from the durable record. textContent-only, plain copy.
function emitParkedShell(s) {
  deps.emit(s, {
    type: 'init', sessionId: s.sessionId, side: s.side, profile: s.profile, mode: s.mode,
    profileLabel: s.profileLabel || null, model: null, channelName: (s.context && s.context.channelName) || null,
    // Same identity a live system/init would carry (contextFromRecord restored it).
    taskTitle: (s.context && s.context.taskTitle) || null,
    from: s.counterpartyName || null, selfAvatar: s.selfAvatar || null,
    fromAvatar: s.peerAvatar || null, cwdLabel: null,
  });
  // ⚠ The `bind !== 'room'` guard is UNREACHABLE today (nothing constructs a room-bound
  // session) and stays anyway: the room-vs-pair SLOT SHAPE deliberately survived the channels
  // rollback as inert scaffolding (ENGINEERING §18), and deleting the guard is the one edit
  // that makes the shape wrong the day anything sets it again. Read as "the pair case, stated
  // by exclusion", not live routing. A room shell is not a REOPEN — nothing was interrupted.
  if (s.bind !== 'room') deps.emit(s, { type: 'notice', level: 'info', text: 'Reopened. Nothing is running yet, so send a message to continue.' });
  deps.emit(s, { type: 'status', phase: 'parked' });
}

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
  // ⚠ The record's OWN slot. A team record carries an agentId and an empty taskId, so
  // re-deriving the key from (channel, task) resumes it onto the THREAD slot — a different
  // session from the one that crashed. slotKey is byte-for-byte sessionKey(channelId, taskId)
  // when there is no agentId.
  const slot = { channelId: rec.channelId, taskId: rec.taskId, agentId: rec.agentId || null };
  if (!deps.windowFactoryReady() || deps.hasLiveSession(slot)) return false;
  let sdk;
  try { sdk = await deps.getSdk(); } catch (_) { return false; }
  // ⚠ Re-check AFTER the await: a reopen shell or racing launch may have created this slot
  // during getSdk, and startSession would overwrite the Map entry and orphan that window.
  if (deps.hasLiveSession(slot)) return false;
  const s = await deps.startSession({
    key: store.slotKey(slot),
    channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId,
    // ⚠ A resumed TEAM session keeps its identity and room binding, else it returns as a
    // pair-bound responder with no agent to post as.
    agentId: rec.agentId || null, bind: rec.bind === 'room' ? 'room' : 'pair',
    // ⚠ FAIL RESTRICTIVE, matching recreateParkedShell. A raw stored profile lets a missing /
    // corrupt / future-version value fall through normalizeProfile's global fallback and resume
    // at FULL access — the most permissive profile, from the least trustworthy input.
    side: rec.side, profile: knownProfile(rec.profile), mode: rec.mode,
    counterpartyId: rec.counterpartyId || null, direct: rec.direct === true, // L1 binding + the DM flag
    context: contextFromRecord(rec), rawFirstTurn, resumeSdkId: sdkSessionId,
    // ⚠ Rehydrate the running cap budget like recreateParkedShell does. Without both counters a
    // session that burned 23 of 24 turns, crashed and was resumed starts again at zero, so
    // every crash+resume mints a fresh turn AND cost budget.
    turns: rec.turns, costUsd: rec.costUsd,
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
  recreateParkedShell,
  openFromChannel, // record-less shell (exported for the test; recreateParkedShell is the caller)
  armRequestStatus, // lifecycle strip, opened at 'sent' by the requester route
  noteRequestStatus, // ...and advanced by the listener's wire observations
  evictIdleShell, // LRU relief for the shared window budget
  atCapAfterEvict, // the engine's launch / openConsentWindow cap branches use it too
  emitParkedShell,
  offerResume,
  startResume,
  resume,
};
