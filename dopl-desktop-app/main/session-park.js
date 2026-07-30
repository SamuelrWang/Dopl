// session-park.js — idle-park + resume machinery (v1.7.4 Session Window, Track D).
//
// Extracted from session-engine.js to hold that AT-CAP file (§O-7 / F-09c) under the
// 500-line cap while P1 (idle parks) + P2 (reopen fallback) add resume paths. Leaf
// deps (io / store / diag / Notification) are required at the top exactly like
// session-dispatch.js; the ENGINE-specific handles (the live registry, the SDK loader,
// the shared option assembly, the consumer loop, dispatch, startSession) are injected
// via bind(). The BEGIN/END PURE block references those as free vars, so
// test/session-park.test.mjs slices it, proves it is electron/require-free, and drives
// it with fakes — pinning the resume/recreate contract without an electron require.
//
// SECURITY: a parked resume and a recreated-shell resume BOTH assemble their SDK
// options through the engine's OWN buildSdkOptions (deps.buildSdkOptions) — the SAME
// path a fresh launch uses (allowedTools shadow rule, canUseTool gate, scrubbed env,
// disallowedTools, settingSources:[], permissionMode 'default'). There is NO divergent
// option assembly and NO new auto-approval; options.resume = the retained sdkSessionId
// is the only difference from a cold launch. feedInbound stays bound to the stored
// counterparty (a recreated shell restores counterpartyId from the durable record).

const io = require('./session-io');
const store = require('./session-store');
const { Notification } = require('electron');
const { diag } = require('./diag');

// ─── BEGIN SESSION-PARK-PURE (injectable; unit-tested via source extraction) ──────

let deps = null;

// The engine binds its internals here at load (sessions, getSdk, buildSdkOptions,
// consume, dispatch, startSession, hasLiveSession, windowFactoryReady, atWindowCap,
// loadHistory, settleSession). The functions below read them at CALL time, so bind order
// at module load does not matter.
function bind(d) {
  deps = d || null;
}

// FIX #8: profiles a persisted record may legitimately carry. Anything else (missing,
// corrupt, or from a future version) recreates as read_only — fail restrictive.
const KNOWN_PROFILES = new Set(['full', 'dopl_only', 'read_only']);

function knownProfile(p) {
  return KNOWN_PROFILES.has(p) ? p : 'read_only';
}

// v1.7.5 D1: rebuild the session CONTEXT from a durable record. A recreate/resume used
// to pass context:{}, so the reopened window lost its identity (no peer name, no channel,
// no task title) and the header fell back to a bare "Session". The record now persists
// those three fields (session-io.baseRecord + the store whitelist), so the shape the
// engine reads is restored verbatim: `authorName` is the field startSession derives
// counterpartyName from, so the peer name survives a reopen too. Display-only strings —
// they never re-enter the prompt (a resume passes its own rawFirstTurn).
//
// v2.x: the two ID fields are the exception — channelId / workspaceId (already on the
// durable record at the record level) ARE prompt input, because a recreated shell with
// nothing to resume builds its first turn from this context (io.takeFraming ->
// prompt-framing.deliverySection), and without them the reopened session was told the
// channel's display name only and could not address dopl_channel.
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

// P1 — resume a PARKED session IN PLACE. The session object survived park (still in
// the registry, window alive); only its live SDK query was torn down. Rebuild the
// abort controller + push iterator SYNCHRONOUSLY here so the pushInbound / pushTurn
// effect the reducer queues right after this one lands on the FRESH iterator (a push
// queues until the async consumer attaches). resumeSdkId feeds options.resume, so the
// run continues the SAME sdk session; lastTotalCost resets to 0 because the resumed
// query counts its own cost from 0 (state.costUsd carries the running cap total).
function resumeParked(s) {
  if (!deps || !s || s.settled || s.resuming) return;
  s.resuming = true;
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  s.resumeSdkId = s.sdkSessionId || s.resumeSdkId || null;
  // FIX #2: a resumed query mints a FRESH sdkSessionId at its own system/init. Drop the
  // old one now so a pre-init crash's lifecycle clientMsgId falls back to the (distinct
  // per session-object) sessionId, not the prior cycle's sdk id — which would collide with
  // the prior cycle's terminal event and hide a post-cap crash.
  s.sdkSessionId = null;
  // FIX #1b: SYNCHRONOUSLY supersede the torn-down query's consume loop. Its `s.query !== q`
  // guard now trips, so a late non-abort rejection from the OLD query cannot crash this
  // freshly-resumed session (its own new query is attached below, post-await).
  s.query = null;
  // FIX #10: ASSUMPTION — the SDK restarts total_cost_usd from 0 on a resumed query, so
  // resetting the delta baseline here preserves the running cap total carried in
  // state.costUsd (the cap keeps enforcing across park cycles). Revisit if the SDK ever
  // continues the cumulative total across a resume.
  s.lastTotalCost = 0;
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

// P2 — the reopenByTask fallback: no live session exists for (channel,task), so
// recreate a PARKED SHELL in the registry from the durable record. startSession opens a
// fresh window, shows a one-line note, and leaves the session dormant until a lazy wake
// (P1). One shell per key: a Map hit (a shell from a prior click) returns ok:true
// WITHOUT a second window — startSession sets the Map entry synchronously before its
// first await, so a rapid second call sees it.
//
// v2.5 D3 (ALWAYS-OPEN WINDOW): a retained sdkSessionId is NO LONGER required. A record
// with no resumable sdk session still opens — it shows the channel history (deps.
// loadHistory) and, when the operator types, starts a FRESH session for the task seeded
// with that history as fenced context (session-history + io.withSeed). Only a task with
// NO durable record at all returns {ok:false}: nothing about it lives on this machine.
async function recreateParkedShell(a) {
  if (!deps || !deps.windowFactoryReady()) return { ok: false };
  const key = store.sessionKey(String((a && a.channelId) || ''), String((a && a.taskId) || ''));
  const existing = deps.sessions.get(key);
  if (existing && !existing.settled) return { ok: true };
  const rec = store.getRecord(key);
  const sdkId = store.getSdkSessionId(key);
  if (!rec) return { ok: false };
  // FIX #4: apply the SAME shared window budget launch()/openConsentWindow() enforce
  // (sessions + open consent windows vs MAX_WINDOWS) — a reopen must not blow the cap.
  // FIX #7: at the cap, try to FREE one slot first. A recreated shell never leaves the
  // registry on its own (only settle / a window-factory failure delete it) and the gate
  // now creates shells from an inbound message alone, so six peer replies to six old
  // tasks used to own the whole budget permanently — after which launches and consent
  // windows degraded to cap-skips. evictIdleShell settles the oldest dormant shell the
  // operator never touched (LRU by creation, never one holding a card). FAIL RESTRICTIVE:
  // if nothing is evictable, or the cap still holds after it, the reopen is refused.
  if (deps.atWindowCap && deps.atWindowCap()) {
    if (!evictIdleShell()) return { ok: false };
    if (deps.atWindowCap()) return { ok: false };
  }
  const s = await deps.startSession({
    key, channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId,
    // FIX #8: a shell recreated purely from a persisted record must FAIL RESTRICTIVE —
    // a missing/unknown stored profile resumes as read_only, never the permissive
    // `full` that normalizeProfile would pick (its global fallback is unchanged).
    side: rec.side, profile: knownProfile(rec.profile), mode: rec.mode,
    counterpartyId: rec.counterpartyId || null, // FIX L1: keep the feed counterparty-bound
    context: contextFromRecord(rec), resumeSdkId: sdkId || null, // D1: restore the header identity
    // FIX #9: rehydrate the running cap budget so a turn/cost-capped session reopened via
    // P2 continues from where it capped instead of getting a fresh budget.
    turns: rec.turns, costUsd: rec.costUsd,
    parkedShell: true, // startSession opens the window but starts NO query (lazy resume)
  }, null);
  if (!s) return { ok: false };
  // FIX F4: record the body that POPPED this gate on the shell BEFORE the read. The
  // listener advanced its cursor to that message's seq before dispatching it, so the
  // fetch window always contains it — recording it here keeps it out of BOTH the rendered
  // history (session-history filters the entries) and the fresh run's seed (io.withSeed),
  // so it appears exactly once: as the actionable Accept / Decline card. Idempotent with
  // session-gate.enqueue's own noteGatedBody.
  if (a && a.holdBody) io.noteGatedBody(s, a.holdBody);
  // D3: paint the channel history into the empty replay ring. FIX F3: this is AWAITED, not
  // fire-and-forget. Unawaited, an operator who typed first got a cold fresh run and saw
  // the thread arrive as turn 2 BELOW their own bubble, and a fetch that resolved after a
  // racing system/init dropped the seed on the floor. A failed fetch still just shows one
  // calm notice. Guarded so a mid-wave engine that has not wired it opens the shell as before.
  if (deps.loadHistory) {
    try { await deps.loadHistory(s); } catch (_) { /* calm: the shell carries on */ }
  }
  return { ok: true };
}

// FIX #7 — free ONE window slot by settling the least-recently-created PARKED shell the
// operator never interacted with. A settled parked record keeps its phase ('parked' via
// the persist effect) and its sdkSessionId, so the evicted task stays fully reopenable —
// this drops a dormant window, never a conversation. NEVER takes a shell that is live, is
// holding an inbound card, or that the operator has touched (session-ipc stamps
// operatorTouched on every renderer-driven handler). Returns false when nothing qualifies.
function evictIdleShell() {
  if (!deps || !deps.sessions || !deps.settleSession) return false;
  let victim = null;
  for (const s of deps.sessions.values()) {
    if (!s || s.settled || !s.state) continue;
    if (s.state.parked !== true) continue; // only a dormant shell is evictable
    if (s.operatorTouched === true) continue; // never close a window the operator used
    // Nor one with ANY unanswered message on it: the head's card (hasPendingInbound) or a
    // reply queued behind it. The queue is memory-only, so evicting would lose them.
    if (s.state.hasPendingInbound === true) continue;
    if (s.pendingInbound && s.pendingInbound.length) continue;
    if (!victim || (s.startedAt || 0) < (victim.startedAt || 0)) victim = s;
  }
  if (!victim) return false;
  diag('session-park: evicting an untouched parked shell for the window budget');
  try { deps.settleSession(victim, 'interrupted'); } catch (err) {
    diag('session-park: evict failed', err && err.message);
    return false;
  }
  return true;
}

// P2: paint a recreated parked shell. No SDK system/init lands (no query runs), so we
// synthesize the init the renderer needs from the durable record, drop a one-line note
// pointing at the channel thread, and show the Paused pill. textContent-only, plain copy.
function emitParkedShell(s) {
  deps.emit(s, {
    type: 'init', sessionId: s.sessionId, side: s.side, profile: s.profile, mode: s.mode,
    profileLabel: s.profileLabel || null, model: null, channelName: (s.context && s.context.channelName) || null,
    // D1: the synthesized init carries the SAME identity a live system/init would (the
    // context was restored from the durable record by contextFromRecord).
    taskTitle: (s.context && s.context.taskTitle) || null,
    from: s.counterpartyName || null, selfAvatar: s.selfAvatar || null,
    fromAvatar: s.peerAvatar || null, cwdLabel: null,
  });
  // FIX #14: the old copy ("The earlier transcript is in the channel thread.") now
  // contradicts the window itself — D3 PAINTS that transcript a moment later, so it read
  // as "look elsewhere" directly above the thread. This line states the shell's actual
  // state instead; session-history owns the two cases where no history lands (no bound
  // counterparty / a failed fetch) and says where to read it there.
  deps.emit(s, { type: 'notice', level: 'info', text: 'Reopened. Nothing is running yet, so send a message to continue.' });
  deps.emit(s, { type: 'status', phase: 'parked' });
}

// ── Shared resume machinery (moved verbatim from session-engine.js) ───────────────

// Offer an opt-in resume from the startup interrupted-notice (init crash scan). Never
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
  if (!deps.windowFactoryReady() || deps.hasLiveSession({ channelId: rec.channelId, taskId: rec.taskId })) return false;
  let sdk;
  try { sdk = await deps.getSdk(); } catch (_) { return false; }
  // FIX #7: re-check AFTER the await — a reopen shell (or a racing launch/resume) may have
  // created this (channel,task) during getSdk; bail so startSession does not overwrite the
  // Map entry and orphan that window (startSession sets the Map before its own first await).
  if (deps.hasLiveSession({ channelId: rec.channelId, taskId: rec.taskId })) return false;
  const s = await deps.startSession({
    key: store.sessionKey(rec.channelId, rec.taskId),
    channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId,
    // C7 (MEDIUM-4): FAIL RESTRICTIVE, matching recreateParkedShell. This path passed the
    // stored profile RAW, so a missing / corrupt / future-version value fell through
    // normalizeProfile's global fallback and resumed the session at FULL access — the most
    // permissive profile, from the least trustworthy input (a durable record on disk).
    side: rec.side, profile: knownProfile(rec.profile), mode: rec.mode,
    counterpartyId: rec.counterpartyId || null, // FIX L1: restore the counterparty binding
    context: contextFromRecord(rec), rawFirstTurn, resumeSdkId: sdkSessionId, // D1: restore the header identity
  }, sdk);
  return !!s;
}

async function resume(rec, sdkSessionId) { // opt-in resume from the interrupted notice
  const nudge = 'The session was resumed after an interruption. Continue where you left off and await the next channel reply.';
  return startResume(rec, sdkSessionId, nudge);
}

// v2.5 D1: `resumeRequesterForReply` (the v2.2 item-3 bounded auto-continuation — reopen
// a settled requester and feed the peer's reply as its first turn) is GONE. A peer reply
// no longer resumes anything on its own: session-dispatch routes it to the engine's
// inbound gate, which recreates this same parked shell and HOLDS the reply for the
// operator's Accept. The accept then takes the ordinary lazy-resume path above.

// ─── END SESSION-PARK-PURE ────────────────────────────────────────────────────────

module.exports = {
  bind,
  resumeParked,
  recreateParkedShell,
  evictIdleShell, // FIX #7: LRU relief for the shared window budget
  emitParkedShell,
  offerResume,
  startResume,
  resume,
};
