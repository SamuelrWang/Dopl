// Channels listener — per-message dispatch: one inbound message, one outcome.
//
// SPLIT NOTE (Q10): extracted from channel-listener.js, which sat exactly ON the
// §2 500-line cap. That file keeps the long-poll loop, channel-set
// reconciliation, and the public start/stop/restart/status surface; the decision
// of what to DO with a single message — the three pre-classify session-window
// routes, then classify, then the three verdict outcomes — lives here.
//
// The ORDER is the contract, and it is pinned statically by
// test/wake-external-requester.test.mjs (which mirrors this body and drives the
// mirror through the real classify): every pre-classify route SHORT-CIRCUITS the
// rest, and classify runs LAST. All three routes no-op when window-mode is OFF,
// so the classify path stays byte-for-byte legacy behavior.
//
// C-3 (2026-08-08) — THIS MODULE ALSO OWNS HOW FAR THE CURSOR MOVES (drainPage below).
// The page loop used to write the PERSISTED cursor before calling dispatchMessage, so
// every downstream early return was a permanent silent drop. Pairing "what happened to
// this message" with "may the cursor step over it" here is the seam: the loop in
// channel-listener.js keeps the transport and knows nothing about dispatch verdicts.

const targeting = require('./targeting');
const trigger = require('./trigger');
const taskNotify = require('./task-notify');
const sessionDispatch = require('./session-dispatch');
const versionSkew = require('./version-skew');
const io = require('./listener-io'); // C-3: the cursor store + sleep (listener-io requires nothing back)
const { LISTENER } = require('./config');
const { diag } = require('./diag');

// Route ONE message. Awaited by the loop, so a trigger's consent + spawn still
// serializes ahead of the next message in the page (unchanged from when this
// body lived inline).
//
// THE RETURN VALUE IS A DEFERRAL REASON, AND FALSY MEANS HANDLED (C-3). Every route
// below is terminal for the message it claims — it either did the thing or decided
// deliberately not to — so "handled" is the default and needs no statement. The ONE
// path that can answer "I could not do this, and the message must not be lost" is
// `trigger.handleTrigger`, whose two early returns (no Claude runtime at all; no
// consent row, which is `null` on ANY network error or non-2xx from the consent POST)
// were the silent drops C-3 names. It returns a short reason string, this returns it
// verbatim, and drainPage below holds the cursor on it.
async function dispatchMessage(entry, m, myUserId) {
  // Q10 — read the peer's stamped build FIRST, before any route can claim this
  // message. A reply consumed by a live session window is exactly the message
  // whose sender's version explains a behavior gap, so observing after the
  // short-circuits would miss the case this exists for. Diagnostic only: it
  // returns a value nobody reads here, swallows its own errors, and cannot
  // change a single verdict below.
  versionSkew.observe(entry, m, myUserId);
  // THE LEGACY-THREAD REGISTRY IS RECORDED HERE NOW, ahead of every route (2026-07-31).
  // It used to be written from classify's self-authored branch, on the argument that classify
  // was the one place every message this operator posts passes through. That stopped being
  // true the moment MY OWN messages started routing to MY OWN agents: an untagged line of
  // mine, taken by an engaged agent, short-circuits above classify and the opener it would
  // have recorded is lost — costing a spurious consent prompt on the peer's eventual reply.
  // It is a NO-OP for anything that is not a self-authored, addressed, thread-opening message
  // (see noteMyLegacyThread), and re-seeing one only refreshes its eviction age, so calling it
  // here as well as from classify cannot double-record or change a verdict.
  targeting.noteMyLegacyThread(m, entry, myUserId);
  // THE REQUEST LIFECYCLE STRIP is OBSERVED here, ahead of every route, for the same reason the
  // skew read is: the events that say what happened to a request the operator sent are events
  // some route below is about to claim (a peer's reply) or that no route reads at all (the
  // milestones — every route gates on kind === 'message'). It claims nothing, short-circuits
  // nothing and changes no verdict; it advances one status line on the session route (2) opened
  // for the operator's OWN typing, and answers false for every session that never sent a request.
  sessionDispatch.noteRequestLifecycle(entry, m, myUserId);
  // A FOURTH ROUTE ran in front of these three: `channel-agents.routeAddressedAgent`, which
  // claimed any message naming one of THIS operator's named agents (`metadata.to_agent_id`)
  // for that agent's own session. Named-agent addressing is gone (channels rollback §1), so
  // there is nothing to claim ahead of the session routes and no `dismissed` notification
  // for a retired handle.
  //
  // v2.2 session-window dispatch, checked BEFORE classify → consent (§A.2):
  //   1. feed a LIVE session's next turn; 2. auto-open a REQUESTER window on my
  //   own thread opener; 3. reopen a SETTLED-yet-resumable requester on a peer reply.
  //
  // THERE WERE FOUR (2026-08-05, rollback plan §3.4). A fourth route opened a dormant SHELL
  // for the request the operator typed in the app's own UI, because that post carried no
  // runtime stamp and route 2 refused it for exactly the conjunct written to keep an EXTERNAL
  // Claude Code session from getting a competing window. main/ui-bridge.js stamps `desktop-ui`
  // now, so route 2 claims the operator's typing as well and starts the agent on it — one
  // initiating behaviour instead of two. An UNSTAMPED create still reaches no route at all.
  if (sessionDispatch.feedLiveSession(entry, m, myUserId)) return;
  // CHAT MAY BE SEEN BY A LIVE SESSION; IT MAY NEVER START ONE (2026-08-06, operator's call).
  //
  // The chat brake used to live ONLY inside classify, which is the LAST thing this function
  // runs — so the three routes above reached it first and none of them had ever heard of
  // `intent`. The tool description's promise ("addresses nobody and starts nobody") was
  // therefore true of the spawn path and false of these two, and a peer's chat line could
  // open a requester window (route 2) or REOPEN A SETTLED SESSION (route 3). Found live on
  // 2026-08-06 by a two-agent probe in a real DM.
  //
  // ROUTE 1 IS DELIBERATELY ABOVE THIS LINE and stays unguarded. It feeds a session that is
  // ALREADY RUNNING, which is "seen", not "started" — the distinction the operator drew.
  // Routes 2 and 3 both bring a session INTO existence, so they are the two this refuses.
  //
  // AND IT DOES NOT RETURN. Falling through to classify is the whole point: chat from a
  // member classifies as 'fyi', which drives `trigger.sendFyi` — the notification the human
  // actually sees. An early return here would silence chat entirely, which is a worse bug
  // than the one being fixed.
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
    'members', Number(entry.channel && entry.channel.memberCount) || '?',
    'to', targeting.metaStr(m, 'to_user_id') ? String(targeting.metaStr(m, 'to_user_id')).slice(0, 8) : '-',
    'verdict', verdict
  );
  // ROUTE (5) — REOPEN IN PLACE, and it is the ONE route that runs AFTER classify.
  //
  // The three routes above are pre-classify because classify reaches the WRONG VERDICT for the
  // messages they claim. This one is different: 'trigger' is the RIGHT verdict for a peer's
  // follow-up — it is a request addressed to me and it does want a decision — and the only
  // thing wrong is WHERE the decision gets asked for. A follow-up tagged with an exchange this
  // machine already answered belongs in THAT window, at its in-window inbound gate, not in a
  // second consent card next to it.
  //
  // Sitting here rather than above buys the "must not disturb the other verdicts" property by
  // CONSTRUCTION: 'task-reply', 'fyi', 'agent-escalation' and 'ignore' are decided and
  // dispatched before this line can be reached, so no predicate of mine can divert them.
  // The route answers false for everything it does not claim, and then handleTrigger runs
  // byte-for-byte as before.
  if (verdict === 'trigger') {
    if (!(await sessionDispatch.maybeReopenAddressedThread(entry, m, myUserId))) return trigger.handleTrigger(entry, m);
  } else if (verdict === 'fyi') trigger.sendFyi(entry, m);
  // Feature 4 (requester side): a reply in one of MY interactive tasks —
  // passive notify only. No consent row, no watcher record, no spawn.
  else if (verdict === 'task-reply') taskNotify.notifyTaskReply(entry, m);
  // A FIFTH verdict, 'agent-escalation', reached a passive notifier here: a teammate's NAMED
  // agent addressing ME, the human, which had to be news rather than a request. It turned on
  // `metadata.author_agent_id` with no `to_agent_id` beside it, and nothing stamps either key
  // any more (channels rollback §1), so the verdict is unreachable and gone.
}

// ─── BEGIN DISPATCH-DEFERRAL (pure; unit-tested via source extraction) ───────
// C-3's retry policy. Nothing in here reaches a store, a window or the network, so
// test/listener-cursor-advance.test.mjs slices it and evaluates it verbatim.
// `LISTENER` is a free var in here (the session-park idiom).

// The wait before re-awaiting a page whose head would not dispatch. The SAME capped
// exponential ladder the reconnect backoff uses, because it is the same shape of
// failure (something upstream is not answering) and a second tuning knob for it would
// be a second thing to get wrong.
function deferralDelayMs(attempts) {
  const n = Math.max(1, Number(attempts) || 1);
  return Math.min(LISTENER.BACKOFF_MAX_MS, LISTENER.BACKOFF_BASE_MS * 2 ** (n - 1));
}

// THE POISON-MESSAGE ESCAPE. `true` once a single message has held the head of its
// channel's queue for the whole ladder. The alternative — retry forever — trades a
// bounded, announced loss for an unbounded, silent stall of every LATER message in
// that channel, which is strictly worse than the bug being fixed.
function deferralExhausted(attempts) {
  return (Number(attempts) || 0) >= LISTENER.DISPATCH_MAX_ATTEMPTS;
}

// Per-ENTRY, and only ever for ONE seq: drainPage stops at the first message that will
// not dispatch, so there is exactly one head to count. A different seq resets the count,
// which is what makes the ladder measure THIS message rather than the channel's history.
function noteDeferral(entry, seq) {
  const d = entry.deferral;
  entry.deferral = d && d.seq === seq ? { seq: seq, attempts: d.attempts + 1 } : { seq: seq, attempts: 1 };
  return entry.deferral.attempts;
}

function clearDeferral(entry, seq) {
  if (entry.deferral && entry.deferral.seq === seq) entry.deferral = null;
}
// ─── END DISPATCH-DEFERRAL ──────────────────────────────────────────────────

// C-3 — ONE PAGE OF MESSAGES, AND HOW FAR THE PERSISTED CURSOR MOVES OVER IT.
//
// THE DEFECT: `io.setCursor` ran BEFORE `dispatchMessage`, so the electron-store cursor
// was already past a message that then hit a downstream early return. A 15s wifi drop
// during the consent POST meant no consent row, nothing in Pending Requests, and a
// restart that re-awaited from the ADVANCED cursor — the peer's agent long-polls forever.
//
// WAS THE OLD ORDER LOAD-BEARING? It is not. The one comment in the tree that leans on it
// (session-park's FIX F4, "the listener advanced its cursor to that message's seq before
// dispatching it, so the fetch window always contains it") is stale: session-history's
// FIX F5 dropped `since` from that read entirely, so the window no longer depends on the
// cursor at all. And nothing a RE-dispatch could double-do: the two deferring returns are
// both upstream of `watcher.register`, `handleTrigger` is idempotent per (channel, seq)
// through the settled/pending checks, and the consent create is de-duped server-side on
// (operator, channel, kind, seq) — so a POST whose RESPONSE was lost returns the existing
// row rather than opening a second request.
//
// The real risk is the OTHER one: a message that can never dispatch would hold the head of
// this channel's queue forever. So the shape is advance-on-success + a bounded ladder +
// a loud poison escape (see DISPATCH-DEFERRAL above), not advance-always.
//
// Returns TRUE when the page was left unfinished on purpose; the loop then backs off and
// re-awaits from the held cursor instead of taking its normal idle.
async function drainPage(entry, msgs, myUserId) {
  const channelId = entry.channel.id;
  for (const m of msgs) {
    const seq = m.seq || 0;
    let deferred = null;
    try {
      deferred = await dispatchMessage(entry, m, myUserId);
    } catch (err) {
      // A THROW IS A DEFERRAL, not a dead channel. It used to escape into channelLoop's
      // caller, which stopped the loop for up to a 5-minute reconcile — with the cursor
      // already advanced past the message that threw.
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
  // A LINE WAS DROPPED HERE, not forgotten: the old body ended with
  // `if (msgs.length === 0 && maxSeq > since) io.setCursor(id, maxSeq)`, and `maxSeq` is
  // a reduce over `msgs` seeded with `since` — so on an EMPTY page it equals `since` and
  // the guard can never be true. It was unreachable, and reproducing it here would have
  // carried a dead branch into a function whose whole subject is when the cursor moves.
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
