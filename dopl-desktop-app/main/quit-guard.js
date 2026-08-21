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
// TWO WAYS FORWARD, both real. "Quit anyway" kills now. "Wait for them to finish" waits for
// every agent to come off a turn and THEN quits by itself — it is not a disguised cancel.
//
// MID-TOOL-CALL IS NOT A REASON TO WAIT. On "Quit anyway" there is no grace period and no
// letting the current step land: the abort goes out with everything else. A tool call
// half-finished by a process that is going away is not worth the seconds, and the peer is
// told the session went inactive either way.
//
// THE PEER IS TOLD. Each killed session is ended through the reducer's `inactive` event —
// C-5's calm terminal — so the requester's card stops pulsing "Working…" instead of claiming
// work in progress on a machine that has quit. One terminal path, shared with the launch
// watchdog. ⚠ IT NAMED "the window-budget eviction" AS A THIRD SHARER UNTIL 2026-08-20, and
// there is no eviction: `session-park.js` records that `evictIdleShell` / `atCapAfterEvict`
// went with the window, and the surviving ceiling
// (`session-windowless.js › MAX_CONCURRENT_SESSIONS`) is a plain REFUSAL at launch — nothing
// is ever reclaimed out from under a live session.
//
// ── THE TWO THINGS THAT MUST NOT GO WRONG ───────────────────────────────────────────────
//
// 1. QUITTING MUST ALWAYS REMAIN POSSIBLE. Every branch below is wrapped, and every failure
//    resolves the same way: let the quit happen. A dialog that throws, a registry that throws,
//    a network that hangs — none of them may trap an operator inside an app they asked to
//    close. `disarmed` is the one-way latch that guarantees a second pass cannot re-prompt.
// 2. THE QUIT MUST NOT FEEL BROKEN. The final state push is RACED against a short deadline,
//    never awaited outright: `session-state-push.send` carries a 15s HTTP timeout and one
//    retry, which is right for a running app and absurd for a quit. If the flush has not
//    landed by then it is abandoned and said so — the rows go stale, which is the same
//    outcome a crash produces and strictly better than a quit that appears to hang.

const { app, dialog, Notification } = require('electron');
const { DEFAULT_IDLE_MS } = require('./session-state');
const { diag } = require('./diag');

// How long the final `{sessions: []}` push may hold the quit. Under two seconds still reads
// as immediate; past that the operator is watching an app refuse to close. The push is one
// small POST on an already-warm connection, so this is generous for the healthy case and the
// unhealthy case is precisely the one that must not be waited on.
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

let deps = null;
let disarmed = false; // one-way: the teardown has run (or failed), so let every quit through
let prompting = false; // a dialog is on screen — a second quit must not open a second one
let waitTimer = null;
let waitStartedAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── BEGIN QUIT-GUARD-PURE (injectable; unit-tested via source extraction) ───
// `deps`, the constants and `diag` are free vars from here down. Nothing in this block
// reaches a window, a timer or the network, so test/quit-guard.test.mjs evaluates it
// verbatim with fakes.

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

function quitMessage(list) {
  const n = list.length;
  return n === 1 ? 'One agent is still running.' : `${n} agents are still running.`;
}

// The copy is deliberately about CONSEQUENCE, not about mechanism: an operator deciding this
// does not need to know what an SDK child is, only that stopping now interrupts named work.
const QUIT_DETAIL_TAIL =
  'Quitting now stops them where they are. The people waiting are told the session went inactive.';

function buildDialogOptions(list) {
  return {
    type: 'question',
    buttons: ['Quit anyway', 'Wait for them to finish'],
    defaultId: BUTTON_WAIT, // the non-destructive one is what Return picks
    cancelId: BUTTON_WAIT, // …and so is Escape: neither may silently kill work
    noLink: true,
    title: 'Dopl',
    message: quitMessage(list),
    detail: `${describeAll(list)}\n\n${QUIT_DETAIL_TAIL}`,
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

// Stop the listener, end every session holding a child, and give the final state push a
// bounded moment to leave. Never throws, and never takes longer than FLUSH_DEADLINE_MS past
// the (synchronous) kill.
async function teardown(reason) {
  diag('quit-guard: tearing down —', reason);
  try { deps.listener.stop(); } catch (err) { diag('quit-guard: listener.stop threw', err && err.message); }
  let ended = 0;
  try { ended = deps.endLiveSessions(); } catch (err) { diag('quit-guard: endLiveSessions threw', err && err.message); }
  diag('quit-guard: ended', ended, 'session(s) holding a claude child');
  // THE ROWS. Every ended session has left the projection by now, so this posts the empty set
  // and deletes what this machine was claiming. Raced, never awaited — see the header.
  try {
    const flushed = await Promise.race([
      deps.flushSessionState().then(() => true),
      sleep(FLUSH_DEADLINE_MS).then(() => false),
    ]);
    if (!flushed) {
      diag('quit-guard: the final session-state push did not land inside',
        FLUSH_DEADLINE_MS, 'ms — SKIPPED, so this machine\'s rows stay until it signs in again');
    }
  } catch (err) {
    diag('quit-guard: final session-state push threw', err && err.message);
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
  describeSession,
  describeAll,
  quitMessage,
  buildDialogOptions,
  waitSatisfied,
  waitExpired,
};
