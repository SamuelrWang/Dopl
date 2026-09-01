// session-query.js — the query LIFECYCLE. ⚠ AND NOTHING ABOUT WHICH PLATFORM IS RUNNING IT.
//
// ⚠ THE OPTION ASSEMBLY LEFT ON 2026-08-31 (runtime-adapter port, steps 3–4). `› buildSdkOptions`
// — every option, every pin, the held gate, the scrubbed env, the deny list — is now the
// ADAPTER's (`main/runtime/claude/launch-spec.js`), and this file no longer knows what is inside
// the object it hands back. What stayed is the discipline that was never platform-shaped: the
// supersede-before-relaunch rule, the loop tagging that makes a superseded consumer inert, the
// launch watchdog, and the auth-hold short circuit.
//
// SECURITY: `buildLaunchSpec` is still the ONE assembly point for every spawn shape (fresh
// launch, parked resume, recreated shell, post-sign-in relaunch). session-park calls it through
// `deps.buildLaunchSpec` and session-auth relaunches through the engine's own `startQuery`, so no
// path anywhere assembles its own spec — which is what makes the pre-approval shadow rule, the
// held gate, the ambient-config isolation and the pinned permission mode hold identically on all
// of them. The conversation id is the only thing that ever differs between cold and resumed.
//
// Leaf deps (io / store / diag / session-auth / the runtime registry) are required at the top
// exactly like session-park.js; the two ENGINE-owned handles this file cannot require —
// `dispatch` and the replay-aware `emitQuiet` — are injected via bind(). None of the modules
// required here require session-engine back, so there is no cycle.

const io = require('./session-io');
const store = require('./session-store');
const { diag } = require('./diag');
const sessionAuth = require('./session-auth');
const sessionCredential = require('./session-credential'); // the container lock (plan §4.4 B1)
const runtimeRegistry = require('./runtime');

let deps = null; // { dispatch, emitQuiet, scheduleIdle }

function bind(d) {
  deps = d || null;
}

/**
 * The OPAQUE launch payload for this session's runtime. ⚠ CORE NEVER LOOKS INSIDE IT — that is
 * the seam, and inspecting it here would put a platform's option vocabulary straight back into
 * the module the extraction removed it from.
 *
 * ⚠ THE ENGINE'S TWO HANDLES RIDE THE REQUEST. The held gate needs the dispatch (to paint a
 * card) and the replay-aware quiet emitter (to resolve one an auto-allowed post painted), and the
 * adapter must not require the engine back.
 */
function buildLaunchSpec(s) {
  return runtimeRegistry.runtimeFor(s.runtimeId).buildLaunchSpec({
    session: s,
    dispatch: deps.dispatch,
    emitQuiet: deps.emitQuiet,
  });
}

// H1 — SUPERSEDE the live query handles without touching lifecycle state. The consume
// loop below is tagged by its own `q`, so nulling `s.query` makes the previous loop inert
// (`s.query !== q` returns immediately, dropping its tail AND any late rejection); the
// abort stops the child process; closing the iterator ends the prompt stream it blocks on.
// Safe on a cold session, where every field is already null.
function abortInFlight(s) {
  try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
  try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
  s.query = null;
}

async function startQuery(s, rt) {
  // H1 (THE TWO-CHILDREN BUG): this used to overwrite s.abortController / s.query with NO
  // teardown of what was already there. A second call therefore left the FIRST child process
  // alive — still holding this session's pre-approved channel access, still able to post into
  // the channel — with nothing left pointing at it to stop it, and s.firstTurn pushed twice.
  // session-auth.resumeAfterSignIn is what made it reachable: a sign-in that lands on a session
  // a peer wake had already resumed, or simply a double-click on the sign-in button. Superseding
  // FIRST makes a relaunch idempotent at this layer, whatever the caller does; a cold launch is
  // unaffected (abortInFlight is a no-op there).
  abortInFlight(s);
  // 🔒 THE CONTAINER LOCK (plan §4.4 B1), minted before the spec is assembled because
  // `buildLaunchSpec` is SYNCHRONOUS and reads the stamp off `s`.
  // ⚠ THERE ARE EXACTLY TWO CALL SITES AND THAT IS NOT AN OVERSIGHT — this one and
  // `session-park.js › startResumedConsumer`. They are the two places a query STARTS: a woken
  // SPAWN-IDLE shell never passes through here (`startSession` returns before `startQuery`, and
  // `wakeEffects` fires `resumeQuery` -> `resumeParked`), so a single site here would leave every
  // woken shell on the unlocked device token. The call is IDEMPOTENT per session — an already
  // stamped session mints nothing — so the pair is safe and a resume of a live session is free.
  // ⚠ `session-audience-ceiling.test.mjs` pins BOTH sites by source scan: deleting either one
  // is silent otherwise, and the half it deletes is a whole spawn shape.
  await sessionCredential.ensureContainerCredential(s, diag);
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  // ⚠ SYNCHRONOUS BY CONTRACT. The handle is assigned to the session IMMEDIATELY; an await
  // between "the child exists" and "something points at it" is the two-children bug above,
  // reintroduced at a different layer.
  const q = rt.start(buildLaunchSpec(s));
  s.query = q;
  s.pushIterator.push(io.userMessage(s.firstTurn));
  // C-4 — ARM THE LAUNCH WATCHDOG. The idle timer used to be armed ONLY by reducer effects
  // that require `launched`, which only the runtime's own init event dispatches — so a child that
  // booted and never emitted one had no timer of any kind: phase 'launching' forever,
  // `hasLiveSession` true, every retry `{skipped:'busy'}`, and its slot spent against
  // MAX_WINDOWS for the life of the process.
  //
  // HERE rather than in startSession, and that is the point of the seam: this is the ONE
  // deferred launch (H1's supersede-before-relaunch), so it covers the cold launch AND
  // session-auth's post-sign-in relaunch, which re-enters with phase reset to 'launching'
  // and would otherwise hang exactly the same way. It is the SAME `scheduleIdle` every other
  // arming site uses — `session-state.idleTimeout` reads the launching phase and answers the
  // launch bound — so there is no second timer to leak and `launched`'s own scheduleIdle
  // replaces this one the instant the session really starts.
  if (deps && deps.scheduleIdle) deps.scheduleIdle(s);
  consume(s, q, rt); // fire-and-forget consumer loop
}

// The normalizer's read-only context. ⚠ Rebuilt per message on purpose: `willGatePost` asks the
// LIVE gate, so a posture changed mid-turn applies to the next call, exactly as it always did.
function normalizeCtx(s) {
  return {
    channelId: s.channelId,
    peerName: s.counterpartyName,
    peerId: s.counterpartyId,
    // v2.7 L3: the gate PREDICTION, so one artifact starts as the decision card when the post
    // will stop. It DECIDES nothing.
    willGatePost: (input, toolName) => io.postWillGate(s, input, toolName),
  };
}

async function consume(s, q, rt) {
  try {
    // FIX #1b: `q` tags this loop; a park->resume swaps s.query, so s.query !== q => SUPERSEDED (ignore its tail + late rejection).
    // Q6: an auth failure the runtime reports as CONTENT is consumed here — the dead-end bubble is
    // REPLACED by the sign-in action, and this loop stops rather than rendering it.
    // ⚠ ONE CALL PER MESSAGE SINCE 2026-08-31, WHERE THERE WERE THREE. The auth sentinel, the
    // render mapping and the per-message usage extraction all read the same raw schema and all
    // three are now the adapter's `normalize`; core applies what comes back. That is what makes
    // the whole message-handling surface fixture-testable rather than a third of it.
    // ⚠ THE SENTINEL'S ANSWER IS THE STOP CONDITION — NOT THE FACT THAT IT WAS ASKED (D7.4,
    // restored 2026-09-01). HEAD read `if (sessionAuth.holdIfAuthMessage(s, msg)) return;`, and
    // that function answers FALSE without acting in three cases — no bound deps, no session, and
    // `s.settled`. The port dropped the return value and returned unconditionally, so a SETTLED
    // session that emits an auth-shaped message stopped draining the stream HEAD kept reading.
    // That matters because settling does not end the child process: `holdIfAuthFailure` is the
    // thing that aborts and closes, and it declines to on a settled session precisely because the
    // teardown already ran. Returning there abandons the iterator mid-stream with nothing left to
    // consume its tail — the loop's own supersede tag (`s.query !== q`) is the ONLY other exit,
    // and a settled-but-not-superseded session never trips it.
    // ⚠ AND IT IS THE SAME SHAPE THE CATCH BELOW ALREADY USES (`held.length &&
    // holdIfAuthFailure(...)`), which never lost it. The two auth lanes now agree again.
    for await (const msg of q) {
      if (s.query !== q) return;
      // ⚠ `diag` RIDES THE CALL (D7.3). `session-io.js` may not require it — it is required in
      // plain Node by a dozen suites and `diag.js` pulls electron — so the swallowed context
      // dispatch's log line is supplied from here, exactly as the option assembly supplies the
      // gate bridge's. This file already requires `diag` at its top for the query-error line.
      const hold = io.applyCoreEvents(s, rt.normalize(msg, normalizeCtx(s)), deps.dispatch, store, diag);
      if (hold && sessionAuth.holdIfAuthFailure(s, hold.text)) return;
    }
  } catch (err) {
    if (s.query !== q) return;
    if (!isAbortError(err)) {
      // Q6: an auth-shaped rejection surfaces the in-window sign-in action instead of `crash`
      // (settle + destroy + task_failed{interrupted}). Every other error keeps that path
      // unchanged. ⚠ THE RUNTIME DECIDES WHETHER IT IS AUTH-SHAPED, not this loop: a rejection
      // string is as platform-specific as a message, so it goes through the same normalizer as
      // a synthetic error message.
      const text = (err && err.message) || err;
      const held = rt.normalize({ type: 'error', text: String(text == null ? '' : text) }, normalizeCtx(s));
      if (held.length && sessionAuth.holdIfAuthFailure(s, held[0].text)) return;
      diag('session-engine: query error', text);
      if (!s.settled) deps.dispatch(s, { type: 'crash' });
    }
  }
}

function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
}

module.exports = {
  bind,
  buildLaunchSpec,
  abortInFlight,
  startQuery,
  consume,
  isAbortError,
};
