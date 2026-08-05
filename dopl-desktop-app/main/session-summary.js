// SESSION SUMMARIES — the ONE projection from this machine's live session state to
// the thing a human (or, in phase 5, an MCP caller) is shown about it.
//
// WHAT REPLACED WHAT. `agent-chips-bar.tsx` showed one chip per SUMMONED NAMED AGENT
// and read its state off a server column. Both are gone (F-141). Rollback plan §3.3
// puts SESSION PILLS in that spot instead: one pill per LIVE SESSION this operator has
// running in that channel or DM, named from the surviving handle pool, and still called
// "agents" in UI copy because a session IS an agent session.
//
// WHY ONE MODULE. Three surfaces want the same sentence about a session — the channel
// pane's pills (this phase), the tray, and rollback §3.5's "what is flint doing?" over
// MCP (phase 5). The chips bar's defect was that its two readers each derived state
// their own way and disagreed in production ("the web chip shows Idle while the desktop
// works", plan §2). So the mapping is written ONCE, here, and every consumer is handed
// the RESULT. Phase 5 lifts `list()` to MCP and adds no second derivation.
//
// THIS PHASE ADDS NO SERVER WRITE. `agent_presence` is untouched (plan §5 / sequencing
// item 7 — its retirement is to be measured, not assumed), no table gains a column, and
// nothing here reaches the network. A summary is derived from in-memory state and pushed
// to the renderer over IPC.
//
// ── THE STATE MAPPING ────────────────────────────────────────────────────────────────
// The engine's own vocabulary is two fields wide (`session-state.js` / `session-reducer.js`):
// a PHASE (launching / running / awaiting_permission / awaiting_inbound / interrupted /
// parked / ended) and an ACTIVITY (working / idle / awaiting_peer / awaiting_permission /
// awaiting_inbound / parked). A pill has THREE states, and the reduction is:
//
//   ENGINE                                        PILL      WHY
//   phase 'ended'                                 ended     terminal at the top of the
//                                                           reducer; nothing wakes it
//   parked === true  (or phase 'parked')          idle      the query is torn down; the
//                                                           session is resumable, not gone
//   activity 'working'                            working   mid-turn, running tools
//   activity 'awaiting_permission'                working   ALSO mid-turn — the turn has
//                                                           not ended, the SDK is blocked
//                                                           on a canUseTool promise. Calling
//                                                           that "idle" would say nothing is
//                                                           happening while the agent is one
//                                                           click from continuing.
//   activity 'idle'                               idle      between turns
//   activity 'awaiting_peer'                      idle      posted; the other machine has it
//   activity 'awaiting_inbound'                   idle      a reply is HELD for an Accept;
//                                                           this session is running nothing
//   activity 'parked'                             idle      (the parked branch above wins,
//                                                           and this agrees with it)
//   anything else / absent                        idle      see the fallback note below
//
// PRECEDENCE IS PHASE-FIRST for the two terminal-ish answers and ACTIVITY-SECOND for the
// rest, because `phase` and `activity` deliberately disagree in normal operation: FIX #6
// keeps a still-pending gate card's phase while the activity moves, and a park lands with
// phase 'awaiting_inbound' when a message is held. Reading only one field is how the old
// chip got it wrong.
//
// THE FALLBACK DIRECTION IS 'idle', AND THAT IS A CHOICE. Both lies cost something: a pill
// saying "working" over a dead session makes the operator wait for nothing, and a pill
// saying "idle" over a working one makes them re-ask. The first is worse — waiting has no
// natural end and no feedback — so an activity this table does not know reads as idle.
//
// THERE IS NO 'thinking'. Plan §3.3 lists it and its own dependency note says why not yet:
// it needs `includePartialMessages: true`, which is off. Adding a fourth state that can
// only ever be derived from a stream we do not have would be a state that never appears.
//
// ── ENDED SESSIONS: THE RETENTION RULE ───────────────────────────────────────────────
// An ended session's pill survives exactly as long as its WINDOW does, and no longer.
//
// `session-engine.settle` deletes the registry entry on every end and destroys the window
// on all but one: M2b keeps it for an ABANDONMENT, because that end fires hours later with
// nobody present and a transcript vanishing off the desktop of someone who stepped away is
// indistinguishable from a crash. So the abandoned session is the case that has something
// left to open, and it is the case whose pill stays — as `ended`, openable, landing in that
// painted transcript. Every other end (operator End, turn/cost cap, completed, crash) takes
// its window with it and its pill leaves at the same moment.
//
// WHY NOT A TIMED TOMBSTONE. A pill is a HANDLE, not a log: its whole affordance is "click
// to open this". A pill for a session with no window would answer that click by recreating
// a fresh parked shell — a different session wearing a dead one's name — or by doing
// nothing. The channel transcript already carries the record of what happened. So the rule
// needs no TTL, no ring to prune and no persistence: the retained set is bounded by the
// window budget itself (MAX_SESSION_WINDOWS), the operator closing the window is the
// removal, and a destroyed window is swept on the next projection.

// The module's ONLY two dependencies, and they are both above the sentinel below on
// purpose: everything from there to `module.exports` is import-free, so
// test/session-summary.test.mjs evaluates the real code verbatim with these two injected —
// no window layer, no file log, no Electron of any kind (the session-reopen idiom).
const { pickAgentName } = require('./agent-names');
const { diag } = require('./diag');

// ─── BEGIN SESSION-SUMMARY-PURE (injectable; unit-tested via source extraction) ──────
// `pickAgentName` and `diag` are free vars from here down.

const PILL_WORKING = 'working';
const PILL_IDLE = 'idle';
const PILL_ENDED = 'ended';
const PILL_STATES = [PILL_WORKING, PILL_IDLE, PILL_ENDED];

// The activity half of the table above. Written out in full — including the rows that
// agree with the fallback — so the mapping is READABLE as a list of the engine's real
// activities rather than as a couple of special cases over a default.
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
 *
 * The activity lookup goes through an OWN-PROPERTY check rather than a bare index: a
 * plain object literal answers a FUNCTION for 'constructor' / 'toString', and a function
 * is truthy, so a bare lookup would let those two words through as a pill state
 * (session-park's `requestRank` was fixed for exactly this).
 */
function pillState(state) {
  const st = state || {};
  if (st.phase === 'ended') return PILL_ENDED;
  if (st.parked === true || st.phase === 'parked') return PILL_IDLE;
  const known = Object.prototype.hasOwnProperty.call(ACTIVITY_PILL, st.activity);
  return known ? ACTIVITY_PILL[st.activity] : PILL_IDLE;
}

// A display string for the wire: one line, whitespace collapsed, bounded, or null.
// Same discipline as session-store's `durableName` and for the same reason — a channel
// name and a thread title are counterparty-influenced text on their way to a renderer.
function displayText(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return s || null;
}

/**
 * THE NAME LEDGER. `sessionKey -> { channelId, name }`.
 *
 * PER CHANNEL, not global (plan §3.3: "Per channel / DM (not global)"), so `taken` is the
 * names held in THIS channel and two channels may each run a `flint`.
 *
 * KEYED BY SESSION KEY — (channel, thread) — which is what makes the name survive the
 * things that replace the session OBJECT while the operator's mental model does not
 * change: an idle park and its lazy resume, a P2 recreate from the durable record, a crash
 * resume. The internal `sessionId` is minted fresh by each of those; the key is not.
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

/**
 * The friendly handle for ONE session object, off the SAME ledger `list()` reads.
 *
 * Phase 4's composer pill (session window) labels its steer option "Message <name>", and the
 * name has to match the channel's pill-bar or the two surfaces disagree about what one session
 * is called. This is the shared read: the engine calls it while emitting `init` so the window
 * carries the same handle `list()` will project, keyed by the same (channel, thread) session
 * key. Idempotent — a name assigned here is the one the pill-bar shows, and vice versa.
 */
function nameForSession(s) {
  return nameFor(ledger, String((s && s.key) || ""), String((s && s.channelId) || ""));
}

/** One LIVE session object -> its summary. `name` is handed in (the ledger is the
 *  caller's), so this stays a pure shape. */
function liveSummary(s, name) {
  const ctx = (s && s.context) || {};
  return {
    sessionId: String((s && s.sessionId) || ''),
    channelId: String((s && s.channelId) || ''),
    // Wire name `task` == domain name `thread` (the v3.0 vocabulary boundary). '' is a
    // real value: a responder with no first-class thread collapses it.
    taskId: String((s && s.taskId) || ''),
    name: name,
    state: pillState(s && s.state),
    channelName: displayText(ctx.channelName),
    threadTitle: displayText(ctx.taskTitle),
  };
}

/** One RETAINED ENDED entry -> its summary. Nothing is re-derived: the state is `ended`
 *  by construction, and the identity was frozen when the session settled. */
function endedSummary(e, name) {
  return {
    sessionId: String((e && e.sessionId) || ''),
    channelId: String((e && e.channelId) || ''),
    taskId: String((e && e.taskId) || ''),
    name: name,
    state: PILL_ENDED,
    channelName: displayText(e && e.channelName),
    threadTitle: displayText(e && e.threadTitle),
  };
}

/**
 * Have the summaries actually changed? The engine dispatches on EVERY SDK event, so
 * without this the renderer would be woken by a message it cannot see the effect of —
 * a tool result, a token count, a cost delta — dozens of times per turn.
 *
 * Compared as a stable string rather than field-by-field so a member added to the shape
 * is compared automatically instead of being silently dropped from the check. Order is
 * already stable (the registry preserves insertion, and the ended list is append-only).
 */
function summariesDigest(list) {
  return JSON.stringify(list || []);
}

// ─── END SESSION-SUMMARY-PURE ────────────────────────────────────────────────────────

// ── The live half: the registry, the ledger, the ended set, the push ─────────────────

const SESSIONS_EVENT = 'dopl:sessions';

// A burst of engine dispatches — one turn is many — must cost ONE render. 200ms is below
// the threshold where a state flip reads as laggy and well above one turn's event storm.
// Mirrors ui-sync's COALESCE_MS reasoning.
const PUSH_COALESCE_MS = 200;

// Belt for the retention rule. The rule itself is self-bounding (an entry lives only while
// its window does, and windows are capped by MAX_SESSION_WINDOWS), so this can only ever
// bite if that invariant breaks; it drops the OLDEST, which is the least likely to still
// be on screen.
const MAX_ENDED = 12;

const ledger = new Map(); // sessionKey -> { channelId, name }
let endedKept = []; // oldest first: { key, sessionId, channelId, taskId, channelName, threadTitle, win }
let deps = { sessions: null };
let getWindowFn = null;
let pushTimer = null;
let lastDigest = null;

/** The engine binds its in-memory registry here at load (the session-reopen idiom). */
function bind(d) {
  deps = { sessions: (d && d.sessions) || null };
}

/** Arm the push. `getWindow()` returns the live SPA BrowserWindow (or null) and is called
 *  at SEND time, never captured — the window is rebuilt on reopen. Idempotent. */
function start(opts) {
  getWindowFn = opts && typeof opts.getWindow === 'function' ? opts.getWindow : null;
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
 * EVERY pill this machine can show, live first, then the retained ended ones. Every
 * consumer filters this by channel itself — the list is bounded by the window budget, so
 * there is nothing to page and no watch handshake to get wrong.
 *
 * Names are assigned HERE, lazily, which is what keeps the ledger from growing with every
 * session that ever ran: a key that has left both the registry and the ended set is
 * released below and its handle goes back to the pool.
 */
function list() {
  const out = [];
  const seen = new Set();
  if (deps.sessions) {
    for (const s of deps.sessions.values()) {
      if (s.settled) continue;
      seen.add(s.key);
      out.push(liveSummary(s, nameFor(ledger, s.key, String(s.channelId || ''))));
    }
  }
  for (const e of sweepEnded()) {
    // A key that is BOTH live and retained-ended means the thread was reopened after an
    // abandonment. The live session wins: it is the one the pill should open.
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(endedSummary(e, nameFor(ledger, e.key, e.channelId)));
  }
  for (const key of [...ledger.keys()]) {
    if (!seen.has(key)) ledger.delete(key);
  }
  return out;
}

/**
 * THE HANDLE ONE SESSION IS WEARING, for a caller that has the session in hand.
 *
 * §3.2 gives the session WINDOW's composer a pill whose resting row reads "Message <name>",
 * and that name has to be the SAME one the channel pane's pill shows for the same session —
 * a window calling itself `flint` while its pill says `onyx` is the two-readers-one-fact
 * defect this module exists to prevent (F-142), reproduced inside one feature. So the window
 * asks main, and main answers out of the ledger `list()` already writes.
 *
 * ASSIGNS ON DEMAND, like `list()` does, which is safe for exactly one reason: the caller
 * holds a LIVE session resolved from its own window, so the key is in the registry and the
 * next `list()` keeps it. A key that is in neither the registry nor the ended set is released
 * on the next projection, so naming something this module cannot see would mint a handle and
 * then lose it — never call this with anything but a live session.
 */
function nameForSession(s) {
  if (!s || !s.key) return null;
  return nameFor(ledger, s.key, String(s.channelId || ''));
}

/**
 * A session ENDED. Retain it only when its window survived — see the retention rule in
 * the header. Returns whether a pill was kept, which is what the engine's own reasoning
 * (`keepWindow` is the abandonment case alone) is worth asserting against.
 */
function noteEnded(s, keepWindow) {
  const kept = keepWindow === true && windowAlive(s && s.win);
  if (kept) {
    const ctx = (s && s.context) || {};
    endedKept.push({
      key: s.key,
      sessionId: s.sessionId,
      channelId: String(s.channelId || ''),
      taskId: String(s.taskId || ''),
      channelName: ctx.channelName || null,
      threadTitle: ctx.taskTitle || null,
      win: s.win,
    });
  }
  touch();
  return kept;
}

/**
 * The window of a RETAINED ENDED session for (channel, thread), or null.
 *
 * `session-reopen.reopenByTask` consults this between its live-session branch and its
 * recreate fallback, so the pill's "Open" reuses the one reopen path rather than growing
 * a second one — and an abandoned session opens the transcript it actually left behind
 * instead of a fresh parked shell wearing its name.
 */
function keptWindow(channelId, taskId) {
  const key = String(channelId || '') + ':' + String(taskId || '');
  for (const e of sweepEnded()) {
    if (e.key === key) return e.win;
  }
  return null;
}

// The ONE place a summaries frame crosses into the renderer, modelled on ui-sync's
// sendToWindow: the window is resolved at send time and a dead one fails closed.
function sendToWindow(payload) {
  let win = null;
  try { win = getWindowFn ? getWindowFn() : null; } catch (_err) { return false; }
  if (!windowAlive(win)) return false;
  const wc = win.webContents;
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
  try {
    wc.send(SESSIONS_EVENT, payload);
  } catch (err) {
    diag('session-summary send error', err && err.message);
    return false;
  }
  return true;
}

function flush() {
  pushTimer = null;
  const sessions = list();
  const digest = summariesDigest(sessions);
  if (digest === lastDigest) return; // nothing a pill could show has moved
  // Only record the frame as delivered when it really was: a send into a window that is
  // not there yet must not suppress the next identical one.
  if (sendToWindow({ sessions: sessions })) lastDigest = digest;
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
  nameForSession,
  noteEnded,
  keptWindow,
  touch,
};
