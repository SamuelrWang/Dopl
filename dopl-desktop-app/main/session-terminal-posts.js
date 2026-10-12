// WHAT A SESSION'S END STILL OWES THE CHANNEL, and the one place a quit can wait for it.
//
// THE DEFECT (2026-10-12). A session ended at quit posts two things — the calm `task_progress`
// "This session went inactive." note (`trigger-outcomes.js › onEnded`) and, for a windowless
// agent, the drop report (`session-drop-notice.js › report`). BOTH were issued as
// `void Promise.resolve(post…)`: fire-and-forget, which is right while the app is running and
// wrong at the exact moment `quit-guard.js › teardown` calls `app.quit()` on the next tick. The
// process went away with the POST still in flight, so the peer whose card was pulsing "Working…"
// was never told anything — the one promise `quitDetailTail` makes out loud ("The person waiting
// is told the session went inactive") was the one the quit path could not keep.
//
// ⚠ IT IS A REGISTER, NOT A QUEUE. Nothing here sends, retries, re-orders or persists anything;
// the posts are already idempotent on their own deterministic `clientMsgId` and already carry
// their own retry budget (`channel-post.js › postWithRetry`). This holds the PROMISES so a
// caller that is about to kill the process can give them a bounded moment first. A queue would
// be a second delivery path beside `channel-post.js`, which is the shape this tree splits on
// purpose.
//
// ⚠ DEPENDENCY-FREE ON PURPOSE (no electron, no store, no diag) — the same argument as
// `deadline.js`: `test/quit-end-notice.test.mjs` drives the REAL shipped functions under
// `node --test` rather than a source-sliced copy, so the thing the quit path depends on is the
// thing that was tested. The logging is the caller's.
//
// ⚠ AND IT SELF-EMPTIES. Every tracked promise removes itself on settle, so a long-running app
// holds at most the posts actually in flight. A register that only grows is the shape this tree
// has been bitten by (see `trigger-outcomes.js › MAX_REMEMBERED_ENDS`); this one cannot, because
// the removal is the promise's own `finally` rather than a sweep somebody has to remember.

const pending = new Set();

/**
 * Register one terminal post. Returns the SAME promise so a call site reads as it did before
 * (`void track(Promise.resolve(post(…)).catch(…))`), and never changes its outcome.
 *
 * ⚠ A REJECTION IS STILL THE CALLER'S. Both call sites already `.catch` and diag their own
 * failure; swallowing here would take that line away from them. So the registered promise is
 * neutralised for `drain` only (below), not for the caller.
 */
function track(p) {
  const post = Promise.resolve(p);
  // The entry is the SETTLED-EITHER-WAY shadow, so `drain` can `Promise.all` without one failed
  // post rejecting the whole wait — and without this module needing a catch the caller sees.
  const entry = post.then(() => undefined, () => undefined);
  pending.add(entry);
  void entry.then(() => { pending.delete(entry); });
  return post;
}

/**
 * Everything registered and not yet settled, as ONE promise that cannot reject.
 *
 * ⚠ UNBOUNDED BY DESIGN, AND THE CALLER MUST BOUND IT. A post carries a 15-20s HTTP budget and
 * up to three attempts, which is right for a running app and absurd for a quit; the bound is a
 * QUIT-PERCEPTION number and belongs to the quit path (`quit-guard.js › FLUSH_DEADLINE_MS`), not
 * here. Awaiting this outright on the quit path is the bug, the same way awaiting
 * `session-state-push.flush()` outright would be.
 *
 * ⚠ A SNAPSHOT, so a post registered DURING the drain does not extend it. The quit path issues
 * every terminal post synchronously (`session-reopen.js › endLiveSessions`) before it gets here,
 * so there is nothing legitimate left to wait for, and an open-ended drain would be a second
 * unbounded await by another name.
 */
function drain() {
  if (pending.size === 0) return Promise.resolve();
  return Promise.all([...pending]).then(() => undefined);
}

/** How many posts are in flight. For the quit log and the tests; never a control surface. */
function pendingCount() {
  return pending.size;
}

module.exports = { track, drain, pendingCount };
