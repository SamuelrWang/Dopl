// Acts on the init message's Dopl MCP status (F-692): NEVER RUN A MUTE AGENT. The verdict is
// `mcp-connect.js`'s (pure); this file acts on it with the engine's handles (`bind`), modelled on
// `session-auth.js`: fail closed first (`denyPending`), retry ONCE through the engine's own launch.
// The backstop, not the mechanism: `session-query.js › startQuery` pre-warms `/api/mcp`.

const { diag } = require('./diag');
const store = require('./session-store');
const mcpConnect = require('./mcp-connect');

let deps = null; // { acquireRuntime, startQuery, dispatch, emit, denyPending, resumeParked, abortInFlight }

function bind(d) {
  deps = d || null;
}

/** Statuses THIS session already reported (0 = the cold launch); the counter lives on the session. */
function attemptOf(s) {
  return Number(s && s.mcpConnectAttempt) || 0;
}

/** TRUE when the caller must stop reading this stream (superseded or over); FALSE when healthy or unwired. */
function handleMcpStatus(s, status) {
  if (!deps || !s || s.settled) return false;
  const attempt = attemptOf(s);
  const verdict = mcpConnect.mcpConnectVerdict({ status, attempt });
  if (verdict === 'ok') return false;
  if (verdict === 'retry') {
    diag('mcp-connect: dopl MCP server not connected (status', String(status) + ') — killing this launch and retrying ONCE');
    // Incremented BEFORE the relaunch, so the retry's own status reads attempt 1 → `fail`.
    s.mcpConnectAttempt = attempt + 1;
    void relaunch(s);
    return true; // superseded the moment startQuery runs
  }
  failVisibly(s, status, attempt);
  return true;
}

/**
 * The one retry, on the lane that launched (`s.launchVia`, F-696): a cold launch re-enters the
 * engine's `startQuery` (it supersedes the dead child and re-pushes `s.firstTurn`); a resumed one
 * must go back through the resume, or the message that woke it is lost. A throw ends visibly.
 */
async function relaunch(s) {
  try { if (deps.denyPending) deps.denyPending(s, 'Reconnecting the Dopl MCP server'); } catch (_) { /* best effort */ }
  if (s.launchVia === 'resume' && typeof deps.resumeParked === 'function') return resumeArm(s);
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
 * Re-run the resume with the same input (read off the old iterator first). It aborts the child
 * itself — `resumeParked`, unlike `startQuery`, does not. A fresh iterator is the proof it restarted;
 * a refused resume ENDS rather than leaving an aborted, unwakeable "parked" pill.
 */
function resumeArm(s) {
  const pending = (s.pushIterator && typeof s.pushIterator.replayable === 'function')
    ? s.pushIterator.replayable() : [];
  const before = s.pushIterator;
  try { if (deps.abortInFlight) deps.abortInFlight(s); } catch (_) { /* best effort */ }
  try {
    deps.resumeParked(s);
  } catch (err) {
    diag('mcp-connect: retry resume failed', err && err.message);
    return failVisibly(s, 'relaunch-failed', attemptOf(s));
  }
  if (!s.pushIterator || s.pushIterator === before) {
    diag('mcp-connect: the resume refused the retry — ending rather than leaving an unwakeable pill');
    return failVisibly(s, 'resume-refused', attemptOf(s));
  }
  for (const msg of pending) {
    try { s.pushIterator.push(msg); } catch (_) { /* best effort */ }
  }
  diag('mcp-connect: retried on the RESUME lane, replaying', String(pending.length), 'input message(s)');
  return undefined;
}

/**
 * End where the operator can see it: the diag line, `s.mcpDiag` (the card's local `diag` field), the
 * vendor-neutral `s.endCode`, and the reducer's `crash` terminal (settle + `task_failed`, so a
 * waiting peer is told).
 */
function failVisibly(s, status, attempt) {
  const text = mcpConnect.mcpDownText(status, attempt);
  diag('mcp-connect:', text);
  s.mcpDiag = text;
  s.endCode = 'mcp-unreachable';
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
