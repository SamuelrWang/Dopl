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
//   (3) maybeSurfaceRequesterReply — item 3 secondary. A peer reply in a task I
//       REQUESTED whose live window has already SETTLED, reopened as a bounded
//       continuation ONLY when a resumable sdkSessionId survived (an idle/interrupt
//       end KEEPS it; a close/completed/failed CLEARS it → today's passive notify).
//       Deduped by hasLiveSession; the reopened window is the operator's OWN task and
//       gated tools still gate (§H-4). Reuses the classify task-reply pairing
//       predicate (taskCreatedBy === me && author === the task's target) WITHOUT
//       perturbing classify's 1536-case table.

const settings = require('./settings');
const targeting = require('./targeting');
const io = require('./listener-io');
const sessionEngine = require('./session-engine');
const store = require('./session-store');
const { notifyLocal } = require('./channel-post');
const { diag } = require('./diag');

// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──
// Node-only routing — every dependency (settings, targeting, sessionEngine, io, store,
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
    authorName: io.displayNameFor(m.authorUserId),
  });
}

async function maybeOpenRequesterSession(entry, m, myUserId) {
  if (!settings.getWindowMode()) return false;
  if (!targeting.requesterTaskOpen(m, myUserId)) return false;
  const taskId = targeting.firstClassTaskId(m);
  if (sessionEngine.hasLiveSession({ channelId: entry.channel.id, taskId })) return true;
  const res = await sessionEngine.launchRequesterSession({
    channelId: entry.channel.id,
    taskId,
    workspaceId: entry.workspaceId,
    goal: m.body,
    counterpartyId: targeting.metaStr(m, 'taskTarget'), // FIX L1: the member the task addresses
    context: {
      channelName: entry.channel.name,
      targetName: io.displayNameFor(targeting.metaStr(m, 'taskTarget')),
      taskTitle: targeting.metaStr(m, 'taskTitle'),
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
  const key = store.sessionKey(entry.channel.id, taskId);
  const sdkId = store.getSdkSessionId(key);
  if (!sdkId) return false; // no resumable session → today's passive task-reply notify
  const rec = store.getRecord(key);
  if (!rec) return false;
  const ok = await sessionEngine.resumeRequesterForReply(rec, sdkId, {
    message: m.body,
    authorName: io.displayNameFor(m.authorUserId),
  });
  if (ok) diag('requester continuation reopened', 'task', taskId.slice(0, 8));
  return ok;
}
// ─── END SESSION-DISPATCH-PURE ─────────────────────────────────────────────────

module.exports = { feedLiveSession, maybeOpenRequesterSession, maybeSurfaceRequesterReply };
