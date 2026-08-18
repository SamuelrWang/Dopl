// Session-window dispatch — the listener's pre-classify routing.
//
// Three routes checked in order BEFORE classify -> consent (§A.2). ⚠ All SHORT-CIRCUIT when
// window-mode is OFF, so the classify path stays byte-for-byte legacy behavior — no engine call
// happens in legacy mode. `myUserId` is passed in (the listener owns identity resolution); a
// null identity fails closed.
//
//   (1) feedLiveSession — a LIVE session for this (channel,task) consumes an inbound
//       COUNTERPARTY reply as its NEXT TURN, no new consent modal. ⚠ ONLY the task's actual
//       other party feeds; a THIRD member in the same channel can never inject a turn.
//   (2) maybeOpenRequesterSession — MY OWN first-class thread opener addressed to a peer opens
//       a REQUESTER window driving the thread. One window per (channel, task); a
//       cap/no-sdk/disabled skip returns false and classify 'ignore's my own message, with a
//       passive local notice on a window cap. Claims BOTH desktop runtimes: a session this app
//       spawned AND the operator typing in the app's own UI (ui-bridge.js stamps `desktop-ui`).
//   (3) maybeSurfaceRequesterReply — a peer reply in a task I REQUESTED whose window has
//       SETTLED. The reply is HELD at the inbound gate, not fed as a continuation turn, and a
//       retained sdkSessionId is not required (feedInboundForTask recreates the shell).
//       Deduped by hasLiveSession; gated tools still gate (§H-4). ⚠ Reuses the classify
//       task-reply pairing predicate WITHOUT perturbing classify's 1536-case table. false falls
//       through to classify, where 'task-reply' still fires the passive notice.
//   (4) noteRequestLifecycle — NOT a route. An observation made ahead of the above, advancing
//       the request status line from lifecycle events already on the wire.
//   (5) maybeReopenAddressedThread — THE ONE POST-CLASSIFY ROUTE, run from the listener's
//       'trigger' branch. See the route for why.

const settings = require('./settings');
const targeting = require('./targeting');
const io = require('./listener-io');
const store = require('./session-store'); // (5): durable record proving this exchange ran here
const sessionEngine = require('./session-engine');
const { notifyLocal } = require('./channel-post');
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
// Node-only routing — every dependency (settings, targeting, sessionEngine, io, notifyLocal,
// diag) is a module-scope binding the test injects, so the truth table is pinned with no
// host-bound import.

function feedLiveSession(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all. Safe only because the server refuses task_* kinds from an agent
  // (service-writes.assertLifecycleKindIsServerOwned), so prose can no longer ride in one. What
  // still arrives is a LIFECYCLE marker (a statement about a SESSION, not a person speaking) or
  // a `task_progress` MILESTONE (feeding those spends one peer turn per milestone, on a stream
  // the product tells agents to post freely). Widening it also un-does the loop brake where a
  // loop is cheapest to start. Rendering is unaffected: the web transcript still draws
  // milestones (lib/group-thread.ts, components/activity-event-row.tsx).
  if (!m || m.kind !== 'message') return false;
  if (!myUserId || m.authorUserId === myUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  if (!sessionEngine.hasLiveSession({ channelId: entry.channel.id, taskId })) return false;
  // ⚠ Feed ONLY the session's actual counterparty (the task's other party).
  const counterparty = sessionEngine.counterpartyFor({ channelId: entry.channel.id, taskId });
  if (!counterparty || m.authorUserId !== counterparty) return false;
  return sessionEngine.feedInbound({
    channelId: entry.channel.id,
    taskId,
    message: m.body,
    authorName: authorLabel(m), // the AUTHOR, not just the account — see authorLabel
  });
}

// ⚠ The runtime conjunct is the ONE gate rejection with no other symptom. Every other conjunct
// refuses a message that was never mine to drive; this one refuses MY OWN create of MY OWN
// thread, and its whole visible effect ("no window opened") is also exactly what an EXTERNAL
// session's create should look like. If the stamp ever stops arriving (desktop shipped ahead of
// the server, header renamed, a proxy dropping X-Dopl-Runtime, or the server refusing an agent
// credential's `desktop-ui` claim), requester windows silently stop opening and nothing else
// says why. So when a message clears every conjunct EXCEPT the stamp, name the stamp we saw.
function diagRuntimeGateSkip(m, myUserId) {
  if (!m || m.kind !== 'message' || !myUserId) return;
  if (!targeting.firstClassTaskId(m)) return;
  if (m.authorUserId !== myUserId) return;
  if (targeting.metaStr(m, 'taskCreatedBy') !== myUserId) return;
  const target = targeting.metaStr(m, 'taskTarget');
  if (!target || target === myUserId) return;
  // ⚠ A DECLARED handoff clears the stamp conjunct, so requesterTaskOpen already returned true
  // and this diag is unreachable. Stated explicitly so a future reorder cannot misreport a
  // handoff open as a skew skip.
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
    counterpartyId: targeting.metaStr(m, 'taskTarget'), // L1: the member the task addresses
    direct: entry.channel.isDirect === true, // in a DM the server addresses this session's posts
    // ⚠ The CONCRETE ids must ride the context: prompt-framing's delivery section reads ONLY the
    // context, and a requester given just the channel's display name cannot fill dopl_channel's
    // required `channel=` (nor the workspace a multi-workspace token demands) and hunts with
    // op "list" instead of posting. taskId is what makes each post THREAD instead of arriving
    // on the peer as a brand-new request.
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
    // ⚠ Lifecycle strip, armed for the OPERATOR'S OWN typing ONLY. A session-posted create is
    // left alone — that session already narrates in its own window. The strip answers what the
    // session cannot: Accept/Decline arrive as task_started / task_failed MILESTONES and every
    // route here gates on kind === 'message'.
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
  // Recreate the shell (if a durable record survives) and HOLD the reply for the operator's
  // Accept. The engine owns the record / window-budget / profile checks.
  const ok = await sessionEngine.feedInboundForTask({
    channelId: entry.channel.id,
    taskId,
    message: m.body,
    authorName: authorLabel(m), // the AUTHOR, not just the account
  });
  if (ok) diag('requester reply gated', 'task', taskId.slice(0, 8));
  return ok;
}
// (4) AN OBSERVATION, NOT A ROUTE: claims no message and short-circuits nothing. The events it
// reads are already spoken for (a peer's reply belongs to route 1) or reach nobody (milestones
// gate out on kind === 'message' everywhere). It only advances the status line on the session
// the operator's own typed request opened; every other session is untouched because route (2)
// arms one only for `desktop-ui`.
//
// The three transitions are exactly the facts on the wire:
//   task_started by the peer -> Accepted.
//   task_failed + declined   -> Declined. ⚠ `declined` is a server-reserved calm flag,
//                               re-stamped only for a poster entitled to the thread tag, so a
//                               third member cannot fabricate somebody else's outcome.
//   a kind='message' reply   -> Replied.
// ⚠ BOUND TO THE PAIR: the thread must be one I created and the author must be the member I
// addressed, so a third member posting in my thread moves nothing.
// ⚠ A task_failed with NO declined flag is a real peer-side error, not a decline, and there is
// no word for it — the strip holds rather than say the wrong thing.
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

// (5) A PEER'S FOLLOW-UP REOPENS THE WINDOW THAT ANSWERED IT, instead of raising a second
// consent beside the window holding the exchange.
//
// ⚠ POST-CLASSIFY, AND THE ONLY ONE. Routes (1)-(3) exist because classify reaches the WRONG
// VERDICT for what they claim; here classify is RIGHT (this is a request addressed to me and it
// does want a decision) and only WHERE the decision is asked is wrong. Sitting at the
// verdict -> action boundary buys the safety property by CONSTRUCTION: 'task-reply', 'fyi', the
// chat suppression and 'ignore' cannot be diverted by a route that runs only after classify
// already said 'trigger'.
// ⚠ NO CONSENT ROW is created here, and that is not a gap: the message goes through the
// IN-WINDOW INBOUND GATE, the same surface a LIVE session's inbound uses, so the operator's
// Messages posture decides it. The recreated shell starts NO agent, restores its profile
// fail-restrictively, and spends nothing until the Accept.
// FAILS TO TODAY'S BEHAVIOR ON EVERY MISS (no tag, a tag from another channel, no durable
// record, a record bound to a different member, a full window budget): answers false, the
// listener raises the fresh consent.
async function maybeReopenAddressedThread(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  if (!m || m.kind !== 'message') return false;
  // The RESPONDER-SIDE predicate, stated rather than inherited — the requester-side routes turn
  // on exactly the opposite pair, so no message can satisfy both.
  //   PEER-AUTHORED: my own message opens threads, it does not answer them.
  //   NOT SOMEBODY ELSE'S: an explicit addressee that is not me is a message I watch, not one I
  //     owe an answer to. ⚠ Absent is still ALLOWED, but no longer because the server filled
  //     it in: DM auto-address and classify's implicit 1:1 rule both retired 2026-08-18, so
  //     an unaddressed post no longer earns a 'trigger' at all and cannot reach this route
  //     that way. What absence now covers is a STORED message from before the retirement,
  //     and an addressee-less lifecycle post from an installed desktop. The route still runs
  //     only under a 'trigger' verdict, which today means the post named me.
  if (!myUserId || !m.authorUserId || m.authorUserId === myUserId) return false;
  const addressee = targeting.metaStr(m, 'to_user_id');
  if (addressee && addressee !== myUserId) return false;
  const channelId = entry && entry.channel ? String(entry.channel.id || '') : '';
  const taskId = exchangeTag(m, channelId);
  if (!taskId) return false;
  const rec = store.getRecord(store.sessionKey(channelId, taskId));
  if (!reopenableRecord(rec, channelId, taskId, m.authorUserId)) return false;
  // The engine owns the rest: a LIVE session is fed directly, a settled one is recreated
  // through the parked-shell path (window budget, evict-then-fail included) and the message is
  // held on it. A refusal is a plain false and the listener carries on to consent.
  const ok = await sessionEngine.feedInboundForTask({
    channelId,
    taskId,
    message: m.body,
    authorName: authorLabel(m), // the AUTHOR, not the account
  });
  diag('thread follow-up', channelId.slice(0, 8), 'thread', taskId.slice(0, 8),
    ok ? 'reopened in place (gated)' : 'not reopened — falling through to consent');
  return ok;
}

// The (channel, thread) STORAGE TAG this message carries, or '' for one this machine could
// never have keyed a session under. Exactly two spellings:
//   FIRST-CLASS  a UUID `metadata.taskId`, through the same UUID gate every other route uses.
//   LEGACY       the ad-hoc id this machine mints for an untagged request, deterministic from
//                (channel, seq). ⚠ Re-derived through the canonical minter and compared for
//                EQUALITY, never pattern-matched loosely, so this reader can never disagree
//                with the one that wrote the tag.
// ⚠ THE CHANNEL IS THE CROSS-CHANNEL FENCE: a legacy tag names its channel inline, so one
// minted elsewhere answers '' rather than being looked up against this channel's slot.
function exchangeTag(m, channelId) {
  const firstClass = targeting.firstClassTaskId(m);
  if (firstClass) return firstClass;
  if (!channelId) return '';
  const tag = targeting.metaStr(m, 'taskId');
  const seq = tag.slice(('task-' + channelId + '-').length);
  if (!/^[1-9][0-9]*$/.test(seq)) return ''; // the same positive-integer seq the minter demands
  return targeting.legacyThreadId(channelId, seq) === tag ? tag : '';
}

// May this durable record be reopened for this message? ⚠ FAIL CLOSED on every count — a miss
// costs a consent prompt, a false positive puts a stranger's words into somebody else's window.
//   THE RECORD IS THIS THREAD'S: `metadata.taskId` is caller-settable for a legacy id, so the
//     record found under the slot key is re-checked against the (channel, thread) it claims.
//   IT IS A PAIR RECORD: a TEAM session is keyed (channel, AGENT) in the SAME key space and an
//     agent id is a UUID like a first-class thread id, so a tag naming one of my agents would
//     otherwise resolve to that agent's slot. An agentId disqualifies the record.
//   THE AUTHOR IS ITS COUNTERPARTY: the L1 binding read off the record. Only the member this
//     exchange ran against may continue it. A record with no stored counterparty (a shell
//     opened from a group channel) qualifies nobody.
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
