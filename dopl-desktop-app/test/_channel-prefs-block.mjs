// SHARED EXTRACTION for the `main/channel-prefs.js` suites.
//
// WHY IT IS ITS OWN FILE. `channel-prefs.test.mjs` crossed the 500-line cap when the
// 2026-08-20 arm-vs-durable-posture split arrived, and the alternative — a second copy
// of the slicer in a second file — is how two suites drift into testing two different
// programs. Same seam and same precedent as `_session-summary-harness.mjs` and
// `_reducer-block.mjs`: the extraction machinery is shared, the cases are split by what
// they are ABOUT. `channel-prefs.test.mjs` keeps the SHARED VALIDATOR and the IPC surface;
// `channel-launch-posture.test.mjs` takes the DURABLE posture's own map ops.
//
// ⚠ THE ARM'S HALF OF THIS EXPORT LIST IS DELETED (2026-08-20, Samuel's ruling). It read
// `ARM_TTL_MS, armIsLive, resolveArm, readArmFrom, armInto, takeArmFrom, sweepExpired` —
// the single-use, 30-minute, consent-only permission preset. `channel-prefs.js` no longer
// defines any of them, so the `new Function` below threw a `ReferenceError` at MODULE LOAD
// and took BOTH suites down with it, before a single case ran. That is the sharp part of
// sharing a slicer: one dead symbol in the export list is not a failing assertion, it is
// two suites that cannot start. The list is now exactly what the block defines.
//
// WHY SOURCE EXTRACTION AT ALL: channel-prefs.js pulls in electron-store, so it does not
// import under `node --test`. The validation + map ops are fenced as a PURE block (no
// electron/fs/store refs) and sliced verbatim here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The whole module's source — for the assertions that pin a literal (a store key,
 *  a TTL) rather than a behaviour. */
export const SRC = readFileSync(join(HERE, "..", "main", "channel-prefs.js"), "utf8");

const BEGIN = "// ─── BEGIN CHANNEL-PREFS-VALIDATE";
const END = "// ─── END CHANNEL-PREFS-VALIDATE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN CHANNEL-PREFS-VALIDATE sentinel missing");
assert.notEqual(to, -1, "END CHANNEL-PREFS-VALIDATE sentinel missing");
assert.ok(to > from, "channel-prefs sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The sliced block must stay electron/fs/store-free (§H-7). Scan CODE only
// (strip // comments — they legitimately say "electron-free").
const CODE = BLOCK.split("\n")
  .map((l) => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");
for (const banned of ["require(", "electron", "store.", "fs.", "os.", "process."]) {
  assert.ok(!CODE.includes(banned), `CHANNEL-PREFS-VALIDATE block must not reference ${banned}`);
}

const EXPORTED = [
  // THE SHARED VALIDATOR — the frozen enums and the whole-pair-or-nothing rule. It
  // outlived the arm because it was never the arm's: both records were always
  // re-validated through `normalizePreset`, and it is still the only thing standing
  // between a hostile renderer payload and a stored `bypass`.
  "TOOL_MODES", "MESSAGE_MODES", "DEFAULT_PRESET", "normalizePreset", "defaultPreset",
  // THE DURABLE LAUNCH POSTURE's map ops — and since the arm's deletion, the only
  // per-channel record in this block. ⚠ There is no TTL argument and no `at`, which
  // used to be the difference from the arm's readers and is now simply the shape.
  // ⚠ `effectivePosture` IS THE WIRE SHAPE, and it is exported here so the IPC harness in
  // `channel-prefs.test.mjs` can stub `getLaunchPosture` with the REAL composition instead of
  // re-spelling it. A stub that re-implements the function under test can only assert about a
  // shape main might not produce — which is exactly how the always-present `model` key went
  // missing on the wire while every suite stayed green.
  "readPostureFrom", "effectivePosture", "postureInto",
];

/** The pure block, evaluated verbatim. Module-level and shared — the block holds no
 *  state of its own (every op takes the map it works on), so one copy is safe.
 *  ⚠ `normalizeModelId` IS INJECTED SINCE 2026-08-22 (Samuel's model-selection ruling): the
 *  durable posture gained a MODEL field, validated against `session-model.js`'s frozen id list
 *  rather than against a fourth copy of it here. The REAL function is handed in — it is pure,
 *  and its fail-closed answer (an unknown id is ABSENT, not a rejected write) is the behaviour
 *  the cases below are about. */
export const prefs = new Function(
  "normalizeModelId",
  `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
)(createRequire(import.meta.url)(join(HERE, "..", "main", "session-model.js")).normalizeModelId);

/** Two real UUIDs, so the per-channel isolation cases are about ids the IPC gate
 *  would actually accept. */
export const CH_A = "44444444-4444-4444-8444-444444444444";
export const CH_B = "55555555-5555-4555-8555-555555555555";
