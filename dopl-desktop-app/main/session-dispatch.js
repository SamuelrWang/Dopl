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
//   (2) maybeOpenRequesterSession — MY OWN first-class create_task addressed to a peer
//       auto-opens a REQUESTER window that drives the task. One window per (channel,
//       task); a cap/no-sdk/disabled skip returns false → classify 'ignore's my own
//       message (today's behavior), with a passive local notice on a window cap.
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
//   (4) maybeOpenRequesterShell — MY OWN, HUMAN-TYPED create addressed to a peer (the request
//       the operator types in the app's web view, which carries no desktop runtime stamp)
//       opens a PINNED SHELL: window + transcript, agent NOT started. See the route.
//   (5) noteRequestLifecycle — NOT a route. An observation the listener makes ahead of all of
//       the above, advancing that shell's status line from lifecycle events already on the wire.
//   (6) maybeReopenAddressedThread — THE ONE POST-CLASSIFY ROUTE. A peer's FOLLOW-UP to an
//       exchange this machine already answered reopens THAT window instead of raising a second
//       consent. It runs from the listener's 'trigger' branch, not from the pre-classify list;
//       the route states why below.

const settings = require('./settings');
const targeting = require('./targeting');
const io = require('./listener-io');
const roster = require('./channel-roster'); // 2026-08-01: WHO wrote the message being fed
const store = require('./session-store'); // (6): the durable record that says this exchange ran here
const sessionEngine = require('./session-engine');
const { notifyLocal } = require('./channel-post');
const { diag } = require('./diag');

// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──
// Node-only routing — every dependency (settings, targeting, sessionEngine, io,
// notifyLocal, diag) is a module-scope binding the test injects, so the routing truth
// table is pinned without any host-bound module import.

function feedLiveSession(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
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
    // words a machine wrote. roster.authorLabel says which it was. A self-echo cannot reach
    // this route at all (the `m.authorUserId === myUserId` conjunct above), so the label is
    // the only thing that changes here.
    authorName: roster.authorLabel(entry.channel.id, m),
  });
}

// FIX L3 — the runtime conjunct is the ONE gate rejection with no other symptom.
// Every other conjunct that refuses a window describes a message that was never
// mine to drive; this one refuses MY OWN create of MY OWN thread, and the whole
// visible effect is "no window opened", which is also exactly what an EXTERNAL
// session's create is supposed to look like. If the server ever stops stamping
// (a desktop shipped ahead of the server, a header renamed, a proxy dropping
// X-Dopl-Runtime), desktop-spawned requester windows silently stop opening and
// nothing in the logs says why. So when a message clears every conjunct EXCEPT
// the stamp, name the stamp we actually saw.
function diagRuntimeGateSkip(m, myUserId) {
  if (!m || m.kind !== 'message' || !myUserId) return;
  if (!targeting.firstClassTaskId(m)) return;
  if (m.authorUserId !== myUserId) return;
  if (targeting.metaStr(m, 'taskCreatedBy') !== myUserId) return;
  const target = targeting.metaStr(m, 'taskTarget');
  if (!target || target === myUserId) return;
  const stamp = targeting.metaStr(m, 'runtime');
  if (stamp === 'desktop-session') return; // not the runtime conjunct that refused
  diag(
    'requester window skipped: metadata.runtime',
    stamp ? `'${stamp}'` : '(absent)',
    "!== 'desktop-session' — expected for my EXTERNAL session (it awaits the reply itself); if this WAS a desktop-spawned session, the server is not stamping the X-Dopl-Runtime header (version skew)"
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
    authorName: roster.authorLabel(entry.channel.id, m), // the AUTHOR, not just the account
  });
  if (ok) diag('requester reply gated', 'task', taskId.slice(0, 8));
  return ok;
}
// (4) THE OPERATOR'S OWN TYPED REQUEST -> A PINNED SHELL (2026-08-02).
//
// THE GAP: a request the operator types in the app's own web view opened NOTHING on their
// machine. The view posts from the browser (cookies, no X-Dopl-Runtime header), so the server
// stamps no `runtime` key, and route (2)'s WAKE-V1 conjunct — written so a thread my EXTERNAL
// Claude Code session opened would not get a competing window — refused it for exactly the same
// reason it refuses an external agent's create. Clicking the thread later opened history with no
// session, and the peer's accept or decline was invisible until a reply arrived.
//
// Runs AFTER route (2), so a DESKTOP-spawned session's create is claimed there and never gets
// here; targeting.requesterShellOpen ALSO refuses a stamped message, so the two are exclusive in
// both directions rather than by ordering alone. An EXTERNAL agent's create is refused by the
// author-kind conjunct and still opens nothing at all.
//
// A SHELL, NOT A SESSION. openRequesterShell opens the window and starts no query, which is what
// makes it safe to open on a caller-asserted author kind: it spends nothing, posts nothing and
// wakes only on the operator's own turn or an accepted reply. It counts against the same
// MAX_WINDOWS budget as every other shell and is evictable while the operator has not touched it.
async function maybeOpenRequesterShell(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  if (!targeting.requesterShellOpen(m, myUserId)) return false;
  const taskId = targeting.firstClassTaskId(m);
  if (sessionEngine.hasLiveSession({ channelId: entry.channel.id, taskId })) return true;
  const target = targeting.metaStr(m, 'taskTarget');
  const res = await sessionEngine.openRequesterShell({
    channelId: entry.channel.id,
    taskId,
    workspaceId: entry.workspaceId,
    counterpartyId: target, // FIX L1 binding: only this member's replies may ever feed the shell
    direct: entry.channel.isDirect === true, // H2: in a DM the server addresses this session's posts
    context: {
      channelName: entry.channel.name,
      taskTitle: targeting.metaStr(m, 'taskTitle'),
      authorName: io.displayNameFor(target), // startSession reads counterpartyName off this
      channelId: entry.channel.id,
      workspaceId: entry.workspaceId,
      taskId,
    },
  });
  // ONE DIAG LINE PER AUTO-OPEN, and one per refusal with its reason. Ids only, as 8-char
  // prefixes: no request body, no thread title, no member id.
  if (res && res.ok) {
    diag('requester shell opened', entry.channel.id.slice(0, 8), 'thread', taskId.slice(0, 8));
    return true;
  }
  diag('requester shell not opened', entry.channel.id.slice(0, 8), 'thread', taskId.slice(0, 8),
    'reason', (res && res.reason) || 'unknown');
  return false;
}

// (5) THE REQUEST LIFECYCLE STRIP — AN OBSERVATION, NOT A ROUTE.
//
// It claims no message and short-circuits nothing: the listener calls it ahead of the routes,
// the same way it observes the peer's stamped build, because the events it reads are already
// spoken for or reach nobody. A peer's reply belongs to route (1); the milestones reach no route
// at all (every one of them gates on kind === 'message'). All this does is advance the small
// status line on the shell the operator's own request opened. A session with no strip — every
// responder, every team shell, every plain reopen — is untouched, because only openRequesterShell
// arms one.
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

// (6) THE FOLLOW-UP REOPENS THE WINDOW THAT ANSWERED IT (2026-08-02).
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
// WHY IT IS POST-CLASSIFY, AND THE ONLY ONE. The four routes above exist because classify would
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
    authorName: roster.authorLabel(channelId, m),
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
  maybeOpenRequesterShell, // (4) the operator's own typed request
  noteRequestLifecycle, // (5) the strip observer — claims nothing
  maybeReopenAddressedThread, // (6) POST-classify: a peer's follow-up reopens the window that answered
  exchangeTag, // ...and its two helpers, exported for the truth table
  reopenableRecord,
};
