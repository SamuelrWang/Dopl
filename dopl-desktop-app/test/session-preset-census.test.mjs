// H2's CENSUS — WHO IN `main/` MAY HAND A LAUNCH A POSTURE, AND WHO MAY ARM A DORMANT SHELL.
//
// ⚠ SPLIT OUT OF `session-preset-start.test.mjs` ON 2026-08-21, at the 500-line cap `test/**`
// is linted under. That file had three lines of headroom, and the SPAWN-IDLE ruling needed the
// carve-out case rewritten with its argument attached — a file at the cap does not just stop
// growing, it stops being correctable, which is the same reason `main/channel-dir-ipc.js` was
// split (F-226) and `_session-summary-harness.mjs` before it.
//
// THE SEAM IS SUBJECT, NOT ARITHMETIC. `session-preset-start.test.mjs` DRIVES real spawn paths
// and asserts the resulting AXES — it is about behaviour. These two cases assert a property of
// the TREE ("nobody else does this"), which nothing you can call proves and which changes on a
// completely different clock: whenever a FILE is added, split or renamed. Keeping them together
// meant every file-level move re-opened a behavioural suite.
//
// H2 ITSELF IS UNCHANGED AND ITS ARGUMENT LIVES NEXT DOOR: a stored posture may only apply to a
// launch a human is approving right now. Read that file's header first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

// ⚠ "H2: recreateParkedShell and openFromChannel pass NO startModes to startSession" STOOD HERE
// AND IS DELETED (2026-08-20, F-228). It sliced those two functions out of session-park.js and
// asserted each really spawned (`deps.startSession(`), spawned a DORMANT shell
// (`parkedShell: true`), and handed in no posture. Both are deleted: `recreateParkedShell`
// rebuilt a parked WINDOW for a thread with no live session (a peer reply on an old thread) and
// `openFromChannel` was the operator's "Open session" from the channel view. They were the two
// paths that actually re-applied the stored preset in the v3.1 bug, so they were the file's
// original subjects — but the invariant never lived in them, and a slice of a deleted function
// yields the empty string, against which `!/startModes/` passes for free.
//
// WHAT REPLACES IT IS STRONGER: those two were an incomplete list of who spawns, and the case
// below enumerates EVERY caller that hands a posture in, off the tree.

test("H2: exactly TWO callers in main/ hand a posture in, and neither arms a dormant shell", () => {
  // ⚠ `session-launch.js` is excluded WITH the engine (2026-08-21: the spawn FUNNEL split off it
  // at the §2 cap). A funnel FORWARDS a posture; this census is about who ORIGINATES one.
  const files = readdirSync(MAIN).filter(
    (f) => f.endsWith(".js") && f !== "session-engine.js" && f !== "session-launch.js");
  const handers = files.filter((f) => /startModes:/.test(read(f))).sort();
  assert.deepEqual(
    handers,
    ["session-ipc-ops.js", "trigger.js"],
    "a new caller that hands in a posture is a new way for one to reach a launch no human is " +
      "attending — review it here rather than updating this list reflexively " +
      "(session-ipc-ops.js = sessions:launch, the operator's own click on the Agents tab, " +
      "handing in the DURABLE record — it lived in channel-dir-ipc.js until the 2026-08-20 " +
      "split off the 500-line cap (F-226), which moved the FILE and not the consumer; " +
      "trigger.js = the consent-approved responder lane, which " +
      "since 2026-08-20 hands in a pinned NULL — it still names the key, so it still shows up " +
      "here, and that is right: the seam is what must stay reviewed, not the value on this pass)"
  );
  // ⚠ THE MEMBERSHIP IS TWO AND THE EFFECTIVE COUNT IS ONE, so the difference is asserted rather
  // than left to the string above. `trigger.js` appearing in a grep for `startModes:` used to mean
  // it consumed the single-use arm; it now means it spells out that it consumes nothing.
  assert.match(read("trigger.js"), /const startModes = null;/,
    "the responder lane hands in null — a census member that supplies no posture");
  // ⚠ THE PARKED-SHELL CARVE-OUT ASSERTED `[]` UNTIL SAMUEL'S SPAWN-IDLE RULING (2026-08-21).
  // `operatorArmed` lets a handed-in posture reach a DORMANT shell, and the argument for why the
  // New Agent click may is written where it is exercised (`main/session-ipc-ops.js`, the
  // `sessions:launch` block). A SECOND producer means something other than a live click can arm
  // a shell, which IS the failure H2 names — do not add a name here without that argument.
  const armers = files.filter((f) => /operatorArmed/.test(read(f))).sort();
  assert.deepEqual(armers, ["session-ipc-ops.js"], "only New Agent may arm a dormant shell");
  // …and it is the SAME file that hands the posture in: the click and the posture read are ONE
  // event, not two call sites that happen to agree.
  assert.ok(handers.includes("session-ipc-ops.js"));
});
