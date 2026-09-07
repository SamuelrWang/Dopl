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

test("every reason `endEffects` can be called with has a face — none of them is silent", () => {
  // Discovered from the SOURCE, so a reason added later fails here rather than shipping a
  // session that ends without saying why. That is the exact defect this file exists about.
  // ⚠ THE COUNT WAS FIVE AND IS NOW THREE (2026-09-07): `turn_cap` and `cost_cap` went with the
  // caps themselves. The floor is kept — an EMPTY discovery would make this case vacuous, which
  // is the failure mode a hard-coded five was guarding against in the first place.
  const reasons = new Set();
  for (const src of [M("session-reducer.js"), M("session-effects.js")]) {
    for (const m of src.matchAll(/endEffects\([^)]*?,\s*'[a-z_]+',\s*'([a-z_]+)'/g)) reasons.add(m[1]);
  }
  assert.ok(reasons.size >= 3, `expected the known ends, found ${[...reasons].join(", ")}`);
  for (const reason of reasons) {
    const text = endedStatusText(reason, { turnCap: 24 });
    assert.ok(text && typeof text === "string", `${reason} ends in silence`);
    assert.notEqual(text, reason, `${reason} fell through to the raw-word fallback`);
  }
});

// 🔒 TWO CASES STOOD HERE AND ARE DELETED WITH THE CAPS (2026-09-07, Samuel's ruling):
//   · "the caps name the limit, and the turn cap names the NUMBER it actually hit" — it pinned
//     `endedStatusText('turn_cap', {turnCap})` -> "Turn limit reached (N turns)", singular
//     included, and `('cost_cap')` -> "Cost limit reached".
//   · "the window and the PEER'S CARD can never name two different numbers" — it pinned
//     `endedStatusText` and `endLifecycle` against each other for `turn_cap` across the sane and
//     the degraded shapes, so the two surfaces explaining one ending could not disagree (#1179).
// Neither reason can be produced any more: `turnCapBody` and both arms of both tables are gone
// (`session-effects.js`), and nothing ends a session on turns or cost. A repaired pin on a
// deleted feature is fake coverage, so these are removed rather than re-pointed. The RULE they
// served — one ending, one number, said the same way to both audiences — survives in the
// `abandoned` / `inactive` cases below, which are what the two tables still disagree about on
// purpose.

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
  // 2026-09-07: driven on `operator` — `turn_cap` was the reason here until the caps were
  // deleted, and this case is about the ORDER, which is the same for every reason that carries a
  // lifecycle.
  const effects = endEffects(running(), "ended", "operator").map((e) => e.type);
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
