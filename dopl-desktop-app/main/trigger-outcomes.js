// trigger-outcomes.js — EVERY ECHO INTO THE CHANNEL THAT IS NOT A REPLY.
//
// Nothing here is posted as an ANSWER; the only job is to stop the peer waiting on one.
//
// ⚠ THE CALM FLAG VOCABULARY IS NOT RETIRED and must not be treated as free: `CALM_FLAG_KEYS`
// stay reserved server-side (INVARIANTS §5), installed builds still write them, and the web still
// renders them. This machine no longer produces the request-terminal ones (inbound consent is
// retired, 2026-08-22).
//
// THE SESSION LIFECYCLE ECHO — `lifecycleHandlers`, the engine's `setLifecycleHandlers` seam. It
// tells a WAITING PEER that this machine stopped; the quit path requires it (§11's quit guard),
// and a windowless session needs it.
//
// SEAM: no injection — it derives its own targets from the flat info object the engine hands it.
// Leaf deps are required directly; nothing here requires trigger.js back.

const { postTaskEvent } = require('./channel-post');
// The register a quit drains before it closes the process (`quit-guard.js › teardown`).
const terminalPosts = require('./session-terminal-posts');
const { diag } = require('./diag');

// ── THE TWO PEER-FACING COURTESY REPLIES ─────────────────────────────────────
// ⚠ TWO OF THE THREE MOVED HERE FROM `main/trigger-headless.js` ON 2026-08-20, ahead of that
// file's deletion. They were never the headless lane's alone: `trigger.js` reaches both on the
// WINDOWLESS path (the busy terminal and the auth-hold terminal), so deleting their old home
// would have deleted two strings a live path still sends. `CANNOT_RUN` is new in the same wave,
// for the terminal that used to BE the headless lane.
//
// Both are POSTED AS A COURTESY, never as a reply: `channel-post.postCourtesy` sends them
// unaddressed, so a no-op can never trigger the peer back (P1-5).
const RESEND =
  "I'm still finishing a previous request in this channel — please resend in a moment.";

// H1 (LOW): the HONEST version of the above for the one case where "still finishing" is false.
// A session HELD on the sign-in action occupies the registry slot while running nothing, so the
// old copy told the peer to resend into a slot that will not free itself — the operator has to
// sign in on that Mac first, and nothing was saying so. No local detail leaks: it names the
// state, not the machine, the account, or the error.
// ⚠ VENDOR-FREE SINCE 2026-08-31 (port wave D, §2.5), AND BY THIS CONSTANT'S OWN RULE. The block
// above says "No local detail leaks: it names the state, not the machine, the account, or the
// error" — and WHICH RUNTIME this operator's agents run on is local detail of exactly that kind,
// readable by anyone who can address them. It also stopped being true: a build that ships three
// adapters cannot promise the held credential is any particular vendor's.
const AUTH_HELD_REPLY =
  "I can't run this right now — my agent's sign-in on this machine needs attention. I'll pick it up once that's sorted.";

// 2026-08-20: the engine refused the launch outright (the concurrency ceiling, or no runnable
// Claude Code on this machine). ⚠ It says the request was NOT answered and it does NOT invite a
// resend, which is what separates it from RESEND above: `busy` frees itself as soon as a session
// ends, and these do not — a resend into a spent cap or a missing runtime fails identically.
// ⚠ NO LOCAL DETAIL, AND NOW THERE IS NO LOCAL COPY AT ALL. Which of the two it was used to be
// the operator's own banner (`trigger.js › skippedHint`), removed 2026-10-09 with the rest of the
// unanswered-request notice per Samuel's spec. THIS line is now the only thing anyone is told,
// which is the right way round: the peer is the one waiting. It still names no machine state.
const CANNOT_RUN =
  "I couldn't pick this up — my agent isn't able to run it right now. Try me again later, or reach me another way.";

// ── THE SESSION LIFECYCLE ECHO (engine → channel) ────────────────────────
// The engine's runLifecycle hands a flat info object { channelId, taskId, workspaceId,
// side, sessionId, key, sdkSessionId }. postTaskEvent needs only channel.id, workspaceId,
// and a `seq` for the idempotent clientMsgId `${kind}-${channelId}-${seq}` (it does NOT
// read channel.name), so the coupling is tiny.
//
// ─── BEGIN LIFECYCLE-ECHO-PURE (echo-id derivation; unit-tested via source extraction) ──
//
// FIX #2: `seq` folds a per-resume-CYCLE discriminator into a STABLE base, so a NEW cycle
// (a park->resume) posts a NEW server row while a RETRY within one cycle still collapses to
// one (the server dedupes on the identical clientMsgId).
//   base  = the first-class taskId, else the STABLE sessionKey (channelId:taskId) — never
//           the per-launch ephemeral sessionId, so a resume (fresh sessionId, same key)
//           can't post under a different id.
//   cycle = the SDK session id (a resumed query mints a fresh one at its own system/init),
//           falling back to the per-object sessionId for a PRE-INIT crash so two distinct
//           cycles that both die before init still get distinct rows.
// The DELIBERATE same-cycle dedupe (I-LOW(b)) is preserved: two attempts within one cycle
// share that cycle's sdk id, so they still collapse to ONE server row.
// Only the non-terminal note reaches this derivation, which wants FIX #2's per-cycle
// discriminator (a genuinely new run that ends is a new note).
function echoSeq(info) {
  const i = info || {};
  if (i.seq != null) return i.seq;
  const base = i.taskId || i.key || i.sessionId || 'session';
  const cycle = i.sdkSessionId || i.sessionId || 'init';
  return base + '#' + cycle;
}
// ⚠ `sessionId` IS THE SLOT KEY `i.key`, NOT `i.sessionId` (2026-09-15, docs/traces/AGENT-BADGE-TRACE.md).
// The flat info object carries both and they are different facts: `sessionId` is the PER-LAUNCH
// ephemeral id (fresh on every resume, a React key on the wire) and `key` is
// `<channelId>:<taskId>:<agentId>` — `session-store.js › sessionKey`, the same value
// `runtime/claude/launch-spec.js:159` stamps onto a spawned session's own posts. The AGENT id is
// the segment every reader wants (`lib/agent-post-stamp.ts › agentIdOfSessionKey` reads it from
// the END), and the ephemeral id does not carry one at all, so stamping that would produce a
// header the server accepts and no reader can resolve.
function echoTargets(info) {
  const i = info || {};
  return {
    entry: { channel: { id: i.channelId }, workspaceId: i.workspaceId },
    m: { seq: echoSeq(i) },
    taskId: i.taskId || undefined,
    sessionId: i.key || undefined,
  };
}

// C-5 (2026-08-08) — ONE `session_ended` STATUS NOTE PER (thread, cycle), FROM THIS PROCESS.
//
// Three terminals post that marker (the 12h abandonment, the auth hold, the launch timeout)
// where previously none did, and two of them can reach the same session: a held session is
// PARKED, and a park can be followed by an abandonment. The operator would then see the note
// twice on one exchange.
// ⚠ THE AUTH HOLD NOW POSTS A DIFFERENT SENTENCE (2026-09-15) AND THIS GUARD STILL COVERS IT —
// deliberately. The guard keys on the `session_ended` MARKER and the (thread, cycle) echo id,
// never on the body, so hold-then-abandon still says ONE thing on one exchange. That is the
// point: the second post would be the calm "went inactive" arriving under a note that already
// told the peer this side is waiting on a person.
//
// The key is the echo id the post would carry, so the local guard and the server's own
// `client_msg_id` uniqueness agree BY CONSTRUCTION rather than by coincidence — and a genuinely
// NEW cycle (sign in, run, park, abandon) mints a new sdk session id, so it is a different key
// and it posts, which is right. Belt AND braces: the server dedupes the same id a second time.
//
// BOUNDED. A Set that only grows is the shape this tree has been bitten by; 64 is far above
// the four concurrent sessions a machine can hold, and the oldest entry goes first (insertion
// order), which is the least likely to still be relevant.
const MAX_REMEMBERED_ENDS = 64;
const saidInactive = new Set();

function firstInactiveNote(channelId, seq) {
  const k = `${channelId}|${seq}`;
  if (saidInactive.has(k)) return false;
  if (saidInactive.size >= MAX_REMEMBERED_ENDS) saidInactive.delete(saidInactive.values().next().value);
  saidInactive.add(k);
  return true;
}
// ─── END LIFECYCLE-ECHO-PURE ──────────────────────────────────────────────────────────

/**
 * ⚠ POSTS NOTHING, AND THAT IS THE FEATURE (Phase 5, 2026-08-18). This used to echo
 * `task_started` the instant the session's SDK system/init landed (§A.3 launched). A launch is
 * a fact about a RUNTIME; the surface that reports it is the Agents tab, off the LOCAL session
 * projection, and a transcript row claiming it was the thing this phase removed.
 *
 * The handler is KEPT rather than unwired so the engine's lifecycle seam
 * (`setLifecycleHandlers` / `runLifecycle`) stays intact for the calm note below — and so this
 * comment sits where the next person looks for the echo.
 */
function onLaunched(_info) {}

// THE CALM STATUS NOTE, and nothing else, when the session ends (End / cap / crash / quit).
// The engine is authoritative: it passes the resolved `kind`, the `extra` metadata (e.g.
// { interrupted:true }), and — for P3 (v1.7.4) — an explicit calm `bodyOverride`. IDLE
// no longer calls this at all (it parks).
//
// ⚠ ONLY `task_progress` IS POSTED. The terminal kinds are gone with the session card that read
// them: a `task_failed{capped}` / `task_finished` row said "this exchange ended" on a surface
// that had no other way to say "this machine stopped", and the thread never had an outcome to
// report (INVARIANTS §5). What is left is the `session_ended` MILESTONE — the one thing the
// peer genuinely needs, because they are waiting on a reply that is not coming.
// The metadata rides unchanged: `CALM_FLAG_KEYS` stay reserved server-side (§5) whether or not
// this build still writes them, and installed builds still do.
function onEnded(info, kind, extra, bodyOverride) {
  const meta = extra || {};
  // P1-7 (2026-08-04): `task_progress` is the non-terminal marker for a LOCAL session end —
  // see `session-effects.endLifecycle`. Everything else USED to be coerced to `task_finished`;
  // it is now dropped, because the coercion's only remaining job would be to manufacture a
  // terminal row this module no longer posts.
  if (kind !== 'task_progress') return;
  const { entry, m, taskId, sessionId } = echoTargets(info);
  if (!entry.channel.id) return;
  // C-5: the calm status note is said once per (thread, cycle); see firstInactiveNote.
  if (meta.session_ended === true && !firstInactiveNote(entry.channel.id, m.seq)) {
    diag('session onEnded: session_ended already posted for this cycle — not repeating it');
    return;
  }
  const body = bodyOverride || (meta.session_ended ? 'Session ended' : undefined);
  // ⚠ THE SLOT KEY RIDES WITH IT. This note is ABOUT one session, so the row must say which —
  // see `echoTargets` above and `channel-post.js › postTaskEvent`'s `sessionId` note.
  // ⚠ AND IT IS REGISTERED, NOT MERELY FIRED (2026-10-12). Fire-and-forget is right while the
  // app is running and wrong at the one moment this note matters most: a session ended by a QUIT
  // posts from here and then `quit-guard.js › teardown` calls `app.quit()`, which took the
  // process away with the request in flight — so the peer waiting on a reply was told nothing.
  // `track` only HOLDS the promise so the quit path can give it a bounded moment; it does not
  // change this call's outcome, and the `.catch` below is still the only error handler.
  terminalPosts.track(postTaskEvent(entry, m, 'task_progress', taskId, meta, body, { sessionId }))
    .catch((err) => diag('session onEnded echo error', err && err.message));
}

const lifecycleHandlers = { onLaunched, onEnded };

module.exports = {
  // (2) the engine's lifecycle seam — index.js hands this to setLifecycleHandlers.
  lifecycleHandlers,
  // the peer-facing courtesy replies, all read by trigger.js's terminals
  RESEND,
  AUTH_HELD_REPLY,
  CANNOT_RUN,
};
