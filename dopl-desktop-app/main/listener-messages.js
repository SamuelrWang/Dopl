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
  // ⚠ **THE DELIVERY LANE — ONE CALL, AND IT IS THE ONLY THING THAT MAY CLAIM A MESSAGE FOR AN
  // AGENT.** It feeds the sessions the SERVER'S STORED VERDICT names (`session-dispatch.js`), and
  // claiming is terminal: a message an agent took is not also a consent card.
  // ⚠ NOT CHAT-GUARDED, deliberately: it feeds a session that is ALREADY RUNNING, which is
  // "seen", not "started". Chat still reaches classify, where an @-tag makes it 'fyi' and an
  // untagged line 'ignore'.
  // ⚠ **SYNCHRONOUS AGAIN SINCE 2026-09-02 (ruling B6).** It was awaited for one wave and one
  // reason: TIER 3 bought a multi-agent room's unaddressed message a bounded claim/pass MODEL
  // CALL before it could say who it had woken, and that call HELD THIS CHANNEL'S CURSOR — which
  // is why it needed a timeout at all. The triage tier is deleted; RR3 answers the same question
  // on the row, at write time, so the route decides from data it already has and the listener
  // gets its cursor back.
  if (sessionDispatch.feedLiveSession(entry, m, myUserId)) return;
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
  // ⚠ ROUTE (5) RAN HERE — the one route that ran AFTER classify, diverting a peer's follow-up
  // into the window that had answered it rather than raising a second consent card beside it.
  // Deleted with the window (F-228): every 'trigger' now reaches `handleTrigger`, which is what
  // the route fell through to on every miss anyway.
  if (verdict === 'trigger') return trigger.handleTrigger(entry, m);
  // ⚠ `myUserId` RIDES ALONG so the banner can tell MY agent from a PEER's: an agent posts under
  // its operator's `author_user_id`, so the author id alone cannot (`task-notify.js ›
  // mentionAuthorLabel`). Nothing is decided here — the verdict still reaches the action directly.
  if (verdict === 'fyi') trigger.sendFyi(entry, m, myUserId);
  // A reply in one of MY interactive tasks: passive notify only — no consent row, no watcher
  // record, no spawn. ⚠ AND SINCE 2026-08-18 (wiring plan Phase 7) ONLY WHEN IT @-TAGS ME.
  // The verdict itself is unchanged and must stay so: it is a ROUTING statement — "this reply
  // is not a fresh request" — and folding the mention into classify would drop the suppression
  // along with the banner, so the peer's reply would spawn a counter-session against itself.
  // What the tag gates is the NOTICE. A thread reply is agent-into-thread activity, which is
  // precisely what the policy silences, and unlike 'trigger' nothing is waiting on the
  // operator here — there is no consent row and no launch, so no flow depends on the banner.
  // ⚠ THE CONDITION MOVED INSIDE (2026-10-09, Samuel's spec). It used to read
  // `m.authorKind === 'user' || targeting.mentionsMe(...)` here, because a HUMAN-typed reply
  // notified even untagged (2026-08-20 review) while agent replies stayed mention-gated. The
  // spec turns the REPLY notice off for both authors, so author kind no longer decides anything
  // and the only question left is "was I tagged", which `notifyTaskReply` now asks — see its
  // header for why that path must survive at all (a tag inside my own thread never reaches
  // `sendFyi`). The arm still fires on every task-reply so the verdict stays observable.
  // ⚠ ONE PREDICATE, TWO READERS still holds: `targeting.mentionsMe` is the same function
  // classify's 'fyi' verdict is conjoined with — it is just read one frame deeper now.
  else if (verdict === 'task-reply') taskNotify.notifyTaskReply(entry, m, myUserId);
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
  drainPage,
  deferBackoff,
};
