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
  // v2.2 session-window dispatch, checked BEFORE classify → consent (§A.2):
  //   1. feed a LIVE session's next turn; 2. auto-open a REQUESTER window on my
  //   own create_task; 3. reopen a SETTLED-yet-resumable requester on a peer reply.
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
  if (verdict === 'trigger') await trigger.handleTrigger(entry, m);
  else if (verdict === 'fyi') trigger.sendFyi(entry, m);
  // Feature 4 (requester side): a reply in one of MY interactive tasks —
  // passive notify only. No consent row, no watcher record, no spawn.
  else if (verdict === 'task-reply') taskNotify.notifyTaskReply(entry, m);
}

module.exports = { dispatchMessage };
