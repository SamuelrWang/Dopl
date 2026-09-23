// DESCRIPTOR PARITY — a field the descriptor CAN declare must be a field some runtime actually
// differs on.
//
// ⚠ WHAT IT CATCHES IS A FIELD THAT HAS QUIETLY BECOME VESTIGIAL. A capability every adapter
// answers identically is not a capability: it is a constant wearing a descriptor's clothes, and
// the UI is branching on it for nothing. The failure is slow and silent — nobody deletes a field
// that "might be needed", and the descriptor grows into a shape whose size no longer tells you
// anything about how much the runtimes really differ.
//
// ⚠ IT IS DELIBERATELY INERT AT ONE ADAPTER, AND SAYS SO RATHER THAN PASSING QUIETLY. With a
// single registered runtime there is nothing to compare, so every field would fail the parity
// rule for a reason that is not a defect — the port has not shipped its second adapter yet. So
// the suite ARMS at two: below that it asserts only that it is inert and WHY, and the moment a
// second adapter registers every field is measured without anybody remembering to come back.
// That is the same shape `test/removed-vocabulary.test.mjs` uses for its census — a guard that
// cannot be true yet should be written so it becomes true by itself, not deleted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const registry = require(join(HERE, "..", "main", "runtime", "index.js"));

const ADAPTERS = registry.all();
const ARMED = ADAPTERS.length >= 2;

// The fields whose whole purpose is to DIFFER. A value here that is the same on every runtime is
// either a constant that belongs in core, or a capability nobody has exercised yet.
// ⚠ NOT EVERY FIELD IS ON THIS LIST, and that is not laziness. `axisB.hardDeny` is Dopl's own
// floor and is IDENTICAL on every runtime BY DESIGN — asserting variance on it would be asserting
// the opposite of an invariant. So the list names the fields the port exists to vary.
//
// ⚠ THE THIRD COLUMN IS `nullable`, AND ITS ABSENCE WAS A DEFECT THIS SUITE COULD NOT SEE AT ONE
// ADAPTER (repaired 2026-08-31, when the Codex adapter armed it). The second case below asserts
// that every field is "declared absent somewhere", whose whole purpose is to catch a HIDE-ON-ABSENT
// branch no runtime exercises. But most fields here HAVE no hide-on-absent branch:
// `axisB.enforcementPoint` REFUSES REGISTRATION when null, `session.fork` and `approval.heldCallback` are booleans, and
// `toolMode.options` is a list a runtime cannot lack. Requiring a `null` from one of those is
// requiring an adapter that could never register. So the case now runs over the NULLABLE subset —
// the fields §3.2's hide-on-absent table actually lists — and the variance case still runs over
// all of them.
const VARIES = [
  ["session.fork", (d) => d.session.fork, false],
  ["session.liveModelSwitch", (d) => d.session.liveModelSwitch, false],
  ["axisB.enforcementPoint", (d) => d.axisB.enforcementPoint, false],
  ["axisB.inputRewrite", (d) => d.axisB.inputRewrite, false],
  ["approval.heldCallback", (d) => d.approval.heldCallback, false],
  ["approval.granularity", (d) => d.approval.granularity, true],
  ["toolMode.options", (d) => d.toolMode.options.map((o) => o.value), false],
  ["toolMode.windowlessFloor", (d) => d.toolMode.windowlessFloor, false],
  ["toolMode.secondaryAxis", (d) => d.toolMode.secondaryAxis, true],
  ["containment.mode", (d) => d.containment.mode, false],
  ["models.source", (d) => d.models.source, false],
  ["models.dimensions", (d) => d.models.dimensions, true],
  ["mcp.sessionTransport", (d) => d.mcp.sessionTransport, false],
  ["mcp.hostRegistration", (d) => d.mcp.hostRegistration, false],
  ["mcp.eagerLoadFlag", (d) => d.mcp.eagerLoadFlag, true],
  ["prose.toolSearchVerb", (d) => d.prose.toolSearchVerb, true],
  // CXP-3A (2026-09-22): Codex `'ALL_TOOLS'` (measured, code-mode models), Claude/Cursor `null`.
  ["prose.deferredCatalog", (d) => d.prose.deferredCatalog, true],
  ["packaging.delivery", (d) => d.packaging.delivery, false],
];

// ⚠ THE CURSOR CENSUS, RESOLVED 2026-08-31 (port step 8) — AND FIVE OF ITS SIX ROWS ARE NOW
// MEASURED RATHER THAN DELETED. `PENDING_UNTIL_CURSOR` held six fields that could not vary until a
// third adapter landed, each row naming the value the DESIGN predicted Cursor would declare
// (`adapter-architecture.md` §1.4). Deleting the rows once the adapter registered would have let
// six dated predictions expire unchecked, which is the opposite of what a census is for. So the
// five that came true are pinned as PREDICTIONS-NOW-CONFIRMED below, and the sixth is a FINDING.
//
// ⚠ EACH ROW IS `[path, the value the DESIGN predicted Cursor declares]`. The case that reads it
// asserts BOTH halves: that the field really does vary now, and that Cursor's value is the
// predicted one — so a field that started varying for some OTHER reason cannot pass as a
// confirmation, and a later adapter that quietly changes one of these fails here rather than
// silently rewriting a design decision.
const CURSOR_PREDICTIONS = [
  ["axisB.enforcementPoint", "in-process"],
  ["approval.heldCallback", false],
  ["approval.granularity", null],
  ["mcp.sessionTransport", "in-process"],
  ["mcp.hostRegistration", "inline"],
];

// Deferred rows: fields that cannot vary yet, each keyed to what would make it vary. The stale case
// below fails the moment one starts varying.
const DEFERRED_BY_DESIGN = {
  // ⚠ 2026-09-22: Claude's roster went LIVE (`runtime/claude/roster.js` reads `supportedModels()`
  // off a turn-free handshake), so all three shipped adapters answer `live`. `frozen` stays a
  // contract value — `model-catalog.js` reads such a roster inline, and
  // `runtime-model-catalog.test.mjs` drives that path — for a platform with no roster call.
  "models.source": "live on all three since Claude's roster went live (2026-09-22); `frozen` is "
    + "kept for a platform with no roster call, and its inline-read path has its own suite.",
};

const at = (read) => ADAPTERS.map(({ descriptor }) => JSON.stringify(read(descriptor)));
const pending = (path) => Object.prototype.hasOwnProperty.call(DEFERRED_BY_DESIGN, path);

// The two judgements the cases below make, so the census can be checked against the SAME rules it
// exempts a row from. ⚠ A row earns its place by failing at least one of these; the moment it
// passes both it is stale, whatever the reason it was added for.
const varies = (read) => new Set(at(read)).size > 1;
function absentAndPresent(read) {
  const values = ADAPTERS.map(({ descriptor }) => read(descriptor));
  return values.some((v) => v === null) && values.some((v) => v !== null);
}

test("with one runtime registered this suite is INERT, and that is stated rather than assumed", () => {
  // ⚠ Written as an assertion so the day a second adapter lands, THIS case fails too and points
  // the reader at the ones below rather than letting them stay quietly unmeasured.
  if (ARMED) {
    assert.ok(true, "two or more adapters — the parity cases below are live");
    return;
  }
  assert.equal(ADAPTERS.length, 1,
    "the parity rule needs two runtimes to compare; delete this branch when the second lands");
});

test("every field the descriptor can declare is one some runtime differs on", { skip: !ARMED }, () => {
  const vestigial = [];
  for (const [path, read] of VARIES) {
    if (pending(path)) continue; // see DEFERRED_BY_DESIGN — checked by its own case below
    const values = at(read);
    if (new Set(values).size === 1) {
      vestigial.push(`${path} — every runtime answers ${values[0]}`);
    }
  }
  assert.deepEqual(
    vestigial,
    [],
    "these descriptor fields no longer describe a DIFFERENCE. Either a runtime should be "
    + "declaring something else, or the field is a constant and belongs in core:\n"
    + vestigial.join("\n")
  );
});

test("…and every NULLABLE one is DECLARED ABSENT somewhere and PRESENT somewhere", { skip: !ARMED }, () => {
  // ⚠ THE HALF THAT CATCHES A HIDE-ON-ABSENT PATH NOBODY EXERCISES. A nullable field that is
  // non-null on every runtime has a `null` branch in the UI that has never rendered, and an
  // untested hide is how a control comes back for a runtime that cannot support it.
  // ⚠ NULLABLE ONLY — see the VARIES header for why demanding a `null` from
  // `axisB.enforcementPoint` would be demanding an adapter that could never register.
  const untested = [];
  for (const [path, read, nullable] of VARIES) {
    if (!nullable || pending(path)) continue;
    const values = ADAPTERS.map(({ descriptor }) => read(descriptor));
    if (!values.some((v) => v === null)) untested.push(`${path} — never declared absent`);
    if (!values.some((v) => v !== null)) untested.push(`${path} — never declared present`);
  }
  assert.deepEqual(untested, [],
    "a hide-on-absent branch that no registered runtime exercises:\n" + untested.join("\n"));
});

test("every DEFERRED row still describes something that really is not varying yet", { skip: !ARMED }, () => {
  // ⚠ THE HALF THAT KEEPS THE CENSUS HONEST, and it is the same discipline `core-vocabulary`'s
  // DEFERRED list runs under: without it the list only ever grows, and a row for a field that
  // started varying two waves ago reads as permission for the next one.
  const stale = [];
  for (const path of Object.keys(DEFERRED_BY_DESIGN)) {
    const entry = VARIES.find(([p]) => p === path);
    if (!entry) { stale.push(`${path} (not a VARIES field at all)`); continue; }
    const [, read, nullable] = entry;
    // A row is EARNED by failing one of the two judgements. Passing both means the field is
    // already measured and the exemption is now hiding nothing but itself.
    const stillPending = !varies(read) || (nullable && !absentAndPresent(read));
    if (!stillPending) stale.push(`${path} (it is fully measured now — delete its row)`);
  }
  assert.deepEqual(stale, [],
    "these DEFERRED_BY_DESIGN rows no longer describe anything:\n" + stale.join("\n"));
});

test("the Cursor census RESOLVED: every design prediction is confirmed against the shipped adapter", { skip: ADAPTERS.length < 3 }, () => {
  // ⚠ THE CASE THAT REFUSES TO LET A PREDICTION EXPIRE UNCHECKED. `PENDING_UNTIL_CURSOR` was six
  // dated claims about what Cursor would declare; deleting them when the adapter landed would have
  // retired all six unmeasured. So five are asserted here and the sixth is DEFERRED_BY_DESIGN.
  // ⚠ BOTH HALVES, and the second is the one that matters: "the field varies now" can be true for
  // the wrong reason, so the predicted VALUE is pinned too. A later adapter that changes one of
  // these fails here rather than silently rewriting a design decision.
  const cursor = ADAPTERS.find(({ descriptor }) => descriptor.id === "cursor");
  assert.ok(cursor, "the third adapter is registered but is not the one these predictions are about");
  const wrong = [];
  for (const [path, predicted] of CURSOR_PREDICTIONS) {
    const entry = VARIES.find(([p]) => p === path);
    assert.ok(entry, `${path} is no longer a VARIES field — the prediction has nothing to check`);
    const [, read] = entry;
    if (!varies(read)) wrong.push(`${path} — still identical on every runtime`);
    const actual = read(cursor.descriptor);
    if (JSON.stringify(actual) !== JSON.stringify(predicted)) {
      wrong.push(`${path} — design predicted ${JSON.stringify(predicted)}, adapter declares ${JSON.stringify(actual)}`);
    }
  }
  assert.deepEqual(wrong, [],
    "a design prediction did not survive contact with the shipped adapter. That is a FINDING, not "
    + "a test to relax: either the adapter is declaring the wrong thing, or the design's §1.4 table "
    + "needs a dated amendment the way its Codex cells got one:\n" + wrong.join("\n"));
});

test("the VARIES list itself still points at real fields", () => {
  // Cheap, and it runs at one adapter too: a renamed descriptor field would otherwise make every
  // case above compare `undefined` to `undefined` and pass.
  const missing = [];
  for (const [path, read] of VARIES) {
    for (const { descriptor } of ADAPTERS) {
      if (read(descriptor) === undefined) missing.push(`${descriptor.id}: ${path}`);
    }
  }
  assert.deepEqual(missing, [],
    "a field on this list is undefined — absent must be an explicit null:\n" + missing.join("\n"));
});
