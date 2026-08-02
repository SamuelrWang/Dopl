// THE CONTEXT METER (2026-08-02) — "how full is this session's window".
//
// The operator's stated use is a decision, not a statistic: WHEN do I end this session and open
// a fresh one. That makes every failure mode here asymmetric, and the tests are organised around
// the three that matter:
//
//   OVERSTATING is a bug.  The obvious source for this number is `result.usage`, which sits on
//     the same event session-io already reads total_cost_usd from. It is WRONG: the bundled CLI
//     builds it by summing its running per-model totals, so `input_tokens` there climbs
//     monotonically for the whole run. A meter fed from it would only ever go up, sail past
//     100%, and never correct after an auto-compaction. The occupancy is the prompt the model
//     LAST saw, which is the last main-lane assistant message's own usage.
//   INVENTING A DENOMINATOR is worse.  An unknown model gets no percentage at all.
//   GOING BLANK is a failure too.  A window reload must repaint the meter, so it is pinned in
//     the replay ring like `init` and `modes`.
//
// METHOD: drive the shipped code. The real observer against a real SDK-shaped stream, the real
// reducer block, the real label formatter, the real replay ring, the real view-model fold, and
// the real paint function against DOM stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = (p) => join(HERE, "..", "renderer", "session", p);

const model = require("../main/session-model.js");
const labels = require(R("session-labels.js"));
const vm = require(R("session-viewmodel.js"));
const modesUi = require(R("session-modes-ui.js"));
const { initialSessionState, sessionReducer } = loadReducer();

const REPLAY_SRC = readFileSync(join(HERE, "..", "main", "session-replay.js"), "utf8");
const ring = new Function(`${REPLAY_SRC.slice(REPLAY_SRC.indexOf("// ─── BEGIN SESSION-REPLAY-RING"),
  REPLAY_SRC.indexOf("// ─── END SESSION-REPLAY-RING"))}
  return { createRing, ringRecord, ringDrain, ringOnLoad, ringOnReload, isPinned };`)();

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

function stream(session, messages) {
  const dispatched = [];
  for (const msg of messages) model.observe(session, msg, (_s, e) => dispatched.push(e));
  return dispatched;
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

// ── 5. the copy ──────────────────────────────────────────────────────────────

test("the meter reads '412k / 1M (41%)'", () => {
  assert.equal(labels.contextMeterText({ tokens: 412200, window: 1000000 }), "412k / 1M (41%)");
  assert.equal(labels.contextMeterText({ tokens: 150000, window: 200000 }), "150k / 200k (75%)");
  assert.equal(labels.contextMeterText({ tokens: 940000, window: 1000000 }), "940k / 1M (94%)");
});

test("NO window means NO percentage — tokens only, and no colour either", () => {
  assert.equal(labels.contextMeterText({ tokens: 48000, window: null }), "48k context");
  assert.equal(labels.contextMeterLevel({ tokens: 48000, window: null }), "");
  assert.equal(labels.contextPercent({ tokens: 48000, window: null }), null);
});

test("nothing measured yet renders NOTHING, not a confident zero", () => {
  for (const ctx of [null, undefined, {}, { tokens: 0, window: 1000000 }, { tokens: "x" }]) {
    assert.equal(labels.contextMeterText(ctx), "", JSON.stringify(ctx));
    assert.equal(labels.contextMeterLevel(ctx), "");
  }
});

test("the thresholds: amber past 75%, red past 90%", () => {
  const at = (pct) => labels.contextMeterLevel({ tokens: pct * 10000, window: 1000000 });
  assert.equal(at(10), "");
  assert.equal(at(74), "");
  assert.equal(at(75), "is-high");
  assert.equal(at(89), "is-high");
  assert.equal(at(90), "is-full");
  assert.equal(at(100), "is-full");
});

test("a measurement larger than the window we believe in clamps at 100, it does not read 240%", () => {
  assert.equal(labels.contextPercent({ tokens: 2400000, window: 1000000 }), 100);
  assert.match(labels.contextMeterText({ tokens: 2400000, window: 1000000 }), /\(100%\)$/);
});

// ── 6. the window paints it, and a RELOAD repaints it ────────────────────────

test("the view-model folds a context event into the state the strip paints from", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "init", sessionId: "s1", model: "claude-opus-5" });
  assert.equal(s.context, null, "nothing before the first turn ends");
  s = vm.reduceEvent(s, { type: "context", tokens: 412200, window: 1000000, model: "claude-opus-5" });
  assert.deepEqual(s.context, { tokens: 412200, window: 1000000 });
  assert.equal(s.liveModel, "claude-opus-5");
  assert.equal(labels.contextMeterText(s.context), "412k / 1M (41%)");
});

test("a mid-session switch moves the HEADER's live model, and the pick is a separate fact", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "init", sessionId: "s1", model: "claude-opus-5" });
  s = vm.reduceEvent(s, { type: "model", choice: "haiku" }); // main took the pick
  assert.equal(s.modelChoice, "haiku", "the select shows what was REQUESTED");
  assert.equal(s.liveModel, null, "and nothing yet claims it is running");
  s = vm.reduceEvent(s, { type: "context", tokens: 20000, window: 200000, model: "claude-haiku-4-5" });
  assert.equal(s.liveModel, "claude-haiku-4-5", "the header states what IS running");
  assert.equal(s.modelChoice, "haiku", "which is a different fact from the pick");
});

function strip() {
  const node = () => ({ value: "", disabled: false, classList: { toggle() {} } });
  return { toolMode: node(), messageMode: node(), modelMode: node(), ctxMeter: { textContent: "", className: "" } };
}

test("the real paint puts the number and the level class on the meter, via textContent", () => {
  const els = strip();
  let s = vm.reduceEvent(vm.initialState(), { type: "context", tokens: 940000, window: 1000000 });
  modesUi.sync(els, s);
  assert.equal(els.ctxMeter.textContent, "940k / 1M (94%)");
  assert.equal(els.ctxMeter.className, "ctx-meter text-caption is-full");
  s = vm.reduceEvent(s, { type: "context", tokens: 90000, window: 1000000 }); // after a compaction
  modesUi.sync(els, s);
  assert.equal(els.ctxMeter.textContent, "90k / 1M (9%)");
  assert.equal(els.ctxMeter.className, "ctx-meter text-caption", "and the danger colour clears");
});

test("the same paint puts the MODEL PICK on the third select, and nothing else on it", () => {
  const els = strip();
  const s = vm.reduceEvent(vm.initialState(), { type: "model", choice: "sonnet" });
  modesUi.sync(els, s);
  assert.equal(els.modelMode.value, "sonnet");
  assert.equal(els.toolMode.value, "manual", "the axes are painted from their own fields");
  assert.equal(els.messageMode.value, "ask");
});

test("the model select goes dead across the SAME adoption gap the two axes do", () => {
  const els = strip();
  modesUi.sync(els, { phase: "consent", consentResolved: { decision: "accepted" } });
  assert.deepEqual([els.toolMode.disabled, els.messageMode.disabled, els.modelMode.disabled], [true, true, true]);
  modesUi.sync(els, { phase: "running" });
  assert.deepEqual([els.toolMode.disabled, els.messageMode.disabled, els.modelMode.disabled], [false, false, false]);
});

test("a strip with no meter and no third select does not throw (a harness, or version skew)", () => {
  modesUi.sync({}, { phase: "running", context: { tokens: 1, window: 2 } });
  modesUi.sync({ toolMode: { value: "" } }, { phase: "running" });
});

test("REPLAY: the meter and the pick are pinned, so a window reload repaints both", () => {
  const r = ring.createRing(4, 1024 * 1024);
  ring.ringRecord(r, { type: "init", sessionId: "s1" });
  ring.ringRecord(r, { type: "modes", tool: "manual", message: "ask" });
  ring.ringRecord(r, { type: "model", choice: "opus" });
  ring.ringRecord(r, { type: "context", tokens: 412200, window: 1000000 });
  for (let i = 0; i < 40; i++) ring.ringRecord(r, { type: "turn", text: "t" + i });
  const types = r.entries.map((e) => e.type);
  assert.ok(types.includes("model"), "the pick survived the eviction pressure");
  assert.ok(types.includes("context"), "and so did the measurement");
  // ...and a reload replays them into a fold that lands on the same state.
  ring.ringOnLoad(r);
  ring.ringOnReload(r);
  let s = vm.initialState();
  for (const p of ring.ringOnLoad(r)) s = vm.reduceEvent(s, p);
  assert.equal(s.modelChoice, "opus");
  assert.deepEqual(s.context, { tokens: 412200, window: 1000000 });
});

test("REPLAY: last-wins, so a long session cannot pack the ring with old measurements", () => {
  const r = ring.createRing(50, 1024 * 1024);
  for (let i = 1; i <= 30; i++) ring.ringRecord(r, { type: "context", tokens: i * 1000, window: 1000000 });
  const kept = r.entries.filter((e) => e.type === "context");
  assert.equal(kept.length, 1, "pinned must not mean unbounded");
  assert.equal(kept[0].tokens, 30000, "and the survivor is the CURRENT one");
});

test("the hint the operator actually needs is on the meter, in house voice", () => {
  const HTML = readFileSync(R("session.html"), "utf8");
  const at = HTML.indexOf('id="ctxMeter"');
  assert.notEqual(at, -1, "the meter is in the strip");
  const title = /title="([^"]+)"/.exec(HTML.slice(at, at + 400));
  assert.ok(title, "and it carries a hover hint");
  assert.match(title[1], /end this session and open a fresh one/i,
    "which names the thing to DO about a full window");
  assert.doesNotMatch(title[1], /[—–]/, "house voice: no em dashes");
});
