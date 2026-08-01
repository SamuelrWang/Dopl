// Channels listener — passive task-reply notification (Feature 4, requester side).
//
// When the REQUESTER receives an inbound reply that belongs to an INTERACTIVE
// task they created, classify() (targeting.js) returns the 'task-reply' verdict.
// Such a reply is not a new request: it needs NO consent row, NO watcher record,
// NO spawn. It is simply news — "a reply arrived in your thread". This module fires
// a single silent OS notification for that and, on click, opens the channel via
// the SAME injected-handler seam trigger.sendFyi uses (targeting.openChannelForEntry,
// wired from index.js through targeting.setHandlers). No token use, no API write.
//
// It lives in its own tiny module because trigger.js (430/500) and
// session-spawner.js (443/500) sit at the eslint max-lines cap; the passive path
// must not grow either of them.
//
// EXTRACTION NOTE: `taskReplyNotice` is a pure, plain `function` declaration (like
// classify/metaStr) so test/task-notify.test.mjs can slice + evaluate its body
// verbatim without loading Electron. Keep it free of braces inside its
// strings/comments/regex or the test's brace-balancing extractor breaks.

const { Notification } = require('electron');
const io = require('./listener-io');
const targeting = require('./targeting');
const { metaStr, truncate } = targeting;
const { diag } = require('./diag');

// Pure: build the passive { title, body } for a thread reply from the message +
// pre-resolved channel/responder names. Prefers the server-stamped thread title for
// the headline (falling back to the channel name), and the server-stamped summary
// for the body (falling back to a truncated body excerpt).
// The `taskTitle` metadata key is the wire spelling (wire name `task` == domain name
// `thread`); the words the operator READS carry no "task" at all.
function taskReplyNotice(m, channelName, responderName) {
  const taskTitle = metaStr(m, 'taskTitle');
  const where = taskTitle || channelName || 'a channel';
  const detail = metaStr(m, 'summary') || truncate(m && m.body, 120);
  const title = 'Reply in ' + where;
  const body = responderName ? responderName + ': ' + detail : detail;
  return { title: title, body: body };
}

// Fire the silent notice. Silent because this is news, not a decision prompt; the
// requester chose interactive mode and will read the reply when they open the
// channel. Best-effort — a missing Notification API or a torn-down window is fine.
function notifyTaskReply(entry, m) {
  const channelName = entry && entry.channel && entry.channel.name;
  const responderName = io.displayNameFor(m && m.authorUserId);
  const notice = taskReplyNotice(m, channelName, responderName);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: notice.title, body: notice.body, silent: true });
      n.on('click', () => targeting.openChannelForEntry(entry));
      n.show();
    }
  } catch (_) { /* best-effort */ }
  const cid = entry && entry.channel && entry.channel.id ? entry.channel.id.slice(0, 8) : '?';
  diag('task-reply notify', cid, 'seq', m && m.seq, metaStr(m, 'taskTitle') ? 'titled' : 'channel');
}

// ── D2: an AGENT addressing ME, the human (the escalation path) ──────────────
//
// Multiplayer gives agents one way to reach a person: address that person. classify returns
// 'agent-escalation' for it, and the whole outcome is THIS notification. It must never
// spawn: the agent asked a HUMAN, and answering with another machine's agent is both the
// wrong answer and the loop the law forbids. There is no consent row, no watcher record and
// no session — the same "news, not a decision" shape as a thread reply, one module over.
//
// The copy NAMES THE HANDLE, because "an agent needs you" is not actionable in a room that
// holds several. The handle is RESOLVED BY THE CALLER (listener-messages, off
// channel-agents' authenticated roster) and passed in, never looked up here and never read
// off the message: this module's whole guarantee is that it cannot reach the spawn / gate /
// consent machinery, and that guarantee is pinned as its DEPENDENCY SET
// (test/wake-external-requester.test.mjs). An unresolved handle degrades to the owner's
// name plus a generic word rather than printing a UUID at a person.
//
// Pure like its twin, and brace-free inside its strings/comments so the source-slicing
// harness can evaluate it verbatim.
function agentEscalationNotice(m, channelName, ownerName, handle) {
  const who = handle ? '@' + handle : 'An agent';
  const whose = ownerName ? ' (' + ownerName + "'s agent)" : '';
  const where = channelName || 'a channel';
  const detail = metaStr(m, 'summary') || truncate(m && m.body, 120);
  return { title: who + whose + ' needs you in ' + where, body: detail };
}

// Fire it. NOT silent: unlike a thread reply, this is somebody waiting on a person — it is
// the one passive path where the operator is the blocker. Click opens the channel through
// the same injected handler every other notification uses.
function notifyAgentEscalation(entry, m, handle) {
  const channelName = entry && entry.channel && entry.channel.name;
  const channelId = entry && entry.channel && entry.channel.id;
  const ownerName = io.displayNameFor(m && m.authorUserId);
  const notice = agentEscalationNotice(m, channelName, ownerName, handle);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: notice.title, body: notice.body });
      n.on('click', () => targeting.openChannelForEntry(entry));
      n.show();
    }
  } catch (_) { /* best-effort */ }
  const cid = channelId ? String(channelId).slice(0, 8) : '?';
  diag('agent-escalation notify', cid, 'seq', m && m.seq, handle ? 'handle' : 'unnamed', '- no spawn');
}

// ── FIX S2: somebody addressed an agent of mine that is DISMISSED ────────────
//
// The routing rule refuses a `dismissed` row by design — the row keeps its handle so old
// messages stay attributable, and it starts nothing. What that refusal ALSO used to do was
// fall through to classify, where the owner bridge (to_user_id = the agent's owner = me)
// turned it into a 'trigger': a consent card and a pair ASSIST session, spawned in place of
// the agent that was named. A dismissed agent's message started a session.
//
// The refusal now stops at the route and produces THIS instead — the same shape as a thread
// reply, one function up: news, silent, no consent row, no watcher record, no session. It
// lives here rather than in channel-agents.js so this module's pinned DEPENDENCY SET stays
// the guarantee it is (test/wake-external-requester.test.mjs): the passive lane still cannot
// reach anything that could spawn, gate or record a consent.
//
// Pure like its twins, and brace-free inside its strings/comments for the slicing harness.
function agentDismissedNotice(m, channelName, authorName, handle) {
  const who = handle ? '@' + handle : 'an agent';
  const where = channelName || 'a channel';
  const asked = authorName || 'Someone';
  const detail = metaStr(m, 'summary') || truncate(m && m.body, 120);
  return {
    title: asked + ' addressed ' + who + ' in ' + where,
    body: 'That agent is dismissed, so nothing ran. ' + detail,
  };
}

// ── ONE NOTIFICATION PER BURST (2026-08-01, the adversarial review of F1-F7) ──
//
// WHAT CHANGED UNDER THIS. Before F1 a `task_*` addressed to a dismissed row produced NOTHING at
// all: the kind gate in routeAddressedAgent refused every milestone before the roster was ever
// consulted. F1 opened that gate, so a peer agent logging progress at a retired handle now
// yields the 'dismissed' verdict ONCE PER POST — and milestone volume is the whole point of
// milestones. The verdict is right and the notice is right; firing it per post is not. An agent
// mid-run can post a dozen task_progress lines in a minute, and each one would raise its own
// banner saying the same thing about the same dead handle.
//
// SO IT IS SUPPRESSED PER (CHANNEL, AGENT), FOR A WINDOW. The first post of a burst notifies;
// everything about the same retired agent in the same channel for SUPPRESS_WINDOW_MS is silent.
// A different agent, or the same agent in a different channel, is a different fact and notifies
// on its own. After the window the next post notifies again, which is what keeps this a rate
// limit rather than a mute: if a peer is still addressing a dismissed agent five minutes later,
// the operator should hear about it again.
//
// LOCAL, AND IT STAYS LOCAL. A plain Map with an LRU cap, held in this module — no timer, no
// disk, and above all NO NEW IMPORT: this module's dependency set is a pinned invariant
// (test/wake-external-requester.test.mjs), and it is the guarantee that the passive lane cannot
// reach anything that spawns, gates or records a consent. Losing the map on a restart is
// correct: a fresh run has no burst to be in the middle of.
//
// ─── BEGIN TASK-NOTIFY-SUPPRESS (injectable; unit-tested via source extraction) ───
// The only dependency in this block is its own state, so the test slices it whole and drives
// the REAL suppression rule with an explicit clock.

const SUPPRESS_WINDOW_MS = 5 * 60 * 1000; // one notice per (channel, agent) per burst
const SUPPRESS_CAP = 50; // (channel, agent) pairs remembered at once

const dismissedSeen = new Map(); // `${channelId}:${agentId}` -> when we last notified, ms

function suppressKey(channelId, agentId) {
  return String(channelId || '') + ':' + String(agentId || '');
}

// PURE-ish: may this dismissal notify NOW? Answers yes exactly once per (channel, agent) per
// window and RECORDS that answer, so the caller has nothing to remember. Insertion order is age
// order, so one pass from the front drops whatever is over the cap — the same LRU shape
// channel-threads uses for its participant cache.
//
// A clock that went BACKWARDS (a system time change) is treated as a new burst rather than as a
// suppression that never expires: `now - last` negative falls through to notify.
function mayNotifyDismissed(channelId, agentId, nowMs) {
  const now = Number(nowMs) || Date.now();
  const key = suppressKey(channelId, agentId);
  const last = dismissedSeen.get(key);
  if (typeof last === 'number') {
    const age = now - last;
    if (age >= 0 && age < SUPPRESS_WINDOW_MS) return false;
  }
  dismissedSeen.delete(key);
  dismissedSeen.set(key, now);
  for (const oldest of dismissedSeen.keys()) {
    if (dismissedSeen.size <= SUPPRESS_CAP) break;
    dismissedSeen.delete(oldest);
  }
  return true;
}

// ─── END TASK-NOTIFY-SUPPRESS ─────────────────────────────────────────────────

// Silent: nobody is blocked on the operator here. The agent is gone, the message is on
// record, and the click opens the channel through the same injected handler as every other
// notification in this module.
//
// The AGENT the suppression is keyed on is the addressed id off the message — the same field the
// caller resolved the handle from (listener-messages) — so a burst aimed at one retired row is
// one notice, and a second retired row in the same channel still gets its own.
function notifyAgentDismissed(entry, m, handle) {
  const channelName = entry && entry.channel && entry.channel.name;
  const channelId = entry && entry.channel && entry.channel.id;
  const cid = channelId ? String(channelId).slice(0, 8) : '?';
  if (!mayNotifyDismissed(channelId, metaStr(m, 'to_agent_id'))) {
    diag('agent-dismissed notify SUPPRESSED', cid, 'seq', m && m.seq, '- same agent, same burst');
    return;
  }
  const authorName = io.displayNameFor(m && m.authorUserId);
  const notice = agentDismissedNotice(m, channelName, authorName, handle);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: notice.title, body: notice.body, silent: true });
      n.on('click', () => targeting.openChannelForEntry(entry));
      n.show();
    }
  } catch (_) { /* best-effort */ }
  diag('agent-dismissed notify', cid, 'seq', m && m.seq, handle ? 'handle' : 'unnamed', '- no spawn');
}

module.exports = {
  notifyTaskReply,
  taskReplyNotice,
  notifyAgentEscalation,
  agentEscalationNotice,
  notifyAgentDismissed, // FIX S2: a retired agent was addressed — news, never a spawn
  agentDismissedNotice,
  mayNotifyDismissed, // one notice per (channel, agent) per burst, now that milestones reach here
  SUPPRESS_WINDOW_MS,
  SUPPRESS_CAP,
};
