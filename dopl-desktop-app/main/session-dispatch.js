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

const settings = require('./settings');
const targeting = require('./targeting');
const io = require('./listener-io');
const roster = require('./channel-roster'); // 2026-08-01: WHO wrote the message being fed
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
// ─── END SESSION-DISPATCH-PURE ─────────────────────────────────────────────────

module.exports = {
  feedLiveSession,
  maybeOpenRequesterSession,
  maybeSurfaceRequesterReply,
  maybeOpenRequesterShell, // (4) the operator's own typed request
  noteRequestLifecycle, // (5) the strip observer — claims nothing
};
