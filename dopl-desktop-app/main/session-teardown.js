// The end of a session and what survives it. `settle` is the ONE teardown every terminal reaches; a second
// one would be a second set of the C3 bugs (an orphaned child still holding pre-approved channel access).

const store = require('./session-store');
const agentHistory = require('./agent-history');
const sessionMetrics = require('./session-metrics');
const sessionNarration = require('./session-narration');
const sessionSummary = require('./session-summary');
const { diag } = require('./diag');
const sessionCredential = require('./session-credential');
const { teardownHandles } = require('./session-handles');

let deps = null;

// `bind` rebuilds `deps` from a literal: a handle the engine passes and this list omits is dropped silently.
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    baseRecord: (d && d.baseRecord) || null,
    denyPendingPermissions: (d && d.denyPendingPermissions) || function () {},
    refreshTray: (d && d.refreshTray) || function () {},
    sessionOn: (d && d.sessionOn) || null,
  };
}

// Terminal: a done task drops its resume entry, every other end keeps the conversation id (FIX #7).
function settle(s, outcome) {
  if (s.settled) return;
  s.settled = true;
  // Deny every held tool call fail-closed BEFORE the teardown (C3).
  deps.denyPendingPermissions(s, 'Session ended');
  teardownHandles(s);
  // Give the container credential back, unawaited (the TTL is the backstop). A park does NOT release it:
  // a resume reuses this object and would 401 on its first tool call.
  try { void sessionCredential.releaseContainerCredential(s, diag); } catch (_) { /* best effort */ }
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  store.saveRecord(deps.baseRecord(s));
  if (outcome === 'completed' || outcome === 'failed') store.clearSdkSessionId(s.key);
  // Freeze the history BEFORE the registry entry goes: the narration ring lives only on `s`.
  try {
    agentHistory.record({
      key: s.key, agentId: s.agentId, sessionId: s.sessionId,
      channelId: s.channelId, taskId: s.taskId, workspaceId: s.workspaceId,
      channelName: (s.context && s.context.channelName) || null,
      threadTitle: (s.context && s.context.taskTitle) || null,
      // A snapshot of what it RAN AS; `durableHistory` is a whitelist, so an omitted field is dropped.
      identityName: (s.context && s.context.identity && s.context.identity.name) || null,
      endedAt: Date.now(),
      diag: s.mcpDiag || null,
      // The structured end code and its runtime: `session-detail.js › endReasonFor` re-says it at read time.
      endCode: s.endCode || null,
      runtimeId: s.runtimeId || null,
      ...sessionMetrics.metrics(s),
      entries: sessionNarration.ringFor(s),
    });
  } catch (err) { diag('session-teardown: could not freeze agent history —', err && err.message); }
  deps.sessions.delete(s.key);
  sessionSummary.noteEnded();
  deps.refreshTray();
}

// THE WORK LANE FOR ONE ADDRESS — live if it is live, else the frozen 7-day history `settle` wrote.
function narrationFor(a) {
  const live = deps.sessionOn(a);
  if (live) return sessionNarration.ringFor(live);
  const rec = agentHistory.historyFor(store.slotKey(a));
  return rec && Array.isArray(rec.entries) ? rec.entries.slice() : [];
}

module.exports = { bind, settle, narrationFor };
