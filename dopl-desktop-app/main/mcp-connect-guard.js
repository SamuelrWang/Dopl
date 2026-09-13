// THE CONNECT ASSERTION — what happens when the init message says the Dopl MCP server is not up.
// (F-692, 2026-09-13.)
//
// ⚠ THE RULE IS "NEVER RUN A MUTE AGENT". The vocabulary and the verdict are `mcp-connect.js`'s
// (pure); this file is the only one allowed to ACT on one, because acting means killing a child
// process, re-running the launch and ending a session — the engine's handles, injected by `bind`.
//
// ⚠ MODELLED ON `session-auth.js`, DELIBERATELY AND LINE FOR LINE WHERE IT MATTERS. That module is
// the precedent for "a stream said something core must stop for": it is bound with the same four
// handles, it fails closed FIRST (`denyPending` before any teardown, so no awaited `canUseTool`
// promise dangles), and its retry is `deps.startQuery` — the engine's OWN deferred launch, never a
// second spec assembly. `session-query.js › startQuery` supersedes whatever was live before it
// assembles anything, which is what makes the retry here idempotent at this layer (H1's
// two-children bug, and the reason this file does not abort the child itself).
//
// ⚠ ONE RETRY, AND THE ATTEMPT COUNTER LIVES ON THE SESSION. `s.mcpConnectAttempt` is incremented
// BEFORE the relaunch, so the second init message reads `attempt: 1` and
// `mcpConnectVerdict` answers `fail`. A counter held in this module instead would be wrong the
// first time two sessions launch at once.
//
// ⚠ IT IS NOT THE PRE-FLIGHT. `session-query.js › startQuery` warms `/api/mcp` before every spawn
// (`mcp-connect.js › warmMcpRoute`) so this guard is the BACKSTOP rather than the mechanism — a
// route that is warm connects inside the CLI's 5s default and nothing here fires.

const { diag } = require('./diag');
const store = require('./session-store');
const mcpConnect = require('./mcp-connect');

let deps = null; // { acquireRuntime, startQuery, dispatch, emit, denyPending }

/**
 * The engine binds its internals here at load, exactly as it does for `session-auth.js`:
 * its OWN `startQuery` (the deferred launch — never a second spec assembly), the runtime
 * acquirer, the dispatch, the emitter and the fail-closed permission sweep.
 */
function bind(d) {
  deps = d || null;
}

/** How many times THIS session has already reported an MCP status (0 = the cold launch). */
function attemptOf(s) {
  return Number(s && s.mcpConnectAttempt) || 0;
}

/**
 * ACT ON THE STATUS THIS LAUNCH REPORTED. Returns TRUE when the caller must stop reading this
 * stream — the retry superseded it, or the session is over — and FALSE when the launch is healthy
 * and consumption continues.
 *
 * ⚠ `false` IS THE ANSWER FOR AN UNWIRED HARNESS AND A SETTLED SESSION, not an exception. A guard
 * that cannot act must not stop a stream it has no way to replace.
 */
function handleMcpStatus(s, status) {
  if (!deps || !s || s.settled) return false;
  const attempt = attemptOf(s);
  const verdict = mcpConnect.mcpConnectVerdict({ status, attempt });
  if (verdict === 'ok') return false;
  if (verdict === 'retry') {
    diag('mcp-connect: dopl MCP server not connected (status', String(status) + ') — killing this launch and retrying ONCE');
    s.mcpConnectAttempt = attempt + 1;
    void relaunch(s);
    return true; // the old loop is superseded the moment startQuery runs; stop reading it here
  }
  failVisibly(s, status, attempt);
  return true;
}

/**
 * THE ONE RETRY. ⚠ THE SAME PATH THE LAUNCH WOULD HAVE TAKEN — `session-auth.js ›
 * resumeAfterSignIn`'s preflight branch, to the letter: reset the phase to 'launching' so the
 * watchdog re-arms, acquire the runtime, and re-enter the engine's `startQuery`, which supersedes
 * the dead child and re-pushes `s.firstTurn`.
 *
 * ⚠ FAIL CLOSED FIRST. Every awaited `canUseTool` promise is denied before the teardown, so no
 * resolver dangles on a child that is about to be aborted. The reason is `session-auth.js`'s (P1
 * discipline) and not a new one.
 *
 * ⚠ A THROW HERE ENDS THE SESSION VISIBLY rather than leaving it in phase 'launching' with no
 * query behind it — the shape H1(b) records as unparkable, un-timeout-able and unsettleable.
 */
async function relaunch(s) {
  try { if (deps.denyPending) deps.denyPending(s, 'Reconnecting the Dopl MCP server'); } catch (_) { /* best effort */ }
  if (s.state) { s.state.phase = 'launching'; s.state.parked = false; s.state.activity = 'working'; }
  try {
    const rt = await deps.acquireRuntime(s.runtimeId);
    await deps.startQuery(s, rt);
  } catch (err) {
    diag('mcp-connect: retry launch failed', err && err.message);
    failVisibly(s, 'relaunch-failed', attemptOf(s));
  }
}

/**
 * END IT WHERE THE OPERATOR CAN SEE IT. Three surfaces, and each is the one that already exists
 * for a launch that cannot run:
 *   - the DIAG line, local-only, naming the server and the status word;
 *   - `s.mcpDiag`, which `session-summary.js › liveSummary` / `endedSummary` carry as the
 *     projection's local-only `diag` field, so the agent card says WHY rather than just "Ended";
 *   - an `error` emit + `crash`, the same terminal path a query throw takes — settle +
 *     `task_failed{interrupted:true}`, so a peer waiting on this agent is told instead of waiting.
 *
 * ⚠ THE EMIT GOES FIRST, so the specific sentence is above the reducer's generic one.
 * ⚠ `crash` IS REUSED RATHER THAN A NEW REDUCER CASE. The state transition this needs is exactly
 * the one `crash` makes (abortQuery, settle 'interrupted', the lifecycle echo), and a fourth
 * terminal path would be a second answer to "how does a session that cannot run end".
 */
function failVisibly(s, status, attempt) {
  const text = mcpConnect.mcpDownText(status, attempt);
  diag('mcp-connect:', text);
  s.mcpDiag = text;
  try { if (deps.denyPending) deps.denyPending(s, mcpConnect.MCP_UNAVAILABLE_LABEL); } catch (_) { /* best effort */ }
  try { store.setRecordPhase(s.key, 'ended'); } catch (_) { /* the visible end matters more than the record */ }
  try { deps.emit(s, { type: 'error', message: text }); } catch (_) { /* best effort */ }
  try { deps.dispatch(s, { type: 'crash' }); } catch (err) { diag('mcp-connect: crash dispatch failed', err && err.message); }
}

module.exports = {
  bind,
  attemptOf,
  handleMcpStatus,
};
