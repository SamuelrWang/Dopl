// A9 — THE OPERATOR'S OWN WINDOW NOW SAYS WHY THE SESSION ENDED.
//
// THE DEFECT (filed at #1209 while task 9(c) landed, built 2026-09-06). `endedEmit` has carried
// `reason` since it existed and NOTHING read it: a whole-tree grep for a consumer found none. The
// work stream got a status line for two of the five ends, minted in `session-narration.js ›
// entryFor` off the DISPATCH ACTION's type — so an operator End and an `inactive` spoke, and a
// turn cap, a cost cap and a 12h abandonment ended in silence. The posted lifecycle explains an
// end to the PEER; the operator watching their own agent stop was told nothing.
//
// The turn cap is the one that cost real time: an agent-issued session stops at 24 turns and its
// own window goes quiet with no line saying so.
//
// WHY THE REASON AND NOT THE ACTION, which is the whole shape of the fix. Two of the five ends
// have no action type to key off — a turn or cost cap is reached INSIDE the `result` action
// (session-reducer.js :239/:242) — so no arm of `entryFor` could ever have seen them. The `ended`
// emit is the one place all five converge already knowing which they were.
//
// ⚠ NOT A SECOND COPY OF `endLifecycle`. That table writes to the CHANNEL and deliberately says
// one calm thing for `abandoned` and `inactive` both, because which one it was is a fact about
// the operator's machine and none of a counterparty's business. This one writes to the operator's
// OWN window, where that argument does not apply and the distinction is the point.
//
// Run: `node --test dopl-desktop-app/test/session-ended-reason.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const M = (p) => readFileSync(join(MAIN, p), "utf8");

const { endedStatusText, endLifecycle, endEffects, initialSessionState, sessionReducer } = loadReducer();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;

// ── THE COPY ─────────────────────────────────────────────────────────────────────────

test("every reason `endEffects` can be called with has a face — none of the five is silent", () => {
  // Discovered from the SOURCE, so a sixth reason added later fails here rather than shipping a
  // session that ends without saying why. That is the exact defect this file exists about.
  const reasons = new Set();
  for (const src of [M("session-reducer.js"), M("session-effects.js")]) {
    for (const m of src.matchAll(/endEffects\([^)]*?,\s*'[a-z_]+',\s*'([a-z_]+)'/g)) reasons.add(m[1]);
  }
  assert.ok(reasons.size >= 5, `expected the known ends, found ${[...reasons].join(", ")}`);
  for (const reason of reasons) {
    const text = endedStatusText(reason, { turnCap: 24 });
    assert.ok(text && typeof text === "string", `${reason} ends in silence`);
    assert.notEqual(text, reason, `${reason} fell through to the raw-word fallback`);
  }
});

test("the caps name the limit, and the turn cap names the NUMBER it actually hit", () => {
  assert.equal(endedStatusText("turn_cap", { turnCap: 24 }), "Turn limit reached (24 turns)");
  assert.equal(endedStatusText("turn_cap", { turnCap: 200 }), "Turn limit reached (200 turns)");
  assert.equal(endedStatusText("turn_cap", { turnCap: 1 }), "Turn limit reached (1 turn)", "singular");
  assert.equal(endedStatusText("cost_cap", { turnCap: 24 }), "Cost limit reached");
});

test("the window and the PEER'S CARD can never name two different numbers", () => {
  // ⚠ THE POINT OF CALLING `turnCapBody` RATHER THAN RESTATING IT (#1179). A literal here would
  // drift the first time the issuer-keyed default moved, and the two surfaces explaining one
  // ending would disagree about which limit fired.
  for (const turnCap of [24, 200, 1, 80]) {
    assert.equal(endedStatusText("turn_cap", { turnCap }), endLifecycle("turn_cap", { turnCap }).body, String(turnCap));
  }
  // …including the degraded shapes, so the agreement is not just true on the happy path.
  for (const state of [undefined, {}, { turnCap: Infinity }, { turnCap: 0 }, { turnCap: "24" }]) {
    assert.equal(endedStatusText("turn_cap", state), endLifecycle("turn_cap", state).body, JSON.stringify(state));
  }
});

test("`abandoned` and `inactive` are told APART here, and stay merged on the wire", () => {
  const abandoned = endedStatusText("abandoned");
  const inactive = endedStatusText("inactive");
  assert.notEqual(abandoned, inactive, "the operator's own window is where the difference is useful");
  // The peer still gets ONE calm sentence for both — the privacy rule in session-effects.js's
  // header is untouched by this change, and this is what proves it was not widened.
  assert.equal(endLifecycle("abandoned").body, endLifecycle("inactive").body);
});

test("an UNKNOWN reason renders itself; a missing one says nothing at all", () => {
  // A reason this table has not learned is still more than silence, and it is visibly raw rather
  // than dressed as copy — which is what makes the gap findable.
  assert.equal(endedStatusText("some_new_terminal"), "some_new_terminal");
  // But nothing is invented for an end that carries no reason: no cause, no blame.
  for (const empty of [undefined, null, "", 0, {}]) assert.equal(endedStatusText(empty), null, JSON.stringify(empty));
});

test("the copy obeys the house rules: no em dash, no blame, no diagnosis", () => {
  for (const reason of ["turn_cap", "cost_cap", "operator", "abandoned", "inactive"]) {
    const text = endedStatusText(reason, { turnCap: 24 });
    assert.ok(!/—/.test(text), `em dash in ${reason}: ${text}`);
    assert.ok(!/error|crash|sorry|problem/i.test(text), `${reason}: ${text}`);
  }
  // ⚠ THE LINE THIS REPLACED CARRIED ONE: `'Ended — inactive'` sat in entryFor since it was
  // written. Pinned so the fix is not quietly reverted to the old string.
  assert.ok(!/Ended — inactive/.test(M("session-narration.js")), "the em-dashed line must not come back");
});

// ── THE WIRING ───────────────────────────────────────────────────────────────────────

test("there is exactly ONE end line: the action arms are gone, so nothing double-posts", () => {
  const narration = M("session-narration.js");
  const entryFor = narration.slice(narration.indexOf("function entryFor("), narration.indexOf("function retagPrivate("));
  assert.ok(!/type === 'end'\)/.test(entryFor), "the operator-End arm would put a second line under one ending");
  assert.ok(!/type === 'inactive'\)/.test(entryFor), "same for the inactive arm");
  // The PAUSE lines are untouched — a park is not an end and still speaks for itself.
  assert.match(entryFor, /type === 'idle_timeout'/);
  assert.match(entryFor, /type === 'interrupt'/);
});

test("the engine mints it off the EMIT, before the settle that freezes the ring", () => {
  const engine = M("session-engine.js");
  assert.match(engine, /if \(eff\.payload && eff\.payload\.type === 'ended'\) sessionNarration\.noteEnded\(s, eff\.payload\);/);
  // ⚠ ORDER IS THE CORRECTNESS ARGUMENT, and it is asserted rather than assumed: the line has to
  // land while the session is live, because `settle` freezes the ring into the 7-day history that
  // an ended agent's window is served from. A line appended after it is written to nothing.
  const effects = endEffects(running(), "ended", "turn_cap").map((e) => e.type);
  assert.deepEqual(effects, ["abortQuery", "lifecycle", "emit", "settle"]);
});

test("it is NOT inside `emit`, which returns early on the sessions that most need the line", () => {
  // `emit` bails on a windowless session (`claimGate`) and on a destroyed window. Those are
  // precisely the sessions nobody was watching, so losing the reason there loses it where it is
  // the only remaining explanation.
  const engine = M("session-engine.js");
  const emitFn = engine.slice(engine.indexOf("function emit(s, payload)"), engine.indexOf("function emitQuiet("));
  assert.ok(!/noteEnded/.test(emitFn), "the line must not depend on a live window");
});

test("the pure block stays pure — `endedStatusText` is extractable and requires nothing", () => {
  const effects = M("session-effects.js");
  const block = effects.slice(effects.indexOf("// ─── BEGIN SESSION-EFFECTS"), effects.indexOf("// ─── END SESSION-EFFECTS"));
  assert.ok(block.includes("function endedStatusText("), "it must live inside the extracted block");
  for (const banned of ["require(", "electron", "child_process"]) {
    assert.ok(!block.includes(banned), `SESSION-EFFECTS must not reference ${banned}`);
  }
  // …and the narration module's own require sits ABOVE its sentinel, like `appWindows`.
  const narration = M("session-narration.js");
  assert.ok(
    narration.indexOf("require('./session-effects')") < narration.indexOf("// ─── BEGIN SESSION-NARRATION-PURE"),
    "a require inside the pure block would break every source-extraction test that slices it"
  );
});
