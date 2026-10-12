// C-8 — QUITTING WITH AGENTS IN FLIGHT.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-8). `before-quit` did two things: set
// `app.isQuitting` and stop the listener. It never iterated the session registry, never
// aborted a controller, and never flushed the final state push — and repo-wide the only
// `.kill(` in this tree is the auth pty. So every live `sdk.query()` left a bundled `claude`
// child RUNNING after the app was gone, still holding that session's pre-approved
// `dopl_channel` MCP access, still able to post into the channel on behalf of an operator
// whose app is closed. `session-engine`'s C3 teardown already solved exactly this for the
// CRASH path; the quit path simply never reached it, so this reuses that machinery rather
// than growing a second one.
//
// ── SAMUEL'S DECISIONS, AND WHERE EACH ONE LIVES ────────────────────────────────────────
//
// THE DIALOG NAMES WHAT IT IS ABOUT TO INTERRUPT. Not "3 agents are running" — the thread's
// title and the channel it is in, per row, because the whole point is that the operator can
// recognise the work. `sessionEngine.listOrphanRisk()` is that list, and it is the SAME
// predicate the teardown kills by ("holds a live child"), so the dialog can never name a set
// the quit does not act on.
//
// THREE BUTTONS, all real (2026-08-07 ruling, Cancel added 2026-08-30). "Quit anyway" kills
// now. "Wait for them to finish" waits for every agent to come off a turn and THEN quits by
// itself — "quit, but not on top of live work", not a disguised cancel. "Cancel" aborts the quit
// outright — "I did not mean this at all": no teardown, no latch, no pending auto-quit, and
// `app.isQuitting` back to false. Do not collapse Wait and Cancel; each is a separate ruling.
// Cancel takes `defaultId`/`cancelId`, because the safest of three is the one that does nothing.
//
// MID-TOOL-CALL IS NOT A REASON TO WAIT. On "Quit anyway" there is no grace period and no
// letting the current step land: the abort goes out with everything else. A tool call
// half-finished by a process that is going away is not worth the seconds, and the peer is
// told the session went inactive either way.
//
// THE PEER IS TOLD. Each killed session is ended through the reducer's `inactive` event —
// C-5's calm terminal — so the requester's card stops pulsing "Working…" instead of claiming
// work in progress on a machine that has quit. One terminal path, shared with the launch
// watchdog.
//
// ── THE TWO THINGS THAT MUST NOT GO WRONG ───────────────────────────────────────────────
//
// 1. QUITTING MUST ALWAYS REMAIN POSSIBLE. Every branch below is wrapped, and every failure
//    resolves the same way: let the quit happen. A dialog that throws, a registry that throws,
//    a network that hangs — none of them may trap an operator inside an app they asked to
//    close. `disarmed` is the one-way latch that guarantees a second pass cannot re-prompt.
// 2. THE QUIT MUST NOT FEEL BROKEN. Every final request is BOUNDED by a short deadline,
//    never awaited outright: `session-state-push.send` carries a 15s HTTP timeout and one
//    retry, which is right for a running app and absurd for a quit. If one has not landed
//    by then it is abandoned and said so BY NAME — the rows go stale, which is the same
//    outcome a crash produces and strictly better than a quit that appears to hang.
//
// ── 2026-10-12: THE TEARDOWN ORDER, AND WHY IT IS NOT THE OBVIOUS ONE ───────────────────
//
// The teardown ENDS THE SESSIONS BEFORE IT STOPS THE LISTENER, and it WAITS for the posts those
// ends issue. It used to do neither, and the cost was the one promise this module makes out
// loud: a live agent killed by a quit told its peer nothing at all, so a requester's card went
// on claiming "Working…" on a machine that had closed. Both halves are explained on `teardown`
// itself; the short version is that the ends' posts are fire-and-forget by design (right while
// the app runs, wrong one tick before `app.quit()`), and that `session-terminal-posts.js` is the
// register which makes them waitable without giving this tree a second delivery path.

const { app, dialog, Notification } = require('electron');
const { DEFAULT_IDLE_MS } = require('./session-state');
const { withDeadline, DEADLINE } = require('./deadline');
// What the ends still owe the channel. Required at module scope rather than lazily: this is the
// one thing the teardown MUST be able to wait for, so a missing module should fail loudly at
// boot, not silently skip the notice on the one code path nobody watches.
const terminalPosts = require('./session-terminal-posts');
const { diag } = require('./diag');

// How long the final wire traffic may hold the quit. Under two seconds still reads as immediate;
// past that the operator is watching an app refuse to close. Each is one small POST on an
// already-warm connection, so this is generous for the healthy case and the unhealthy case is
// precisely the one that must not be waited on.
//
// ⚠ IT BOUNDS THREE THINGS NOW, SHARING ONE WINDOW (2026-10-12): the ENDS' own terminal posts
// (`session-terminal-posts.drain`), the final `{sessions: []}` push, and the `away`/device-offline
// pair. All three are armed on the same tick, so this stays the worst case for the whole
// teardown — it is a quit-PERCEPTION number, not a per-request budget, and giving any of them
// its own window in series is what would make a quit feel broken.
const FLUSH_DEADLINE_MS = 1500;

// How often the wait path re-reads the registry. The projection it is watching coalesces at
// 200ms (session-summary), so anything faster only re-reads the same answer.
const WAIT_POLL_MS = 2000;

// THE CAP ON "WAIT FOR THEM TO FINISH", and it is DERIVED rather than picked. An agent that
// is mid-turn and stops producing is PARKED by its own idle TTL (`session-state.DEFAULT_IDLE_MS`,
// 15 minutes), and a parked session holds no child — so the wait terminates on its own inside
// one TTL for every session that is going to terminate at all. The extra minute is for the
// park to land and the projection to catch up. Past that, waiting longer cannot make progress
// that waiting one TTL did not, so the cap falls through to the kill with a notice.
const WAIT_CAP_MS = DEFAULT_IDLE_MS + 60 * 1000;

const BUTTON_QUIT = 0;
const BUTTON_WAIT = 1;
const BUTTON_CANCEL = 2; // 2026-08-30: the one button that does not end in a quit

let deps = null;
let waitStartedAt = 0;

// (the local `sleep` helper went with the hand-rolled flush bound, 2026-10-12: `deadline.js ›
// withDeadline` owns the timer now, and it `unref`s it so a pending bound cannot hold the
// process open on the one path whose whole job is to close it.)

// ─── BEGIN QUIT-GUARD-PURE (injectable; unit-tested by EXECUTION) ────────────
// `deps`, `app`, the constants, `withDeadline`/`DEADLINE`, `terminalPosts` and `diag` are free
// vars from here down. Nothing in this block NAMES a module or reaches a window, a timer or the
// network DIRECTLY — every platform edge arrives injected — so test/quit-guard.test.mjs
// evaluates it verbatim with fakes.
//
// ⚠ IT NOW COVERS THE TEARDOWN AND THE EXIT, NOT JUST THE COPY (2026-10-12, review 16). The
// block used to hold the dialog's strings and two predicates, so everything about the quit that
// could actually go wrong was reachable only by GREPPING THE SOURCE — and the reviewer showed
// what that costs: `await teardown(reason)` → `void teardown(reason)` and serialising the drain
// behind the flush both left the whole new suite green, because a source probe cannot see
// ordering it does not happen to spell out. `teardown`, `finishQuit` and `stopWaiting` moved in
// here UNCHANGED (a move, not an edit) so the tests drive them and measure the bound on a fake
// clock instead of asserting about their text.
//
// ⚠ AND THE LATCH STATE MOVED WITH THEM, which is what makes each evaluation independent: a
// `new Function` over this block gets its OWN `disarmed`/`prompting`/`waitTimer`, so one test
// cannot leave the guard latched for the next. At runtime these are module scope exactly as
// before — the markers are comments, not a boundary.
let disarmed = false; // one-way: the teardown has run (or failed), so let every quit through
let prompting = false; // a dialog is on screen — a second quit must not open a second one
let waitTimer = null;

/** One session, as a line a human can recognise. Never a bare count. */
function describeSession(s) {
  const thread = (s && s.taskTitle) || null;
  const channel = (s && s.channelName) || (s && s.counterpartyName) || null;
  const where = channel ? ` in ${channel}` : '';
  const what = thread ? `“${thread}”` : 'an untitled thread';
  return `${what}${where}${s && s.working ? ' (working now)' : ''}`;
}

/** The dialog body: every session by name, one per line, newest concerns first. */
function describeAll(list) {
  return list.map((s) => `• ${describeSession(s)}`).join('\n');
}

// The headline COUNTS (2026-08-30 wording), the body NAMES (2026-08-07 ruling). Both, not
// either: the count is what the operator needs to size the decision, the list is what lets them
// recognise the work — the original defect was a count with no list under it.
function quitMessage(list) {
  const n = list.length;
  return n === 1
    ? 'You have 1 active agent session.'
    : `You have ${n} active agent sessions.`;
}

// The copy is deliberately about CONSEQUENCE, not about mechanism: an operator deciding this
// does not need to know what an SDK child is, only that stopping now interrupts named work.
//
// ⚠ IT NOW SAYS "PERMANENTLY", AND THAT IS A CLAIM THE CODE HAS TO EARN (2026-08-30). It does:
// these are the sessions holding a live `claude` child, and the teardown ends each through the
// reducer's `inactive` terminal, which SETTLES the record. Nothing resumes a settled session on
// the next launch. The sessions that DO come back — parked shells, including a spawn-idle "New
// Agent" — hold no child and are excluded from this list entirely, so the word is never said
// about a session that survives.
function quitDetailTail(n) {
  return n === 1
    ? 'Quitting Dopl ends this agent permanently. It stops where it is and cannot be resumed. The person waiting is told the session went inactive.'
    : 'Quitting Dopl ends these agents permanently. They stop where they are and cannot be resumed. The people waiting are told the session went inactive.';
}

function buildDialogOptions(list) {
  return {
    type: 'question',
    buttons: ['Quit anyway', 'Wait for them to finish', 'Cancel'],
    defaultId: BUTTON_CANCEL, // Return does NOTHING: the safest of three is the one with no effect
    cancelId: BUTTON_CANCEL, // …and Escape means Escape, which is the whole point of adding it
    noLink: true,
    title: 'Dopl',
    message: quitMessage(list),
    detail: `${describeAll(list)}\n\n${quitDetailTail(list.length)}`,
  };
}

/** Whether the wait path is done: nobody is mid-turn any more. */
function waitSatisfied(list) {
  return !list.some((s) => s && s.working);
}

/** Whether the wait has run out of budget (see WAIT_CAP_MS for why this bound). */
function waitExpired(now, startedAt) {
  return now - startedAt >= WAIT_CAP_MS;
}

/**
 * End every session holding a child, then take this machine off the air, then give what the ends
 * OWE one bounded moment to leave. Never throws, and never takes longer than FLUSH_DEADLINE_MS
 * past the (synchronous) kill.
 *
 * ⚠ THE ENDS GO FIRST, AND THAT ORDER IS THE FIX (2026-10-12). It used to be
 * `listener.stop()` → `endLiveSessions()`, so every session was ended AFTER presence had already
 * posted `away` and declared the device `offline`, and the posts those ends issue got none of the
 * window the away post and the state flush were sharing. The POST itself was still legal —
 * `listener-io.js › sendOnce` has no running-gate — but it was issued by a machine that had just
 * announced it was gone, and then abandoned.
 *
 * ⚠ AND THE TERMINAL POSTS ARE NOW WAITED FOR, WHICH IS THE HALF THAT ACTUALLY LOST THE NOTICE.
 * `trigger-outcomes.js › onEnded` (the calm "This session went inactive.") and
 * `session-drop-notice.js › report` both issue their POST fire-and-forget. Nothing held either
 * promise, so `app.quit()` on the next tick took the process away with the request in flight and
 * the peer was never told — against both `quitDetailTail`'s promise to the operator ("The person
 * waiting is told the session went inactive") and the C-8 invariant's claim that the quit path
 * tells them. `session-terminal-posts.js` is the register; the bound below is this module's.
 *
 * ⚠ ONE BUDGET FOR ALL THREE, NEVER THREE BUDGETS IN SERIES. Each wait takes the SAME
 * FLUSH_DEADLINE_MS and they are armed together, so the worst case is still 1500 ms end to end.
 * Adding a second window after the first would trade a lost notice for the "app refuses to
 * close" defect that number exists to prevent (rule 2 in the header).
 */
async function teardown(reason) {
  diag('quit-guard: tearing down —', reason);
  // THE KILL, FIRST AND SYNCHRONOUS. Mid-tool-call is not a reason to wait (rule 3): this issues
  // every session's abort and its terminal posts in one pass and returns.
  let ended = 0;
  try { ended = deps.endLiveSessions(); } catch (err) { diag('quit-guard: endLiveSessions threw', err && err.message); }
  diag('quit-guard: ended', ended, 'session(s) still holding a runtime |',
    terminalPosts.pendingCount(), 'post(s) in flight');
  // ⚠ `listener.stop()` RETURNS THE FINAL `away` PRESENCE POST since 2026-09-08, joined with the
  // device `offline` post (presence-core › stop) — one promise, both covered (its own 3s
  // leash). Captured here so the bounded moment below covers it too: without that, quitting left
  // the operator reading ONLINE for up to four beats on every peer's roster.
  let awayPost = null;
  try { awayPost = deps.listener.stop(); } catch (err) { diag('quit-guard: listener.stop threw', err && err.message); }
  try {
    // ⚠ THE THREE ARE BOUNDED SEPARATELY AND REPORTED BY NAME. One bound over all three would
    // let a hung `away` post make a landed end notice report as skipped, which is a
    // lie in the log this module exists to keep honest. Each `withDeadline` resolves to its own
    // DEADLINE sentinel, and because all three are armed on the same tick with the same number
    // the `Promise.all` below cannot outlive FLUSH_DEADLINE_MS.
    // ⚠ A THUNK, NOT A PROMISE, so one of the three CANNOT take the other two down.
    // `deps.flushSessionState()` is an injected call that may throw SYNCHRONOUSLY; evaluated in
    // the argument list it would throw past `Promise.all` into the outer catch below and abandon
    // the end notice — the very post this reordering exists to land — on a failure that has
    // nothing to do with it. Each thunk is called inside its own try, and a thrower resolves
    // like a rejecter: reported, skipped, never fatal (rule 1).
    const bound = (make, what) => {
      let p;
      try { p = make(); } catch (err) {
        diag('quit-guard: the final', what, 'threw before it was sent —', err && err.message);
        return Promise.resolve(undefined);
      }
      return withDeadline(
        Promise.resolve(p).catch(() => undefined),
        FLUSH_DEADLINE_MS,
        () => diag('quit-guard: the final', what, 'did not land inside', FLUSH_DEADLINE_MS, 'ms — SKIPPED'),
      );
    };
    const [notice, rows] = await Promise.all([
      // THE PEER. The end notice is why this reordering exists: somebody is waiting on a reply
      // that is not coming, and this post is the only thing that tells them.
      bound(() => terminalPosts.drain(), 'end notice'),
      // THE ROWS. Every ended session has left the projection by now, so this posts the empty set
      // and deletes what this machine was claiming.
      bound(() => deps.flushSessionState(), 'session-state push'),
      // THE ROSTER. Reported only on failure: a missed `away` costs four beats of a stale pill.
      bound(() => awayPost, 'away post'),
    ]);
    if (notice === DEADLINE) {
      diag('quit-guard: an ended agent could not tell its channel it stopped — the peer\'s card',
        'stays as it was until this machine signs in again');
    }
    if (rows === DEADLINE) {
      diag('quit-guard: this machine\'s session rows stay until it signs in again');
    }
  } catch (err) {
    diag('quit-guard: the final flush threw', err && err.message);
  }
}

function stopWaiting() {
  if (waitTimer) { try { clearInterval(waitTimer); } catch (_) { /* gone */ } waitTimer = null; }
}

// Finish the quit for real: run the teardown once, latch, and ask the app to close again.
async function finishQuit(reason) {
  stopWaiting();
  disarmed = true;
  prompting = false;
  try { await teardown(reason); } catch (err) { diag('quit-guard: teardown threw', err && err.message); }
  try { app.quit(); } catch (err) { diag('quit-guard: app.quit threw', err && err.message); }
}

// ─── END QUIT-GUARD-PURE ────────────────────────────────────────────────────

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  } catch (_) { /* best-effort */ }
}

function orphanRisk() {
  try { return deps.listOrphanRisk() || []; } catch (err) {
    diag('quit-guard: could not read the session registry —', err && err.message);
    return []; // FAIL OPEN: an unreadable registry must not trap the operator in the app
  }
}

// ABORT the quit (2026-08-30). The mirror image of `finishQuit`, and every line of it is the
// opposite on purpose:
//   • `disarmed` stays FALSE — the guard must arm again, because the next ⌘Q is a new decision.
//   • no teardown, so nothing is killed and no final flush goes out; the app is still running
//     and its rows are still true.
//   • any pending "wait" is cancelled too. Cancel means the quit is OFF, not rescheduled — an
//     auto-quit still ticking after the operator pressed Cancel is the bug this button exists
//     to prevent.
//   • `app.isQuitting` goes BACK to false. `onBeforeQuit` sets it on the way in, before it knows
//     the answer, so an aborted quit would otherwise leave the app permanently believing it is
//     on its way out.
function cancelQuit(reason) {
  diag('quit-guard: quit CANCELLED —', reason, '— nothing was torn down');
  stopWaiting();
  prompting = false;
  try { app.isQuitting = false; } catch (err) { diag('quit-guard: could not clear isQuitting', err && err.message); }
}

// "Wait for them to finish": poll the SAME list the dialog named until nobody is mid-turn,
// then quit by itself. Capped (WAIT_CAP_MS), announced, and re-openable — a second Quit while
// waiting brings the dialog back so "Quit anyway" is always one click away.
function startWaiting() {
  stopWaiting();
  waitStartedAt = Date.now();
  notify('Dopl will quit when the agents finish',
    'Nothing is being interrupted. Choose Quit again to stop them now.');
  waitTimer = setInterval(() => {
    const list = orphanRisk();
    if (waitSatisfied(list)) { void finishQuit('wait: every agent came off its turn'); return; }
    if (waitExpired(Date.now(), waitStartedAt)) {
      notify('Dopl is quitting', 'An agent was still running after the wait, so it was stopped.');
      void finishQuit('wait: cap reached');
    }
  }, WAIT_POLL_MS);
  if (waitTimer && typeof waitTimer.unref === 'function') waitTimer.unref();
}

async function promptThenQuit(list) {
  prompting = true;
  let choice = BUTTON_QUIT;
  try {
    const res = await dialog.showMessageBox(buildDialogOptions(list));
    choice = res && typeof res.response === 'number' ? res.response : BUTTON_QUIT;
  } catch (err) {
    // FAIL OPEN, and loudly. A dialog that cannot be shown must not become a quit that cannot
    // happen; the operator asked to close the app and this is not the layer that may refuse.
    diag('quit-guard: the confirmation dialog failed —', err && err.message, '— quitting anyway');
    await finishQuit('dialog failed');
    return;
  }
  if (choice === BUTTON_CANCEL) { cancelQuit('operator chose Cancel'); return; }
  if (choice === BUTTON_WAIT) { prompting = false; startWaiting(); return; }
  await finishQuit('operator chose Quit anyway');
}

// The `before-quit` handler. Returns nothing; its whole contract is whether it called
// `event.preventDefault()`.
function onBeforeQuit(event) {
  app.isQuitting = true;
  if (disarmed) return; // the teardown already ran (or failed) — let it close
  let list = [];
  try {
    if (prompting) { event.preventDefault(); return; } // a dialog is already up; do not stack a second
    list = orphanRisk();
    if (!list.length) { disarmed = true; void teardown('no agents in flight'); return; }
    // Something is running: hold the quit, ask, and re-issue it from the answer. A WAITING
    // quit lands here too, which is the way back out — the dialog returns and "Quit anyway"
    // is one click away.
    event.preventDefault();
    stopWaiting();
    void promptThenQuit(list);
  } catch (err) {
    // Any failure at all: latch and let the quit through. Rule (2) — a user who wants to quit
    // must always be able to.
    diag('quit-guard: before-quit failed —', err && err.message, '— allowing the quit');
    disarmed = true;
  }
}

/**
 * Wire it. `deps`:
 *   listener            channel-listener (stop()).
 *   listOrphanRisk()    sessionEngine — the sessions holding a live `claude` child.
 *   endLiveSessions()   sessionEngine — end each through the reducer's `inactive` terminal.
 *   flushSessionState() session-state-push.flush — an awaitable final push.
 * Returns the handler so a caller (or a test) can drive a quit directly.
 */
function arm(d) {
  deps = d || null;
  app.on('before-quit', onBeforeQuit);
  return onBeforeQuit;
}

module.exports = {
  arm,
  onBeforeQuit,
  // constants + the pure core (exported for the test; nothing else reads them)
  FLUSH_DEADLINE_MS,
  WAIT_CAP_MS,
  BUTTON_QUIT,
  BUTTON_WAIT,
  BUTTON_CANCEL,
  describeSession,
  describeAll,
  quitMessage,
  quitDetailTail,
  buildDialogOptions,
  waitSatisfied,
  waitExpired,
};
