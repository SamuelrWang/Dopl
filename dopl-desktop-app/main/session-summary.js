// The ONE projection from live session state (plus the retained ended history) to what a person or an MCP
// caller is shown: one pill per session. Reaches no network: `session-state-push.js` subscribes to the
// coalesced change digest, so a server write costs a state CHANGE, never a turn.

// Every dependency sits above the sentinel; below it the file is import-free and its harness injects these.
const { metricOrNull, metrics } = require('./session-metrics');
const { PILL_ENDED, pillState, listeningState } = require('./session-pill');
const { noteEvent, detailFor, endReasonFor } = require('./session-detail');
const { displayNameFor, descriptionForAgent } = require('./agent-names');
const { diag } = require('./diag');
const { pickOf } = require('./runtime/selection-vocabulary');
const { displayText, IDENTITY_NAME_MAX } = require('./session-summary-text'); const { heldGatesFor } = require('./session-held-gates');

// ─── BEGIN SESSION-SUMMARY-PURE (injectable; unit-tested via source extraction) ──────

// A session's name IS its agent id (a per-instance id, stable by construction); '' when it carries none, and
// the push refuses that rather than this inventing one.
function nameOf(s) {
  return String((s && s.agentId) || '');
}

// The operator's pick for display, or null (already coerced at the construction site).
function modelPick(s) {
  return pickOf(s && s.model) || null;
}

/** One LIVE session -> its summary. `name` is passed so the ended branch can hand in the frozen id. */
function liveSummary(s, name) {
  const ctx = (s && s.context) || {};
  const pill = pillState(s && s.state);
  return {
    sessionId: String((s && s.sessionId) || ''),
    channelId: String((s && s.channelId) || ''), workspaceId: (s && s.workspaceId) || null,
    taskId: String((s && s.taskId) || ''),
    // The local address beside `name` (the server's column); they hold the same string, nothing may rely on it.
    agentId: name,
    name: name,
    displayName: displayNameFor(name),
    description: descriptionForAgent(name),
    state: pill,
    // Beside the pill, never instead of it (as `detail` is): refines idle into Waiting vs Idle.
    listening: listeningState(s && s.state),
    endedAt: null,
    detail: detailFor(s && s.state, s && s.lastEventKind, pill),
    toolLabel: (s && s.lastToolLabel) || null,
    // The live posture (reducer state, not the stored launch posture); absent fails closed to the narrowest word.
    toolMode: (s && s.state && (s.state.toolMode || (s.state.toolModes && s.state.toolModes[0]))) || null,
    messageMode: (s && s.state && s.state.messageMode) || 'ask',
    // The runtime's reported model first, then the pick; null is real (a spawn-idle agent started nothing).
    model: (s && s.liveModel) || modelPick(s),
    channelName: displayText(ctx.channelName),
    threadTitle: displayText(ctx.taskTitle),
    // A spawn-time capture, so it can ride the STATE half of the server digest.
    identityName: displayText(ctx.identity && ctx.identity.name, IDENTITY_NAME_MAX),
    // The colour this session ASKED for; `null` is "none reported" and cannot erase one server-side.
    color: (s && s.color) || null,
    // The spawn stamp; local only (`reportRow` is an allowlist and names neither this nor `heldGates`).
    runtimeId: (s && s.runtimeId) || '',
    endReason: null,
    // The calls this session is blocked on, enough to decide them inline; local only, answered by
    // `sessions:answerPermission`.
    heldGates: heldGatesFor(s),
    ...metrics(s),
  };
}

/** One retained ENDED entry -> its summary: identity and final measurement were frozen at settle. It carries
 *  no `color`, `heldGates` or health fields — a reader must not assume the two rows share every key. */
function endedSummary(e, name) {
  return {
    sessionId: String((e && e.sessionId) || ''),
    channelId: String((e && e.channelId) || ''), workspaceId: (e && e.workspaceId) || null,
    taskId: String((e && e.taskId) || ''),
    agentId: name,
    name: name,
    // Read LIVE, unlike the metrics: renaming while reading back a finished run is normal.
    displayName: displayNameFor(name),
    description: descriptionForAgent(name),
    state: PILL_ENDED,
    listening: false,
    endedAt: metricOrNull(e && e.endedAt),
    detail: null,
    toolLabel: null,
    runtimeId: (e && e.runtimeId) || '',
    // The frozen end CODE, re-said in the owning runtime's words at read time; null for an ordinary end.
    endReason: endReasonFor(e),
    diag: (e && typeof e.diag === 'string' && e.diag) || null,
    toolMode: null,
    messageMode: null,
    // A model is a control's value; a control over an ended agent is a control over nothing.
    model: null,
    channelName: displayText(e && e.channelName),
    threadTitle: displayText(e && e.threadTitle),
    identityName: displayText(e && e.identityName, IDENTITY_NAME_MAX),
    contextUsed: metricOrNull(e && e.contextUsed),
    contextWindow: metricOrNull(e && e.contextWindow),
    tokensSpent: metricOrNull(e && e.tokensSpent),
    startedAt: metricOrNull(e && e.startedAt),
    lastActivityAt: metricOrNull(e && e.lastActivityAt),
  };
}

/** A summary plus what a SERVER row needs: `channel_sessions` keys on `(user_id, session_key)` and fences on
 *  `workspace_id` (`sessionId` is ephemeral). */
function reportEntry(wire, key, workspaceId) {
  return { ...wire, key: String(key || ''), workspaceId: String(workspaceId || '') };
}

/** The renderer's shape: the report-only `key` removed (`workspaceId` stays; the pop-out routes by it). */
function wireSummary(entry) {
  const out = { ...entry };
  delete out.key;
  return out;
}

/** Changed at all? Compared as one string so a new member is checked automatically. */
function summariesDigest(list) {
  return JSON.stringify(list || []);
}

// ─── END SESSION-SUMMARY-PURE ────────────────────────────────────────────────────────

const SESSIONS_EVENT = 'dopl:sessions';

// A burst of engine dispatches costs ONE render.
const PUSH_COALESCE_MS = 200;

let deps = { sessions: null, endedRecords: null };
let getWindowsFn = null;
let pushTimer = null;
let lastDigest = null;
// The SERVER writer's gate, separate from the window's: `start()` resets `lastDigest` so a rebuilt renderer
// gets a frame, but `lastChangeDigest` is never reset — a rebuilt renderer is not a state change.
const changeSubscribers = new Set();
let lastChangeDigest = null;

/** The engine binds its registry and the ended-history reader (injected: this file is import-free below
 *  the sentinel). No reader degrades to "no ended cards". */
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    endedRecords: (d && d.endedRecords) || null,
  };
}

/** Arm the push; `getWindows()` is called at SEND time (a pop-out can appear at any moment). */
function start(opts) {
  getWindowsFn = opts && typeof opts.getWindows === 'function' ? opts.getWindows : null;
  lastDigest = null;
  touch();
}

function windowAlive(win) {
  return !!(win && typeof win.isDestroyed === 'function' && !win.isDestroyed());
}

// The retained ended records, from the durable history (a restart keeps the cards); never throws.
function retainedEnded() {
  if (typeof deps.endedRecords !== 'function') return [];
  try {
    const out = deps.endedRecords();
    return Array.isArray(out) ? out : [];
  } catch (err) {
    diag('session-summary: ended history unreadable —', (err && err.message) || String(err));
    return [];
  }
}

/** Every pill, live first then retained ended ones; N rows per (channel, thread) is normal and never deduped. */
function reportList() {
  const out = [];
  const seen = new Set();
  if (deps.sessions) {
    for (const s of deps.sessions.values()) {
      if (s.settled) continue;
      seen.add(s.key);
      out.push(reportEntry(liveSummary(s, nameOf(s)), s.key, s.workspaceId));
    }
  }
  for (const e of retainedEnded()) {
    // The same instance both live and retained: the live one wins.
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(reportEntry(endedSummary(e, String(e.agentId || '')), e.key, e.workspaceId));
  }
  return out;
}

function list() {
  return reportList().map(wireSummary);
}

// A session ended: only the digest moves (the record is written by `session-teardown.js › settle`).
function noteEnded() {
  touch();
}

// The 7-day sweep dropped keys: make the next digest move.
function releaseEnded() {
  touch();
}

// Fan out to every window resolved at send time; one dead window must not swallow the rest.
function sendToWindows(payload) {
  let wins = null;
  try { wins = getWindowsFn ? getWindowsFn() : null; } catch (_err) { return false; }
  if (!Array.isArray(wins) || wins.length === 0) return false;
  let sent = 0;
  for (const win of wins) {
    if (!windowAlive(win)) continue;
    const wc = win.webContents;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) continue;
    try {
      wc.send(SESSIONS_EVENT, payload);
      sent += 1;
    } catch (err) {
      diag('session-summary send error', err && err.message);
    }
  }
  return sent > 0;
}

/** "The projection moved", for a non-window consumer (`session-state-push.js`). A throwing subscriber is caught:
 *  `touch()` runs inside the engine's dispatch. */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  changeSubscribers.add(fn);
  return () => changeSubscribers.delete(fn);
}

function emitChange(entries) {
  for (const fn of changeSubscribers) {
    try { fn(entries); }
    catch (err) { diag('session-summary: change subscriber threw —', (err && err.message) || String(err)); }
  }
}

function flush() {
  pushTimer = null;
  const entries = reportList();
  const digest = summariesDigest(entries);
  if (digest !== lastChangeDigest) {
    lastChangeDigest = digest;
    emitChange(entries);
  }
  if (digest === lastDigest) return;
  // Recorded as delivered only when it was, so a frame sent before a window exists is not suppressed.
  if (sendToWindows({ sessions: entries.map(wireSummary) })) lastDigest = digest;
}

/** A session's state moved: stamp its activity and what moved it, at the engine's one dispatch funnel. */
function noteActivity(s, event) {
  if (s) s.lastActivityAt = Date.now();
  noteEvent(s, event);
  touch();
}

function touch() {
  if (pushTimer) return;
  pushTimer = setTimeout(flush, PUSH_COALESCE_MS);
  if (typeof pushTimer.unref === 'function') pushTimer.unref();
}

module.exports = {
  liveSummary,
  endedSummary,
  nameOf,
  summariesDigest,
  SESSIONS_EVENT,
  PUSH_COALESCE_MS,
  bind,
  start,
  list,
  reportList,
  subscribe,
  noteEnded,
  releaseEnded,
  noteActivity,
  touch,
};
