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

// TWO PASSIVE AGENT NOTICES lived here and are gone with named agents (channels rollback §1):
//
//   `notifyAgentEscalation` — classify's 'agent-escalation' verdict, a teammate's NAMED agent
//   addressing a PERSON. It named the handle, resolved by the CALLER off the authenticated
//   roster and passed in so this module's DEPENDENCY SET could not grow.
//
//   `notifyAgentDismissed` (FIX S2) — somebody addressed a DISMISSED agent of mine, which the
//   routing rule refused. It carried a per-(channel, agent) suppression window so a burst
//   aimed at one retired row was one notice.
//
// Neither verdict is reachable: nothing stamps `author_agent_id` or `to_agent_id` any more,
// and there are no rows to dismiss. What they were built to protect SURVIVES and is what this
// module still is — a passive lane that cannot reach anything which could spawn, gate or
// record a consent, pinned as its dependency set in test/wake-external-requester.test.mjs.

module.exports = {
  notifyTaskReply,
  taskReplyNotice,
};
