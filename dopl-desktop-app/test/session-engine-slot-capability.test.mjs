// THE FUNNEL'S RUNTIME-CAPABILITY QUESTIONS — main/session-launch.js › launch, waves D1 and D3.
//
// ⚠ WHY THIS IS ITS OWN FILE (2026-10-11). `session-engine-slot.test.mjs` crossed the hard
// 500-line §2 cap that `test/**/*.mjs` is linted under (`eslint.config.js`, ZERO exemptions), so
// `cd dopl-desktop-app && npm run lint` was red. Split on the seam its section headers already
// named rather than at the line the lint failed on (the F-226 precedent, one file per reason to
// change): the SLOT ARITHMETIC — minting, the three-part key, multiplayer, the auth hold, the
// cost ceiling, the rollbacks, runtime forwarding — stays there; the two 2026-09-01 capability
// waves are here, in whole. They are the separable group because they are about what an ADAPTER
// DECLARES rather than about slots, and two of their six cases do not touch the funnel at all —
// they drive `main/runtime/capability.js`'s predicates directly.
//
// ⚠ THE HARNESS IS IMPORTED, NOT RESPELLED. `_session-launch-funnel-harness.mjs` is the one copy;
// it injects the REAL `windowlessFloorRefusal` / `axisBOpScopedWarning` over the SHIPPED
// descriptors by default, which is the whole reason the "every shipped adapter launches" halves
// below mean anything. A second copy here that faked either predicate would make both files green
// over the gates they exist to pin.
//
// Run: `node --test dopl-desktop-app/test/session-engine-slot-capability.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { CH, MAIN, TASK, call, harness } from "./_session-launch-funnel-harness.mjs";

// ── ⚠ D1: THE WINDOWLESS TOOL FLOOR IS LAUNCH-BLOCKING (2026-09-01) ──────────────────────────
//
// `contract.js › LAUNCH_BLOCKING[3]`. `capability.js › floorWindowlessTool`'s header stated the
// refusal from the day it was written — "`windowlessFloor: null` REFUSES THE WINDOWLESS LAUNCH
// rather than picking a mode" — and NOTHING refused it. The predicate returned the session's own
// stored mode instead, which starts at the NARROWEST member and resets to it on park, on a session
// with no gate surface: every tool call silently denied, including the reads the prompt orders.
//
// ⚠ THE REFUSAL IS PINNED IN TWO HALVES BECAUSE ONE HALF ALONE IS PASSABLE BY THE BUG. "The
// funnel refuses when handed a reason" would pass over a `windowlessFloorRefusal` that never
// answers one; "the shipped adapters launch" would pass over a funnel that never asks. Together
// they pin the wire.

test("D1: a runtime with NO orderable windowless floor is REFUSED before anything is constructed", async () => {
  const h = harness({ floorRefusal: "Test Runtime declares no windowless tool floor, and a session with no gate surface would silently deny every tool call it makes" });
  const res = await h.launch(call({ channelId: CH, taskId: TASK, runtime: "codex" }));
  // ⚠ `'disabled'`, NOT AN EIGHTH WIRE WORD. `REFUSAL_REASONS` is backed by a deployed column
  // CHECK, so a new word here would be a refusal the database refuses to record. `'disabled'` is
  // the existing local-only code for "this build will not run this spawn shape"; the SPECIFIC
  // reason rides the diag, which is the only surface allowed to name a runtime.
  // ⚠ AND IT NOW RIDES `detail` TOO. The diag is for the operator's log; `detail` is what the
  // RENDERER shows, and it already prefers it over the copy map — so the sentence this refusal
  // was computing and throwing away is now the one the operator reads, instead of the generic
  // "The agent could not be started". Still `'disabled'` for the wire word, for the reason
  // spelled out above.
  assert.deepEqual(res, {
    skipped: "disabled",
    detail: "Test Runtime declares no windowless tool floor, and a session with no gate surface would silently deny every tool call it makes",
  });
  // ⚠ NOTHING IS SPENT. The check sits after acquireRuntime and BEFORE startSession, so there is
  // no session in the registry, no slot held and no rollback to get wrong.
  assert.equal(h.calls.started.length, 0, "no session is constructed");
  assert.equal(h.sessions.size, 0, "and none is registered");
  assert.deepEqual(h.calls.acquired, ["codex"], "…but the runtime WAS acquired first: the question is about a known runtime");
  assert.ok(h.calls.diag.some((l) => /windowless launch refused/.test(l)),
    "the operator-readable sentence lands in the diag, the one surface that may name a runtime");
});

test("D1: every SHIPPED adapter declares an orderable floor, so none of them is refused", async () => {
  // The other half. Driven through the REAL predicate over the REAL descriptors — a fake would
  // make this file green over a check that does not exist.
  for (const runtime of ["claude", "codex", "cursor", undefined]) {
    const h = harness();
    const res = await h.launch(call({ channelId: CH, taskId: TASK, runtime }));
    assert.equal(res.skipped, undefined, `${runtime || "(default)"} must launch`);
    assert.equal(h.calls.started.length, 1, `${runtime || "(default)"} constructs its session`);
  }
});

test("D1: the predicate itself answers a SENTENCE for a null floor and for an unorderable one", () => {
  // ⚠ THE MUTATION, RUN HERE RATHER THAN DESCRIBED. `floorWindowlessTool` must answer `null`
  // (refuse) and NOT the session's own mode, for BOTH causes — an absent floor and a floor that
  // is not one of the runtime's declared modes. Before the fix both returned a mode, and the
  // narrowest one at that.
  const capability = createRequire(import.meta.url)(join(MAIN, "runtime", "capability.js"));
  const base = {
    label: "Test Runtime",
    toolMode: { options: [{ value: "narrow" }, { value: "wide" }], windowlessFloor: "wide" },
  };
  assert.equal(capability.windowlessFloorRefusal(base), null, "a declared, orderable floor is fine");
  assert.equal(capability.floorWindowlessTool(base, "narrow"), "wide", "…and it raises");

  const noFloor = { ...base, toolMode: { ...base.toolMode, windowlessFloor: null } };
  assert.match(capability.windowlessFloorRefusal(noFloor), /declares no windowless tool floor/);
  assert.equal(capability.floorWindowlessTool(noFloor, "narrow"), null,
    "REFUSE, never the session's own mode — which here is the NARROWEST, i.e. deny-everything");
  assert.equal(capability.floorWindowlessTool(noFloor, "wide"), null, "…and not the wide one either");

  const badFloor = { ...base, toolMode: { ...base.toolMode, windowlessFloor: "nonesuch" } };
  assert.match(capability.windowlessFloorRefusal(badFloor), /not one of the modes it declares/);
  assert.equal(capability.floorWindowlessTool(badFloor, "narrow"), null);
  // ⚠ NAMES THE RUNTIME'S OWN LABEL AND NO VENDOR.
  assert.match(capability.windowlessFloorRefusal(noFloor), /^Test Runtime /);
});

// ── ⚠ D3: AXIS B'S COLLAPSE WARNING HAS A CONSUMER (2026-09-01) ──────────────────────────────
//
// `capability.js › axisBOpScoped` was declared with a documented severe consequence — "`false`
// COLLAPSES AXIS B FROM OP-SCOPED TO WHOLE-TOOL — every channel call gates, READS INCLUDED — and a
// held inbound on a windowless session is held forever" — and grepping `main/` and `src/` for it
// returned exactly one hit, a COMMENT. So the operator got no warning and the launch was not
// refused: a declaration that could not do its job.
//
// ⚠ WARNING, NOT REFUSAL, AND THIS FILE PINS THAT TOO. The direction of failure is CLOSED
// (unreadable input -> `postFieldsOk` fails -> `gate` -> a windowless gate DENIES), so the agent
// is broken and the boundary is not. A refusal here would take a registered adapter off the only
// spawn shape this tree has, which is a release decision and not this function's.

test("D3: a runtime whose Axis B is not op-scoped LAUNCHES, and says so", async () => {
  // ⚠ NO SHIPPED ADAPTER IS UNVERIFIED SINCE CXP-3A (2026-09-22), so the REAL sentence is built
  // from the frozen Codex descriptor with `opScoped` set back to `'unverified'` and injected.
  const req = createRequire(import.meta.url), D = req(join(MAIN, "runtime", "index.js")).descriptorFor("codex");
  const h = harness({ opScopedWarning: req(join(MAIN, "runtime", "capability.js")).axisBOpScopedWarning({ ...D, axisB: { ...D.axisB, opScoped: "unverified" } }) });
  const res = await h.launch(call({ channelId: CH, taskId: TASK, runtime: "codex" }));
  assert.equal(res.skipped, undefined, "it is a WARNING — the launch proceeds");
  assert.equal(h.calls.started.length, 1, "…and the session is really constructed");
  const warned = h.calls.diag.filter((l) => /Axis B is not op-scoped/.test(l));
  assert.equal(warned.length, 1, "exactly one line, at the launch");
  assert.match(warned[0], /READS INCLUDED/, "it names the consequence, not just the field");
  assert.match(warned[0], /not been measured/, "…and that this one is UNVERIFIED rather than false");
});

test("D3: an op-scoped runtime says NOTHING — a warning on every launch is a warning nobody reads", async () => {
  for (const runtime of ["claude", "cursor", "codex"]) {
    const h = harness();
    await h.launch(call({ channelId: CH, taskId: TASK, runtime }));
    assert.deepEqual(h.calls.diag.filter((l) => /Axis B is not op-scoped/.test(l)), [], runtime);
  }
});

test("D3: the predicate distinguishes false from unverified, and names no vendor", () => {
  const capability = createRequire(import.meta.url)(join(MAIN, "runtime", "capability.js"));
  const at = (opScoped) => ({ label: "Test Runtime", axisB: { opScoped } });
  assert.equal(capability.axisBOpScopedWarning(at(true)), null, "op-scoped: no warning at all");
  assert.match(capability.axisBOpScopedWarning(at(false)), /^Test Runtime cannot show the gate/);
  assert.match(capability.axisBOpScopedWarning(at("unverified")), /^Test Runtime has not been measured/);
  // ⚠ ABSENT IS NOT `true`. A descriptor that omits the field has not declared op-scoping, and
  // reading absent as capable is exactly the fail-OPEN this predicate exists to refuse.
  assert.match(capability.axisBOpScopedWarning(at(undefined)), /cannot show the gate/);
  assert.match(capability.axisBOpScopedWarning({ label: "Test Runtime" }), /cannot show the gate/);
  for (const v of [true, false, "unverified", undefined]) {
    const w = capability.axisBOpScopedWarning(at(v));
    if (w) assert.ok(!/claude|codex|cursor|anthropic|openai/i.test(w), `names a vendor: ${w}`);
  }
});
