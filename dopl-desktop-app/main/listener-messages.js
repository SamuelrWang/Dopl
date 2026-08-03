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
const channelAgents = require('./channel-agents'); // D2: the @-addressed agent route
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
  // nothing and changes no verdict; it advances one status line on the shell route (4) opened,
  // and answers false for every session that never sent a request.
  sessionDispatch.noteRequestLifecycle(entry, m, myUserId);
  // D2 — ADDRESSING WINS, so it is checked FIRST. A message naming one of THIS operator's
  // agents (`metadata.to_agent_id`) belongs to that agent's own session and to nothing
  // else. Ahead of feedLiveSession deliberately: an addressed message that also carries a
  // thread id must not be eaten as the next turn of a pair session that happens to be live
  // on that thread.
  //
  // FIX S2 — A REFUSAL IS NOT A FALL-THROUGH. The route answers four verdicts (see
  // channel-agents.js), and only the EMPTY one means "not this lane". A message that named
  // one of my agents and could not be delivered used to fall through to classify, where the
  // owner bridge's `to_user_id = me` made it a 'trigger' — a consent card and a pair ASSIST
  // spawn, standing in for the agent that was actually addressed.
  const routed = await channelAgents.routeAddressedAgent(entry, m, myUserId);
  // 'dismissed' — a retired agent starts NOTHING, and the operator hears about it on the
  // same passive news path as a thread reply (no consent row, no watcher record, no spawn).
  if (routed === 'dismissed') {
    taskNotify.notifyAgentDismissed(entry, m, channelAgents.handleFor(entry.channel.id, targeting.metaStr(m, 'to_agent_id')));
    return;
  }
  if (routed) return; // 'fed' or 'refused': either way the message is spoken for
  // v2.2 session-window dispatch, checked BEFORE classify → consent (§A.2):
  //   1. feed a LIVE session's next turn; 2. auto-open a REQUESTER window on my
  //   own create_task; 3. reopen a SETTLED-yet-resumable requester on a peer reply.
  if (sessionDispatch.feedLiveSession(entry, m, myUserId)) return;
  if (await sessionDispatch.maybeOpenRequesterSession(entry, m, myUserId)) return;
  if (await sessionDispatch.maybeSurfaceRequesterReply(entry, m, myUserId)) return;
  //   4. open a PINNED SHELL for MY OWN, HUMAN-TYPED request to a peer. Route 2 claims a thread
  //      a DESKTOP-spawned session opened; this claims the one the operator typed in the app's
  //      web view, which carries no runtime stamp and so looked exactly like an EXTERNAL agent's
  //      create to route 2. LAST of the four on purpose: it only ever sees my own message, which
  //      none of the three above can claim, and a stamped create is refused by the predicate as
  //      well as by this ordering.
  if (await sessionDispatch.maybeOpenRequesterShell(entry, m, myUserId)) return;
  // FIX B1: say so when the "address to act" law is being evaluated against a roster this
  // run has never successfully read. The count classify uses is then the durable last-known
  // one (or 0 for a channel never known to hold agents), which fails CLOSED toward the law —
  // but a field log has to be able to say that is what happened.
  if (entry.rosterKnown !== true) {
    diag('agents: classify on UNKNOWN roster', entry.channel.id.slice(0, 8), 'seq', m.seq, 'last known teamAgents', Number(entry.teamAgents) || 0);
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
  // ROUTE (6) — REOPEN IN PLACE, and it is the ONE route that runs AFTER classify.
  //
  // The four routes above are pre-classify because classify reaches the WRONG VERDICT for the
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
  // D2 (escalation): an agent addressed ME, the human. A notification and nothing else —
  // no consent row, no watcher record, no spawn. Answering a person's question with a
  // machine is the loop the law forbids.
  // The HANDLE is resolved here, off the authenticated roster, and handed over: task-notify
  // deliberately requires nothing that could spawn, gate or record a consent, and that
  // dependency set is a pinned invariant.
  else if (verdict === 'agent-escalation') taskNotify.notifyAgentEscalation(entry, m, channelAgents.handleFor(entry.channel.id, targeting.metaStr(m, 'author_agent_id')));
}

module.exports = { dispatchMessage };
