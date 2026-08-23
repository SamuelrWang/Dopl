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
//
// ── ENDED SESSIONS: THE RETENTION RULE ───────────────────────────────────────────────
// ⚠ THE RETENTION RULE, REWRITTEN 2026-08-20 (F-234, Samuel's ruling). It USED to read: a
// pill survives exactly as long as its WINDOW does, and no longer — `settle` destroyed the
// window on every end but ABANDONMENT, so the abandoned session was the only one with
// something left to open and the only one whose pill stayed.
//
// EVERY SESSION IS WINDOWLESS since the F-228 retirement, so `s.win` is null on all of them
// and that predicate answered FALSE for every end: nothing was ever retained, and an agent
// that finished left the Agents tab instantly with no record it had run. The rule was
// written for exactly the case it had stopped covering — "an end nobody watched happen must
// not make a run vanish".
//
// SO RETENTION WAS MADE UNCONDITIONAL, on the caller's flag alone, BOUNDED BY `MAX_ENDED` (12).
// A TIME bound was refused at the time — the question the window check answered ("did anything
// ever have this on screen") has no answer without a window, and a TTL would have invented one.
//
// ⚠ AND ON 2026-08-22 SAMUEL RULED THE TIME BOUND IN, WHICH SUPERSEDES BOTH HALVES ABOVE.
// EVERY end is retained (not only the abandonment), the record is DURABLE (`agent-history.js`
// — it survives a restart, which the in-memory set never did), and the bound is SEVEN DAYS
// from `endedAt` rather than a count of 12. The count bound was the honest answer while the
// set lived in memory; once the history is on disk it can be swept on the clock, which is what
// "the window stays viewable for a week" actually asks for. `MAX_ENDED` and `endedKept` are
// DELETED — see `retainedEnded` below.
//
// ⚠ A RETAINED PILL IS A TOMBSTONE, NOT A HANDLE, AND THAT IS UNCHANGED AND NOW LOAD-BEARING.
// An ended agent is gone from the engine's registry, so every wake path (`feedLiveSession`'s
// fan-out, the @agent-id parse, `messageByTask`, `reopenByTask`, a spawn-idle wake) resolves
// nothing and refuses. What the card opens is a READ-ONLY history, never a session. The channel
// transcript is still the shared record, and nothing here ever touches it.

// ⚠ The module's only three dependencies, all ABOVE the sentinel: everything from there to
// `module.exports` is import-free, so test/session-summary.test.mjs evaluates the real code
// verbatim with these injected.
// ⚠ `pickAgentName` LEFT THIS LIST ON 2026-08-21. The stone-name pool is deleted in both trees;
// a pill's name is the session's own `agentId`, minted at spawn by `main/agent-id.js`, so there
// is nothing left to pick and no ledger to pick it out of. See `nameOf` below.
const { metricOrNull, metrics } = require('./session-metrics');
// ⚠ THE STATE MAPPING MOVED OUT ON 2026-08-22 (`session-pill.js`) — one file, one reason to
// change: that module answers "what WORD does a person see for this state", this one answers
// "which sessions exist and what rides with each".
// ⚠ THE COMPATIBILITY RE-EXPORT WENT WITH THE SECOND HALF OF THAT MOVE (2026-08-22). This file
// re-exported `PILL_STATES`, `ACTIVITY_PILL`, `pillState`, `queryTornDown` and `listeningState`
// "so every existing reader of `summary.pillState` is unchanged" — and there were NO production
// readers of the re-export, in either tree: the only consumers outside this file were the test
// harnesses, which already require `session-pill.js` themselves. A second import path for one
// derivation is exactly the drift the split was made to prevent, so what this file takes is now
// only what it CALLS. Read the mapping from `main/session-pill.js`.
const { PILL_ENDED, pillState, listeningState } = require('./session-pill');
const { noteEvent, detailFor } = require('./session-detail');
const { diag } = require('./diag');

// ─── BEGIN SESSION-SUMMARY-PURE (injectable; unit-tested via source extraction) ──────
// The names above are free vars from here down.


// Display string for the wire: one line, whitespace collapsed, bounded, or null. ⚠ Same
// discipline as session-store's `durableName`: channel name and thread title are
// counterparty-influenced text on their way to a renderer.
function displayText(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return s || null;
}

/**
 * A SESSION'S NAME IS ITS AGENT ID — the whole derivation, since 2026-08-21.
 *
 * ⚠ THIS REPLACED A LEDGER, and the deletion is the point. `nameFor(ledger, key, channelId)`
 * picked the first free handle from the stone-name pool and RELEASED it the moment its key left
 * both the registry and the ended set. Under multiplayer that release is a correctness BUG:
 * agents share a thread, end at different times, and a released handle was re-issued within one
 * projection pass — so `@flint` in a transcript could name a different agent than the one it was
 * typed at. A per-INSTANCE id is stable by construction: no ledger, no `taken` set, no sweep.
 *
 * ⚠ IT IS ALSO WHAT THE SERVER STORES (`channel_sessions.name`, CHECK `^[a-z][a-z0-9-]{1,30}$`
 * — `agent-id.js`'s charset is a deliberate subset, so a real id can never be refused). '' is
 * the honest answer for a session carrying no id; the push refuses it rather than this
 * inventing a name.
 */
function nameOf(s) {
  return String((s && s.agentId) || '');
}

/** The operator's PICK, as something to display — or '' when they picked nothing. `'default'` is
 *  the frozen enum's "ask for no model at all", so it names no model and must not be rendered as
 *  one. Never coerced further here: `session-engine.js` already coerced it at the construction
 *  site against the frozen list, and this is a read. */
function modelPick(s) {
  const pick = String((s && s.model) || '');
  return pick && pick !== 'default' ? pick : null;
}


/** One LIVE session object -> its summary. `name` is handed in (it is `nameOf(s)`; the argument
 *  survives so the ENDED branch, whose session object is gone, can pass the frozen id). */
function liveSummary(s, name) {
  const ctx = (s && s.context) || {};
  const pill = pillState(s && s.state);
  return {
    sessionId: String((s && s.sessionId) || ''),
    channelId: String((s && s.channelId) || ''),
    // Wire name `task` == domain name `thread`. '' is a real value: a responder with no
    // first-class thread collapses it.
    taskId: String((s && s.taskId) || ''),
    // ⚠ THE ADDRESS OF ONE AGENT AMONG SEVERAL (2026-08-21). `(channelId, taskId)` stopped
    // identifying a session, so every op the Agents tab invokes — pause, end, setMode, message,
    // narration, openAgentWindow — takes this as its third coordinate. It rides BESIDE `name`
    // because `name` is the SERVER's column and this is the local address; they hold the same
    // string today and a reader that needs to address something must not have to know that.
    agentId: name,
    name: name,
    state: pill,
    // ⚠ BESIDE THE PILL, NEVER INSTEAD OF IT (the rule `detail` follows): it refines `idle` into
    // "Waiting" (feeds) vs "Idle" (relaunches), and adds nothing under `working` / `ended`.
    listening: listeningState(s && s.state),
    endedAt: null, // a LIVE session has not ended; the field is uniform so a reader never branches on absence
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
    // ⚠ WHICH MODEL IS REALLY ANSWERING (2026-08-22, Samuel's model-selection ruling), and the
    // precedence is deliberate: the SDK's own reported id FIRST (`s.liveModel`, stamped from
    // system/init and from every assistant message, so a mid-session `Query.setModel` shows up
    // without a second wiring), then the operator's PICK, then null. A card that showed the pick
    // over the live id would go wrong the moment the two differed — which is the normal case,
    // since 'default' means "whatever the CLI chose" and the CLI is the one that knows.
    // ⚠ NULL IS A REAL ANSWER, not a gap: a SPAWN-IDLE agent has started no query, so nothing has
    // reported a model and nothing has been picked. Saying null is honest; guessing is not.
    model: (s && s.liveModel) || modelPick(s),
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
    agentId: name, // frozen with the rest of the identity — see `noteEnded`
    name: name,
    state: PILL_ENDED,
    listening: false, // terminal; stated rather than omitted so every row carries the field
    // ⚠ WHEN IT ENDED, so the card can say so and the operator can tell a run that finished a
    // minute ago from one about to age out of the 7-day window. It is the SWEEP'S CLOCK too
    // (`agent-history.js › expired`), which is why it is frozen at settle rather than derived.
    endedAt: metricOrNull(e && e.endedAt),
    // Nothing finer to say about a session that is doing nothing, and a retained detail
    // would outlive the run it described.
    detail: null,
    toolLabel: null,
    // No posture to change; a retained one would offer a control over nothing.
    toolMode: null,
    messageMode: null,
    // ⚠ NOT FROZEN AT SETTLE, so it is null here rather than stale. The metrics beside it ARE
    // frozen because the operator wants to read what the run cost; a model is a control's current
    // value, and a control over an ended agent is a control over nothing.
    model: null,
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

// ⚠ `MAX_ENDED` (12) AND `endedKept` STOOD HERE AND ARE DELETED (2026-08-22, Samuel's ruling).
// They were an in-memory list bounded by COUNT and lost on quit. Ended cards are projected from
// the DURABLE history now (`agent-history.js`, injected as `deps.endedRecords`), bounded by
// SEVEN DAYS from `endedAt` and swept by `agent-retention.js`. A count bound in front of a
// durable set would be a second, shorter retention rule nobody asked for.
// ⚠ THE NAME LEDGER STOOD HERE TOO AND IS DELETED (2026-08-21) — see `nameOf`.
let deps = { sessions: null, endedRecords: null };
let getWindowsFn = null;
let pushTimer = null;
let lastDigest = null;
// ⚠ The SERVER writer's gate, separate from the window's — see `subscribe`.
const changeSubscribers = new Set();
let lastChangeDigest = null;

/**
 * The engine binds its in-memory registry here at load, plus the reader for retained ENDED
 * records (`agent-history.js › listEnded`).
 * ⚠ INJECTED, NOT REQUIRED: this module is import-free below the sentinel so its suites can
 * evaluate it as source. An absent `endedRecords` degrades to "no ended cards" rather than
 * throwing — the live half is what an operator is mid-way through, and it must not go dark
 * because a history file could not be read.
 */
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    endedRecords: (d && d.endedRecords) || null,
  };
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

/**
 * The retained ENDED records — read from the durable history, never from a local list.
 *
 * ⚠ THIS IS WHY A RESTART KEEPS THE CARDS. The predecessor (`sweepEnded` over `endedKept`) was
 * in-memory, so quitting the app erased every ended agent even though its work had happened;
 * the durable file is read fresh on every projection instead. The BOUND is not here either —
 * `agent-history.js` owns `RETENTION_MS` and `agent-retention.js` runs the sweep, so this reads
 * whatever survives and applies no second rule of its own.
 * ⚠ NEVER THROWS. A history file that cannot be read costs the ended cards, not the live ones.
 */
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

/**
 * EVERY pill this machine can show, live first, then retained ended ones. Consumers filter by
 * channel themselves — the list is bounded by MAX_CONCURRENT_SESSIONS live plus the retained
 * ended set (`agent-history.js › MAX_HISTORY`), so nothing to page.
 * ⚠ SEVERAL ROWS PER (channel, thread) IS NORMAL SINCE 2026-08-21: the registry is keyed by
 * (channel, thread, AGENT). Nothing here de-duplicates on the pair, and nothing downstream may
 * start to. Names are the sessions' own agent ids — no ledger, no assignment, no release.
 * ONE PASS BEHIND BOTH CONSUMERS: builds REPORT entries, `list()` narrows for the renderer, the
 * server writer takes them whole. */
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
    // Both live and retained-ended => the SAME agent instance was somehow re-registered after
    // an abandonment. The live session wins; it is the one the pill should open. ⚠ A sibling
    // agent on the same thread has a DIFFERENT key and is never suppressed by this.
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(reportEntry(endedSummary(e, String(e.agentId || '')), e.key, e.workspaceId));
  }
  return out;
}

/** The renderer's view: `reportList()` minus the two fields only a server row needs. */
function list() {
  return reportList().map(wireSummary);
}

/** The handle one session is wearing, for a caller holding the session. ⚠ IT ASSIGNS NOTHING
 *  NOW (2026-08-21): it reads the id the session was minted with, so it is safe for any session
 *  object at any point in its life. The "assigns on demand" caveat went with the ledger. */
function nameForSession(s) {
  if (!s || !s.key) return null;
  return nameOf(s);
}

/**
 * A session ENDED — the projection's half of it: mark the digest dirty so the card flips.
 *
 * ⚠ IT NO LONGER STORES ANYTHING, AND THE `keepWindow` ARGUMENT NO LONGER DECIDES ANYTHING
 * (2026-08-22, Samuel's ruling). Retention used to be this function's job and was conditional
 * on that flag, which the engine set for the ABANDONMENT alone. Now EVERY end is retained, for
 * seven days, and the record is written where the data actually is: `session-engine.js › settle`
 * calls `agent-history.record(...)` with the narration ring, which lives on the session object
 * and is not visible from here.
 * ⚠ THE ARGUMENT SURVIVES AND IS IGNORED, deliberately. `session-effects.js › endEffects` still
 * sets it, `settle` still passes it, and deleting the parameter would be a change to the engine's
 * effect vocabulary for a cosmetic gain. It returns whether a record is expected to exist, which
 * is now simply "an end happened".
 */
function noteEnded(s, _keepWindow) {
  touch();
  return true;
}

/**
 * The 7-day sweep dropped these keys: forget any cached projection of them
 * (`main/agent-retention.js`). The durable read is fresh every time, so this only has to make
 * the next digest move — otherwise the card would linger until some unrelated state change.
 */
function releaseEnded(_keys) {
  touch();
}

// ⚠ `keptWindow(channelId, taskId)` STOOD HERE AND IS DELETED (2026-08-20, F-228). It returned
// the surviving BrowserWindow of a RETAINED ENDED session so `reopenByTask` could reveal the
// transcript an abandoned run left behind rather than build a fresh shell over it. No session
// has a window, so nothing is retained and nothing can be revealed. The RETENTION ITSELF is
// untouched — an ended agent still holds its PILL in the Agents tab, which is what `noteEnded`
// and its retention are for; only the window handle went.

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
  // ⚠ FIVE `session-pill.js` NAMES STOOD AT THE TOP OF THIS LIST AND ARE DELETED (2026-08-22):
  // `PILL_STATES`, `ACTIVITY_PILL`, `pillState`, `queryTornDown`, `listeningState`. They were a
  // compatibility re-export with no production reader — one derivation behind two import paths,
  // which is the drift the `session-pill.js` split exists to prevent. Require that module.
  liveSummary,
  endedSummary,
  nameOf, // 2026-08-21: the whole naming derivation (the pool + its ledger are deleted)
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
  releaseEnded, // 2026-08-22: the 7-day sweep's cleaner for this projection
  noteActivity,
  touch,
};
