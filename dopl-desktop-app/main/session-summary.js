// SESSION SUMMARIES — the ONE projection from this machine's live session state to what a human
// (or an MCP caller) is shown about it: one pill per LIVE SESSION in a channel or DM.
//
// ONE MODULE, ONE DERIVATION. Three surfaces want the same sentence about a session (channel pane
// pills, the tray, "what is flint doing?" over MCP), and the predecessor's defect was two readers
// deriving it their own way and disagreeing in production. Every consumer is handed the RESULT.
//
// THIS MODULE REACHES NO NETWORK. The `channel_sessions` writer is main/session-state-push.js,
// which SUBSCRIBES to `subscribe()` below. Separate on purpose: this file is import-free below the
// sentinel and every one of its tests reads it as SOURCE, so an HTTP call here would end both. The
// trigger is the DIGEST, and there is only one — `flush()` coalesces a burst of engine dispatches
// into one comparison and fires only when the projection moved, so a server write costs a state
// CHANGE and never a turn.
//
// ENDED SESSIONS — THE RETENTION RULE (Samuel, 2026-08-22): EVERY end is retained, the record is
// DURABLE (`agent-history.js`; it survives a restart), and the bound is SEVEN DAYS from `endedAt`
// rather than a count. `MAX_ENDED` and `endedKept` are deleted; see `retainedEnded` below.
//
// A RETAINED PILL IS A TOMBSTONE, NOT A HANDLE. An ended agent is gone from the engine's registry,
// so every wake path resolves nothing and refuses; what the card opens is a READ-ONLY history. The
// channel transcript is still the shared record, and nothing here ever touches it.

// The module's only four dependencies, all ABOVE the sentinel: everything from there to
// `module.exports` is import-free, so test/session-summary.test.mjs evaluates the real code
// verbatim with these injected. (`displayNameFor` joined 2026-08-25, STUBBED in the harness — it
// opens an electron-store on require.)
const { metricOrNull, metrics } = require('./session-metrics');
// THE STATE MAPPING MOVED OUT ON 2026-08-22 (`session-pill.js`) — one file, one reason to change:
// that module answers "what WORD does a person see for this state", this one answers "which
// sessions exist and what rides with each". The compatibility re-export went with it and had no
// production reader — a second import path for one derivation is the drift the split prevents.
const { PILL_ENDED, pillState, listeningState } = require('./session-pill');
const { noteEvent, detailFor, endReasonFor } = require('./session-detail'); // ⚠ `endReasonFor` joined 2026-09-21 (U10): WHY a run stopped, as a structured code re-said in the OWNING runtime's own words — the same "a second fact beside the pill" seam `detailFor` is, so a third surface cannot word it a third way
// ⚠ WHAT THE OPERATOR CALLS AN AGENT (2026-08-25) — read HERE, not in the renderer: one
// projection, one answer. The reasoning is `agent-names.js`'s own header.
const { displayNameFor, descriptionForAgent } = require('./agent-names');
const { diag } = require('./diag');
// `displayText` and `IDENTITY_NAME_MAX` moved out on 2026-09-13 (`session-summary-text.js`), a
// split forced by the 500-line cap. Injected by the harness like the rest.
const { displayText, IDENTITY_NAME_MAX } = require('./session-summary-text'); const { heldGatesFor } = require('./session-held-gates'); // ⚠ THE SECOND REQUIRE SHARES THIS LINE BECAUSE THE FILE IS AT THE §1 CAP: `heldGatesFor` (2026-09-17) projects WHAT A HELD CALL IS ASKING off the reducer's own `pendingPermissions` — never a second opinion about what is live — and takes no requires of its own precisely so this file's source-extraction harness keeps loading

// ─── BEGIN SESSION-SUMMARY-PURE (injectable; unit-tested via source extraction) ──────
// The names above are free vars from here down.

/**
 * A SESSION'S NAME IS ITS AGENT ID — the whole derivation, since 2026-08-21.
 *
 * It replaced a ledger that picked the first free handle from a stone-name pool and RELEASED it
 * once its key left the registry. Under multiplayer that release is a correctness BUG: a released
 * handle could be re-issued within one projection pass, so `@flint` in a transcript could name a
 * different agent than the one it was typed at. A per-INSTANCE id is stable by construction.
 *
 * It is also what the server stores (`channel_sessions.name`, CHECK `^[a-z][a-z0-9-]{1,30}$` —
 * `agent-id.js`'s charset is a deliberate subset, so a real id can never be refused). '' is the
 * honest answer for a session carrying no id; the push refuses it rather than this inventing one.
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
    channelId: String((s && s.channelId) || ''), workspaceId: (s && s.workspaceId) || null, // ⚠ THE CONTAINER THIS RUN BELONGS TO (2026-09-14) — a FIELD, never a handle, and `null` when the spawn shape carried none, which is the rule every other id on this row follows. The SPA's `DesktopSessionSummary` is gaining it on the other side. ⚠ IT DOES NOT REACH THE WIRE YET: `wireSummary` below still DELETES `workspaceId`, and `reportEntry` re-stamps its own string-coerced copy over this one, so lifting that strip is the decision this line is waiting on — not something to do silently.
    // Wire name `task` == domain name `thread`. '' is a real value: a responder with no
    // first-class thread collapses it.
    taskId: String((s && s.taskId) || ''),
    // THE ADDRESS OF ONE AGENT AMONG SEVERAL (2026-08-21): `(channelId, taskId)` stopped
    // identifying a session, so every op the Agents tab invokes takes this as its third coordinate.
    // It rides BESIDE `name` because `name` is the SERVER's column and this is the local address;
    // they hold the same string today and a reader that addresses something must not rely on that.
    agentId: name,
    name: name,
    // ⚠ NULL is the ordinary answer (never renamed) and not a gap — the card falls back to
    // `Agent #<id>`. Rides BESIDE `agentId`/`name`, which stay the ADDRESS. See `agent-names.js`.
    displayName: displayNameFor(name),
    description: descriptionForAgent(name), // what it is FOR, beside what it is CALLED
    state: pill,
    // ⚠ BESIDE THE PILL, NEVER INSTEAD OF IT (the rule `detail` follows): it refines `idle` into
    // "Waiting" (feeds) vs "Idle" (relaunches), and adds nothing under `working` / `ended`.
    listening: listeningState(s && s.state),
    endedAt: null, // a LIVE session has not ended; the field is uniform so a reader never branches on absence
    // ⚠ BESIDE THE PILL, NEVER INSTEAD OF IT (header; session-detail.js). `detail` is null
    // over any pill but `working`; `toolLabel` means something only under `detail: 'tool'`.
    detail: detailFor(s && s.state, s && s.lastEventKind, pill),
    toolLabel: (s && s.lastToolLabel) || null,
    // THE LIVE POSTURE (2026-08-20), read-only here: a control that cannot read back what it set
    // lies after the auth hold resets both axes, after a resume, and after a change made in another
    // window. The REDUCER's state, not the channel's stored launch posture — a session can be moved
    // off what it launched on. Absent reads fail-closed, as `session-io.js › grantArgs` treats it.
    toolMode: (s && s.state && s.state.toolMode) || 'manual',
    messageMode: (s && s.state && s.state.messageMode) || 'ask',
    // WHICH MODEL IS REALLY ANSWERING (2026-08-22, Samuel's model-selection ruling). The SDK's own
    // reported id FIRST (`s.liveModel`, stamped from system/init and from every assistant message,
    // so a mid-session `Query.setModel` shows up with no second wiring), then the operator's PICK,
    // then null. The pick over the live id would go wrong the moment the two differed, which is the
    // normal case since 'default' means "whatever the CLI chose". NULL is a real answer, not a gap:
    // a spawn-idle agent has started no query.
    model: (s && s.liveModel) || modelPick(s),
    channelName: displayText(ctx.channelName),
    threadTitle: displayText(ctx.taskTitle),
    // SPAWN-TIME, AND IT CANNOT MOVE. `context.identity` is captured once at spawn
    // (`session-launch-op.js`) and never re-resolved, which is what makes it free to carry in the
    // STATE half of the server digest rather than the quantized churn half.
    identityName: displayText(ctx.identity && ctx.identity.name, IDENTITY_NAME_MAX),
    // THE AGENT COLOUR — the key this session ASKED for, not the one it was granted (Samuel,
    // 2026-09-13; docs/specs/agent-colors.md). An IDENTITY like `identityName`, quantization-exempt
    // and on `session-telemetry.js › STATE_FIELDS` so a change PUSHES. `reportRow` had read
    // `e.color` since the colours wave while the summary carried none, so every push asked for
    // nothing. No bound and no sanitizer: a CLOSED SET, membership-tested at the two boundaries
    // that produce one, where `labelOrNull` would pass `agent-99` through. `null` is "none
    // reported" and cannot erase one (`server/session-colors.ts` rule 1).
    color: (s && s.color) || null,
    // ── 2026-09-21 (U10) — WHICH RUNTIME IS ANSWERING, AND ON WHAT USAGE TERMS ───────────────
    // ⚠ THE SPAWN STAMP, READ AND NEVER RE-CHOSEN (INVARIANTS §11). `model` one screen up says
    // WHAT is answering; without this the row could not say WHO, so a Codex agent and a Claude
    // agent on one thread were two identical pills. `''` is a session from before the stamp.
    // ⚠ LOCAL ONLY, like `heldGates` — `session-state-push.js › reportRow` is an allowlist and
    // does not name either, so neither widens `channel_sessions`.
    runtimeId: (s && s.runtimeId) || '',
    // ⚠ WHETHER A RESUME WOULD KEEP THE COST CAP HONEST, in the record's own three words
    // (`session-runtime-truth.js`). `'unverified'` is a REAL answer and not a gap — it is the one
    // `capability.js › canResume` refuses on, and UNKNOWN is not EMPTY.
    usageBaseline: (s && s.usageBaseline) || null,
    // ⚠ null on a LIVE row, stated rather than omitted so no reader branches on absence — the
    // rule `endedAt` above follows. A running agent has not stopped, so it has no end reason.
    endReason: null,
    heldGates: heldGatesFor(s), // ⚠ **THE CALLS THIS SESSION IS BLOCKED ON, WITH ENOUGH TO DECIDE THEM** (Samuel, 2026-09-17: *"i dont see like a surface where I can approve the permission either inline"*). `[]` is the ordinary answer and the field is UNIFORM so no reader branches on absence. ⚠ **LOCAL ONLY** — `session-state-push.js › reportRow` is an allowlist and does not name it, so a tool input summary never reaches the server; the answering op is `sessions:answerPermission`
    ...metrics(s),
  };
}

/** One RETAINED ENDED entry -> its summary. Nothing re-derived: state is `ended` by construction,
 *  and the identity and final measurement were FROZEN when the session settled. The session object
 *  is gone, so a live read here would answer null and blank the numbers at exactly the moment the
 *  operator wants to read what the run cost. */
function endedSummary(e, name) {
  return {
    sessionId: String((e && e.sessionId) || ''),
    channelId: String((e && e.channelId) || ''), workspaceId: (e && e.workspaceId) || null, // the frozen record's container — `agent-history.js` keeps it; same rule and same pending decision as `liveSummary`'s copy above
    taskId: String((e && e.taskId) || ''),
    agentId: name, // frozen with the rest of the identity — see `noteEnded`
    name: name,
    // ⚠ READ LIVE, NOT FROZEN, unlike the metrics: renaming while reading back a finished run
    // is normal, and a frozen copy would show the old name on the card just retitled.
    displayName: displayNameFor(name),
    description: descriptionForAgent(name), // read LIVE beside the name, for the same reason
    state: PILL_ENDED,
    listening: false, // terminal; stated rather than omitted so every row carries the field
    // WHEN IT ENDED, so the card can tell a run that finished a minute ago from one about to age
    // out of the 7-day window. It is the SWEEP's clock too (`agent-history.js › expired`), which is
    // why it is frozen at settle rather than derived.
    endedAt: metricOrNull(e && e.endedAt),
    // Nothing finer to say about a session that is doing nothing, and a retained detail
    // would outlive the run it described.
    detail: null,
    toolLabel: null,
    // ⚠ WHICH RUNTIME RAN IT, frozen with the rest of the identity (2026-09-21, U10) — the live
    // row's twin. The session object is gone, so this is the only thing left that can say whose
    // failure `endReason` below is describing.
    runtimeId: (e && e.runtimeId) || '',
    usageBaseline: (e && e.usageBaseline) || null,
    // ⚠ WHY IT STOPPED, AS A STRUCTURED CODE RE-SAID IN THAT RUNTIME'S OWN WORDS (U10). The CODE
    // is what was frozen; the sentence is rebuilt at read time from the owning runtime's
    // descriptor, which is what a generic SDK string could never be. `null` is the ordinary
    // ending — an agent the operator ended has no failure and must not grow a line claiming one.
    endReason: endReasonFor(e),
    diag: (e && typeof e.diag === 'string' && e.diag) || null, // F-692: `diag` is FROZEN, unlike `detail` — it says WHY IT STOPPED, and an MCP-connect failure ENDS the session, so this row is the only place that sentence survives. The LIVE half rides `session-metrics.js › metrics`; this file was AT the 500 cap
    // No posture to change; a retained one would offer a control over nothing.
    toolMode: null,
    messageMode: null,
    // NOT frozen at settle, so it is null here rather than stale. The metrics beside it ARE frozen
    // because the operator wants to read what the run cost; a model is a control's current value,
    // and a control over an ended agent is a control over nothing.
    model: null,
    channelName: displayText(e && e.channelName),
    threadTitle: displayText(e && e.threadTitle),
    // ⚠ FROZEN AT SETTLE (`session-teardown.js`): an ended session must still report what it
    // RAN AS, and reading null here would push a row that ERASES the name.
    identityName: displayText(e && e.identityName, IDENTITY_NAME_MAX),
    contextUsed: metricOrNull(e && e.contextUsed),
    contextWindow: metricOrNull(e && e.contextWindow),
    tokensSpent: metricOrNull(e && e.tokensSpent),
    startedAt: metricOrNull(e && e.startedAt),
    lastActivityAt: metricOrNull(e && e.lastActivityAt),
  };
}

/**
 * One entry widened with the two facts a SERVER ROW needs: `channel_sessions` keys on `(user_id,
 * session_key)` and fences on `workspace_id`. `sessionId` is EPHEMERAL (a park or recreate mints a
 * new one), so it is the wrong upsert key. Neither field goes on the wire — `wireSummary` strips
 * them, so the IPC payload and `DesktopSessionSummary` stay byte-unchanged.
 */
function reportEntry(wire, key, workspaceId) {
  return { ...wire, key: String(key || ''), workspaceId: String(workspaceId || '') };
}

/** The wire shape: report-only `key` removed; `workspaceId` STAYS since 2026-09-14
 *  (the pop-out rail routes a cross-workspace row by it — `agent-window/index.tsx › segmentFor`). */
function wireSummary(entry) {
  const out = { ...entry };
  delete out.key;
  return out;
}

/**
 * Have the summaries actually changed? The engine dispatches on EVERY SDK event, so without this
 * the renderer is woken dozens of times per turn by effects it cannot see. Compared as a stable
 * string, not field-by-field, so a member added to the shape is checked automatically instead of
 * silently dropped. Order is already stable (registry preserves insertion; ended is append-only).
 */
function summariesDigest(list) {
  return JSON.stringify(list || []);
}

// ─── END SESSION-SUMMARY-PURE ────────────────────────────────────────────────────────

// ── The live half: the registry, the ledger, the ended set, the push ─────────────────

const SESSIONS_EVENT = 'dopl:sessions';

// A burst of engine dispatches (one turn is many) must cost ONE render. 200ms is below where a state flip
// reads as laggy and above one turn's event storm. Mirrors ui-sync's COALESCE_MS.
const PUSH_COALESCE_MS = 200;

// `MAX_ENDED` (12) and `endedKept` stood here and are deleted (2026-08-22, Samuel's ruling): an
// in-memory list bounded by COUNT and lost on quit. Ended cards are projected from the DURABLE
// history now (`agent-history.js`, injected as `deps.endedRecords`), bounded by seven days from
// `endedAt` and swept by `agent-retention.js`. The name ledger stood here too — see `nameOf`.
let deps = { sessions: null, endedRecords: null };
let getWindowsFn = null;
let pushTimer = null;
let lastDigest = null;
// ⚠ The SERVER writer's gate, separate from the window's — see `subscribe`.
const changeSubscribers = new Set();
let lastChangeDigest = null;

/**
 * The engine binds its in-memory registry here at load, plus the reader for retained ENDED records
 * (`agent-history.js › listEnded`). INJECTED, not required: this module is import-free below the
 * sentinel so its suites can evaluate it as source. An absent `endedRecords` degrades to "no ended
 * cards" rather than throwing — the live half must not go dark because a history file failed.
 */
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    endedRecords: (d && d.endedRecords) || null,
  };
}

/** Arm the push. ⚠ `getWindows()` is called at SEND time, never captured — the window is rebuilt on reopen
 *  and a pop-out can appear at any moment (wiring plan Phase 10; it fans out over main/app-windows.js's
 *  registry). Idempotent. */
function start(opts) {
  getWindowsFn = opts && typeof opts.getWindows === 'function' ? opts.getWindows : null;
  lastDigest = null; // a fresh window has seen nothing; the next touch must reach it
  touch();
}

function windowAlive(win) {
  return !!(win && typeof win.isDestroyed === 'function' && !win.isDestroyed());
}

/**
 * The retained ENDED records — read from the durable history, never from a local list, which is why
 * a restart keeps the cards (the predecessor's `endedKept` was in-memory, so quitting erased every
 * ended agent). The BOUND is not here either: `agent-history.js` owns `RETENTION_MS` and
 * `agent-retention.js` runs the sweep, so this reads whatever survives and applies no second rule.
 * NEVER THROWS — a history file that cannot be read costs the ended cards, not the live ones.
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
 * channel themselves — the list is bounded by MAX_CONCURRENT_SESSIONS live plus the retained ended
 * set (`agent-history.js › MAX_HISTORY`), so there is nothing to page. Several rows per (channel,
 * thread) is normal since 2026-08-21: the registry is keyed by (channel, thread, AGENT), nothing
 * here de-duplicates on the pair, and nothing downstream may start to. ONE PASS BEHIND BOTH
 * CONSUMERS: it builds REPORT entries, `list()` narrows for the renderer, the writer takes them
 * whole. */
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
    // Both live and retained-ended => the SAME agent instance was somehow re-registered after an
    // abandonment. The live session wins; it is the one the pill should open. A sibling agent on
    // the same thread has a DIFFERENT key and is never suppressed by this.
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

/** The handle one session is wearing, for a caller holding the session. It ASSIGNS NOTHING since
 *  2026-08-21 — it reads the id the session was minted with, so it is safe at any point in its
 *  life. */
function nameForSession(s) {
  if (!s || !s.key) return null;
  return nameOf(s);
}

/**
 * A session ENDED — the projection's half of it: mark the digest dirty so the card flips.
 *
 * It stores nothing, and `keepWindow` decides nothing (2026-08-22, Samuel's ruling): EVERY end is
 * retained for seven days, and the record is written where the data actually is —
 * `session-engine.js › settle` calls `agent-history.record(...)` with the narration ring, which
 * lives on the session object and is not visible from here. The argument survives and is ignored
 * deliberately: deleting the parameter would change the engine's effect vocabulary for a cosmetic
 * gain. It returns whether a record is expected to exist, i.e. "an end happened".
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

// `keptWindow(channelId, taskId)` stood here and is deleted (2026-08-20, F-228): no session has a
// window, so nothing is retained and nothing can be revealed. The RETENTION itself is untouched —
// an ended agent still holds its PILL in the Agents tab; only the window handle went.

// The ONE place a summaries frame crosses into the renderer (modelled on ui-sync's sendToWindows):
// windows resolved at send time, a dead one fails closed. It FANS OUT since 2026-08-18 — a pop-out
// reads the same Agents projection, and pushing to one window would have frozen it there with no
// error anywhere — so one dead window must not swallow the rest: the answer is "did ANY take it".
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
 *
 * NOT the window's gate, and the two must never be merged: `start()` resets `lastDigest` so a
 * REBUILT renderer gets a frame it has not seen, but a rebuilt renderer is not a state change and
 * must not cost a server write. `lastChangeDigest` is separate, never reset, and records regardless
 * of whether anything consumed the frame. A throwing subscriber must not break the engine —
 * `touch()` is called from `dispatch`, so an exception here unwinds into the SDK event loop.
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
 * The stamp lives here, with the projection that reads it, and is taken at the engine's ONE
 * dispatch funnel — the only caller — which is what stops a second writer appearing somewhere that
 * fires on a different clock. `event` is OPTIONAL (2026-08-20): without one `noteEvent` no-ops and
 * `detailFor` falls through to `thinking` over a working pill. It costs no extra push — `dispatch`
 * already calls `touch()`, so both stamps move exactly as often as the digest is recomputed.
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
  // 2026-08-22: five `session-pill.js` names were re-exported here with no production reader. One
  // derivation behind two import paths is the drift that split exists to prevent; require it.
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
