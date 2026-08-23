// trigger-outcomes.js — EVERY ECHO INTO THE CHANNEL THAT IS NOT A REPLY.
//
// Extracted from trigger.js to hold that AT-CAP file (§2, 500 lines) under the cap. TWO FAMILIES
// lived here, and ONE IS LEFT. What they shared is the shape that matters: nothing was (or will
// be) posted as an ANSWER, and the only job is to stop the peer waiting on one.
//
// ── ⚠ (1) THE REQUEST TERMINALS ARE DELETED (2026-08-22, Samuel's inbound-consent ruling) ────
//
// `inboundDenied`, `inboundExpired`, `outboundCancelled` and `onInterrupted` each posted a
// `task_failed` under the original `task_started`'s deterministic taskId, and the METADATA FLAG
// was what the web rendered: `{declined}` a calm "Declined", `{dropped}` "Reply was not sent",
// `{interrupted}` a calm "Interrupted", no flag a REAL error. Every one of the four was a
// resolver of `consent-watcher.js`, dispatched when a WATCHED INBOUND RECORD reached a terminal
// status — and there are no inbound records: the row, the watcher, its durable store and its poll
// cadence are all deleted (`trigger.js`'s header carries the ruling). A peer's ask now raises a
// notification whose Dismiss decides nothing, so there is no decline to echo, no expiry to
// report, and no mid-spawn record for a restart to find interrupted.
//
// ⚠ THE FLAG VOCABULARY ITSELF IS NOT RETIRED and must not be treated as free: `CALM_FLAG_KEYS`
// stay reserved server-side (INVARIANTS §5), installed builds still write them, and the web still
// renders them. What went is this machine's four PRODUCERS of them.
//
//   (2) THE SESSION LIFECYCLE ECHO — `lifecycleHandlers`, the engine's `setLifecycleHandlers`
//       seam, and now the whole of this file. ⚠ MOVED HERE FROM `main/session-window.js` ON
//       2026-08-20, and the move is the point: that file was the SESSION WINDOW FACTORY, deleted
//       with the window model (INVARIANTS §11, F-228), and this half is nothing to do with
//       windows. It is what tells a WAITING PEER that this machine stopped, it is required of the
//       quit path (§11's quit guard depends on it), and a WINDOWLESS session needs it exactly as
//       much as a windowed one did. Deleting the factory with this attached would have silently
//       taken peer notification with it — which is why the move is its own wave, ahead of any
//       deletion.
//
// SEAM: the lifecycle echo takes NO injection — it derives its own targets from the flat info
// object the engine hands it. ⚠ `bind({ entryFromRecord, msgFromRecord, taskIdFor })` went with
// the terminals above: those three record→shape helpers existed to rebuild an `entry`/`m` pair
// from a PERSISTED consent record, and nothing persists one. Leaf deps are required directly;
// nothing here requires trigger.js back.

const { postTaskEvent } = require('./channel-post');
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
const AUTH_HELD_REPLY =
  "I can't run this right now — my Claude Code sign-in on this machine needs attention. I'll pick it up once that's sorted.";

// 2026-08-20: the engine refused the launch outright (the concurrency ceiling, or no runnable
// Claude Code on this machine). ⚠ It says the request was NOT answered and it does NOT invite a
// resend, which is what separates it from RESEND above: `busy` frees itself as soon as a session
// ends, and these do not — a resend into a spent cap or a missing runtime fails identically.
// ⚠ NO LOCAL DETAIL. Which of the two it was, and what the operator should do about it, is the
// LOCAL notification's job (`trigger.js › skippedHint`); the peer is told the outcome and
// nothing about this machine.
const CANNOT_RUN =
  "I couldn't pick this up — my agent isn't able to run it right now. Try me again later, or reach me another way.";

// ⚠ `notifyReplied(entry, reply)` STOOD HERE AND IS DELETED (2026-08-20) — zero callers. It
// raised a local "Dopl: replied in <channel>" banner carrying the REPLY TEXT, and its caller
// was the `claude -p` headless lane, which handed a reply STRING back for the desktop to post
// on the agent's behalf. That lane is deleted (Samuel's ruling, the same day) and the surviving
// executor posts its own bytes, so there is no moment at which main holds a reply to announce.
// ⚠ IT IS ALSO THE SHAPE INVARIANTS §11 RETIRED: per-message desktop notifications are gone —
// the MENTION is the escalation and the Tags inbox is the record. Reviving this would be a new
// notification producer, and there are exactly three.

// ── (2) THE SESSION LIFECYCLE ECHO (engine → channel) ────────────────────────
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
//
// ⚠ P2-9's TERMINAL COLLAPSE LIVED HERE AND WENT WITH THE TERMINAL ECHOES (Phase 5,
// 2026-08-18). It keyed `task_finished` / `task_failed` on the THREAD rather than the cycle,
// so five park+resume cycles posted one row for one logical failure — a rule about a card
// this phase deleted, for kinds this module no longer posts. The `kind` argument went with
// it: ONE kind reaches this derivation now, and it is the non-terminal note, which wants the
// per-cycle discriminator FIX #2 gives it (a genuinely new run that ends is a new note).
function echoSeq(info) {
  const i = info || {};
  if (i.seq != null) return i.seq;
  const base = i.taskId || i.key || i.sessionId || 'session';
  const cycle = i.sdkSessionId || i.sessionId || 'init';
  return base + '#' + cycle;
}
function echoTargets(info) {
  const i = info || {};
  return {
    entry: { channel: { id: i.channelId }, workspaceId: i.workspaceId },
    m: { seq: echoSeq(i) },
    taskId: i.taskId || undefined,
  };
}

// C-5 (2026-08-08) — ONE `session_ended` STATUS NOTE PER (thread, cycle), FROM THIS PROCESS.
//
// Three terminals post that marker (the 12h abandonment, the auth hold, the launch timeout)
// where previously none did, and two of them can reach the same session: a held session is
// PARKED, and a park can be followed by an abandonment. The operator would then see the note
// twice on one exchange.
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
  const { entry, m, taskId } = echoTargets(info);
  if (!entry.channel.id) return;
  // C-5: the calm status note is said once per (thread, cycle); see firstInactiveNote.
  if (meta.session_ended === true && !firstInactiveNote(entry.channel.id, m.seq)) {
    diag('session onEnded: session_ended already posted for this cycle — not repeating it');
    return;
  }
  const body = bodyOverride || (meta.session_ended ? 'Session ended' : undefined);
  Promise.resolve(postTaskEvent(entry, m, 'task_progress', taskId, meta, body))
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
