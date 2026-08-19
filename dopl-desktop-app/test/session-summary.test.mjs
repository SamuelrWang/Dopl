// SESSION SUMMARIES (main/session-summary.js) — the state mapping, the naming, the ended
// retention rule, and the frame that crosses to the renderer.
//
// WHY THE MAPPING IS THE CENTREPIECE HERE. The surface this replaces (`agent-chips-bar.tsx`)
// shipped a defect the rollback plan names in §2: "the web chip shows Idle while the desktop
// works" — two readers, two derivations, one of them reading a field that could not know. The
// answer was ONE module, so the truth table below is what makes that worth anything: every
// activity and phase the engine can really produce, held against the pill the operator sees.
// The engine's vocabulary is re-read out of session-reducer.js so a NEW activity cannot be
// added there and quietly fall through this table's default.
//
// SOURCE EXTRACTION with INJECTION lives in `_session-summary-harness.mjs` — shared with
// `session-summary-report.test.mjs` (F-147), which carries the report view and the change
// subscription. This file keeps the mapping, the naming, the wire shape, the ended
// retention rule and the renderer frame.
//
// Run: `node --test dopl-desktop-app/test/session-summary.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAIN, load, session } from "./_session-summary-harness.mjs";

// The engine's own vocabulary, re-read from source so a NEW activity added to the reducer
// cannot silently land on this projection's fallback (the MAPPING coverage case below).
const REDUCER = readFileSync(join(MAIN, "session-reducer.js"), "utf8");
const EFFECTS = readFileSync(join(MAIN, "session-effects.js"), "utf8");
const STATE = readFileSync(join(MAIN, "session-state.js"), "utf8");
const ENGINE = readFileSync(join(MAIN, "session-engine.js"), "utf8");

// ── 1. THE STATE MAPPING ─────────────────────────────────────────────────────────────

// Every (phase, activity, parked) shape the engine really produces, and the pill it must
// become. The `why` column is the mapping's own reasoning, restated where it is checked.
const MAPPING = [
  { name: "a launching session", state: { phase: "launching", activity: "working" }, pill: "working" },
  { name: "a running turn", state: { phase: "running", activity: "working" }, pill: "working" },
  {
    name: "a turn blocked on a permission card",
    state: { phase: "awaiting_permission", activity: "awaiting_permission" },
    pill: "working",
    why: "the turn has not ended — the SDK is blocked on canUseTool, one click from continuing",
  },
  { name: "a turn that ended without posting", state: { phase: "running", activity: "idle" }, pill: "idle" },
  {
    name: "a turn that POSTED and is waiting on the peer",
    state: { phase: "running", activity: "awaiting_peer" },
    pill: "idle",
    why: "the other machine has it; nothing runs here",
  },
  {
    name: "a session holding an inbound reply for an Accept",
    state: { phase: "awaiting_inbound", activity: "awaiting_inbound", hasPendingInbound: true },
    pill: "idle",
  },
  {
    name: "a PARKED session (idle timeout)",
    state: { phase: "parked", activity: "parked", parked: true },
    pill: "idle",
    why: "the query is torn down but the session is resumable, not gone",
  },
  {
    name: "a park that landed while a message was held (FIX #6: phase and activity disagree)",
    state: { phase: "awaiting_inbound", activity: "parked", parked: true },
    pill: "idle",
    why: "`parked` is read off the flag, not off the phase, exactly because those two diverge",
  },
  {
    name: "an AUTH HOLD (a park with no credential)",
    state: { phase: "parked", activity: "parked", parked: true, authHeld: true },
    pill: "idle",
  },
  {
    name: "a parked SHELL (a window with no query yet)",
    state: { phase: "parked", activity: "parked", parked: true },
    pill: "idle",
  },
  {
    name: "an ABANDONED session (the parked one nobody came back to)",
    state: { phase: "ended", activity: "parked", parked: true },
    pill: "ended",
    why: "phase 'ended' is terminal in the reducer and wins over the park flag",
  },
  { name: "a turn-capped session", state: { phase: "ended", activity: "working" }, pill: "ended" },
  { name: "an operator-ended session", state: { phase: "ended", activity: "idle" }, pill: "ended" },
  {
    name: "an INTERRUPTED session (mid teardown)",
    state: { phase: "interrupted", activity: "working" },
    pill: "working",
    why: "the query is still being torn down; the activity is what it was",
  },
];

test("MAPPING: every engine state the reducer produces becomes the right pill", () => {
  const m = load();
  for (const row of MAPPING) {
    assert.equal(
      m.pillState(row.state),
      row.pill,
      `${row.name} must read as "${row.pill}"${row.why ? ` — ${row.why}` : ""}`
    );
  }
});

test("MAPPING: there are exactly three pill states, and no 'thinking'", () => {
  const m = load();
  assert.deepEqual(m.PILL_STATES, ["working", "idle", "ended"]);
  // Every row of the table must land on one of the three. 'thinking' is absent NOT because
  // includePartialMessages is off (F-146 corrected that; the window's Thinking chip needs no
  // stream) but because pillState's whole input is { phase, activity, parked } — and because
  // the value is PERSISTED: see session-pill-db-contract.test.mjs for the CHECK constraint.
  for (const [activity, pill] of Object.entries(m.ACTIVITY_PILL)) {
    assert.ok(m.PILL_STATES.includes(pill), `${activity} maps to "${pill}", which is not a pill state`);
  }
  for (const row of MAPPING) assert.ok(m.PILL_STATES.includes(row.pill));
});

test("MAPPING: the table covers every activity the engine can really set", () => {
  const m = load();
  // Re-derived from the engine rather than listed here, so a NEW activity added there
  // cannot silently land on this module's fallback. Both spellings are read: the literal
  // (`activity: 'working'`) and the ternary the turn-end and park branches use.
  const produced = new Set();
  for (const src of [REDUCER, EFFECTS, STATE, ENGINE]) {
    for (const seg of src.matchAll(/activity\s*[:=]\s*([^,;}\n]*)/g)) {
      for (const q of seg[1].matchAll(/'([a-z_]+)'/g)) produced.add(q[1]);
    }
  }
  assert.ok(produced.size >= 5, `expected the engine's activity vocabulary, parsed ${[...produced]}`);
  const uncovered = [...produced].filter(
    (a) => !Object.prototype.hasOwnProperty.call(m.ACTIVITY_PILL, a)
  );
  assert.deepEqual(
    uncovered,
    [],
    "the session engine sets an activity this projection's table does not name. It would " +
      "fall through to the 'idle' default, which is a guess, not a mapping — add the row."
  );
});

test("MAPPING: an unknown or absent activity falls to idle, never to working", () => {
  const m = load();
  assert.equal(m.pillState({ phase: "running", activity: "sprinting" }), "idle");
  assert.equal(m.pillState({ phase: "running" }), "idle");
  assert.equal(m.pillState({}), "idle");
  assert.equal(m.pillState(null), "idle");
  // The fail direction is deliberate: a pill claiming "working" over a dead session makes
  // the operator wait for something with no end and no feedback.
});

test("MAPPING: an inherited property is not a pill state", () => {
  const m = load();
  // A bare index on an object literal answers a FUNCTION for these, and a function is
  // truthy — session-park's requestRank shipped that bug once already.
  assert.equal(m.pillState({ activity: "constructor" }), "idle");
  assert.equal(m.pillState({ activity: "toString" }), "idle");
  assert.equal(m.pillState({ activity: "hasOwnProperty" }), "idle");
});

// ── 2. NAMING ────────────────────────────────────────────────────────────────────────

test("NAMES: a session gets a handle from the pool, and keeps it", () => {
  const m = load();
  const ledger = new Map();
  const first = m.nameFor(ledger, "chan-1:task-1", "chan-1");
  assert.equal(first, "quartz");
  assert.equal(m.nameFor(ledger, "chan-1:task-1", "chan-1"), "quartz", "the name must be stable");
  assert.equal(m.nameFor(ledger, "chan-1:task-2", "chan-1"), "onyx");
});

test("NAMES: the pool is PER CHANNEL, so two channels each get a quartz", () => {
  const m = load();
  const ledger = new Map();
  assert.equal(m.nameFor(ledger, "chan-1:task-1", "chan-1"), "quartz");
  assert.equal(m.nameFor(ledger, "chan-2:task-1", "chan-2"), "quartz");
  assert.equal(m.nameFor(ledger, "chan-1:task-2", "chan-1"), "onyx");
  assert.equal(m.nameFor(ledger, "chan-2:task-2", "chan-2"), "onyx");
});

test("NAMES: the handle rides the SESSION KEY, so a park/resume/recreate keeps it", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  const before = m.list()[0].name;
  // A recreate mints a fresh internal sessionId for the SAME (channel, thread) slot.
  m.bind({ sessions: new Map([["chan-1:task-1", session({ sessionId: "sess-recreated" })]]) });
  const after = m.list()[0];
  assert.equal(after.sessionId, "sess-recreated");
  assert.equal(after.name, before, "a recreated shell is the same session to the operator");
});

test("NAMES: a handle is released when its pill leaves, and goes back to the pool", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  assert.equal(m.list()[0].name, "quartz");
  m.bind({ sessions: new Map() });
  assert.deepEqual(m.list(), []);
  // Nothing holds `quartz` any more, so the next session in that channel gets it. This is
  // what stops the ledger (and the suffix rounds) growing with every session ever run.
  m.bind({ sessions: new Map([["chan-1:task-9", session({ taskId: "task-9" })]]) });
  assert.equal(m.list()[0].name, "quartz");
});

/**
 * §3.2: the session WINDOW's composer pill reads its own handle over IPC
 * (`session:agent-name` -> `nameForSession`), and the channel pane's pill reads the same
 * session's handle out of `list()`. Two readers again — so what is worth pinning is that there
 * is still ONE derivation behind them, in either call order. A window calling itself `flint`
 * while its own pill says `onyx` is F-142's defect reproduced inside one feature.
 */
test("NAMES: a window's own handle is the SAME one its pill shows, either way round", () => {
  const m = load();
  const live = session();
  const other = session({ sessionId: "sess-2", taskId: "task-2" });
  m.bind({ sessions: new Map([["chan-1:task-1", live], ["chan-1:task-2", other]]) });
  const asked = m.nameForSession(live); // the window asks BEFORE any projection has run
  assert.equal(asked, "quartz");
  const listed = m.list();
  assert.equal(listed[0].name, asked, "the projection agrees with the answer already given");
  assert.equal(m.nameForSession(other), listed[1].name, "and the other way round");
  // No key, no handle: naming something outside the registry would mint one and then lose it
  // on the next projection, which releases every key `list()` did not see.
  assert.equal(m.nameForSession(null), null);
  assert.equal(m.nameForSession({}), null);
});

// ── 3. THE SUMMARY SHAPE ─────────────────────────────────────────────────────────────

test("SHAPE: a live summary carries exactly what the Agents tab and the agent view need", () => {
  // ⚠ WIDENED 2026-08-18 (wiring plan Phase 5): the five MEASUREMENT fields joined the
  // identity + state ones when session cards died and the Agents tab replaced them. They
  // are read from where they already lived on the session object — nothing here starts a
  // counter — and none of them reaches the server (`session-state-push.js › rowFor` picks
  // its columns by name).
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  assert.deepEqual(m.list(), [
    {
      sessionId: "sess-1",
      channelId: "chan-1",
      taskId: "task-1",
      name: "quartz",
      state: "working",
      channelName: "general",
      threadTitle: "Ship the thing",
      contextUsed: 84000,
      contextWindow: 200000, // the frozen table's row for claude-haiku-4-5
      tokensSpent: 1200000,
      startedAt: 1700000000000,
      lastActivityAt: 1700000600000,
    },
  ]);
});

test("SHAPE: an UNMEASURED metric is null — never a confident zero", () => {
  // ⚠ THE FAILURE THIS CASE EXISTS FOR: `Number(null)` is 0, so a coercion-only guard
  // reports an empty context window on a session that has simply not reported usage yet,
  // and the meter paints 0% of a window that may be nearly full. Three absences land
  // here — a session before its first turn, an engine that predates the stamps, and a
  // MODEL THIS BUILD HAS NO WINDOW FOR (which must show raw tokens, never a made-up
  // percentage: session-model.js says so in as many words).
  const m = load();
  const s = session({
    promptTokens: undefined,
    liveModel: "some-model-from-the-future",
    tokensSpent: undefined,
    startedAt: undefined,
    lastActivityAt: undefined,
  });
  m.bind({ sessions: new Map([[s.key, s]]) });
  const row = m.list()[0];
  assert.equal(row.contextUsed, null);
  assert.equal(row.contextWindow, null, "an unknown model gets NO denominator, not 0");
  assert.equal(row.tokensSpent, null);
  assert.equal(row.startedAt, null);
  assert.equal(row.lastActivityAt, null);
  // …and the identity half is untouched by any of it.
  assert.equal(row.name, "quartz");
  assert.equal(row.state, "working");
});

test("SHAPE: a RETAINED ENDED pill keeps the measurement it settled with", () => {
  // The session object is gone by then, so a live read would blank every number at
  // exactly the moment the operator wants to read what the run cost. `noteEnded` freezes
  // them with the identity.
  const m = load();
  const s = session();
  m.bind({ sessions: new Map() });
  assert.equal(m.noteEnded(s, true), true);
  const [row] = m.list();
  assert.equal(row.state, "ended");
  assert.equal(row.contextUsed, 84000);
  assert.equal(row.contextWindow, 200000);
  assert.equal(row.tokensSpent, 1200000);
  assert.equal(row.startedAt, 1700000000000);
});

test("SHAPE: counterparty-influenced text is bounded and single-line", () => {
  const m = load();
  m.bind({
    sessions: new Map([
      ["chan-1:task-1", session({ context: { channelName: "a\nb\tc", taskTitle: "x".repeat(200) } })],
    ]),
  });
  const row = m.list()[0];
  assert.equal(row.channelName, "a b c");
  assert.equal(row.threadTitle.length, 80);
  // Same discipline session-store.durableName applies, and for the same reason.
});

test("SHAPE: a thread-less responder session is a real row, not a dropped one", () => {
  const m = load();
  const s = session({ taskId: "", context: {} });
  m.bind({ sessions: new Map([[s.key, s]]) });
  const row = m.list()[0];
  assert.equal(row.taskId, "");
  assert.equal(row.threadTitle, null);
  assert.equal(row.channelName, null);
});

test("SHAPE: a settled registry entry is never listed", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session({ settled: true })]]) });
  assert.deepEqual(m.list(), []);
});

// ── 4. THE ENDED RETENTION RULE ──────────────────────────────────────────────────────

test("ENDED: an abandonment keeps its window, so its pill stays — as ended, openable", () => {
  const m = load();
  const s = session();
  assert.equal(m.noteEnded(s, true), true);
  const rows = m.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "ended");
  assert.equal(rows[0].taskId, "task-1");
  assert.equal(m.keptWindow("chan-1", "task-1"), s.win);
});

test("ENDED: every other end destroys its window, so its pill goes with it", () => {
  const m = load();
  // settle(keepWindow=false) — operator End, turn/cost cap, completed, crash.
  assert.equal(m.noteEnded(session(), false), false);
  assert.deepEqual(m.list(), [], "a pill is a handle onto a window, not a tombstone");
  assert.equal(m.keptWindow("chan-1", "task-1"), null);
});

test("ENDED: a kept window the operator then CLOSES takes its pill with it", () => {
  const m = load();
  const s = session();
  m.noteEnded(s, true);
  assert.equal(m.list().length, 1);
  s.win.destroyed = true;
  assert.deepEqual(m.list(), [], "closing the window is the removal — no TTL, no ring to prune");
  assert.equal(m.keptWindow("chan-1", "task-1"), null);
});

test("ENDED: keepWindow over an ALREADY destroyed window retains nothing", () => {
  const m = load();
  const s = session();
  s.win.destroyed = true;
  assert.equal(m.noteEnded(s, true), false);
  assert.deepEqual(m.list(), []);
});

test("ENDED: reopening the thread replaces the ended pill rather than doubling it", () => {
  const m = load();
  const ended = session();
  m.noteEnded(ended, true);
  // The operator reopens that thread: a live session takes the same (channel, thread) slot.
  m.bind({ sessions: new Map([["chan-1:task-1", session({ sessionId: "sess-live" })]]) });
  const rows = m.list();
  assert.equal(rows.length, 1, "one slot, one pill");
  assert.equal(rows[0].sessionId, "sess-live");
  assert.equal(rows[0].state, "working", "the LIVE session is the one the pill should open");
});

test("ENDED: the retained set is bounded even if the window budget stops holding", () => {
  const m = load();
  for (let i = 0; i < m.MAX_ENDED + 5; i += 1) {
    m.noteEnded(session({ taskId: `t-${i}`, sessionId: `s-${i}` }), true);
  }
  const rows = m.list();
  assert.equal(rows.length, m.MAX_ENDED);
  // The OLDEST go: they are the least likely to still be on screen.
  assert.equal(rows[0].taskId, "t-5");
});

// ── 5. THE FRAME THAT CROSSES TO THE RENDERER ────────────────────────────────────────

test("PUSH: the event name and payload are the shape the preload forwards", async () => {
  const m = load();
  assert.equal(m.SESSIONS_EVENT, "dopl:sessions");
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].channel, "dopl:sessions");
  assert.deepEqual(Object.keys(m.sent[0].payload), ["sessions"]);
  assert.equal(m.sent[0].payload.sessions[0].name, "quartz");
});

test("PUSH: a burst of dispatches costs ONE frame", async () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  for (let i = 0; i < 50; i += 1) m.touch(); // one turn is many engine events
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1);
});

test("PUSH: nothing is sent when nothing a pill could show has moved", async () => {
  const m = load();
  const s = session();
  m.bind({ sessions: new Map([[s.key, s]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1);
  // A cost delta / token count / tool result all dispatch and change no pill.
  m.touch();
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1, "the renderer must not be woken by state it cannot see");
  // A real transition does send.
  s.state = { phase: "running", activity: "awaiting_peer" };
  m.touch();
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 2);
  assert.equal(m.sent[1].payload.sessions[0].state, "idle");
});

test("PUSH: a frame that never reached a window is re-sent, not swallowed", async () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  let win = null; // the SPA window is not built yet
  m.start({ getWindows: () => (win ? [win] : []) });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 0);
  win = m.spaWindow;
  m.touch();
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1, "the digest may only be recorded for a frame that landed");
});

test("PUSH: a destroyed window fails closed rather than throwing into the engine", async () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.spaWindow.destroyed = true;
  m.start({ getWindows: () => [m.spaWindow] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 0);
  // And a getWindows that throws is the same non-event.
  m.start({ getWindows: () => { throw new Error("gone"); } });
  m.touch();
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 0);
});

test("PUSH: EVERY app window gets the frame, and one dead one does not swallow the rest", async () => {
  // ⚠ FANS OUT SINCE 2026-08-18 (wiring plan Phase 10). This pushed to ONE window, so a
  // pop-out thread window's Agents surface would have frozen with no error anywhere — the
  // silent-staleness failure INVARIANTS §11 names. The targets are main/app-windows.js's
  // registry, the same set the sender guards are bound to.
  const m = load();
  const popout = load().spaWindow; // a second window with its OWN send log
  const popoutSent = [];
  popout.webContents.send = (channel, payload) => popoutSent.push({ channel, payload });
  const dead = load().spaWindow;
  dead.destroyed = true;
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [dead, m.spaWindow, popout] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1, "the shell got it");
  assert.equal(popoutSent.length, 1, "and so did the pop-out");
  assert.deepEqual(popoutSent[0].payload, m.sent[0].payload, "the same frame, not a re-derivation");
});

test("PUSH: a rebuilt window is repainted, not left with the previous frame's digest", async () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  m.start({ getWindows: () => [m.spaWindow] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1);
  // The SPA window is closed and reopened: same summaries, new renderer, nothing painted.
  m.start({ getWindows: () => [m.spaWindow] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 2, "a fresh renderer has seen nothing; the digest must reset");
});

test("PUSH: the projection never mutates the registry it reads", () => {
  const m = load();
  const s = session();
  const sessions = new Map([[s.key, s]]);
  const before = JSON.stringify({ state: s.state, context: s.context, settled: s.settled });
  m.bind({ sessions });
  m.list();
  m.list();
  assert.equal(sessions.size, 1);
  assert.equal(JSON.stringify({ state: s.state, context: s.context, settled: s.settled }), before);
});
