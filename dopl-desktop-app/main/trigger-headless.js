// Channels listener — the HEADLESS FALLBACK lane (§2 split, 2026-08-04).
//
// Extracted from trigger.js when that file reached the 500-line cap. The seam is a
// real one rather than arithmetic: `trigger.js` owns the CONSENT pipeline (create
// the row, register it, resolve the operator's answer) and the SESSION lane, which
// is the default executor; this owns what happens when there is no session window —
// window mode off, or an engine skip (cap / no SDK / disabled). That lane has its
// own shape end to end: it spawns headlessly, cannot show a live gate, and therefore
// routes its reply through an OUTBOUND REVIEW the operator approves before anything
// reaches the channel.
//
// The two peer-facing replies live here too, because both lanes send them and a
// second copy of either is a second voice for the same product.
//
// PRESERVED INVARIANTS: error suppression (an errored spawn posts NO reply and opens
// NO outbound review — that would leak local machine state), single-resolve via
// watcher.settle, deterministic taskId / clientMsgId.

const consent = require('./consent');
const watcher = require('./consent-watcher');
const targeting = require('./targeting');
const spawner = require('./session-spawner');
const claudeAuth = require('./claude-auth');
const queued = require('./queued-notice');
const { postTaskEvent, postResult, postCourtesy, notifyLocal } = require('./channel-post');
const { diag } = require('./diag');

const RESEND =
  "I'm still finishing a previous request in this channel — please resend in a moment.";

// H1 (LOW): the HONEST version of the above for the one case where "still finishing" is false.
// A session HELD on the sign-in action occupies the registry slot while running nothing, so the
// old copy told the peer to resend into a slot that will not free itself — the operator has to
// sign in on that Mac first, and nothing was saying so. No local detail leaks: it names the
// state, not the machine, the account, or the error.
const AUTH_HELD_REPLY =
  "I can't run this right now — my Claude Code sign-in on this machine needs attention. I'll pick it up once that's sorted.";

// Headless mode: spawn, then (on a clean reply) open an outbound review. D4:
// task_started fires from onStart, which runs only once the pool slot is claimed for a
// real spawn, so a busy/no-cli skip can never orphan a task_started.
async function runHeadlessApproved(entry, m, rec, { taskId, startedAt, requesterName }) {
  diag('spawn mode: headless', 'profile', rec.toolProfile);
  const result = await spawner.runForChannel({
    channelId: entry.channel.id,
    // D1: the FIRST-CLASS thread id only, NOT taskIdFor's legacy fallback. It picks the pool
    // slot AND the resume id, so two threads of one channel run concurrently, while a legacy
    // inbound (undefined here) collapses to the channel's single slot exactly as before —
    // `task-<channel>-<seq>` is per-MESSAGE, so keying on it would never reuse or resume one.
    taskId: rec.taskId,
    message: m.body,
    context: { channelName: entry.channel.name, authorName: requesterName, authorKind: m.authorKind },
    toolProfile: rec.toolProfile,
    onStart: () => postTaskEvent(entry, m, 'task_started', taskId),
  });

  if (result.skipped === 'busy') {
    // Same notice; D1 changed what defers it (this SESSION runs, or the pool is at its cap).
    await queued.announce(entry, m, taskId, 'headless');
    await postCourtesy(entry, m, RESEND); // P1-5: a no-op must not trigger the peer
    watcher.settle(rec.key, 'busy');
    return;
  }
  if (result.skipped) {
    watcher.settle(rec.key, 'no-cli'); // e.g. 'no-cli' — stay silent (H1)
    return;
  }
  diag('spawn result:', `text ${String(result.text || '').length} chars${result.isError ? ' (error)' : ''}`);

  // Error suppression: an errored run (expired CLI login, timeout, crash) must NOT
  // reply into the shared channel and opens NO outbound review — that would leak
  // local machine state. Close the lifecycle with a generic task_failed (no
  // declined flag → a real failure) and surface it locally only.
  if (result.isError) {
    await postTaskEvent(entry, m, 'task_failed', taskId, { durationMs: Date.now() - startedAt });
    const authText = result.errorDetail || result.text || '';
    if (claudeAuth.isAuthShapedError(authText)) {
      diag('spawn auth-shaped error -> sign-in flow');
      claudeAuth.startSignInFlow({
        getClaudeBin: () => spawner.getClaudeBinPath(),
        channelName: entry.channel.name,
      });
    } else {
      diag('error reply suppressed (local notify only)');
      notifyLocal(
        `Dopl: channel request failed in "${entry.channel.name}"`,
        targeting.truncate(result.text || 'The agent could not complete this request.', 160)
      );
    }
    watcher.settle(rec.key, 'error');
    return;
  }

  await openOutboundReview(entry, m, rec, { taskId, startedAt, text: result.text });
}

// Clean reply → create the outbound review row and move the request to its
// await-outbound phase. The drafted reply is carried on the record so a restart
// can still post it on Send. No blocking — Send/Cancel arrive via the notification
// or the web list and the watcher drives the post.
async function openOutboundReview(entry, m, rec, { taskId, startedAt, text }) {
  if (!text) {
    await postTaskEvent(entry, m, 'task_finished', taskId, { durationMs: Date.now() - startedAt });
    watcher.settle(rec.key, 'no-reply');
    return;
  }
  const reply = consent.clampBody(text); // clamp ONCE: review == posted, byte-for-byte
  const created = await consent.createConsentRequest(rec.workspaceId, {
    channelId: entry.channel.id,
    kind: 'outbound',
    messageSeq: rec.seq,
    summary: `Reply from your agent in "${entry.channel.name}"`,
    bodyPreview: targeting.truncate(reply, 2000),
    proposedReply: reply,
  });
  if (!created) {
    // Fail closed: no review row → do not post; tell the operator locally.
    await postTaskEvent(entry, m, 'task_failed', taskId, { durationMs: Date.now() - startedAt });
    notifyLocal(
      `Dopl: couldn't queue a reply for review in "${entry.channel.name}"`,
      'Your agent drafted a reply but the review could not be created. Open Dopl and try again.'
    );
    watcher.settle(rec.key, 'error');
    return;
  }
  watcher.toOutbound(rec.key, { rowId: created.rowId, taskId, startedAt, proposedReply: reply });
  if (!created.status || created.status === 'pending') {
    consent.notifyOutbound({
      channelName: entry.channel.name,
      proposedReply: reply,
      onSend: () => {
        // F-067: a Send whose PATCH dies re-notifies instead of vanishing.
        consent.submitDecision(rec.workspaceId, created.rowId, 'allow', {
          channelName: entry.channel.name,
          onOpen: () => targeting.openChannelForEntry(entry),
        });
        watcher.poke(rec.key);
      },
      onOpen: () => targeting.openChannelForEntry(entry),
    });
  }
  watcher.poke(rec.key); // resolve a born-decided outbound row at once
}

module.exports = { AUTH_HELD_REPLY, RESEND, runHeadlessApproved };
