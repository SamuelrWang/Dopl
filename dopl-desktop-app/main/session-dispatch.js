// Session dispatch — the listener's pre-classify routing.
//
// ⚠ ONE ROUTE SURVIVES (2026-08-20, F-228). This file held FIVE, and four of them opened on a
// master-switch read that Samuel's live-test ruling turned permanently false. They are deleted
// with the machinery they drove — and the switch itself is gone too, a wave later:
//
//   (2) maybeOpenRequesterSession   MY OWN thread opener minted a REQUESTER WINDOW on MY OWN
//                                   machine and launched my agent against my own message. This
//                                   is the self-trigger bug the retirement was ruled from.
//   (3) maybeSurfaceRequesterReply  a peer reply on a thread I requested, HELD at that window's
//                                   inbound gate. No window, no gate, no hold.
//   (4) noteRequestLifecycle        advanced the request STRIP in the window chrome.
//   (5) maybeReopenAddressedThread  a peer follow-up reopened the window that answered it,
//                                   via the shell-recreate lane.
//
// `diagRuntimeGateSkip`, `REQUEST_MILESTONES`, `exchangeTag` and `reopenableRecord` were
// helpers of those four alone and went with them.
//
//   (1) feedLiveSession — every message in a thread reaches EVERY live agent session this
//       machine is running on that thread. ⚠ DELIBERATELY UNGATED, and it always was: it
//       claims nothing into existence, and a live session's own existence is the gate.
//
// ── THE FAN-OUT (2026-08-21, Samuel's ruling 4) ───────────────────────────────────────────
//
// ⚠ THIS ROUTE USED TO FEED EXACTLY ONE SESSION EXACTLY ONE AUTHOR'S WORDS. It resolved THE
// session for (channelId, firstClassTaskId) and fed it only when `author === counterpartyFor(...)`,
// with the operator's own posts dropped outright (`m.authorUserId === myUserId` returned false).
// Both fences were correct for a world with ONE agent per thread and no way to talk to it in
// the channel. Multiplayer deletes the premise:
//
//   • N of MY agents may be live on one thread, so "the session" does not exist. Every one of
//     them is fed, EXCEPT the one that wrote the message.
//   • MY OWN posts are the operator steering their agents in the open, which is the product.
//     They are fed.
//   • A SIBLING AGENT'S posts are how two of my agents coordinate ("I'll take this one"). They
//     are fed to the siblings and never back to the author.
//
// ⚠ WHAT REPLACES THE COUNTERPARTY FENCE IS THE THREAD, AND THAT IS A REAL WIDENING, STATED
// PLAINLY. A third member of the channel posting INTO THIS THREAD now reaches my live agents as
// a turn, where before only the task's other party could. The thread is the scope Samuel ruled
// on ("every message in a thread feeds every live agent on it"), and the fences that survive
// are the ones that matter: nothing here MINTS a session, the body is still fenced as DATA
// (`session-seed.frameContinuation`), and the ADDRESSING LAW that decides whether a message may
// START an agent is untouched — `targeting.classify` is not consulted here and is not changed.
//
// ── THE SPAWN-IDLE WAKE RULE (2026-08-22, Samuel's ruling) ────────────────────────────────
//
// ⚠ ONE CLASS OF SESSION IS EXEMPT FROM THE FAN-OUT, AND IT IS EXEMPT UNTIL SOMEBODY DIRECTS IT.
// A SPAWN-IDLE agent (`sessions:launch` with `idle: true` — the New Agent button) is REGISTERED
// and has started no `claude` child at all: it holds a slot, a pill and an @-mention address, and
// `wakeEffects` starts its query on the first fed turn. Under the plain fan-out that first turn
// was whatever happened to be said next in the thread — so an agent an operator parked "ready"
// woke up on a passing remark between two other people, spent its launch on it, and answered
// something nobody asked it.
//
// SO AN UNWOKEN SPAWN-IDLE SESSION IS FED NOTHING. It wakes on exactly two things:
//   (a) A 1:1 MESSAGE from its own operator — `sessions:message` → `session-reopen.messageByTask`
//       → the reducer's `steer`, which is already a wake trigger and does not come through this
//       file at all.
//   (b) A THREAD OR MAIN-ROOM MESSAGE THAT @-MENTIONS ITS AGENT ID, from ANY author. ⚠ ANY: the
//       operator, a peer, or a PEER'S AGENT. That is Samuel's ruling verbatim ("user tells peer:
//       I'm going to wake another agent, you direct it"), and it is safe for the same reason the
//       parse itself is: an agent id is minted on this machine and known to no server, so a peer
//       can only name one they were told, and the parse is intersected with the ids actually live
//       on this thread.
//
// ⚠ EVERYTHING ELSE IS DROPPED, NOT QUEUED. There is no backlog to replay: the agent reads the
// thread ON DEMAND once directed, and that read costs no permission (`session-profiles.js ›
// isOwnChannelRead` scopes by channel only, and the windowless message floor auto-allows it), so
// nothing is lost by not pushing it. Queueing would only defer the same problem — a woken agent
// would open with a pile of context nobody addressed to it.
//
// ⚠ THE FLAG IS ITS OWN (`s.awaitingDirective`), NOT AN OVERLOAD OF `freshFraming`. That marker
// answers "does this turn carry the full framing", is consumed by `session-seed.takeFraming`, and
// is one-shot; this answers "may anything reach this agent yet", is read on every message, and is
// cleared by the WAKE rather than by the framing. Two questions, two fields — and the session
// engine clears this one at its single dispatch funnel so BOTH wake lanes clear it identically.
//
// ⚠ AND IT IS BELT-AND-BRACES. `session-gate.js › feedInbound` refuses the same message again,
// because this file is not the only thing that could ever call it.
//
// ⚠ SELF-FILTERING IS BY client_msg_id, NOT BY AUTHOR. Every agent on this machine posts under
// the OPERATOR'S OWN account with `authorKind: 'agent'`, so authorship cannot tell three of my
// agents apart, nor tell any of them from me. `session-outbound-tag.js` stamps each post with
// `agent-<agentId>-<n>` and the session records it (`session-engine.js › ownPostIds`), so a
// session recognises its own words coming back off the wire and nothing else does. A post that
// carries no id (an older build, a hand-made MCP call) is fed to everyone — including,
// harmlessly, its author, which is a duplicated turn rather than a lost one.

const targeting = require('./targeting');
const io = require('./listener-io');
const sessionEngine = require('./session-engine');
const { diag } = require('./diag');

// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──

// WHO WROTE THIS MESSAGE, for the wrapper a session is fed it inside.
// ⚠ `io.displayNameFor` names the ACCOUNT a post came from, and a peer's AGENT posts from the
// peer's account — so "<name> replied in the channel…" credits a person for a machine's words.
// `author_kind` tells the two apart and is derived server-side from the caller's credential,
// never claimed on the wire.
// ⚠ Inside the PURE block on purpose: the truth tables slice this block whole and drive the
// real routes, so a helper the routes call must be sliced with them.
function authorLabel(m) {
  const person = String((io.displayNameFor(m && m.authorUserId)) || '').trim();
  if (!(m && m.authorKind === 'agent')) return person;
  return person ? person + "'s agent" : 'an agent';
}

// THE @AGENT-ID PARSER, AND WHY IT LIVES ON THIS MACHINE (2026-08-21, ruling 5).
//
// ⚠ IT MUST NEVER BECOME A SERVER READ. `metadata.mentionedUserIds` is the server's stamped,
// unspoofable mention set, resolved against the channel ROSTER — and an agent id is not a
// member, so that resolver correctly answers "nobody". That fail-closed behaviour is right and
// stays: a caller-settable mention set is a notification-forgery primitive, and agent ids are
// minted per machine and known to no server. So the parse happens HERE, where the live agent
// ids are, and it decides nothing but FRAMING: an addressed message and an unaddressed one are
// both DELIVERED to every sibling (fan-out), and the difference is one sentence in the turn.
// Nothing about consent, triggering or tool grants reads this.
//
// The pattern is `agent-id.js`'s charset with a word boundary, and the result is INTERSECTED
// with the ids actually live on this thread — so `@deadbeef` in prose resolves to nothing, and
// a peer cannot address an agent that is not mine because they cannot know its id.
function mentionedAgentIds(body, liveIds) {
  const out = [];
  if (!liveIds || !liveIds.length) return out;
  const text = String(body == null ? '' : body);
  const re = new RegExp('@([a-z][a-z0-9]{7})(?![a-z0-9-])', 'g');
  let hit = re.exec(text);
  while (hit) {
    const id = hit[1];
    if (liveIds.indexOf(id) !== -1 && out.indexOf(id) === -1) out.push(id);
    hit = re.exec(text);
  }
  return out;
}

// The ADDRESSING verdict for one reader, handed to the framing.
//   null                       nobody was addressed — an ordinary thread message
//   { me: true,  ids: [...] }  this agent is one of the addressees
//   { me: false, ids: [...] }  somebody else's agent was addressed; read it as context only
function addressingFor(myAgentId, addressed) {
  if (!addressed || !addressed.length) return null;
  return { me: addressed.indexOf(String(myAgentId || '')) !== -1, ids: addressed };
}

// TRUE iff this session is the one that WROTE this message — the only exclusion in the fan-out.
function wroteIt(s, m) {
  const id = m && m.clientMsgId;
  if (!id || !s || !s.ownPostIds) return false;
  return s.ownPostIds.has(String(id));
}

// TRUE iff this session is a SPAWN-IDLE agent nobody has directed yet. ⚠ `=== true` ONLY, so a
// session object that predates the flag — or any shape that simply does not carry it — keeps the
// plain fan-out behaviour. A wake rule that fails toward "feed it" is the safe direction here:
// the failure it guards is a wasted launch, not a leak.
function unwoken(s) {
  return !!(s && s.awaitingDirective === true);
}

// May this message reach this session at all? The fan-out's ONE hold-back, and it is not a
// consent decision: an unwoken spawn-idle agent takes ONLY a message that names it.
function mayFeed(s, addressing) {
  if (!unwoken(s)) return true;
  return !!(addressing && addressing.me === true);
}

function feedLiveSession(entry, m, myUserId) {
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all. Safe only because the server refuses task_* kinds from an agent
  // (service-writes.assertLifecycleKindIsServerOwned), so prose can no longer ride in one. What
  // still arrives is a LIFECYCLE marker (a statement about a SESSION, not a person speaking) or
  // a `task_progress` MILESTONE (feeding those spends one peer turn per milestone, on a stream
  // the product tells agents to post freely). Widening it also un-does the loop brake where a
  // loop is cheapest to start.
  if (!m || m.kind !== 'message') return false;
  // ⚠ IDENTITY IS STILL REQUIRED AND STILL FAILS CLOSED. It no longer EXCLUDES my own posts —
  // that is the fan-out ruling — but a machine that cannot say who it is has no business
  // deciding which of its agents a message is for.
  if (!myUserId) return false;
  // ⚠ AN AUTHOR-LESS POST FAILS CLOSED, and it survived the fan-out ruling unchanged. What the
  // ruling removed was the comparison `authorUserId === myUserId` (my own posts are fed now);
  // the EXISTENCE check is a different rule — a row with no author is a system row, nobody
  // spoke, and `authorLabel` would credit the words to nothing.
  if (!m.authorUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  const thread = { channelId: entry.channel.id, taskId: taskId };
  const live = sessionEngine.liveOnThread(thread);
  if (!live.length) return false;
  const addressed = mentionedAgentIds(m.body, live.map((s) => String(s.agentId || '')));
  const authorName = authorLabel(m); // the AUTHOR, not just the account — see authorLabel
  let fed = 0;
  let held = 0; // spawn-idle agents nobody has directed yet — see THE SPAWN-IDLE WAKE RULE above
  for (const s of live) {
    if (wroteIt(s, m)) continue; // never feed a session its own post back
    // ruling 5: parsed here, consumed by `session-seed.frameContinuation`. Framing only —
    // EXCEPT for the one session class below, where it is also the wake key.
    const addressing = addressingFor(s.agentId, addressed);
    if (!mayFeed(s, addressing)) { held += 1; continue; }
    const ok = sessionEngine.feedInbound({
      channelId: entry.channel.id,
      taskId: taskId,
      agentId: s.agentId,
      message: m.body,
      seq: m.seq, // the turn's seq — the windowless outbound bridge's thread join
      authorName: authorName,
      addressing: addressing,
    });
    if (ok) fed += 1;
  }
  if (fed || held) {
    // ⚠ THE HELD COUNT IS ON THE LINE ON PURPOSE. A spawn-idle agent that never wakes looks
    // identical, from the outside, to one this machine failed to route to — and the whole point
    // of the rule is that the drop is DELIBERATE. Without this the only evidence of a working
    // hold-back is an absence.
    diag('fan-out', entry.channel.id.slice(0, 8), 'seq', m.seq,
      'fed', fed, 'of', live.length, held ? `held:${held} (awaiting a directive)` : '',
      addressed.length ? `addressed:${addressed.join(',')}` : 'unaddressed');
  }
  return fed > 0;
}

// ─── END SESSION-DISPATCH-PURE ─────────────────────────────────────────────────

module.exports = { feedLiveSession, mentionedAgentIds, addressingFor, mayFeed };
