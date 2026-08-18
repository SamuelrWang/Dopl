// Channels listener — per-message dispatch: one inbound message, one outcome.
// (channel-listener.js keeps the long-poll loop, channel-set reconciliation and the public
// start/stop/restart/status surface.)
//
// ⚠ THE ORDER IS THE CONTRACT, pinned by test/wake-external-requester.test.mjs (which mirrors
// this body and drives the mirror through the real classify): every pre-classify route
// SHORT-CIRCUITS the rest, and classify runs LAST. All routes no-op when window-mode is OFF, so
// the classify path stays byte-for-byte legacy behavior.
//
// ⚠ THIS MODULE ALSO OWNS HOW FAR THE CURSOR MOVES (drainPage below). Writing the PERSISTED
// cursor before dispatchMessage makes every downstream early return a permanent SILENT DROP.
// Pairing "what happened to this message" with "may the cursor step over it" is the seam;
// channel-listener.js keeps the transport and knows nothing about dispatch verdicts.

const targeting = require('./targeting');
const trigger = require('./trigger');
const taskNotify = require('./task-notify');
const sessionDispatch = require('./session-dispatch');
const versionSkew = require('./version-skew');
const io = require('./listener-io'); // the cursor store + sleep (listener-io requires nothing back)
const { LISTENER } = require('./config');
const { diag } = require('./diag');

// Route ONE message. Awaited by the loop, so a trigger's consent + spawn serializes ahead of
// the next message in the page.
// ⚠ THE RETURN VALUE IS A DEFERRAL REASON; FALSY MEANS HANDLED. Every route is terminal for the
// message it claims, so "handled" is the default. The ONE path that answers "I could not do
// this and the message must not be lost" is `trigger.handleTrigger` (no Claude runtime; no
// consent row, which is `null` on ANY network error or non-2xx from the consent POST). It
// returns a short reason string, this returns it verbatim, and drainPage holds the cursor.
async function dispatchMessage(entry, m, myUserId) {
  // ⚠ Read the peer's stamped build FIRST, before any route can claim the message: a reply
  // consumed by a live session window is exactly the message whose sender's version explains a
  // behavior gap. Diagnostic only — returns a value nobody reads, swallows its errors, changes
  // no verdict.
  versionSkew.observe(entry, m, myUserId);
  // ⚠ The LEGACY-THREAD REGISTRY is recorded HERE, ahead of every route, NOT from classify's
  // self-authored branch: an untagged line of mine taken by an engaged agent short-circuits
  // above classify, and the opener it would have recorded is lost — costing a spurious consent
  // prompt on the peer's eventual reply. A NO-OP for anything that is not a self-authored,
  // addressed, thread-opening message, and re-seeing one only refreshes its eviction age.
  targeting.noteMyLegacyThread(m, entry, myUserId);
  // ⚠ The REQUEST LIFECYCLE STRIP is OBSERVED here for the same reason: the events saying what
  // happened to a request are either about to be claimed by a route (a peer's reply) or read by
  // no route at all (milestones — every route gates on kind === 'message'). Claims nothing,
  // short-circuits nothing, changes no verdict.
  sessionDispatch.noteRequestLifecycle(entry, m, myUserId);
  // The pre-classify routes, checked BEFORE classify -> consent (§A.2):
  //   1. feed a LIVE session's next turn
  //   2. auto-open a REQUESTER window on my own thread opener (this claims BOTH desktop
  //      runtimes — a session this app spawned AND the operator typing in its own UI)
  //   3. reopen a SETTLED-yet-resumable requester on a peer reply
  // ⚠ An UNSTAMPED create still reaches no route at all.
  if (sessionDispatch.feedLiveSession(entry, m, myUserId)) return;
  // ⚠ CHAT MAY BE SEEN BY A LIVE SESSION; IT MAY NEVER START ONE. The chat brake inside
  // classify runs LAST, so without this guard routes 2 and 3 claim a peer's chat line first and
  // open a requester window or REOPEN A SETTLED SESSION.
  // ⚠ ROUTE 1 IS DELIBERATELY ABOVE THIS LINE and stays unguarded: it feeds a session that is
  // ALREADY RUNNING, which is "seen", not "started". Routes 2 and 3 bring a session INTO
  // existence, so they are the two this refuses.
  // ⚠ IT DOES NOT RETURN. Falling through to classify is the point: chat from a member that
  // @-TAGS ME classifies 'fyi', which drives `trigger.sendFyi` — the notification the human
  // actually sees. An early return silences chat entirely, tag or no tag. (Since 2026-08-18,
  // wiring plan Phase 7, UNTAGGED chat classifies 'ignore' and raises nothing; that is the
  // mention gate answering inside classify, not this guard, and the difference matters —
  // this guard must keep letting chat REACH classify so a tagged line can still be heard.)
  const chat = targeting.isChatIntent(m);
  if (!chat) {
    if (await sessionDispatch.maybeOpenRequesterSession(entry, m, myUserId)) return;
    if (await sessionDispatch.maybeSurfaceRequesterReply(entry, m, myUserId)) return;
  }
  const verdict = targeting.classify(m, entry, myUserId);
  diag(
    'msg', entry.channel.id.slice(0, 8), 'seq', m.seq, 'kind', m.kind,
    'authorKind', m.authorKind, 'author', String(m.authorUserId || '').slice(0, 8),
    'me', myUserId ? String(myUserId).slice(0, 8) : 'NULL',
    // ⚠ DIAGNOSTIC ONLY, and deliberately kept after the implicit 1:1 trigger was
    // removed (2026-08-18). classify no longer READS the count — but a roster of the
    // wrong size is still the first thing to check when a verdict surprises somebody,
    // and it is cheaper to log than to reconstruct.
    'members', Number(entry.channel && entry.channel.memberCount) || '?',
    'to', targeting.metaStr(m, 'to_user_id') ? String(targeting.metaStr(m, 'to_user_id')).slice(0, 8) : '-',
    'verdict', verdict
  );
  // ROUTE (5) — REOPEN IN PLACE, the ONE route that runs AFTER classify. 'trigger' is the
  // RIGHT verdict for a peer's follow-up; only WHERE the decision is asked is wrong, and a
  // follow-up tagged with an exchange this machine already answered belongs in THAT window's
  // inbound gate rather than a second consent card beside it.
  // ⚠ Sitting AFTER classify buys "must not disturb the other verdicts" by CONSTRUCTION:
  // 'task-reply', 'fyi' and 'ignore' are decided and dispatched before this line is reached.
  if (verdict === 'trigger') {
    if (!(await sessionDispatch.maybeReopenAddressedThread(entry, m, myUserId))) return trigger.handleTrigger(entry, m);
  } else if (verdict === 'fyi') trigger.sendFyi(entry, m);
  // A reply in one of MY interactive tasks: passive notify only — no consent row, no watcher
  // record, no spawn. ⚠ AND SINCE 2026-08-18 (wiring plan Phase 7) ONLY WHEN IT @-TAGS ME.
  // The verdict itself is unchanged and must stay so: it is a ROUTING statement — "this reply
  // is not a fresh request" — and folding the mention into classify would drop the suppression
  // along with the banner, so the peer's reply would spawn a counter-session against itself.
  // What the tag gates is the NOTICE. A thread reply is agent-into-thread activity, which is
  // precisely what the policy silences, and unlike 'trigger' nothing is waiting on the
  // operator here — there is no consent row and no launch, so no flow depends on the banner.
  // ⚠ ONE PREDICATE, TWO READERS: `targeting.mentionsMe` is the same function classify's 'fyi'
  // verdict is conjoined with, on the isChatIntent precedent above.
  else if (verdict === 'task-reply' && targeting.mentionsMe(m, myUserId)) taskNotify.notifyTaskReply(entry, m);
}

// ─── BEGIN DISPATCH-DEFERRAL (pure; unit-tested via source extraction) ───────
// ⚠ Nothing here reaches a store, a window or the network, so
// test/listener-cursor-advance.test.mjs slices it and evaluates it verbatim. `LISTENER` is a
// free var.

// The wait before re-awaiting a page whose head would not dispatch. ⚠ The SAME capped
// exponential ladder the reconnect backoff uses — same shape of failure, and a second tuning
// knob would be a second thing to get wrong.
function deferralDelayMs(attempts) {
  const n = Math.max(1, Number(attempts) || 1);
  return Math.min(LISTENER.BACKOFF_MAX_MS, LISTENER.BACKOFF_BASE_MS * 2 ** (n - 1));
}

// ⚠ THE POISON-MESSAGE ESCAPE: true once one message has held the head of its channel's queue
// for the whole ladder. Retrying forever trades a bounded, announced loss for an unbounded
// SILENT STALL of every later message in that channel.
function deferralExhausted(attempts) {
  return (Number(attempts) || 0) >= LISTENER.DISPATCH_MAX_ATTEMPTS;
}

// Per-ENTRY, one seq only: drainPage stops at the first message that will not dispatch, so
// there is exactly one head to count. ⚠ A different seq RESETS the count, which is what makes
// the ladder measure THIS message rather than the channel's history.
function noteDeferral(entry, seq) {
  const d = entry.deferral;
  entry.deferral = d && d.seq === seq ? { seq: seq, attempts: d.attempts + 1 } : { seq: seq, attempts: 1 };
  return entry.deferral.attempts;
}

function clearDeferral(entry, seq) {
  if (entry.deferral && entry.deferral.seq === seq) entry.deferral = null;
}
// ─── END DISPATCH-DEFERRAL ──────────────────────────────────────────────────

// ONE PAGE OF MESSAGES, AND HOW FAR THE PERSISTED CURSOR MOVES OVER IT.
//
// ⚠ ADVANCE ON SUCCESS, NEVER ALWAYS. `io.setCursor` before `dispatchMessage` puts the
// electron-store cursor past a message that then hits a downstream early return: a 15s wifi
// drop during the consent POST means no consent row, nothing in Pending Requests, and a restart
// that re-awaits from the ADVANCED cursor while the peer's agent long-polls forever.
// A RE-dispatch is safe: both deferring returns are upstream of `watcher.register`,
// `handleTrigger` is idempotent per (channel, seq), and the consent create is de-duped
// server-side on (operator, channel, kind, seq).
// ⚠ The opposite risk — a message that can never dispatch holding the head forever — is why
// this is advance-on-success PLUS a bounded ladder PLUS a loud poison escape.
//
// TRUE when the page was left unfinished on purpose; the loop then backs off and re-awaits
// from the held cursor instead of taking its normal idle.
async function drainPage(entry, msgs, myUserId) {
  const channelId = entry.channel.id;
  for (const m of msgs) {
    const seq = m.seq || 0;
    let deferred = null;
    try {
      deferred = await dispatchMessage(entry, m, myUserId);
    } catch (err) {
      // ⚠ A THROW IS A DEFERRAL, not a dead channel: escaping into channelLoop's caller stops
      // the loop for up to a 5-minute reconcile.
      deferred = `error:${(err && err.message) || 'unknown'}`;
    }
    if (deferred) {
      const attempts = noteDeferral(entry, seq);
      if (!deferralExhausted(attempts)) {
        diag('dispatch deferred', channelId.slice(0, 8), 'seq', seq, deferred,
          `— holding the cursor, attempt ${attempts}/${LISTENER.DISPATCH_MAX_ATTEMPTS}`);
        return true;
      }
      diag('dispatch DROPPED', channelId.slice(0, 8), 'seq', seq, deferred,
        `— gave up after ${attempts} attempts; this message will never be answered`);
    }
    clearDeferral(entry, seq);
    if (seq > io.getCursor(channelId)) io.setCursor(channelId, seq);
  }
  return false;
}

// The pause after a deferral, so a re-await does not hot-loop on the IDLE_GAP.
function deferBackoff(entry) {
  return io.sleep(deferralDelayMs(entry.deferral && entry.deferral.attempts));
}

module.exports = {
  dispatchMessage,
  drainPage,
  deferBackoff,
  // the pure policy (exported for the test; drainPage is the only production caller)
  deferralDelayMs,
  deferralExhausted,
  noteDeferral,
  clearDeferral,
};
