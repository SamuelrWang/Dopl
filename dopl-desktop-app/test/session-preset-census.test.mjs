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

// ── ⚠ THE THIRD HANDER AND THE SECOND ARMER (2026-08-22, Samuel's launch-over-MCP ruling) ───
//
// `main/launch-directives.js` joins BOTH lists in this file, and it is the first thing ever to do
// so that is not a human pressing a button. That is the exact event this census exists to force
// a review of, so the review is written here rather than absorbed into the arrays.
//
// WHAT IT IS. An orchestrator — an agent holding this operator's own Dopl credential — writes a
// row into `channel_launch_directives`; this machine claims it and spawns. **No click.**
//
// WHY IT IS ALLOWED TO HAND IN A POSTURE. H2's rule is not "a click must happen"; it is that a
// stored posture may only ever apply to a launch **a human is approving**. Samuel ruled the
// approval for this lane explicitly, and ruled where it lives: a LOCAL, PER-MACHINE, DEFAULT-OFF
// toggle (`channel-prefs.js › getOrchestratorLaunch`). **The toggle IS that human** — it is the
// operator saying, in advance and on this specific machine, "a program may press this button
// here". It replaces "the click IS that human" for this lane and for no other.
//
// WHY THE TOGGLE IS A REAL APPROVAL AND NOT A RUBBER STAMP, which is the part worth checking:
//   • IT IS UNREACHABLE BY THE THING IT GOVERNS. There is no route, no MCP op and no
//     `workspace_settings` column — one `appWindowOnly` IPC pair and an `electron-store` boolean.
//     A spawned session runs with `Bash` and the operator's device token is on disk (§6), so a
//     SERVER-side flag would let the agents this lane creates arm every machine the operator
//     owns. A consent a program can grant itself is not one.
//   • IT DEFAULTS OFF AND IS PER MACHINE, so the lane does not exist until an operator turns it
//     on, on the laptop it will run on.
//   • OFF IS SILENT: no claim, no launch, no server write. The row expires.
//
// WHY IT MAY ALSO ARM A DORMANT SHELL (`operatorArmed`). Same argument, and refusing it would be
// worse rather than safer: without the flag `startSession`'s FIX-4 guard silently DROPS the
// posture and the agent starts at the reducer's `manual`/`ask` — so the operator's own configured
// channel would behave differently depending on who pressed. That is drift, not containment.
//
// ⚠ AND WHAT THE DIRECTIVE ITSELF SUPPLIES IS **A GOAL AND A MODEL**, WHICH IS WHY THIS IS NOT
// AN ESCALATION. The posture is read from the operator's own durable per-channel record, the
// tool profile from main's own watched-channel DTO — the same two sources `sessions:launch`
// reads. Nothing an orchestrator writes reaches a permission decision, and a directive-launched
// agent is exactly as contained as a button-launched one.
// `test/launch-directives.test.mjs § CONTAINMENT` drives all three of those claims.
//
// ⚠ A FOURTH HANDER OR A THIRD ARMER STILL NEEDS THIS TREATMENT. Do not add a name to either
// array without an argument of this shape.

test("H2: exactly THREE callers in main/ hand a posture in, and two may arm a dormant shell", () => {
  // ⚠ `session-launch.js` is excluded WITH the engine (2026-08-21: the spawn FUNNEL split off it
  // at the §2 cap). A funnel FORWARDS a posture; this census is about who ORIGINATES one.
  const files = readdirSync(MAIN).filter(
    (f) => f.endsWith(".js") && f !== "session-engine.js" && f !== "session-launch.js");
  const handers = files.filter((f) => /startModes:/.test(read(f))).sort();
  assert.deepEqual(
    handers,
    ["launch-directives.js", "session-launch-op.js", "trigger.js"],
    "a new caller that hands in a posture is a new way for one to reach a launch no human is " +
      "attending — review it here rather than updating this list reflexively " +
      "(session-launch-op.js = the BODY of sessions:launch, the operator's own click on the " +
      "Agents tab, handing in the DURABLE record — it lived in channel-dir-ipc.js until the " +
      "2026-08-20 split (F-226) and in session-ipc-ops.js until the 2026-08-22 one, and BOTH " +
      "moved the FILE and not the consumer; " +
      "trigger.js = the PEER-TRIGGERED responder lane, which hands in a pinned most-restrictive " +
      "pair — it still names the key, so it still shows up here, and that is right: the seam is " +
      "what must stay reviewed, not the value on this pass; " +
      "launch-directives.js = the ORCHESTRATOR lane, 2026-08-22 — the first hander that is not " +
      "a human pressing something, allowed because Samuel ruled a LOCAL DEFAULT-OFF TOGGLE the " +
      "approval for it. Read the block above this test before touching this array)"
  );
  // ⚠ THE MEMBERSHIP IS TWO AND THE EFFECTIVE COUNT IS ONE, so the difference is asserted rather
  // than left to the string above. `trigger.js` appearing in a grep for `startModes:` used to mean
  // it consumed the single-use arm; it now means it spells out that it consumes nothing.
  // ⚠ THE SPELLING CHANGED ON 2026-08-22 AND THE FACT DID NOT. It was `const startModes = null;`
  // threaded into `{ tools: (startModes && startModes.tools) || 'manual', … }` — a seam whose one
  // producer (`inboundApproved`) passed null, and which went with the inbound consent lane
  // (Samuel's ruling). The value is written where it applies now.
  assert.match(read("trigger.js"), /startModes: \{ tools: 'manual', messages \}/,
    "the responder lane hands in the most restrictive tool axis — a census member with no stored posture");
  // ⚠ THE PARKED-SHELL CARVE-OUT ASSERTED `[]` UNTIL SAMUEL'S SPAWN-IDLE RULING (2026-08-21).
  // `operatorArmed` lets a handed-in posture reach a DORMANT shell, and the argument for why the
  // New Agent click may is written where it is exercised (`main/session-launch-op.js`). A SECOND producer means something other than a live click can arm
  // a shell, which IS the failure H2 names — do not add a name here without that argument.
  const armers = files.filter((f) => /operatorArmed/.test(read(f))).sort();
  assert.deepEqual(armers, ["launch-directives.js", "session-launch-op.js"],
    "New Agent (the click) and the ORCHESTRATOR lane (the local default-OFF toggle, Samuel's " +
      "ruling — see the block above). A THIRD name means something else can arm a dormant " +
      "shell, which IS the failure H2 names.");
  // …and every armer is ALSO a hander: the approval and the posture read are ONE event in each
  // case, not two call sites that happen to agree. That is the property, not the count.
  for (const f of armers) {
    assert.ok(handers.includes(f), `${f} arms a shell without handing in the posture it armed for`);
  }
  // ⚠ AND THE ORCHESTRATOR LANE'S APPROVAL IS THE **LOCAL** ONE, asserted rather than trusted:
  // the lane must read the machine-local toggle, and it must not be reachable from a Dopl
  // credential. A server-side arming flag is the escalation this whole design refuses (§6).
  const lane = read("launch-directives.js");
  assert.match(lane, /channelPrefs\.getOrchestratorLaunch\(\)/,
    "the approval is the LOCAL toggle, read at decision time");
  assert.ok(!/workspace_settings|orchestratorLaunch.*api|apiFetch\([^)]*[Tt]oggle/.test(lane),
    "…and it is never fetched from the server");
});
