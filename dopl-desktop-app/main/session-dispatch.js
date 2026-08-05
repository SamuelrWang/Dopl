// Session-window dispatch — the listener's pre-classify routing (v2.2 Session Window).
//
// Extracted from channel-listener.js to keep that AT-CAP file under 500 lines
// (contract §O-7 / F-09c) and to make room for the item 3 secondary path. Three
// routes, checked in order BEFORE classify → consent (§A.2). All SHORT-CIRCUIT when
// window-mode is OFF, so the classify path stays byte-for-byte legacy behavior — no
// engine call happens at all in legacy mode. `myUserId` is passed in (the listener
// owns identity resolution); a null identity fails closed.
//
//   (1) feedLiveSession        — a LIVE session for this (channel,task) consumes an
//       inbound COUNTERPARTY reply as its NEXT TURN (the loop continuation, no new
//       consent modal). FIX L1: ONLY the task's actual other party feeds; a THIRD
//       member posting in the same channel can never inject a turn.
//   (2) maybeOpenRequesterSession — MY OWN first-class thread opener addressed to a peer
//       auto-opens a REQUESTER window that drives the thread. One window per (channel,
//       task); a cap/no-sdk/disabled skip returns false → classify 'ignore's my own
//       message (today's behavior), with a passive local notice on a window cap.
//       ONE BEHAVIOUR, NOT TWO (2026-08-05, rollback plan §3.4): this claims BOTH desktop
//       runtimes now — a session this app spawned AND the operator typing in the app's own
//       UI. There used to be a fifth route opening a dormant SHELL for the second case,
//       because the app's UI posted with no runtime stamp and the only thing left to route
//       on was a caller-asserted author kind. main/ui-bridge.js stamps `desktop-ui` now, so
//       the evidence is server-side and both cases start the agent. The shell — and its
//       predicate, its route and its park entry point — is DELETED, not disabled.
//   (3) maybeSurfaceRequesterReply — a peer reply in a task I REQUESTED whose live
//       window has already SETTLED. v2.5 D1 REPLACES the v2.2 bounded auto-resume:
//       the same trigger and the same window surfacing, but the reply is HELD at the
//       inbound gate instead of being fed as a continuation turn, and a retained
//       sdkSessionId is no longer required (feedInboundForTask recreates the shell from
//       the durable record; a shell with nothing to resume shows the channel history).
//       Deduped by hasLiveSession; the reopened window is the operator's OWN task and
//       gated tools still gate (§H-4). Reuses the classify task-reply pairing
//       predicate (taskCreatedBy === me && author === the task's target) WITHOUT
//       perturbing classify's 1536-case table. `false` (no record at all) falls through
//       to classify, where the 'task-reply' verdict still fires the passive notice.
//   (4) noteRequestLifecycle — NOT a route. An observation the listener makes ahead of all of
//       the above, advancing the request status line on the session route (2) opened for the
//       operator's OWN typing, from lifecycle events already on the wire.
//   (5) maybeReopenAddressedThread — THE ONE POST-CLASSIFY ROUTE. A peer's FOLLOW-UP to an
//       exchange this machine already answered reopens THAT window instead of raising a second
//       consent. It runs from the listener's 'trigger' branch, not from the pre-classify list;
//       the route states why below.

const settings = require('./settings');
const targeting = require('./targeting');
const io = require('./listener-io');
const store = require('./session-store'); // (5): the durable record that says this exchange ran here
const sessionEngine = require('./session-engine');
const { notifyLocal } = require('./channel-post');
const { diag } = require('./diag');

// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──

// WHO WROTE THIS MESSAGE, for the wrapper a session is fed it inside.
//
// `io.displayNameFor` names the ACCOUNT a post was made from, and a peer's AGENT posts from
// the peer's account, so "<name> replied in the channel..." credited a person for words a
// machine wrote (incident 2026-08-01). `author_kind` is what tells the two apart, and it is
// derived server-side from the caller's credential rather than claimed on the wire.
//
// IT USED TO NAME A HANDLE. `channel-roster.authorLabel` resolved `metadata.author_agent_id`
// against the channel's agent roster and answered "quartz, Ada's agent" - one authenticated
// GET per channel per reconcile pass, kept warm for exactly this line. Named agents are gone
// (channels rollback, plan section 1): nothing stamps that key on a new message, no handle is
// addressable, and the roster read went with the summoning it existed for. The distinction
// this line is actually for - person or machine - survives intact, and the WEB transcript
// still resolves handles on OLD rows through the read that survived there.
//
// Inside the PURE block on purpose: the truth tables slice this block whole and drive the
// real routes, so a helper the routes call has to be sliced with them.
function authorLabel(m) {
  const person = String((io.displayNameFor(m && m.authorUserId)) || '').trim();
  if (!(m && m.authorKind === 'agent')) return person;
  return person ? person + "'s agent" : 'an agent';
}
// Node-only routing — every dependency (settings, targeting, sessionEngine, io,
// notifyLocal, diag) is a module-scope binding the test injects, so the routing truth
// table is pinned without any host-bound module import.

function feedLiveSession(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  // P0-4 DECISION (2026-08-04) — THIS FILTER STAYS, and the reason it stays is
  // the reason it was dangerous before.
  //
  // It was dangerous because PROSE COULD RIDE IN A task_* KIND: a responder's
  // whole answer arrived as `task_finished` and this line dropped it, so the
  // peer's live session was never fed the thing it was waiting for. With the
  // server refusing those three kinds from an agent
  // (`service-writes.assertLifecycleKindIsServerOwned`), a non-'message' post
  // reaching here is now one of exactly two things, and NEITHER is a turn:
  //   - a LIFECYCLE marker written by a runtime or by a thread close. It says
  //     something about a SESSION, and feeding it would answer a machine's
  //     status line as though a person had spoken.
  //   - a `task_progress` MILESTONE. Feeding those would spend one turn of the
  //     peer's session per milestone — on a stream the product tells agents to
  //     post freely as work lands — which is a cost with no message in it.
  // Widening it would also un-do the loop brake in the one place a loop is
  // cheapest to start.
  //
  // What a milestone DOES reach is `channel-agents.routeAddressedAgent`, which
  // delivers task_* kinds to an agent that is addressed or is a participant of
  // the thread (F1, `test/channel-milestone-kinds.test.mjs`). That is the
  // deliberate lane for them, and it is unaffected by this line.
  if (!m || m.kind !== 'message') return false;
  if (!myUserId || m.authorUserId === myUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  if (!sessionEngine.hasLiveSession({ channelId: entry.channel.id, taskId })) return false;
  // FIX L1: feed ONLY the session's actual counterparty (the task's other party).
  const counterparty = sessionEngine.counterpartyFor({ channelId: entry.channel.id, taskId });
  if (!counterparty || m.authorUserId !== counterparty) return false;
  return sessionEngine.feedInbound({
    channelId: entry.channel.id,
    taskId,
    message: m.body,
    // THE ATTRIBUTION (incident 2026-08-01). `io.displayNameFor(m.authorUserId)` names the
    // ACCOUNT a post was made from, and a peer's AGENT posts from the peer's account — so the
    // wrapper this text ends up in ("<name> replied in the channel…") credited a person for
    // words a machine wrote. `authorLabel` says which it was. A self-echo cannot reach this
    // route at all (the `m.authorUserId === myUserId` conjunct above), so the label is the
    // only thing that changes here.
    authorName: authorLabel(m),
  });
}

// FIX L3 — the runtime conjunct is the ONE gate rejection with no other symptom.
// Every other conjunct that refuses a window describes a message that was never
// mine to drive; this one refuses MY OWN create of MY OWN thread, and the whole
// visible effect is "no window opened", which is also exactly what an EXTERNAL
// session's create is supposed to look like. If the server ever stops stamping
// (a desktop shipped ahead of the server, a header renamed, a proxy dropping
// X-Dopl-Runtime), desktop requester windows silently stop opening and nothing
// in the logs says why. So when a message clears every conjunct EXCEPT the
// stamp, name the stamp we actually saw.
//
// 2026-08-05: there are TWO stamps to miss now, and the second widened what this
// line has to explain. An unstamped create is the EXPECTED shape for the
// operator's external Claude Code session — but it is also what the app's own UI
// looks like when main stopped attaching the header (ui-bridge.js) or the server
// refused it (an agent credential claiming `desktop-ui`), and that failure is
// invisible everywhere else.
function diagRuntimeGateSkip(m, myUserId) {
  if (!m || m.kind !== 'message' || !myUserId) return;
  if (!targeting.firstClassTaskId(m)) return;
  if (m.authorUserId !== myUserId) return;
  if (targeting.metaStr(m, 'taskCreatedBy') !== myUserId) return;
  const target = targeting.metaStr(m, 'taskTarget');
  if (!target || target === myUserId) return;
  // Rollback §3.5 — a DECLARED handoff clears the stamp conjunct in the external
  // session's place, so `requesterTaskOpen` returned true and this diag is not
  // even reached; the mirror agrees explicitly so a future reorder cannot make
  // it misreport a handoff open as a skew skip.
  if (targeting.declaresHandoff(m)) return;
  const stamp = targeting.metaStr(m, 'runtime');
  if (targeting.DESKTOP_RUNTIMES.indexOf(stamp) !== -1) return; // not the runtime conjunct that refused
  diag(
    'requester window skipped: metadata.runtime',
    stamp ? `'${stamp}'` : '(absent)',
    'is neither', targeting.DESKTOP_RUNTIMES.join(' nor'),
    '— expected for my EXTERNAL session (it awaits the reply itself); if this WAS this app, the X-Dopl-Runtime stamp is not reaching the message (version skew, or a credential the server refused the desktop-ui claim to)'
  );
}

async function maybeOpenRequesterSession(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  if (!targeting.requesterTaskOpen(m, myUserId)) {
    diagRuntimeGateSkip(m, myUserId);
    return false;
  }
  const taskId = targeting.firstClassTaskId(m);
  if (sessionEngine.hasLiveSession({ channelId: entry.channel.id, taskId })) return true;
  const res = await sessionEngine.launchRequesterSession({
    channelId: entry.channel.id,
    taskId,
    workspaceId: entry.workspaceId,
    goal: m.body,
    counterpartyId: targeting.metaStr(m, 'taskTarget'), // FIX L1: the member the task addresses
    direct: entry.channel.isDirect === true, // H2: in a DM the server addresses this session's posts
    // v2.x: the CONCRETE ids ride the context as well — prompt-framing's delivery section
    // reads only the context, and a requester told just the channel's display name could
    // not fill dopl_channel's required `channel=` (nor the workspace a multi-workspace
    // token demands), so it hunted with op "list" instead of posting. 2026-07-31: taskId
    // joins them, so the delivery call NAMES the thread and every post this session makes
    // threads instead of arriving on the peer as a brand-new request.
    context: {
      channelName: entry.channel.name,
      targetName: io.displayNameFor(targeting.metaStr(m, 'taskTarget')),
      taskTitle: targeting.metaStr(m, 'taskTitle'),
      channelId: entry.channel.id,
      workspaceId: entry.workspaceId,
      taskId,
    },
    toolProfile: targeting.resolveToolProfile(entry.channel),
    mode: targeting.metaStr(m, 'taskMode') || 'autonomous',
  });
  if (res && res.sessionId) {
    diag('requester session opened', String(res.sessionId).slice(0, 8), 'task', taskId.slice(0, 8));
    // THE REQUEST LIFECYCLE STRIP, armed for the OPERATOR'S OWN typing only (2026-08-05).
    // It answers a question this session cannot: the peer's Accept and Decline arrive as
    // task_started / task_failed MILESTONES, and every route here gates on
    // kind === 'message', so the running agent never sees either. A session-posted create
    // is left exactly as it was — that session is already narrating in its own window, and
    // "the request I sent" is not a statement it is making.
    if (targeting.requesterTypedByOperator(m)) {
      sessionEngine.armRequestStatus({ channelId: entry.channel.id, taskId });
    }
    return true;
  }
  diag('requester session not opened:', (res && res.skipped) || 'unknown');
  if (res && res.skipped === 'cap') {
    notifyLocal('Dopl: session window limit reached', `"${entry.channel.name}" will notify you of replies instead.`);
  }
  return false;
}

async function maybeSurfaceRequesterReply(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  if (!m || m.kind !== 'message' || !myUserId || m.authorUserId === myUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  if (!taskId) return false;
  // I am the REQUESTER and the author is the task's target (the responder replying).
  if (targeting.metaStr(m, 'taskCreatedBy') !== myUserId) return false;
  if (targeting.metaStr(m, 'taskTarget') !== m.authorUserId) return false;
  if (sessionEngine.hasLiveSession({ channelId: entry.channel.id, taskId })) return false;
  // v2.5 D1: recreate the shell (if a durable record survives) and HOLD the reply for
  // the operator's Accept. The engine owns the record / window-budget / profile checks.
  const ok = await sessionEngine.feedInboundForTask({
    channelId: entry.channel.id,
    taskId,
    message: m.body,
    authorName: authorLabel(m), // the AUTHOR, not just the account
  });
  if (ok) diag('requester reply gated', 'task', taskId.slice(0, 8));
  return ok;
}
// (4) THE REQUEST LIFECYCLE STRIP — AN OBSERVATION, NOT A ROUTE.
//
// It claims no message and short-circuits nothing: the listener calls it ahead of the routes,
// the same way it observes the peer's stamped build, because the events it reads are already
// spoken for or reach nobody. A peer's reply belongs to route (1); the milestones reach no route
// at all (every one of them gates on kind === 'message'). All this does is advance the small
// status line on the session the operator's own typed request opened. A session with no strip —
// every responder, every team shell, every plain reopen, and every requester session a SPAWNED
// session's create opened — is untouched, because route (2) arms one only for `desktop-ui`.
//
// IT OUTLIVED THE SHELL IT WAS BUILT FOR (2026-08-05). The strip shipped on a dormant requester
// SHELL; that shell is gone and the operator's typed request now opens a full session instead.
// The line survives because the question it answers survives and the session cannot answer it:
// Accept and Decline arrive as task_started / task_failed MILESTONES, and every route in this
// file gates on kind === 'message', so the running agent never sees either one.
//
// The three transitions are exactly the facts on the wire:
//   task_started by the peer -> Accepted. They took the request.
//   task_failed + declined   -> Declined. `declined` is a server-reserved calm flag, re-stamped
//                               only for a poster entitled to the thread tag, so a third member
//                               cannot fabricate somebody else's outcome onto my thread.
//   a kind='message' reply   -> Replied.
// BOUND TO THE PAIR: the thread has to be one I created and the author has to be the member I
// addressed, so a third member posting in my thread moves nothing.
//
// A task_failed with NO declined flag is a real error on the peer's side, not a decline, and v1
// has no word for it — the strip holds where it is rather than say the wrong thing.
const REQUEST_MILESTONES = { task_started: 'accepted', task_failed: 'declined' };

function noteRequestLifecycle(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  if (!m || !myUserId || !m.authorUserId || m.authorUserId === myUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  if (!taskId) return false;
  if (targeting.metaStr(m, 'taskCreatedBy') !== myUserId) return false;
  if (targeting.metaStr(m, 'taskTarget') !== m.authorUserId) return false;
  const status = m.kind === 'message' ? 'replied' : REQUEST_MILESTONES[m.kind];
  if (typeof status !== 'string') return false; // an inherited key is not a milestone
  if (status === 'declined' && !(m.metadata && m.metadata.declined === true)) return false;
  if (!sessionEngine.noteRequestStatus({ channelId: entry.channel.id, taskId }, status)) return false;
  diag('request strip', entry.channel.id.slice(0, 8), 'thread', taskId.slice(0, 8), status);
  return true;
}

// (5) THE FOLLOW-UP REOPENS THE WINDOW THAT ANSWERED IT (2026-08-02).
//
// THE INCIDENT, from a real transcript. A peer's external session posted an UNTAGGED request;
// this machine minted the ad-hoc thread tag `task-<channel>-<seq>`, raised consent, and a pair
// session answered and posted task_finished. The calm close SETTLED that session and destroyed
// its window, keeping only the durable record. The peer then posted a FOLLOW-UP correctly
// tagged with that same thread — the MCP copy tells them to keep the tag, and the server lets
// it stand because they opened the exchange. On this machine the tag was DOUBLY INVISIBLE:
// firstClassTaskId is UUID-gated (correctly — a legacy id is caller-settable), so routes (1)
// and (3) saw no thread at all; and the task-scoped reopen machinery was wired only to the
// requester-side reply surfacing and the operator's own reopen click. So the follow-up fell
// through to classify -> 'trigger' -> a BRAND NEW consent window, sitting next to the window
// that holds the exchange it was answering.
//
// WHY IT IS POST-CLASSIFY, AND THE ONLY ONE. The three routes above exist because classify would
// reach the WRONG VERDICT for the messages they claim. Here classify is right: this really is a
// request addressed to me and it really does want a decision. What is wrong is WHERE the
// decision is asked for. So the seam belongs at the verdict -> action boundary, and putting it
// there buys the safety property by CONSTRUCTION rather than by predicate care: 'task-reply',
// 'fyi', 'agent-escalation', the chat suppression and 'ignore' cannot be diverted by a route
// that only ever runs after classify already said 'trigger'. The requester-side directions
// (Q3b) are self-authored, so classify 'ignore's them and they never reach this line either.
//
// NO CONSENT ROW IS CREATED ON THIS PATH, and that is not a gap. The message is delivered
// through the IN-WINDOW INBOUND GATE — the same v2.5 surface a LIVE session's inbound uses —
// so the operator's Messages posture decides it: manual/ask holds it as an Accept card in the
// window that has the exchange's history, auto_inbound feeds it. The recreated shell starts NO
// agent (the parked-shell machinery), restores its profile fail-restrictively from the record,
// and spends nothing until that Accept.
//
// FAILS TO TODAY'S BEHAVIOR ON EVERY MISS. No tag, a tag from another channel, no durable
// record (expired by the 30-day TTL, pruned by the 200-record LRU, or never one), a record
// bound to a different member, or a window budget with nothing to free: the route answers
// false, the listener raises the fresh consent, and nothing about this path was reached.
async function maybeReopenAddressedThread(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  if (!m || m.kind !== 'message') return false;
  // THE RESPONDER-SIDE PREDICATE, stated rather than inherited. Two conjuncts, both about who
  // this message is FROM and TO — the requester-side routes above turn on exactly the opposite
  // pair, so no message can satisfy both.
  //   PEER-AUTHORED. My own message opens threads, it does not answer them; a self-authored
  //     line reaching here would reopen a window against my own words.
  //   NOT SOMEBODY ELSE'S. An explicit addressee that is not me is a message I am watching,
  //     not one I owe an answer to. Absent is allowed: in a DM the server addresses the peer
  //     automatically, and classify's implicit 1:1 rule is what earned the 'trigger'.
  if (!myUserId || !m.authorUserId || m.authorUserId === myUserId) return false;
  const addressee = targeting.metaStr(m, 'to_user_id');
  if (addressee && addressee !== myUserId) return false;
  const channelId = entry && entry.channel ? String(entry.channel.id || '') : '';
  const taskId = exchangeTag(m, channelId);
  if (!taskId) return false;
  const rec = store.getRecord(store.sessionKey(channelId, taskId));
  if (!reopenableRecord(rec, channelId, taskId, m.authorUserId)) return false;
  // The engine owns the rest: a LIVE session for this slot is fed directly, a settled one is
  // recreated through the parked-shell path (window budget, evict-then-fail included) and the
  // message is held on it. A refusal is a plain false and the listener carries on to consent.
  const ok = await sessionEngine.feedInboundForTask({
    channelId,
    taskId,
    message: m.body,
    // The AUTHOR, not the account: a peer's agent posts from the peer's account, and the
    // wrapper this text lands in names whoever this says wrote it.
    authorName: authorLabel(m),
  });
  diag('thread follow-up', channelId.slice(0, 8), 'thread', taskId.slice(0, 8),
    ok ? 'reopened in place (gated)' : 'not reopened — falling through to consent');
  return ok;
}

// The (channel, thread) STORAGE TAG this message carries, or '' for one this machine could
// never have keyed a session under. Exactly two spellings are honored:
//   FIRST-CLASS  a UUID `metadata.taskId`, read through the same UUID gate every other route
//                uses. Nothing about the id says which channel it belongs to, so the slot key
//                below is what confines the lookup to THIS channel.
//   LEGACY       the ad-hoc id this machine mints for an untagged request, which is
//                deterministic from (channel, seq). It is re-derived through the canonical
//                minter and compared for equality — never pattern-matched loosely — so this
//                reader can never disagree with the one that wrote the tag.
// THE CHANNEL IS THE CROSS-CHANNEL FENCE: a legacy tag names its channel inline, so one minted
// somewhere else answers '' here instead of being looked up against this channel's slot.
function exchangeTag(m, channelId) {
  const firstClass = targeting.firstClassTaskId(m);
  if (firstClass) return firstClass;
  if (!channelId) return '';
  const tag = targeting.metaStr(m, 'taskId');
  const seq = tag.slice(('task-' + channelId + '-').length);
  if (!/^[1-9][0-9]*$/.test(seq)) return ''; // the same positive-integer seq the minter demands
  return targeting.legacyThreadId(channelId, seq) === tag ? tag : '';
}

// May this durable record be reopened for this message? FAIL CLOSED on every count — a miss
// costs a consent prompt, which is today's behavior, while a false positive would put a
// stranger's words into somebody else's exchange window.
//   THE RECORD IS THIS THREAD'S. `metadata.taskId` is caller-settable for a legacy id, so the
//     record found under the slot key is re-checked against the (channel, thread) it claims.
//   IT IS A PAIR RECORD. A summoned TEAM session is keyed (channel, AGENT) in the same key
//     space, and an agent id is a UUID like a first-class thread id — so a tag naming one of my
//     agents would otherwise resolve to that agent's slot. An agentId disqualifies the record.
//   THE AUTHOR IS ITS COUNTERPARTY. The FIX L1 binding, read off the record instead of off a
//     live session object: only the member this exchange ran against may continue it, so a
//     third member stamping an old tag gets the ordinary consent card and nothing else. A
//     record with no stored counterparty (a shell opened from a group channel) qualifies
//     nobody.
function reopenableRecord(rec, channelId, taskId, authorUserId) {
  if (!rec || typeof rec !== 'object') return false;
  if (String(rec.channelId || '') !== channelId) return false;
  if (String(rec.taskId || '') !== taskId) return false;
  if (rec.agentId) return false;
  return !!rec.counterpartyId && rec.counterpartyId === authorUserId;
}
// ─── END SESSION-DISPATCH-PURE ─────────────────────────────────────────────────

module.exports = {
  feedLiveSession,
  maybeOpenRequesterSession,
  maybeSurfaceRequesterReply,
  noteRequestLifecycle, // (4) the strip observer — claims nothing
  maybeReopenAddressedThread, // (5) POST-classify: a peer's follow-up reopens the window that answered
  exchangeTag, // ...and its two helpers, exported for the truth table
  reopenableRecord,
};
