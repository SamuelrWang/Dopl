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

const targeting = require('./targeting');
const trigger = require('./trigger');
const taskNotify = require('./task-notify');
const sessionDispatch = require('./session-dispatch');
const versionSkew = require('./version-skew');
const { diag } = require('./diag');

// Route ONE message. Awaited by the loop, so a trigger's consent + spawn still
// serializes ahead of the next message in the page (unchanged from when this
// body lived inline).
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
  if (await sessionDispatch.maybeOpenRequesterSession(entry, m, myUserId)) return;
  if (await sessionDispatch.maybeSurfaceRequesterReply(entry, m, myUserId)) return;
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
    if (!(await sessionDispatch.maybeReopenAddressedThread(entry, m, myUserId))) await trigger.handleTrigger(entry, m);
  } else if (verdict === 'fyi') trigger.sendFyi(entry, m);
  // Feature 4 (requester side): a reply in one of MY interactive tasks —
  // passive notify only. No consent row, no watcher record, no spawn.
  else if (verdict === 'task-reply') taskNotify.notifyTaskReply(entry, m);
  // A FIFTH verdict, 'agent-escalation', reached a passive notifier here: a teammate's NAMED
  // agent addressing ME, the human, which had to be news rather than a request. It turned on
  // `metadata.author_agent_id` with no `to_agent_id` beside it, and nothing stamps either key
  // any more (channels rollback §1), so the verdict is unreachable and gone.
}

module.exports = { dispatchMessage };
