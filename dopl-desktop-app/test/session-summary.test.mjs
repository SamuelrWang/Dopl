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
// `session-summary-report.test.mjs` (F-147: the report view and the change subscription),
// `session-summary-shape.test.mjs` (2026-08-20: the wire shape, moved out whole when this file
// hit 499 of the cap and the `detail` widening's review comment did not fit) and
// `session-summary-retention.test.mjs` (2026-08-20: §4, below).
// This file keeps the mapping, the naming and the renderer frame.
//
// ⚠ §4 — THE ENDED RETENTION RULE — MOVED OUT WHOLE ON 2026-08-20 (F-226 + F-234). This file
// was at EXACTLY 500 lines, so the rule could not gain a case, and F-234's rewrite needed
// several: retention had been gating on a live WINDOW, which no session has had since the
// F-228 retirement, so nothing was ever retained. Samuel ruled retain-unconditionally bounded
// by MAX_ENDED. The seam was already visible — two suites had come off this harness for the
// same reason — so it was taken deliberately rather than at the moment a lint failed.
//
// ⚠ THE SESSION-WINDOW WAVE (2026-08-20, F-228) TOOK ONE SYMBOL OUT OF THIS FILE AND NO RULES.
// Nothing that remains here ever saw a session window: the mapping is arithmetic over
// `{phase, activity, parked}`, the ledger is keyed on the SESSION KEY, and §5's push fans out
// over `main/app-windows.js`'s APP-window registry — a different registry from the retired
// per-session one, and untouched.
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

// ── REGISTRATION IS A PROJECTION MOVE (2026-08-20) ───────────────────────────────────
// The defect this pair exists for: `startSession` registered the session and then waited for
// the SDK's `system/init` to produce the FIRST dispatch, which is the only thing that used to
// call `touch()`. So a freshly launched agent was invisible in the Agents tab for as long as
// the claude child + its MCP servers took to boot — and `session-query.js`'s own C-4 comment
// records that a child can boot and NEVER emit `system/init`, in which case the pill never
// arrived at all and only a reload (the `sessions:summaries` invoke, which reads the registry
// directly) could show it.

test("PUSH: a session that has only been REGISTERED is pushed — no dispatch required", async () => {
  const m = load();
  const sessions = new Map();
  m.bind({ sessions });
  m.start({ getWindows: () => [m.spaWindow] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1);
  assert.deepEqual(m.sent[0].payload.sessions, [], "an empty machine pushes an empty list");
  // Exactly what startSession now does: put it in the registry, touch. NOTHING else — no
  // state move, no noteActivity, no `launched` event. `phase: 'launching'` is what the
  // engine really holds at this point (baseRecord's own comment).
  const s = session({ state: { phase: "launching", activity: "idle", parked: false } });
  sessions.set(s.key, s);
  m.touch();
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 2, "registration alone must reach the renderer");
  assert.equal(m.sent[1].payload.sessions.length, 1);
  assert.equal(m.sent[1].payload.sessions[0].state, "idle", "a launching session reads idle, not absent");
  assert.equal(m.sent[1].payload.sessions[0].channelId, "chan-1");
});

test("PUSH: a rolled-back registration leaves no phantom pill", async () => {
  const m = load();
  const sessions = new Map();
  m.bind({ sessions });
  m.start({ getWindows: () => [m.spaWindow] });
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1);
  // startSession's two rollback shapes (a window factory that threw, and a windowless spawn
  // held on a missing credential) both `sessions.delete` and touch again. The two touches
  // coalesce into ONE flush, which must see the registry as it finally is.
  const s = session();
  sessions.set(s.key, s);
  m.touch();
  sessions.delete(s.key);
  m.touch();
  await new Promise((r) => setTimeout(r, m.PUSH_COALESCE_MS + 30));
  assert.equal(m.sent.length, 1, "nothing moved, so nothing is sent");
});

// ⚠ THE WEAK HALF, AND LABELLED AS SUCH (INVARIANTS §14 — a regex over source text is not a
// behavioural assertion). `session-engine.js` requires electron and cannot be driven here, so
// the two cases above pin the CONTRACT and this pins the CALL SITE. It goes green on a
// refactor that renamed nothing; what it cannot do is stay green if the touch is deleted.
test("ENGINE: every startSession registry mutation is accompanied by a touch", () => {
  const startSession = ENGINE.slice(
    ENGINE.indexOf("async function startSession("),
    ENGINE.indexOf("async function launch(")
  );
  assert.ok(startSession.length > 0, "startSession not found in session-engine.js");
  const mutations = startSession
    .split("\n")
    .filter((line) => /sessions\.(set|delete)\(/.test(line));
  assert.equal(mutations.length, 3, "the registration + its two rollbacks");
  for (const line of mutations) {
    assert.match(line, /sessionSummary\.touch\(\)/, `registry mutation without a touch: ${line.trim()}`);
  }
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
