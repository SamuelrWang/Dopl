// v3.1 session-window UI: the header control set, the WIDENED pause morph, and the thinking chip.
//
// Three changes ship together and one of them is a regression risk, so they are pinned together:
//   1. The header "Stop" button is DELETED. The send button's pause morph is now the only
//      interrupt control, so `sendButtonMode` had to widen to cover every state Stop covered —
//      the truth table below IS that argument, state by state.
//   2. The header "Close thread" button (and its panel) is DELETED. Closing settles the SHARED
//      thread for both members, so it lives with the thread; the window's X hides/parks it.
//   3. A "Thinking" chip shows while a turn is in flight with nothing rendered for it yet.
//
// Layers: the pure predicates (session-chrome.js), a real reduce sequence through the view-model,
// and the markup/CSS/controller guards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { hasRule, declsOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const vm = require(R("session-viewmodel.js"));
const chrome = require(R("session-chrome.js"));
const { sendButtonMode, thinkingVisible, isAgentOutput } = chrome;
const HTML = readFileSync(R("session.html"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");

// ── 1. THE INTERRUPT PATH: every state Stop used to cover ────────────────────

test("STOP COVERAGE: each state Stop reached now reaches the pause morph instead", () => {
  // The three holes the old predicate (phase==='running' && activity==='working') left open.
  const holes = [
    ["running", null, "THE FIRST TURN: nothing emits a status until the turn ENDS"],
    ["running", "working", "a plain mid-turn (already covered before)"],
    ["awaiting_permission", "awaiting_permission", "a tool call parked on the dock is still mid-turn"],
    ["awaiting_inbound", null, "the first turn, under the inbound gate"],
    ["awaiting_inbound", "working", "FIX #6: a mid-flight turn while a message waits"],
    ["awaiting_inbound", "awaiting_permission", "a gated tool while a message waits"],
    ["running", "awaiting_permission", "the dock is open on a running session"],
  ];
  for (const [phase, activity, why] of holes) {
    assert.equal(sendButtonMode({ phase, activity }), "pause", `${phase}/${activity}: ${why}`);
  }
});

test("RESTING states keep Send — the button never offers to pause nothing", () => {
  for (const activity of ["idle", "awaiting_peer", "parked"]) {
    assert.equal(sendButtonMode({ phase: "running", activity }), "send", `activity ${activity}`);
  }
  for (const phase of ["consent", "parked", "interrupted", "ended"]) {
    assert.equal(sendButtonMode({ phase, activity: "working" }), "send", `phase ${phase}`);
  }
  // `launching` is ONLY ever the pre-init window (init flips it to running), i.e. one that has
  // received no events at all. "End session" still aborts a query that is booting.
  assert.equal(sendButtonMode({ phase: "launching", activity: null }), "send");
  assert.equal(sendButtonMode({}), "send");
  assert.equal(sendButtonMode(null), "send");
});

test("the pause click still routes to the EXISTING interrupt IPC, unchanged", () => {
  assert.match(JS, /sendButtonMode\(state\) === "pause"/);
  assert.match(JS, /bridge\.interrupt\(\)/);
  assert.ok(!/btnStop/.test(JS), "and there is no second control racing it");
});

// ── 2. THE HEADER ────────────────────────────────────────────────────────────

test("the header holds End session, and Stop and Close thread are both deleted", () => {
  // v3.1 deleted BOTH extra controls. Stop stays deleted — the send button's pause morph
  // covers every in-flight state and a second control only competed with it.
  assert.match(HTML, /id="btnEnd"[^>]*>End session</);
  for (const gone of ["btnStop", "outcomeSeg"]) {
    assert.ok(!HTML.includes(`id="${gone}"`), `#${gone} is gone from the markup`);
    assert.ok(!JS.includes(`"${gone}"`), `#${gone} is gone from the controller`);
  }
  assert.ok(!/closeOutcome|seg-btn/.test(JS), "nor any dead outcome bookkeeping");

  // ⚠ CLOSE THREAD IS GONE FOR GOOD (wiring plan Phase 4, 2026-08-18), and this file has
  // watched it leave twice. v3.1 removed the CONTROL on the argument that closing belongs with
  // the thread rather than with one member's window; P1-6 (2026-08-04) brought it back because
  // nothing else closed either. What settles it is that THREADS DO NOT CLOSE at all now — the
  // route, the service, the reducer branch, the IPC handler and session-close-ui.js are all
  // deleted, so there is no seam left to return through. What the operator ends here is the
  // AGENT, and "End session" is that control.
  for (const gone of ["btnCloseThread", "closePanel", "closeSummary", "closeNote",
    "btnCloseCancel", "btnCloseDone", "btnCloseFailed"]) {
    assert.ok(!HTML.includes(`id="${gone}"`), `#${gone} is gone from the markup`);
    assert.ok(!JS.includes(`"${gone}"`), `#${gone} is gone from the controller`);
  }
  // ⚠ The SCRIPT TAG, not the name: the markup's own comment names the deleted module on
  // purpose, which is the annotate-as-history rule `test/removed-vocabulary.test.mjs` enforces
  // on the main tree. A bare name check would punish the annotation it wants.
  assert.ok(!/<script[^>]*session-close-ui\.js/.test(HTML), "and the module is not loaded");
});

test("no layer of the session window can still close a thread", () => {
  // ⚠ THE WHOLE LANE, END TO END. The bridge + IPC + reducer branch were the seam a renderer
  // path could always return through — which is exactly how the control came back in P1-6. It
  // is gone at every layer now, so a future control would have to rebuild all of it (and would
  // find no route to call).
  assert.ok(!/closeTask/.test(JS), "the controller has no call and no mount");
  assert.ok(!existsSync(R("session-close-ui.js")), "the renderer module is gone from disk");
  const PRELOAD = readFileSync(R("session-preload.js"), "utf8");
  assert.ok(!/closeTask\(outcome/.test(PRELOAD), "the bridge member is undeclared");
  const REDUCER = readFileSync(fileURLToPath(new URL("../main/session-reducer.js", import.meta.url)), "utf8");
  assert.ok(!/if \(type === 'close_task'\)/.test(REDUCER), "main has no close_task branch");
  const IPC = readFileSync(fileURLToPath(new URL("../main/session-ipc.js", import.meta.url)), "utf8");
  assert.ok(!/ipcMain\.handle\('session:close-task'/.test(IPC), "and no IPC handler");
});

// ── 3. THE THINKING CHIP ─────────────────────────────────────────────────────

test("isAgentOutput: only my agent's OWN artifacts count as 'something rendered'", () => {
  assert.equal(isAgentOutput({ kind: "turn", role: "assistant" }), true);
  assert.equal(isAgentOutput({ kind: "tool" }), true);
  assert.equal(isAgentOutput({ kind: "outbound" }), true);
  for (const item of [
    { kind: "turn", role: "operator" }, { kind: "request" }, { kind: "counterparty" },
    { kind: "inbound_pending" }, { kind: "notice" }, { kind: "history" }, { kind: "peer_message" },
    undefined, null, {},
  ]) {
    assert.equal(isAgentOutput(item), false, JSON.stringify(item));
  }
});

test("the chip shows on a live turn with nothing rendered, and NOT once output lands", () => {
  const live = { phase: "running", activity: "working" };
  assert.equal(thinkingVisible({ ...live, items: [] }), true, "a turn just started");
  assert.equal(thinkingVisible({ ...live, items: [{ kind: "turn", role: "operator" }] }), true, "the operator typed");
  assert.equal(thinkingVisible({ ...live, items: [{ kind: "counterparty" }] }), true, "a peer reply was fed");
  assert.equal(thinkingVisible({ ...live, items: [{ kind: "turn", role: "assistant" }] }), false, "text landed");
  assert.equal(thinkingVisible({ ...live, items: [{ kind: "tool" }] }), false, "a tool card landed");
  assert.equal(thinkingVisible({ ...live, items: [{ kind: "outbound" }] }), false, "a message was sent");
});

test("the chip NEVER persists past the turn: end, park, interrupt, cap, crash", () => {
  const items = [{ kind: "turn", role: "operator" }];
  assert.equal(thinkingVisible({ phase: "running", activity: "idle", items }), false, "turn ended");
  assert.equal(thinkingVisible({ phase: "running", activity: "awaiting_peer", items }), false, "waiting on the peer");
  assert.equal(thinkingVisible({ phase: "parked", activity: "parked", items }), false, "parked");
  assert.equal(thinkingVisible({ phase: "interrupted", activity: "working", items }), false, "interrupted");
  assert.equal(thinkingVisible({ phase: "ended", activity: "working", items }), false, "ended");
  assert.equal(thinkingVisible({ phase: "running", activity: "working", items, ended: { outcome: "ended" } }), false);
  assert.equal(thinkingVisible({ phase: "consent", activity: "working", items }), false, "a pre-consent window runs nothing");
  assert.equal(thinkingVisible(null), false);
  assert.equal(thinkingVisible({}), false);
});

test("the chip tracks a REAL event sequence through the view-model", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "init", from: "David" });
  s = vm.reduceEvent(s, { type: "request", side: "responder", from: "David", text: "please do X" });
  assert.equal(thinkingVisible(s), true, "the ask is painted, the agent has said nothing yet");
  s = vm.reduceEvent(s, { type: "tool_use", toolUseId: "t1", name: "Bash", inputFull: {} });
  assert.equal(thinkingVisible(s), false, "the first artifact clears it");
  s = vm.reduceEvent(s, { type: "turn", role: "assistant", text: "done", streaming: false });
  assert.equal(thinkingVisible(s), false);
  s = vm.reduceEvent(s, { type: "status", phase: "running", activity: "idle" });
  assert.equal(thinkingVisible(s), false, "and the turn end keeps it clear");
  // The operator sends again: back to thinking until the agent answers.
  s = vm.reduceEvent(s, { type: "turn", role: "operator", text: "one more" });
  s = vm.reduceEvent(s, { type: "status", phase: "running", activity: "working" });
  assert.equal(thinkingVisible(s), true);
});

test("the chip is chrome, NOT a stream item — the scroll pin can never see it", () => {
  // It is a SIBLING of .stream-wrap in the markup, so `state.items` (and therefore streamTail,
  // which drives the pin) is untouched by it.
  const wrap = HTML.indexOf('<div class="stream-wrap">');
  const chip = HTML.indexOf('id="thinkingChip"');
  const wrapEnd = HTML.indexOf("</div>", HTML.indexOf('id="stream"'));
  assert.ok(wrap !== -1 && chip > wrapEnd, "the chip sits outside the scrolling stream");
  assert.ok(!/thinking/i.test(readFileSync(R("session-viewmodel.js"), "utf8")),
    "and the view-model never learns about it: no item, no tail change");
  assert.deepEqual(declsOf(CSS, ".stream-wrap"), { flex: "1", "min-height": "0", display: "flex" },
    "the stream wrap recipe is untouched");
});

test("the chip is static markup toggled by ONE class, with no innerHTML and no CSS copy", () => {
  assert.match(HTML, /<span class="thinking-chip__label">Thinking<\/span>/, "the word is markup");
  assert.equal((HTML.match(/thinking-chip__dot"/g) || []).length, 3, "three static dots");
  assert.match(JS, /els\.thinking\.classList\.toggle\("is-active", chromeVm\.thinkingVisible\(state\)\)/);
  assert.ok(hasRule(CSS, ".thinking-chip"));
  assert.ok(hasRule(CSS, ".thinking-chip.is-active"));
  assert.equal(declsOf(CSS, ".thinking-chip").display, "none", "hidden by default");
  const recipe = CSS.slice(CSS.indexOf(".thinking-chip"), CSS.indexOf(".auth-notice"));
  assert.ok(!/content:\s*["']/.test(recipe), "no copy in CSS `content`");
  assert.match(recipe, /prefers-reduced-motion/, "the animation respects the OS setting");
});

test("renderThinking runs on EVERY paint, so no state can strand the chip", () => {
  const body = JS.slice(JS.indexOf("function renderAll()"), JS.indexOf("}", JS.indexOf("function renderAll()")));
  assert.match(body, /renderThinking\(\);/);
  assert.match(body, /renderSend\(\);/, "beside the button it agrees with");
});
