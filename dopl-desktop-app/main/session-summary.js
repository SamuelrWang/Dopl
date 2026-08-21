// SESSION SUMMARIES — the ONE projection from this machine's live session state to what a
// human (or an MCP caller) is shown about it: one pill per LIVE SESSION in a channel or DM.
//
// ⚠ ONE MODULE, ONE DERIVATION. Three surfaces want the same sentence about a session (channel
// pane pills, the tray, "what is flint doing?" over MCP). The predecessor's defect was two
// readers deriving state their own way and disagreeing in production. Every consumer is handed
// the RESULT; do not add a second derivation.
//
// ⚠ THIS MODULE REACHES NO NETWORK. The `channel_sessions` writer is
// main/session-state-push.js, which SUBSCRIBES to `subscribe()` below. Separate on purpose:
// this file is import-free below the sentinel and every one of its tests reads it as SOURCE —
// an HTTP call here would end both.
// ⚠ THE TRIGGER IS THE DIGEST, and there is only one. `flush()` coalesces a burst of engine
// dispatches into one comparison and fires only when the projection moved, so a server write
// costs a state CHANGE and never a turn. No second timer, no heartbeat.
//
// ── THE STATE MAPPING ────────────────────────────────────────────────────────────────
// Engine vocabulary is two fields (session-state.js / session-reducer.js): PHASE (launching /
// running / awaiting_permission / awaiting_inbound / interrupted / parked / ended) and ACTIVITY
// (working / idle / awaiting_peer / awaiting_permission / awaiting_inbound / parked). A pill
// has THREE states:
//
//   ENGINE                                  PILL      WHY
//   phase 'ended'                           ended     terminal; nothing wakes it
//   parked === true (or phase 'parked')     idle      query torn down; resumable, not gone
//   activity 'working'                      working   mid-turn, running tools
//   activity 'awaiting_permission'          working   ALSO mid-turn — the SDK is blocked on a
//                                                     canUseTool promise, one click from
//                                                     continuing. "idle" would be a lie.
//   activity 'idle'                         idle      between turns
//   activity 'awaiting_peer'                idle      posted; the other machine has it
//   activity 'awaiting_inbound'             idle      reply HELD for an Accept; running nothing
//   activity 'parked'                       idle      (the parked branch above wins)
//   anything else / absent                  idle      fallback
//
// ⚠ PRECEDENCE IS PHASE-FIRST for the two terminal-ish answers, ACTIVITY-SECOND for the rest:
// `phase` and `activity` deliberately disagree in normal operation (a still-pending gate card
// keeps its phase while activity moves; a park lands with phase 'awaiting_inbound' when a
// message is held). Reading one field is how the predecessor got it wrong.
// ⚠ FALLBACK IS 'idle' BY CHOICE. "working" over a dead session makes the operator wait with no
// natural end and no feedback; "idle" over a working one only makes them re-ask.
//
// ⚠ STILL NO 'thinking' PILL, AND THE REASON MOVED (2026-08-20). The obstacle this header used
// to name — that `pillState`'s input says nothing about what has been RENDERED this turn — is
// SOLVED by session-detail.js. What keeps the PILL at three values is now a harder fact: `state`
// is the SERVER's vocabulary, and one row carrying a fourth value 400s the whole push,
// unretryably, forever. The finer signal rides BESIDE it as `detail` + `toolLabel`, local-only.
//
// ── ENDED SESSIONS: THE RETENTION RULE ───────────────────────────────────────────────
// ⚠ An ended session's pill survives exactly as long as its WINDOW does, and no longer.
// session-engine.settle destroys the window on every end but ABANDONMENT (which fires hours
// later with nobody present, where a vanishing transcript is indistinguishable from a crash).
// So the abandoned session is the only one with something left to open, and the only one whose
// pill stays. NO TIMED TOMBSTONE: a pill is a HANDLE ("click to open this"), and a pill with no
// window answers that click by recreating a fresh shell wearing a dead session's name. The
// channel transcript already carries the record. Needs no TTL, ring or persistence — the
// retained set is bounded by MAX_ENDED and swept on the next projection.

// ⚠ The module's only four dependencies, all ABOVE the sentinel: everything from there to
// `module.exports` is import-free, so test/session-summary.test.mjs evaluates the real code
// verbatim with these injected.
const { pickAgentName } = require('./agent-names');
const { metricOrNull, metrics } = require('./session-metrics');
const { noteEvent, detailFor } = require('./session-detail');
const { diag } = require('./diag');

// ─── BEGIN SESSION-SUMMARY-PURE (injectable; unit-tested via source extraction) ──────
// The five names above are free vars from here down.

const PILL_WORKING = 'working';
const PILL_IDLE = 'idle';
const PILL_ENDED = 'ended';
const PILL_STATES = [PILL_WORKING, PILL_IDLE, PILL_ENDED];

// Activity half of the table above, written out in full (including rows agreeing with the
// fallback) so it reads as the engine's real activity list, not special cases over a default.
const ACTIVITY_PILL = {
  working: PILL_WORKING,
  awaiting_permission: PILL_WORKING,
  idle: PILL_IDLE,
  awaiting_peer: PILL_IDLE,
  awaiting_inbound: PILL_IDLE,
  parked: PILL_IDLE,
};

/**
 * Engine state -> pill state. The whole mapping, and the only place it is made.
 * ⚠ OWN-PROPERTY check, never a bare index: a plain object literal answers a FUNCTION for
 * 'constructor' / 'toString', and a function is truthy, so both would pass as pill states.
 */
function pillState(state) {
  const st = state || {};
  if (st.phase === 'ended') return PILL_ENDED;
  if (st.parked === true || st.phase === 'parked') return PILL_IDLE;
  const known = Object.prototype.hasOwnProperty.call(ACTIVITY_PILL, st.activity);
  return known ? ACTIVITY_PILL[st.activity] : PILL_IDLE;
}

// Display string for the wire: one line, whitespace collapsed, bounded, or null. ⚠ Same
// discipline as session-store's `durableName`: channel name and thread title are
// counterparty-influenced text on their way to a renderer.
function displayText(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return s || null;
}

/**
 * THE NAME LEDGER. `sessionKey -> { channelId, name }`.
 * PER CHANNEL, not global: `taken` is the names held in THIS channel, so two channels may each
 * run a `flint`.
 * ⚠ KEYED BY SESSION KEY (channel, thread), never `sessionId` — a park+lazy resume, a recreate
 * from the durable record and a crash resume all mint a fresh sessionId while the operator's
 * mental model does not change. The key is what makes the name survive them.
 */
function nameFor(ledger, key, channelId) {
  const held = ledger.get(key);
  if (held) return held.name;
  const taken = new Set();
  for (const entry of ledger.values()) {
    if (entry.channelId === channelId) taken.add(entry.name);
  }
  const name = pickAgentName(taken);
  ledger.set(key, { channelId: channelId, name: name });
  return name;
}


/** One LIVE session object -> its summary. `name` is handed in (the ledger is the caller's). */
function liveSummary(s, name) {
  const ctx = (s && s.context) || {};
  const pill = pillState(s && s.state);
  return {
    sessionId: String((s && s.sessionId) || ''),
    channelId: String((s && s.channelId) || ''),
    // Wire name `task` == domain name `thread`. '' is a real value: a responder with no
    // first-class thread collapses it.
    taskId: String((s && s.taskId) || ''),
    name: name,
    state: pill,
    // ⚠ BESIDE THE PILL, NEVER INSTEAD OF IT (header; session-detail.js). `detail` is null
    // over any pill but `working`; `toolLabel` means something only under `detail: 'tool'`.
    detail: detailFor(s && s.state, s && s.lastEventKind, pill),
    toolLabel: (s && s.lastToolLabel) || null,
    // ⚠ THE LIVE POSTURE (2026-08-20), read-only here: a control that cannot read back what
    // it set lies after the auth hold resets both axes, after a resume, and after a change
    // made in another window. ⚠ THE REDUCER's state, NOT the channel's stored launch posture
    // — different facts, and this pair exists because a session can be moved off what it
    // launched on. Absent reads fail-closed, as `session-io.js › grantArgs` treats it.
    toolMode: (s && s.state && s.state.toolMode) || 'manual',
    messageMode: (s && s.state && s.state.messageMode) || 'ask',
    channelName: displayText(ctx.channelName),
    threadTitle: displayText(ctx.taskTitle),
    ...metrics(s),
  };
}

/** One RETAINED ENDED entry -> its summary. Nothing re-derived: state is `ended` by
 *  construction and the identity — and now the final measurement — were frozen when the session
 *  settled. ⚠ FROZEN, not recomputed: the session object is gone, so a live read here would
 *  answer null and the agent view would blank its numbers at exactly the moment the operator
 *  wants to read what the run cost. */
function endedSummary(e, name) {
  return {
    sessionId: String((e && e.sessionId) || ''),
    channelId: String((e && e.channelId) || ''),
    taskId: String((e && e.taskId) || ''),
    name: name,
    state: PILL_ENDED,
    // Nothing finer to say about a session that is doing nothing, and a retained detail
    // would outlive the run it described.
    detail: null,
    toolLabel: null,
    // No posture to change; a retained one would offer a control over nothing.
    toolMode: null,
    messageMode: null,
    channelName: displayText(e && e.channelName),
    threadTitle: displayText(e && e.threadTitle),
    contextUsed: metricOrNull(e && e.contextUsed),
    contextWindow: metricOrNull(e && e.contextWindow),
    tokensSpent: metricOrNull(e && e.tokensSpent),
    startedAt: metricOrNull(e && e.startedAt),
    lastActivityAt: metricOrNull(e && e.lastActivityAt),
  };
}

/**
 * One entry widened with the two facts a SERVER ROW needs: `channel_sessions` keys on
 * `(user_id, session_key)` and fences on `workspace_id`.
 * ⚠ `sessionId` is EPHEMERAL (a park or recreate mints a new one) — the wrong upsert key.
 * ⚠ Neither field goes on the wire: `wireSummary` strips them, so the IPC payload and
 * `DesktopSessionSummary` stay byte-unchanged. One derivation, two projections.
 */
function reportEntry(wire, key, workspaceId) {
  return { ...wire, key: String(key || ''), workspaceId: String(workspaceId || '') };
}

/** The wire shape, from a report entry: the two report-only fields removed. */
function wireSummary(entry) {
  const out = { ...entry };
  delete out.key;
  delete out.workspaceId;
  return out;
}

/**
 * Have the summaries actually changed? The engine dispatches on EVERY SDK event, so without
 * this the renderer is woken dozens of times per turn by effects it cannot see.
 * ⚠ Compared as a stable string, not field-by-field, so a member added to the shape is checked
 * automatically instead of silently dropped. Order is already stable (registry preserves
 * insertion; the ended list is append-only).
 */
function summariesDigest(list) {
  return JSON.stringify(list || []);
}

// ─── END SESSION-SUMMARY-PURE ────────────────────────────────────────────────────────

// ── The live half: the registry, the ledger, the ended set, the push ─────────────────

const SESSIONS_EVENT = 'dopl:sessions';

// A burst of engine dispatches (one turn is many) must cost ONE render. 200ms is below where a
// state flip reads as laggy and above one turn's event storm. Mirrors ui-sync's COALESCE_MS.
const PUSH_COALESCE_MS = 200;

// Belt for the retention rule, which is already self-bounding (an entry lives only while its
// pill does, capped by MAX_ENDED). Drops the OLDEST — least likely still on screen.
const MAX_ENDED = 12;

const ledger = new Map(); // sessionKey -> { channelId, name }
let endedKept = []; // oldest first: { key, sessionId, channelId, taskId, channelName, threadTitle, win }
let deps = { sessions: null };
let getWindowsFn = null;
let pushTimer = null;
let lastDigest = null;
// ⚠ The SERVER writer's gate, separate from the window's — see `subscribe`.
const changeSubscribers = new Set();
let lastChangeDigest = null;

/** The engine binds its in-memory registry here at load. */
function bind(d) {
  deps = { sessions: (d && d.sessions) || null };
}

/** Arm the push. ⚠ `getWindows()` is called at SEND time, never captured — the window is
 *  rebuilt on reopen and a pop-out can appear at any moment (wiring plan Phase 10; it fans
 *  out over main/app-windows.js's registry). Idempotent. */
function start(opts) {
  getWindowsFn = opts && typeof opts.getWindows === 'function' ? opts.getWindows : null;
  lastDigest = null; // a fresh window has seen nothing; the next touch must reach it
  touch();
}

function windowAlive(win) {
  return !!(win && typeof win.isDestroyed === 'function' && !win.isDestroyed());
}

/** The retained ended entries whose windows are still open, sweeping the rest. */
function sweepEnded() {
  const alive = endedKept.filter((e) => windowAlive(e.win));
  if (alive.length !== endedKept.length) endedKept = alive;
  if (endedKept.length > MAX_ENDED) endedKept = endedKept.slice(endedKept.length - MAX_ENDED);
  return endedKept;
}

/**
 * EVERY pill this machine can show, live first, then retained ended ones. Consumers filter by
 * channel themselves — the list is bounded by the window budget, so nothing to page.
 * Names are assigned HERE, lazily; a key that has left both the registry and the ended set is
 * released below and its handle returns to the pool.
 * ONE PASS BEHIND BOTH CONSUMERS: builds REPORT entries, `list()` narrows for the renderer, the
 * server writer takes them whole.
 */
function reportList() {
  const out = [];
  const seen = new Set();
  if (deps.sessions) {
    for (const s of deps.sessions.values()) {
      if (s.settled) continue;
      seen.add(s.key);
      const name = nameFor(ledger, s.key, String(s.channelId || ''));
      out.push(reportEntry(liveSummary(s, name), s.key, s.workspaceId));
    }
  }
  for (const e of sweepEnded()) {
    // Both live and retained-ended => the thread was reopened after an abandonment. The live
    // session wins; it is the one the pill should open.
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(reportEntry(endedSummary(e, nameFor(ledger, e.key, e.channelId)), e.key, e.workspaceId));
  }
  for (const key of [...ledger.keys()]) {
    if (!seen.has(key)) ledger.delete(key);
  }
  return out;
}

/** The renderer's view: `reportList()` minus the two fields only a server row needs. */
function list() {
  return reportList().map(wireSummary);
}

/**
 * The handle one session is wearing, for a caller holding the session. The session window's
 * composer ("Message <name>") must show the SAME name as the channel pane's pill, so the
 * window asks main and main answers out of the ledger `list()` already writes.
 * ⚠ ASSIGNS ON DEMAND — only safe for a LIVE session, whose key is in the registry and survives
 * the next `list()`. A key in neither the registry nor the ended set is released on the next
 * projection, so naming anything else mints a handle and loses it.
 */
function nameForSession(s) {
  if (!s || !s.key) return null;
  return nameFor(ledger, s.key, String(s.channelId || ''));
}

/**
 * A session ENDED. Retain only when its window survived (retention rule, header). Returns
 * whether a pill was kept — worth asserting the engine's `keepWindow` (abandonment only)
 * against.
 */
function noteEnded(s, keepWindow) {
  const kept = keepWindow === true && windowAlive(s && s.win);
  if (kept) {
    const ctx = (s && s.context) || {};
    endedKept.push({
      key: s.key,
      sessionId: s.sessionId,
      channelId: String(s.channelId || ''),
      // ⚠ Frozen with the rest of the identity: a retained ended entry has left the registry
      // and there is nowhere else to read this from.
      workspaceId: String(s.workspaceId || ''),
      taskId: String(s.taskId || ''),
      channelName: ctx.channelName || null,
      threadTitle: ctx.taskTitle || null,
      // The final measurement, frozen with the identity and for the same reason — see
      // `endedSummary`. The session object is about to leave the registry.
      ...metrics(s),
      win: s.win,
    });
  }
  touch();
  return kept;
}

// ⚠ `keptWindow(channelId, taskId)` STOOD HERE AND IS DELETED (2026-08-20, F-228). It returned
// the surviving BrowserWindow of a RETAINED ENDED session so `reopenByTask` could reveal the
// transcript an abandoned run left behind rather than build a fresh shell over it. No session
// has a window, so nothing is retained and nothing can be revealed. The RETENTION ITSELF is
// untouched — an ended agent still holds its PILL in the Agents tab, which is what `noteEnded`
// and `sweepEnded` are for; only the window handle went.

// ⚠ The ONE place a summaries frame crosses into the renderer (modelled on ui-sync's
// sendToWindows): windows resolved at send time, a dead one fails closed.
// ⚠ FANS OUT SINCE 2026-08-18 (wiring plan Phase 10). A pop-out reads the same Agents
// projection; pushing to one window would have frozen it there with no error anywhere.
// One dead window must not swallow the rest — the answer is "did ANY window take it".
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

/**
 * "The projection moved", for a consumer that is not a window. One subscriber today:
 * main/session-state-push.js.
 * ⚠ NOT THE WINDOW'S GATE — never merge the two. `start()` resets `lastDigest` so a REBUILT
 * renderer gets a frame it has not seen, but a rebuilt renderer is not a state change and must
 * not cost a server write. `lastChangeDigest` is separate, never reset, and records regardless
 * of whether anything consumed the frame; delivery is the subscriber's problem.
 * ⚠ A THROWING SUBSCRIBER MUST NOT BREAK THE ENGINE — `touch()` is called from `dispatch`, so
 * an exception here unwinds into the SDK event loop.
 */
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
  if (digest === lastDigest) return; // nothing a pill could show has moved
  // ⚠ Record delivered only when it really was: a send into a window that is not there yet
  // must not suppress the next identical frame.
  if (sendToWindows({ sessions: entries.map(wireSummary) })) lastDigest = digest;
}

/**
 * A session's state just moved: STAMP its activity, RECORD what moved it, then touch.
 *
 * ⚠ THE STAMP LIVES HERE, WITH THE PROJECTION THAT READS IT, and is taken at the engine's ONE
 * dispatch funnel — the only caller. `lastActivityAt` feeds the Agents tab's "Last activity"
 * line and nothing else; keeping it beside `metrics()` is what stops a second writer appearing
 * somewhere that fires on a different clock.
 * ⚠ `event` JOINED THE SIGNATURE ON 2026-08-20 and is OPTIONAL: without one `noteEvent` no-ops
 * and `detailFor` falls through to `thinking` over a working pill — the honest answer for "a
 * turn is running and this build cannot say what it is doing".
 * ⚠ IT COSTS NO EXTRA PUSH. `dispatch` already calls `touch()`, so both stamps move exactly as
 * often as the digest is already recomputed — it is NOT a timer and NOT a second traversal.
 */
function noteActivity(s, event) {
  if (s) s.lastActivityAt = Date.now();
  noteEvent(s, event);
  touch();
}

/** Something about a session may have changed. Cheap and coalesced; call it freely. */
function touch() {
  if (pushTimer) return;
  pushTimer = setTimeout(flush, PUSH_COALESCE_MS);
  if (typeof pushTimer.unref === 'function') pushTimer.unref();
}

module.exports = {
  // pure core (re-exported for the shell + the tests)
  PILL_STATES,
  ACTIVITY_PILL,
  pillState,
  liveSummary,
  endedSummary,
  nameFor,
  summariesDigest,
  // the live half
  SESSIONS_EVENT,
  PUSH_COALESCE_MS,
  bind,
  start,
  list,
  reportList,
  subscribe,
  nameForSession,
  noteEnded,
  noteActivity,
  touch,
};
