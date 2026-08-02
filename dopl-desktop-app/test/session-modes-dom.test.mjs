// FIX 2 (2026-08-02) — THE POSTURE SELECTS MUST NEVER LIE (renderer half).
//
// THE DEFECT. Both selects fired and forgot. renderer/session/session.js called
// `bridge.setToolMode(value)` and threw the result away; session-preload.js did not return the
// invoke promise in the first place. So when main REFUSED a change the control kept showing
// the operator's pick while the gate went on enforcing the old value — and main refused every
// change made from a pre-consent window, which is the exact surface the operator sets the
// posture on. The window understated nothing and OVERSTATED its own permissions, which is the
// dangerous direction.
//
// THE RULE THIS FILE PINS: a select shows main's last CONFIRMED value or it says why not.
// Four refusal shapes, one behavior — revert plus one line. Plus the enabled/disabled rule for
// the ~13s adoption gap between Accept and the adopted session's first `init`, where neither
// registry can answer and every change would be refused.
//
// The module touches no `document` (it only reads `.value` / sets `.disabled` on nodes handed
// in), so this drives the REAL session-modes-ui.js against two select stubs. No source regex
// decides anything here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { orderOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));

const modesUi = require(R("session-modes-ui.js"));
const vm = require(R("session-viewmodel.js"));
const HTML = readFileSync(R("session.html"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");

const tick = () => new Promise((resolve) => setImmediate(resolve));

function select(value) {
  const node = {
    value, disabled: false, _listeners: [],
    addEventListener(kind, fn) { if (kind === "change") this._listeners.push(fn); },
    pick(next) { this.value = next; for (const fn of this._listeners) fn({}); },
  };
  return node;
}

// The wiring session.js does, with the same two callbacks: `confirmed` reads the view-model
// state (which moves ONLY on main's `modes` echo), `notice` appends a stream line.
function harness(over = {}) {
  const els = { toolMode: select("manual"), messageMode: select("ask") };
  const confirmedPair = over.confirmed || { tool: "manual", message: "ask" };
  const notices = [];
  const calls = [];
  const answer = (mode) => {
    calls.push(mode);
    if (over.throws) throw new Error("bridge died");
    if (over.rejects) return Promise.reject(new Error("bridge died"));
    // hasOwnProperty, not `=== undefined`: an explicit `result: undefined` is a case under test.
    return Promise.resolve(Object.prototype.hasOwnProperty.call(over, "result") ? over.result : { ok: true });
  };
  const bridge = over.bareBridge ? {} : { setToolMode: answer, setMessageMode: answer };
  modesUi.mount({ els, bridge, confirmed: () => confirmedPair, notice: (t) => notices.push(t) });
  return { els, notices, calls, confirmedPair };
}

// ── 1. the happy path is unchanged ───────────────────────────────────────────

test("main takes the change: the select keeps the operator's pick and nothing is said", async () => {
  const h = harness({ result: { ok: true, tool: "bypass", message: "ask" } });
  h.els.toolMode.pick("bypass");
  await tick();
  assert.deepEqual(h.calls, ["bypass"], "the select's OWN value crossed the bridge");
  assert.equal(h.els.toolMode.value, "bypass");
  assert.deepEqual(h.notices, []);
});

test("the two axes are independent: each select calls only its own bridge method", async () => {
  const els = { toolMode: select("manual"), messageMode: select("ask") };
  const seen = [];
  modesUi.mount({
    els,
    bridge: {
      setToolMode: (m) => { seen.push(["tool", m]); return Promise.resolve({ ok: true }); },
      setMessageMode: (m) => { seen.push(["message", m]); return Promise.resolve({ ok: true }); },
    },
    confirmed: () => ({ tool: "manual", message: "ask" }),
    notice: () => {},
  });
  els.messageMode.pick("auto_both");
  els.toolMode.pick("auto");
  await tick();
  assert.deepEqual(seen, [["message", "auto_both"], ["tool", "auto"]]);
});

// ── 2. every refusal shape reverts, and says one line ────────────────────────

test("{ok:false} reverts the select to main's last CONFIRMED value, and says so once", async () => {
  // This is the pre-consent case before FIX 1, and the adoption gap after it.
  const h = harness({ result: { ok: false }, confirmed: { tool: "accept_edits", message: "ask" } });
  h.els.toolMode.pick("bypass");
  await tick();
  assert.equal(h.els.toolMode.value, "accept_edits", "back to what main is really enforcing");
  assert.deepEqual(h.notices, [modesUi.REFUSED_NOTE]);
});

test("the MESSAGE axis reverts to the message half, never to the tool half", async () => {
  const h = harness({ result: { ok: false }, confirmed: { tool: "bypass", message: "auto_inbound" } });
  h.els.messageMode.pick("auto_both");
  await tick();
  assert.equal(h.els.messageMode.value, "auto_inbound");
  assert.equal(h.els.toolMode.value, "manual", "the other control is not touched");
});

test("a REJECTED invoke reverts too (main never answered, so nothing was taken)", async () => {
  const h = harness({ rejects: true });
  h.els.toolMode.pick("bypass");
  await tick();
  assert.equal(h.els.toolMode.value, "manual");
  assert.deepEqual(h.notices, [modesUi.REFUSED_NOTE]);
});

test("a bridge method that THROWS synchronously reverts rather than killing the listener", async () => {
  const h = harness({ throws: true });
  h.els.toolMode.pick("bypass");
  await tick();
  assert.equal(h.els.toolMode.value, "manual");
  assert.deepEqual(h.notices, [modesUi.REFUSED_NOTE]);
});

test("a bridge with NO method at all (version skew) reverts — silence is not a safe failure", async () => {
  // The old comment called leaving the value put "the safe failure". It is safe in MAIN and
  // unsafe in the window: the operator reads a posture nothing is applying.
  const h = harness({ bareBridge: true });
  h.els.toolMode.pick("bypass");
  await tick();
  assert.equal(h.els.toolMode.value, "manual");
  assert.deepEqual(h.notices, [modesUi.REFUSED_NOTE]);
});

test("an undefined / malformed answer counts as a refusal (only ok===true is success)", async () => {
  for (const result of [undefined, null, {}, { ok: "true" }, { ok: 1 }, "ok"]) {
    const h = harness({ result });
    h.els.toolMode.pick("bypass");
    await tick();
    assert.equal(h.els.toolMode.value, "manual", JSON.stringify(result));
    assert.deepEqual(h.notices, [modesUi.REFUSED_NOTE]);
  }
});

test("the refusal line claims nothing it cannot know, and keeps the house voice", () => {
  assert.doesNotMatch(modesUi.REFUSED_NOTE, /[—–]/, "no em dash");
  assert.doesNotMatch(modesUi.REFUSED_NOTE, /starting|loading|try again/i, "no invented reason");
  assert.match(modesUi.REFUSED_NOTE, /did not apply/);
  // ...and it renders through the ordinary notice path (textContent), not as markup.
  const s = vm.reduceEvent(vm.initialState(), { type: "notice", level: "error", text: modesUi.REFUSED_NOTE });
  assert.deepEqual(s.items, [{ kind: "notice", level: "error", text: modesUi.REFUSED_NOTE }]);
});

// ── 3. the adoption gap ──────────────────────────────────────────────────────

test("selectsEnabled: live during the consent phase, DEAD for the accept -> init gap", () => {
  assert.equal(modesUi.selectsEnabled({ phase: "consent" }), true,
    "FIX 1 gave the pre-consent selects a real path, so they stay usable");
  for (const decision of ["accepted", "denied", "expired"]) {
    assert.equal(modesUi.selectsEnabled({ phase: "consent", consentResolved: { decision } }), false, decision);
  }
  assert.equal(modesUi.selectsEnabled({ phase: "running" }), true);
  assert.equal(modesUi.selectsEnabled({ phase: "running", ended: { outcome: "completed" } }), false);
  assert.equal(modesUi.selectsEnabled({}), true, "an unknown state is not a reason to freeze the control");
});

test("the gap is measured off the REAL view-model fold, not a hand-written state", () => {
  // consent_request -> phase 'consent' (enabled) -> consent_resolved (the gap) -> init (live).
  let s = vm.reduceEvent(vm.initialState(), { type: "consent_request", requestId: "r1", from: "David" });
  assert.equal(modesUi.selectsEnabled(s), true);
  s = vm.reduceEvent(s, { type: "consent_resolved", decision: "accepted" });
  assert.equal(modesUi.selectsEnabled(s), false, "Accept landed; the session does not exist yet");
  s = vm.reduceEvent(s, { type: "init", sessionId: "s1" });
  assert.equal(s.phase, "running");
  assert.equal(modesUi.selectsEnabled(s), true, "the adopted session can take changes again");
});

test("sync() applies the rule to BOTH nodes, and is idempotent", () => {
  const els = { toolMode: select("manual"), messageMode: select("ask") };
  modesUi.sync(els, { phase: "consent", consentResolved: { decision: "accepted" } });
  assert.deepEqual([els.toolMode.disabled, els.messageMode.disabled], [true, true]);
  modesUi.sync(els, { phase: "running" });
  modesUi.sync(els, { phase: "running" });
  assert.deepEqual([els.toolMode.disabled, els.messageMode.disabled], [false, false]);
  modesUi.sync({}, { phase: "running" }); // a harness with no selects must not throw
});

test("the revert belt still runs UNDER the disable (the gap is a convenience, not the guard)", async () => {
  // A change that somehow lands while disabled is refused by main and reverted here anyway.
  const h = harness({ result: { ok: false } });
  modesUi.sync(h.els, { phase: "consent", consentResolved: { decision: "accepted" } });
  h.els.toolMode.pick("bypass");
  await tick();
  assert.equal(h.els.toolMode.value, "manual");
  assert.deepEqual(h.notices, [modesUi.REFUSED_NOTE]);
});

// ── 4. it is actually loaded, and before the controller that mounts it ───────

test("session.html loads the module BEFORE session.js, which mounts and syncs it", () => {
  assert.match(HTML, /<script src="session-modes-ui\.js"><\/script>/);
  assert.equal(orderOf(HTML, 'src="session-modes-ui.js"', 'src="session.js"', "session.html"), true);
  assert.match(JS, /globalThis\.DoplSessionModesUI \|\| null/, "optional at boot, like the other siblings");
  assert.match(JS, /modesUi\.sync\(els, state\)/, "renderStatus owns the enabled/disabled repaint");
  assert.match(JS, /modesUi\.mount\(\{ els, bridge,/);
});

test("confirmedValue falls back to the most restrictive member per axis", () => {
  assert.equal(modesUi.confirmedValue("tool", {}), "manual");
  assert.equal(modesUi.confirmedValue("message", {}), "ask");
  assert.equal(modesUi.confirmedValue("tool", null), "manual");
  assert.equal(modesUi.confirmedValue("tool", { tool: "auto" }), "auto");
  assert.equal(modesUi.confirmedValue("message", { message: "auto_both" }), "auto_both");
});
