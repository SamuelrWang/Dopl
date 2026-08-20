// SHARED EXTRACTION for the `main/channel-prefs.js` suites.
//
// WHY IT IS ITS OWN FILE. `channel-prefs.test.mjs` crossed the 500-line cap when the
// 2026-08-20 arm-vs-durable-posture split arrived, and the alternative — a second copy
// of the slicer in a second file — is how two suites drift into testing two different
// programs. Same seam and same precedent as `_session-summary-harness.mjs` and
// `_reducer-block.mjs`: the extraction machinery is shared, the cases are split by what
// they are ABOUT. `channel-prefs.test.mjs` keeps the ARM; `channel-launch-posture.test.mjs`
// takes the DURABLE posture.
//
// WHY SOURCE EXTRACTION AT ALL: channel-prefs.js pulls in electron-store, so it does not
// import under `node --test`. The validation + map ops are fenced as a PURE block (no
// electron/fs/store refs) and sliced verbatim here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  "TOOL_MODES", "MESSAGE_MODES", "DEFAULT_PRESET", "ARM_TTL_MS", "normalizePreset",
  "armIsLive", "resolveArm", "defaultPreset", "readArmFrom", "armInto", "takeArmFrom",
  "sweepExpired",
  // The DURABLE half (2026-08-20). ⚠ Deliberately NOT symmetrical with the arm's
  // readers: there is no TTL argument and no `at`, which is the whole difference.
  "readPostureFrom", "postureInto",
];

/** The pure block, evaluated verbatim. Module-level and shared — the block holds no
 *  state of its own (every op takes the map it works on), so one copy is safe. */
export const prefs = new Function(
  `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
)();

/** Two real UUIDs, so the per-channel isolation cases are about ids the IPC gate
 *  would actually accept. */
export const CH_A = "44444444-4444-4444-8444-444444444444";
export const CH_B = "55555555-5555-4555-8555-555555555555";
