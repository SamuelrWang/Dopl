// session-park.js — idle-park + resume machinery (v1.7.4 Session Window, Track D).
//
// Extracted from session-engine.js to hold that AT-CAP file (§O-7 / F-09c) under the
// 500-line cap while P1 (idle parks) + P2 (reopen fallback) add resume paths. Leaf
// deps (io / store / diag / crypto / Notification) are required at the top exactly like
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
const crypto = require('crypto');
const { Notification } = require('electron');
const { diag } = require('./diag');

// ─── BEGIN SESSION-PARK-PURE (injectable; unit-tested via source extraction) ──────

let deps = null;

// The engine binds its internals here at load (sessions, getSdk, buildSdkOptions,
// consume, dispatch, startSession, hasLiveSession, windowFactoryReady). The functions
// below read them at CALL time, so bind order at module load does not matter.
function bind(d) {
  deps = d || null;
}

// FIX #8: profiles a persisted record may legitimately carry. Anything else (missing,
// corrupt, or from a future version) recreates as read_only — fail restrictive.
const KNOWN_PROFILES = new Set(['full', 'dopl_only', 'read_only']);

function knownProfile(p) {
  return KNOWN_PROFILES.has(p) ? p : 'read_only';
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
// recreate a PARKED SHELL in the registry if a durable record AND a retained
// sdkSessionId survive. startSession opens a fresh window, shows a one-line note, and
// leaves the session dormant until a lazy wake (P1). One shell per key: a Map hit (a
// shell from a prior click) returns ok:true WITHOUT a second window — startSession sets
// the Map entry synchronously before its first await, so a rapid second call sees it.
// Returns {ok:false} when nothing resumable survives (a truly-closed task).
async function recreateParkedShell(a) {
  if (!deps || !deps.windowFactoryReady()) return { ok: false };
  const key = store.sessionKey(String((a && a.channelId) || ''), String((a && a.taskId) || ''));
  const existing = deps.sessions.get(key);
  if (existing && !existing.settled) return { ok: true };
  const rec = store.getRecord(key);
  const sdkId = store.getSdkSessionId(key);
  if (!rec || !sdkId) return { ok: false };
  // FIX #4: apply the SAME shared window budget launch()/openConsentWindow() enforce
  // (sessions + open consent windows vs MAX_WINDOWS) — a reopen must not blow the cap.
  if (deps.atWindowCap && deps.atWindowCap()) return { ok: false };
  const s = await deps.startSession({
    key, channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId,
    // FIX #8: a shell recreated purely from a persisted record must FAIL RESTRICTIVE —
    // a missing/unknown stored profile resumes as read_only, never the permissive
    // `full` that normalizeProfile would pick (its global fallback is unchanged).
    side: rec.side, profile: knownProfile(rec.profile), mode: rec.mode,
    counterpartyId: rec.counterpartyId || null, // FIX L1: keep the feed counterparty-bound
    context: {}, resumeSdkId: sdkId,
    // FIX #9: rehydrate the running cap budget so a turn/cost-capped session reopened via
    // P2 continues from where it capped instead of getting a fresh budget.
    turns: rec.turns, costUsd: rec.costUsd,
    parkedShell: true, // startSession opens the window but starts NO query (lazy resume)
  }, null);
  return s ? { ok: true } : { ok: false };
}

// P2: paint a recreated parked shell. No SDK system/init lands (no query runs), so we
// synthesize the init the renderer needs from the durable record, drop a one-line note
// pointing at the channel thread, and show the Paused pill. textContent-only, plain copy.
function emitParkedShell(s) {
  deps.emit(s, {
    type: 'init', sessionId: s.sessionId, side: s.side, profile: s.profile, mode: s.mode,
    profileLabel: s.profileLabel || null, model: null, channelName: (s.context && s.context.channelName) || null,
    taskTitle: null, from: s.counterpartyName || null, selfAvatar: s.selfAvatar || null,
    fromAvatar: s.peerAvatar || null, cwdLabel: null,
  });
  deps.emit(s, { type: 'notice', level: 'info', text: 'Reopened. The earlier transcript is in the channel thread.' });
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
    side: rec.side, profile: rec.profile, mode: rec.mode,
    counterpartyId: rec.counterpartyId || null, // FIX L1: restore the counterparty binding
    context: {}, rawFirstTurn, resumeSdkId: sdkSessionId,
  }, sdk);
  return !!s;
}

async function resume(rec, sdkSessionId) { // opt-in resume from the interrupted notice
  const nudge = 'The session was resumed after an interruption. Continue where you left off and await the next channel reply.';
  return startResume(rec, sdkSessionId, nudge);
}

// Item 3 secondary: reopen a SETTLED requester (its sdkSessionId survived an idle /
// interrupt end), resuming with the peer's reply FRAMED — fresh nonce, words stay DATA,
// gated tools still gate on reopen (§H-4).
async function resumeRequesterForReply(rec, sdkSessionId, reply) {
  const nonce = crypto.randomBytes(8).toString('hex');
  return startResume(rec, sdkSessionId, io.frameContinuation(nonce, reply && reply.message, reply && reply.authorName));
}

// ─── END SESSION-PARK-PURE ────────────────────────────────────────────────────────

module.exports = {
  bind,
  resumeParked,
  recreateParkedShell,
  emitParkedShell,
  offerResume,
  startResume,
  resume,
  resumeRequesterForReply,
};
