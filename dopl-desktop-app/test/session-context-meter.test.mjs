// THE CONTEXT METER (2026-08-02, cut down 2026-08-20) — "how full is this session's window".
//
// WHAT THIS FILE COVERS NOW: the MEASUREMENT, end to end, and nothing about painting it. The
// denominator table (`main/session-model.js › contextWindowFor`), the token math
// (`promptTokens`), the observer that turns a real SDK stream into ONE `context` event per turn
// (`observe`), and the reducer block that stores it and emits it across the process boundary.
// Every one of those is main-process code and every one of them still ships.
//
// The operator's stated use is a decision, not a statistic: WHEN do I end this session and open
// a fresh one. That makes the failure modes asymmetric, and the surviving sections are organised
// around the two that are still ours to get wrong:
//
//   OVERSTATING is a bug.  The obvious source for this number is `result.usage`, which sits on
//     the same event session-io already reads total_cost_usd from. It is WRONG: the bundled CLI
//     builds it by summing its running per-model totals, so `input_tokens` there climbs
//     monotonically for the whole run. A meter fed from it would only ever go up, sail past
//     100%, and never correct after an auto-compaction. The occupancy is the prompt the model
//     LAST saw, which is the last main-lane assistant message's own usage.
//   INVENTING A DENOMINATOR is worse.  An unknown model gets no percentage at all.
//
// ⚠ THE THIRD FAILURE MODE — "GOING BLANK: a window reload must repaint the meter, so it is
// pinned in the replay ring like `init` and `modes`" — IS NO LONGER A FAILURE MODE HERE. It was
// a statement about the v1 session WINDOW: a BrowserWindow that could be reloaded out from under
// a live query, which is why the replay ring existed at all. There is no session window to
// reload, `main/session-replay.js` is deleted, and a rule about repainting a surface that does
// not exist cannot be kept honest by anything. See the ⚠ blocks at §5/§6 below.
//
// METHOD, unchanged for what remains: drive the shipped code. The real observer against a real
// SDK-shaped stream, and the real reducer block sliced out of main/session-reducer.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";

const require = createRequire(import.meta.url);

const model = require("../main/session-model.js");
const { initialSessionState, sessionReducer } = loadReducer();

// ── 1. the denominator table, read off the bundled CLI ───────────────────────

test("the window map answers for the four aliases the picker offers", () => {
  assert.equal(model.contextWindowFor("opus"), 1000000);
  assert.equal(model.contextWindowFor("sonnet"), 1000000);
  assert.equal(model.contextWindowFor("fable"), 1000000);
  assert.equal(model.contextWindowFor("haiku"), 200000);
});

test("the window map answers for the ids the SDK actually reports back", () => {
  for (const [id, win] of Object.entries({
    "claude-opus-5": 1000000,
    "claude-opus-4-8": 1000000,
    "claude-opus-4-7": 1000000,
    "claude-opus-4-6": 200000,
    "claude-opus-4-5": 200000,
    "claude-sonnet-5": 1000000,
    "claude-sonnet-4-6": 200000,
    "claude-sonnet-4-5": 200000,
    "claude-haiku-4-5": 200000,
    "claude-fable-5": 1000000,
  })) {
    assert.equal(model.contextWindowFor(id), win, id);
  }
});

test("the [1m] SUFFIX is the window, and it beats the base row that says 200k", () => {
  // `claude-sonnet-4-6` is a 200k model; `claude-sonnet-4-6[1m]` is the same model asked for
  // its long window. Reading the table first would have under-reported by 5x.
  assert.equal(model.contextWindowFor("claude-sonnet-4-6"), 200000);
  assert.equal(model.contextWindowFor("claude-sonnet-4-6[1m]"), 1000000);
  assert.equal(model.contextWindowFor("claude-opus-5[1m]"), 1000000);
  assert.equal(model.contextWindowFor("claude-sonnet-4-5-20250929[1m]"), 1000000);
});

test("a DATED id resolves to its undated row", () => {
  assert.equal(model.contextWindowFor("claude-opus-4-5-20251101"), 200000);
  assert.equal(model.contextWindowFor("claude-haiku-4-5-20251001"), 200000);
});

test("an UNKNOWN model has NO denominator — never a guessed one", () => {
  for (const junk of ["", " ", null, undefined, 0, {}, [], "claude-something-9", "gpt-5", "default"]) {
    assert.equal(model.contextWindowFor(junk), null, JSON.stringify(junk));
  }
});

// ── 2. the token math ────────────────────────────────────────────────────────

test("occupancy is uncached input + cache reads + cache writes, and NOT output", () => {
  assert.equal(model.promptTokens({
    input_tokens: 1200, cache_read_input_tokens: 400000, cache_creation_input_tokens: 11000,
    output_tokens: 9999,
  }), 412200);
});

test("a missing or junk usage block reads as 0, never as NaN", () => {
  for (const junk of [undefined, null, {}, "usage", 7, { input_tokens: "lots" },
    { input_tokens: NaN, cache_read_input_tokens: -5 }]) {
    const n = model.promptTokens(junk);
    assert.equal(Number.isFinite(n), true, JSON.stringify(junk));
    assert.equal(n, 0, JSON.stringify(junk));
  }
});

// ── 3. the observer, against a real SDK-shaped stream ────────────────────────

// ⚠ 2026-08-31 (runtime-adapter port, step 4): `session-model.js › observe` was a SECOND
// normalizer — it parsed the platform's own message schema directly and sat in the consume loop
// beside the render mapping — so it split. The ADAPTER extracts the numbers per message
// (`runtime/claude/normalize.js` -> a `context` CoreEvent) and CORE remembers the last one and
// turns it into the reducer's event when the turn ends (`session-io.js › applyCoreEvents`).
// This helper drives BOTH halves, exactly as the consume loop does, and filters to the events
// this file is about — every assertion below is unchanged.
const io = require("../main/session-io.js");
const normalize = require("../main/runtime/claude/normalize.js").normalize;
const NO_STORE = { setSdkSessionId() {}, saveRecord() {} };

function stream(session, messages) {
  const dispatched = [];
  const s = session;
  if (!s.state) s.state = { phase: "running", turns: 0, costUsd: 0 };
  for (const msg of messages) {
    io.applyCoreEvents(s, normalize(msg, {}), (_s, e) => dispatched.push(e), NO_STORE);
  }
  return dispatched.filter((e) => e && e.type === "context");
}

const init = (m) => ({ type: "system", subtype: "init", model: m, session_id: "sdk-1" });
const assistant = (tokens, m, over = {}) => ({
  type: "assistant", parent_tool_use_id: null,
  message: { role: "assistant", model: m, content: [], usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 50 } },
  ...over,
});
// The shape the CLI really emits, and the shape this must NOT be read from (see the header).
const result = (over = {}) => ({
  type: "result", subtype: "success", total_cost_usd: 0.4,
  usage: { input_tokens: 9999999, cache_read_input_tokens: 9999999, cache_creation_input_tokens: 0, output_tokens: 1 },
  modelUsage: {}, ...over,
});

test("a finished turn dispatches ONE context event: this turn's prompt, and its window", () => {
  const s = {};
  const evs = stream(s, [init("claude-opus-5"), assistant(120000), result()]);
  assert.deepEqual(evs, [{ type: "context", tokens: 120000, window: 1000000, model: "claude-opus-5" }]);
});

test("the LAST assistant message of the turn wins — that is the last request's prompt", () => {
  // A tool loop produces several. Only the final one describes what the model most recently read.
  const s = {};
  const evs = stream(s, [init("claude-opus-5"), assistant(40000), assistant(52000), assistant(61000), result()]);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].tokens, 61000);
});

test("the meter does NOT come from result.usage, which is the SESSION TOTAL", () => {
  // The regression guard for the whole design. result.usage above is ~20M; if anything ever
  // reads it, this number moves and the meter starts claiming 2000% of a 1M window.
  const s = {};
  const evs = stream(s, [init("claude-opus-5"), assistant(120000), result()]);
  assert.equal(evs[0].tokens, 120000);
  assert.ok(evs[0].tokens < evs[0].window, "and it stays inside the window it is measured against");
});

test("a SUBAGENT's messages are ignored: a Task runs in its own window", () => {
  const s = {};
  const evs = stream(s, [
    init("claude-opus-5"),
    assistant(120000),
    assistant(800000, "claude-opus-5", { parent_tool_use_id: "toolu_1" }), // the subagent
    result(),
  ]);
  assert.equal(evs[0].tokens, 120000, "the session's own prompt, not the subagent's");
});

test("a turn that measured NOTHING says nothing rather than painting a zero", () => {
  assert.deepEqual(stream({}, [init("claude-opus-5"), result()]), []);
  assert.deepEqual(stream({}, [result()]), []);
  assert.deepEqual(stream({}, [init("claude-opus-5"), { type: "assistant", message: {} }, result()]), []);
});

// ── ⚠ D7.3: A THROWING CONTEXT DISPATCH IS SWALLOWED, AND A THROWING `result` IS NOT ──────────
//
// The pin for the `try/catch` that came over from `session-model.js › observe` with the dispatch
// it wraps, was LOST in the 2026-08-31 port, and was restored 2026-09-01. Written as a PAIR
// because only the pair states the rule: the meter is a cosmetic gauge and may not kill a
// session, while every other dispatch in the loop is a state transition whose failure must still
// reach `crash`. A single "it does not throw" test would pass just as well over a blanket
// try/catch around the whole loop, which is the wrong fix and the one worth failing on.
//
// The escape route is what makes this MEDIUM rather than cosmetic: `applyCoreEvents` runs inside
// `session-query.js › consume`'s `for await`, so a throw here is caught by that loop's `catch`,
// read as a query error, and dispatched as `crash` — settle + destroy + `task_failed{interrupted}`.
// A reducer bug on the context row would therefore tear the session down mid-turn and report it
// to the waiting peer as an interruption.

test("D7.3: a throwing CONTEXT dispatch is swallowed — the meter may not crash the session", () => {
  const s = { state: { phase: "running", turns: 0, costUsd: 0 } };
  const seen = [];
  const logged = [];
  const hostile = (_s, e) => {
    seen.push(e.type);
    if (e.type === "context") throw new Error("reducer blew up on the gauge row");
  };
  for (const msg of [init("claude-opus-5"), assistant(120000), result()]) {
    // ⚠ NOT wrapped in assert.doesNotThrow around the whole stream: the assertion is that THIS
    // call returns normally, which is what the consume loop depends on.
    // ⚠ THE LOG IS THE FIFTH ARGUMENT AND IS INJECTED. `session-io.js` may not require `diag`
    // (electron); `session-query.js › consume` supplies the real one.
    io.applyCoreEvents(s, normalize(msg, {}), hostile, NO_STORE, (...a) => logged.push(a.join(" ")));
  }
  assert.ok(seen.includes("context"), "the context dispatch was still attempted");
  assert.ok(seen.includes("result"), "and the result still went out ahead of it");
  // ⚠ SWALLOWED IS NOT SILENT. HEAD's line is kept VERBATIM, `session-model:` prefix included, so
  // an existing `listener.log` grep still finds it.
  assert.deepEqual(logged.length, 1, "exactly one line");
  assert.match(logged[0], /^session-model: context dispatch failed reducer blew up on the gauge row$/);
});

test("D7.3: with NO log injected the swallow still holds — the line is optional, the catch is not", () => {
  const s = { state: { phase: "running", turns: 0, costUsd: 0 } };
  const hostile = (_s, e) => { if (e.type === "context") throw new Error("boom"); };
  for (const msg of [init("claude-opus-5"), assistant(120000), result()]) {
    io.applyCoreEvents(s, normalize(msg, {}), hostile, NO_STORE); // four args, as every other caller
  }
});

test("D7.3: a throwing RESULT dispatch still escapes — only the meter is swallowed", () => {
  const s = { state: { phase: "running", turns: 0, costUsd: 0 } };
  const hostile = (_s, e) => { if (e.type === "result") throw new Error("boom"); };
  assert.throws(
    () => {
      for (const msg of [init("claude-opus-5"), assistant(120000), result()]) {
        io.applyCoreEvents(s, normalize(msg, {}), hostile, NO_STORE);
      }
    },
    /boom/,
    "a state-transition dispatch must still reach consume's catch and `crash`"
  );
});

test("a MID-SESSION model switch moves the denominator without waiting for a fresh init", () => {
  // The picker calls Query.setModel, which produces no new system/init. The per-message model
  // is the only signal, and it is what keeps the meter honest across a switch.
  const s = {};
  const evs = stream(s, [
    init("claude-opus-5"), assistant(300000), result(),
    assistant(150000, "claude-haiku-4-5"), result(),
  ]);
  assert.deepEqual(evs, [
    { type: "context", tokens: 300000, window: 1000000, model: "claude-opus-5" },
    { type: "context", tokens: 150000, window: 200000, model: "claude-haiku-4-5" },
  ]);
});

test("an UNKNOWN running model reports its tokens with a null window", () => {
  const evs = stream({}, [init("claude-experimental-9"), assistant(48000, "claude-experimental-9"), result()]);
  assert.deepEqual(evs, [{ type: "context", tokens: 48000, window: null, model: "claude-experimental-9" }]);
});

test("AUTO-COMPACTION needs no special handling: the next turn simply measures smaller", () => {
  const s = {};
  const evs = stream(s, [init("claude-opus-5"), assistant(940000), result(), assistant(90000), result()]);
  assert.deepEqual(evs.map((e) => e.tokens), [940000, 90000], "the meter corrects itself");
});

// ── 4. the reducer holds it, and tells the window ────────────────────────────

const running = () => sessionReducer(initialSessionState({}), { type: "launched", payload: {} }).state;
const emits = (r) => r.effects.filter((e) => e.type === "emit").map((e) => e.payload);

test("a context event stores the measurement and emits exactly one payload", () => {
  const r = sessionReducer(running(), { type: "context", tokens: 412200, window: 1000000, model: "claude-opus-5" });
  assert.equal(r.state.contextTokens, 412200);
  assert.equal(r.state.contextWindow, 1000000);
  assert.equal(r.state.model, "claude-opus-5");
  assert.deepEqual(emits(r), [{ type: "context", tokens: 412200, window: 1000000, model: "claude-opus-5" }]);
  assert.deepEqual(r.effects.map((e) => e.type), ["emit"], "it touches no timer, no cap, no query");
});

test("the reducer coerces junk too — a bad number can never reach the window as a percentage", () => {
  for (const junk of [undefined, null, "lots", NaN, -1, {}]) {
    const r = sessionReducer(running(), { type: "context", tokens: junk, window: junk });
    assert.equal(r.state.contextTokens, 0, JSON.stringify(junk));
    assert.equal(r.state.contextWindow, null, JSON.stringify(junk));
  }
});

test("the COST path is untouched: a result still emits exactly status + scheduleIdle", () => {
  // The meter rides its own event precisely so it cannot perturb the cap accounting.
  const r = sessionReducer(running(), { type: "result", turnCostUsd: 0.02 });
  assert.deepEqual(r.effects.map((e) => e.type), ["emit", "scheduleIdle"]);
  assert.equal(r.state.costUsd, 0.02);
});

test("a result DOES now capture the model that served it (it was computed and discarded)", () => {
  const r = sessionReducer(running(), { type: "result", turnCostUsd: 0.01, model: "claude-haiku-4-5" });
  assert.equal(r.state.model, "claude-haiku-4-5");
  // ...and an older event with no model keeps whatever we had, never blanks it.
  assert.equal(sessionReducer(r.state, { type: "result", turnCostUsd: 0 }).state.model, "claude-haiku-4-5");
});

test("a PARKED session is inert to a late measurement from its drained tail", () => {
  const parked = { ...running(), parked: true, phase: "parked", activity: "parked" };
  const r = sessionReducer(parked, { type: "context", tokens: 500000, window: 1000000 });
  assert.equal(r.state, parked, "no state change");
  assert.deepEqual(r.effects, [], "and nothing repaints a gauge for a query that is gone");
});

// ── ⚠ 5. THE COPY — REMOVED 2026-08-20, the formatter it drove is deleted ─────
//
// WHAT STOOD HERE: four tests over `renderer/session/session-labels.js` —
// `contextMeterText`, `contextMeterLevel`, `contextPercent`.
//   - "the meter reads '412k / 1M (41%)'"                     the k/M rounding and the percentage
//   - "NO window means NO percentage"                          §1's null denominator, carried into copy
//   - "nothing measured yet renders NOTHING, not a confident zero"
//   - "the thresholds: amber past 75%, red past 90%"           the two level classes
//   - "a measurement larger than the window clamps at 100"     never "240%"
//
// WHY THEY ARE GONE: the whole `renderer/session/**` tree was deleted with the v1 session window
// (F-228), `session-labels.js` included. These were pure-function tests over a formatter, so they
// were cheap and they were good — but a formatter with no caller is not a rule about the system,
// it is a rule about a file. Rewriting them to assert the same strings against a reimplementation
// would be the worst outcome available: green forever, pinned to nothing.
//
// ⚠ WHAT IS *NOT* LOST, and where to look before re-deriving it. The three claims those tests
// really defended are all still enforced, one section up, at the layer that crosses the process
// boundary rather than the one that renders it:
//   - "an unknown model gets NO denominator" is §1's last test (`contextWindowFor` -> null).
//   - "junk never reaches a percentage" is §4's `sessionReducer` coercion test — a bad number is
//     flattened to `contextTokens: 0` / `contextWindow: null` BEFORE anything downstream sees it,
//     which is the guard that actually matters and the only one a new UI cannot skip.
//   - the CLAMP had no main-side twin and is the one thing that genuinely left with the copy.
// A replacement meter re-earns the rounding, the thresholds and the clamp with its own tests.
// Do not resurrect these against a new module by find-and-replace: the thresholds (75 / 90) were
// a product decision, not a derivation, and re-asserting them from this file would launder a
// choice nobody made again into a pin.

// ── ⚠ 6. THE WINDOW PAINTS IT, AND A RELOAD REPAINTS IT — REMOVED 2026-08-20 ──
//
// WHAT STOOD HERE: six tests over the v1 session window's renderer and its main-side replay ring.
//   - "the view-model folds a context event into the state the strip paints from"  (session-viewmodel)
//   - "a mid-session switch moves the HEADER's live model, and the pick is a separate fact"
//   - "the real paint puts the number and the level class on the meter, via textContent" (session-modes-ui)
//   - "the same paint puts the MODEL PICK on the third select, and nothing else on it"
//   - "the model select goes dead across the SAME adoption gap the two axes do"
//   - "a strip with no meter and no third select does not throw"
//   - "REPLAY: the meter and the pick are pinned, so a window reload repaints both"  (session-replay)
//   - "REPLAY: last-wins, so a long session cannot pack the ring with old measurements"
//   - "the hint the operator actually needs is on the meter, in house voice"  (session.html)
//
// WHY THEY ARE GONE: every surface they asserted was deleted. `session-viewmodel.js`,
// `session-modes-ui.js` and `session.html` went with `renderer/session/**`; `main/session-replay.js`
// went with the window it replayed into.
//
// ⚠ THE REPLAY TESTS ARE THE ONES TO UNDERSTAND BEFORE REBUILDING ANYTHING. They were not UI
// tests wearing a main-process costume — they pinned a real, non-obvious pair of properties of a
// bounded ring: that `context` is PINNED (survives eviction pressure from 40 later turns, so a
// reload is not blank) and that pinning is LAST-WINS (30 measurements leave exactly 1, so pinned
// does not mean unbounded). Those two pull in opposite directions and the second is the one a
// reimplementation forgets. They are recorded here rather than in a commit message because the
// ring is the kind of thing that gets rewritten from its name.
//
// ⚠ AND NOTE WHAT THE PAINT TESTS QUIETLY COVERED: "the model select goes dead across the SAME
// adoption gap the two axes do" was not about the meter at all. It was the one assertion that the
// model picker could not be driven while a consent decision was mid-flight. If a future surface
// offers a mid-session model switch, that gap is a live requirement and it is currently pinned
// NOWHERE — this comment is its only remaining trace.
