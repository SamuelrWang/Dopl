// H2 (2026-07-31) — A STORED POSTURE MAY ONLY APPLY TO A LAUNCH A HUMAN IS APPROVING.
//
// THE DEFECT THIS FILE EXISTS FOR. `session-engine.startSession` is the single construction
// site for EVERY spawn shape, and v3.1 made it fold the channel's stored permission preset
// into the initial state UNCONDITIONALLY (via channel-context.startingModes). The preset
// storage was per-channel, permanent, with no TTL, no delete and no inspection surface. So:
// an operator picks Tools=bypass / Messages=auto_both once, on one consent card, for channel
// C. Days later a peer replies to ANY thread on C -> recreateParkedShell -> startSession ->
// seeds bypass/auto_both -> the inbound is auto-accepted -> wakeEffects resumes the query ->
// the agent runs with Bash/WebFetch pre-approved and auto-outbound posting, with NO consent
// card and NO click. Before that change every recreated shell started manual/ask.
//
// WHAT THE PREVIOUS VERSION OF THIS FILE TESTED, AND WHY IT WAS WORTHLESS: it regex-matched
// the reducer's SOURCE TEXT for the string `toolMode: 'manual', messageMode: 'ask'` and
// asserted `initialSessionState` coerces junk. Both were true the whole time the bug was
// live. It never once drove `recreateParkedShell` or `session-park.startResume` — the two
// paths that actually re-applied the preset — so it could not have failed. Every test below
// DRIVES a real spawn path against the real startSession and asserts the resulting AXES.
//
// THE INVARIANT: the posture travels ONLY as an explicit `spec.startModes`, supplied by a caller
// executing a decision a human is making right now. Every other shape passes nothing and
// inherits the reducer's own manual/ask.
//
// ⚠ WHAT MOVED ON 2026-08-20 (F-228), AND WHAT DID NOT. The invariant is untouched; three of the
// things this file measured it against are deleted, so it is rewritten down to what survives
// (INVARIANTS §14) rather than removed:
//   · the SECOND posture source — the pre-consent CARD's own pair, consumed by registry entry
//     (`sessionConsent.takeStartModes`, `spec.adoptsConsent`) — went with the session window.
//     The construction-site harness is re-sliced from `const armedModes = spec.startModes;`,
//     and the absence of a second source is now itself asserted there.
//   · `recreateParkedShell` / `openFromChannel` — the two paths that actually re-applied the
//     stored preset in the v3.1 bug — are deleted. The case that named them is replaced by a
//     CENSUS of every caller in main/ that hands a posture in, which is what it was sampling.
//   · the in-window controls (`session-ipc.js`, `session:set-tool-mode`) are deleted with no
//     successor: there is no per-session mode control, the posture is decided once at launch.
//     The write-side case is replaced by an enumeration of every writer of an arm.
// ⚠ AND ONE CASE HAD ALREADY GONE VACUOUS AND WAS READING AS GREEN — see §5.
//
// TWO CALLERS supply a posture today, and the census below is the authority on that: trigger.js
// (the consent-approved responder lane, consuming a single-use arm) and channel-dir-ipc.js
// (`sessions:launch`, the operator's own click on the Agents tab, reading the durable record).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const M = (p) => join(MAIN, p);
const read = (p) => readFileSync(M(p), "utf8");
const ENGINE = read("session-engine.js");
const PARK = read("session-park.js");
const TRIGGER = read("trigger.js");
const CONTEXT = read("channel-context.js");
const PREFS = read("channel-prefs.js");
const WATCHER = read("consent-watcher.js");
const DIRIPC = read("channel-dir-ipc.js");

const { initialSessionState } = loadReducer();

const WIDE = { tools: "bypass", messages: "auto_both" };

// ── 1. THE CONSTRUCTION SITE, driven ─────────────────────────────────────────
// The real `startSession` head: the ONE expression that decides a new session's axes,
// sliced from the shipped engine and evaluated against the real initialSessionState.
// This is what the old file should have exercised.

// ⚠ RE-SLICED, AND THE SECOND SOURCE IS GONE (2026-08-20, F-228). FIX 1 (2026-08-02) had added
// a SECOND, tighter posture source — the pair the operator picked on the PRE-CONSENT CARD
// itself, consumed by registry entry rather than by channel — and this harness injected a
// `sessionConsent` fake for it, defaulting to null ("the card was never touched"). Both the
// card and `sessionConsent.takeStartModes` went with `renderer/session/**`, taking the
// `const consentModes = ...` line this slice STARTED at, so every case here failed on an
// unresolvable slice rather than on anything about postures. The head begins at `armedModes`
// now and there is ONE source: `spec.startModes`, handed in per launch. Fewer free variables,
// and the shape H2 always wanted — the card was the exception to it.
function startModesFor(spec) {
  const src = ENGINE.slice(ENGINE.indexOf("const armedModes = spec.startModes;"),
    ENGINE.indexOf("const context = { ...(spec.context || {})"));
  assert.ok(src.includes("initialSessionState("), "the construction site moved — reslice it");
  assert.ok(!/sessionConsent|consentModes|adoptsConsent/.test(src),
    "a second posture source is back at the construction site — that is H2, re-opened");
  const state = new Function("spec", "initialSessionState", "readCaps",
    `${src}\n return state;`)(spec, initialSessionState, () => ({}));
  return { toolMode: state.toolMode, messageMode: state.messageMode };
}

test("H2: a launch that HANDS IN a posture gets it (the approved consent path)", () => {
  assert.deepEqual(startModesFor({ mode: "interactive", side: "responder", startModes: WIDE }),
    { toolMode: "bypass", messageMode: "auto_both" });
});

test("H2: EVERY spawn shape that hands in NOTHING starts at manual/ask", () => {
  // The four shapes that used to inherit the stored preset by accident.
  const shapes = {
    "recreated parked shell (a peer reply on an old thread)": { parkedShell: true, side: "requester" },
    "crash resume (session-park.startResume)": { side: "responder", resumeSdkId: "sdk-1" },
    "operator Open session (openFromChannel)": { parkedShell: true, side: "requester", resumeSdkId: null },
    "requester auto-open (the operator's own goal, no card)": { side: "requester" },
  };
  for (const [label, spec] of Object.entries(shapes)) {
    assert.deepEqual(startModesFor({ mode: "interactive", ...spec }),
      { toolMode: "manual", messageMode: "ask" }, label);
  }
});

test("H2: a PARKED SHELL refuses a posture unless a human armed it JUST NOW", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, F-228; INVARIANTS §14). The guard is the same
  // `spec.parkedShell` read and it is still LIVE — a dormant shape must never carry a posture
  // into a wake nobody is attending — but the shipped rule grew a carve-out and this case
  // asserted the pre-carve-out absolute. FIX 4's `operatorArmed` is now the whole rule: a shell
  // takes a handed-in posture ONLY when the caller says a human chose it at that moment. A bare
  // recreate, reopen, resume or wake sets neither flag and still lands on manual/ask.
  //
  // Both sides are driven, because a one-sided version of this is how the carve-out becomes the
  // default: the refusal is the security property, and the exception is the thing that must
  // stay expensive to spell.
  const shell = { mode: "interactive", side: "requester", parkedShell: true, startModes: WIDE };
  assert.deepEqual(startModesFor(shell), { toolMode: "manual", messageMode: "ask" },
    "defence in depth: a posture handed to a dormant shell is refused");
  assert.deepEqual(startModesFor({ ...shell, operatorArmed: true }),
    { toolMode: "bypass", messageMode: "auto_both" },
    "…and only an EXPLICIT operatorArmed lets one through");
  // `=== true` only. A truthy value a store or a payload could carry by accident must not open
  // it, which is what makes the carve-out an assertion rather than a hint.
  for (const junk of ["true", 1, {}, [], "yes", "operator"]) {
    assert.deepEqual(startModesFor({ ...shell, operatorArmed: junk }),
      { toolMode: "manual", messageMode: "ask" }, JSON.stringify(junk));
  }
  // ⚠ `spec.parkedShell` HAS NO PRODUCER LEFT (the shell-recreate lane is deleted), and the flag
  // is deliberately still READ rather than scrubbed — a future non-window dormant shape sets it
  // and inherits the safe behaviour. A guard with no live producer is exactly the kind that gets
  // deleted as dead, so its presence at the construction site is asserted here.
  const head = ENGINE.slice(ENGINE.indexOf("const armedModes = spec.startModes;"),
    ENGINE.indexOf("const context = { ...(spec.context || {})"));
  assert.match(head, /!spec\.parkedShell \|\| operatorArmed/, "the guard itself, not just its effect");
});

test("H2: a corrupt or hostile handed-in posture still lands on the MOST RESTRICTIVE member", () => {
  for (const junk of ["BYPASS", "bypass ", "auto;rm -rf", 1, true, {}, [], "yolo", null]) {
    assert.deepEqual(startModesFor({ startModes: { tools: junk, messages: junk } }),
      { toolMode: "manual", messageMode: "ask" }, String(junk));
  }
  // A valid value on ONE axis never drags the other along.
  assert.equal(startModesFor({ startModes: { tools: "bypass", messages: "nope" } }).messageMode, "ask");
  assert.equal(startModesFor({ startModes: { tools: "nope", messages: "auto_both" } }).toolMode, "manual");
});

test("H2: the preset is not, and cannot become, part of any GRANT", () => {
  const s = initialSessionState({ toolMode: "bypass", messageMode: "auto_both" });
  assert.equal(s.inboundForTask, false, "the standing inbound grant is NOT part of the posture");
  assert.deepEqual(s.allowForTask, [], "nor is any tool grant");
  assert.equal(s.authHeld, false);
});

// ── 2. THE RE-APPLYING PATHS: they hand in nothing, structurally ─────────────

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
  const files = readdirSync(MAIN).filter((f) => f.endsWith(".js") && f !== "session-engine.js");
  const handers = files.filter((f) => /startModes:/.test(read(f))).sort();
  assert.deepEqual(
    handers,
    ["channel-dir-ipc.js", "trigger.js"],
    "a new caller that hands in a posture is a new way for one to reach a launch no human is " +
      "attending — review it here rather than updating this list reflexively " +
      "(trigger.js = the consent-approved responder lane, consuming the single-use arm; " +
      "channel-dir-ipc.js = sessions:launch, the operator's own click on the Agents tab)"
  );
  // ...and NOBODY sets the parked-shell carve-out. `operatorArmed` exists so a future attended
  // dormant shape can opt in explicitly; a producer appearing without a case here means a
  // posture can now reach a shell, which is the exact failure H2 names.
  const armers = files.filter((f) => /operatorArmed/.test(read(f))).sort();
  assert.deepEqual(armers, [], "the parked-shell carve-out has no producer, and gaining one is a review");
});

test("H2: startResume (the crash/interrupted resume) passes NO startModes either", () => {
  const body = PARK.slice(PARK.indexOf("async function startResume("), PARK.indexOf("async function resume("));
  assert.ok(body.includes("deps.startSession("), "startResume really spawns");
  assert.ok(!/startModes/.test(body), "a resume is not a fresh human decision");
});

test("H2: the requester launch mints NO posture of its own — it forwards its caller's", () => {
  // ⚠ THIS ASSERTION SURVIVED THE 2026-08-20 SPLIT UNCHANGED, AND ITS REASON DID NOT.
  // It used to read "no card is ever shown for it", i.e. this lane opens at manual/ask
  // FULL STOP. That stopped being the whole truth when the Agents tab grew a Launch
  // button: the operator clicking it IS the human decision, so the DURABLE posture now
  // reaches this lane — from the CALLER, as an explicit `spec.startModes`, exactly like
  // the arm reaches the responder lane. What must stay true is the engine seam itself:
  // `launchRequesterSession` reads no stored posture, so a caller that hands it nothing
  // still inherits the reducer's manual/ask.
  const body = ENGINE.slice(ENGINE.indexOf("function launchRequesterSession("), ENGINE.indexOf("function hasLiveSession("));
  assert.ok(!/startModes/.test(body), "the engine wrapper neither reads nor defaults one");
  assert.ok(!/channel-prefs|channelPrefs/.test(stripComments(ENGINE)),
    "and the engine reaches the prefs store on no path at all");
});

// ── 3. THE ONE CONSUMER ──────────────────────────────────────────────────────

test("H2: exactly ONE place in main/ consumes the arm, and it is the consent-approved launch", () => {
  const body = TRIGGER.slice(TRIGGER.indexOf("async function inboundApproved("), TRIGGER.indexOf("async function launchResponderSession("));
  assert.match(body, /channelPrefs\.consumePermissionPreset\(entry\.channel\.id\)/, "consumed here");
  assert.match(body, /meta && meta\.humanAllowed === true/,
    "and ONLY when a human allowed it — standing trust (auto_allowed) consumes nothing");
  assert.match(body, /startModes/, "and handed to the launch");
  // Nowhere else.
  for (const [name, src] of [["session-engine", ENGINE], ["session-park", PARK], ["channel-context", CONTEXT]]) {
    assert.ok(!/consumePermissionPreset/.test(src), `${name} must not consume the arm`);
  }
});

// ── 3b. THE DURABLE POSTURE'S ONE CONSUMER (2026-08-20) ──────────────────────
// The split: the ARM stays single-use / expiring / consent-only, and a SECOND
// durable record serves the one launch shape where the operator's own click is
// the decision. H2 is not about durability — it is about an AMBIENT read at a
// spawn nobody is attending — so the rule these pin is the CONSUMER COUNT, which
// is what actually kept the failure closed. If either record ever gains a second
// reader, H2 is re-openable and these are the tests that must go red first.

test("H2/split: the DURABLE posture is read by sessions:launch and by nothing else", () => {
  const body = DIRIPC.slice(DIRIPC.indexOf("ipcMain.handle('sessions:launch'"));
  assert.match(body, /channelPrefs\.launchStartModes\(p\.channelId\)/, "consumed here");
  // ...and the pinned 'manual' it replaced is really gone from this handler.
  assert.ok(!/tools: 'manual'/.test(body.slice(0, body.indexOf("ipcMain.handle('sessions:reopen'"))),
    "the hard-pinned tool axis that ignored the operator's pick is gone");
  for (const [name, src] of [
    ["session-engine", ENGINE], ["session-park", PARK],
    ["channel-context", CONTEXT], ["trigger", TRIGGER],
  ]) {
    const code = stripComments(src);
    assert.ok(!/getLaunchPosture|launchStartModes/.test(code),
      `${name} must not read the durable posture — an ambient read here IS H2`);
  }
});

test("H2/split: the RESPONDER lane still consumes the arm, and never the posture", () => {
  const body = TRIGGER.slice(TRIGGER.indexOf("async function launchResponderSession("));
  assert.match(body, /startModes && startModes\.tools/, "the tool axis is the ARM's");
  assert.ok(!/getLaunchPosture/.test(stripComments(body)),
    "a peer-driven launch must not inherit a setting the operator left on a tab");
});

test("H2/split: ONE derivation of the windowless message axis, shared by both lanes", () => {
  // Two copies of "does this pick mean auto-out" is how one lane starts posting
  // without the other. The rule lives in channel-prefs; both lanes call it.
  assert.match(PREFS, /function windowlessMessageMode\(channelId, picked\)/);
  assert.match(TRIGGER, /channelPrefs\.windowlessMessageMode\(/);
  assert.match(PREFS, /function launchStartModes\(channelId\)/);
  const rule = PREFS.slice(PREFS.indexOf("function windowlessMessageMode("));
  assert.match(rule.slice(0, 260), /autoOut \? 'auto_both' : 'auto_inbound'/,
    "WIDEN-ONLY: there is no return below the auto_inbound floor");
});

// Comments legitimately NAME the deleted seam (they explain why it is gone), so the
// absence assertions below scan CODE only.
const stripComments = (src) => src.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
  .join("\n");

test("H2: the AMBIENT read is gone — channel-context no longer exposes startingModes", () => {
  // The absence IS the fix: with no ambient read there is nothing for a spawn path to
  // inherit by accident, so a future shape is safe by construction rather than by memory.
  const ctx = stripComments(CONTEXT);
  assert.ok(!/function startingModes/.test(ctx), "the function is deleted");
  assert.ok(!/startingModes/.test(ctx), "and not exported either");
  assert.ok(!/startingModes/.test(stripComments(ENGINE)), "and the engine no longer calls it");
  assert.ok(!/resolvePermissionPreset/.test(stripComments(CONTEXT + ENGINE + PARK)),
    "nor the always-returns-a-usable-pair reader it used");
});

test("H2: the watcher tells the resolver WHICH kind of allow it was", () => {
  assert.match(WATCHER, /function isHumanAllow\(status\) \{\s*return String\(status \|\| ''\) === 'allowed';/,
    "`allowed` is a person clicking; `auto_allowed` is standing server-side trust");
  assert.match(WATCHER, /safeResolve\('inboundApproved', rec, \{ humanAllowed: isHumanAllow\(status\) \}\)/);
  // It is a call ARGUMENT, never stamped on the persisted record — an authority verdict
  // must not survive a restart and re-authorize a later launch from disk.
  assert.ok(!/rec\.humanAllowed/.test(WATCHER), "never persisted on the record");
});

// ── 4. THE STORAGE CONTRACT the invariant rests on ───────────────────────────

test("H2: consuming DELETES, so one arm can only ever serve one launch", () => {
  assert.match(PREFS, /function consumePermissionPreset\(channelId\)/);
  const body = PREFS.slice(PREFS.indexOf("function consumePermissionPreset("), PREFS.indexOf("function clearPermissionPreset("));
  assert.match(body, /takeArmFrom\(map, channelId, now\)/, "take-and-remove, in one step");
  assert.match(body, /writeAll\(map\)/, "and the removal is persisted");
});

test("H2: a denied or expired request CLEARS the arm rather than leaving it to age out", () => {
  const OUT = read("trigger-outcomes.js");
  for (const fn of ["inboundDenied", "inboundExpired"]) {
    const body = OUT.slice(OUT.indexOf(`async function ${fn}(`), OUT.indexOf("\n}", OUT.indexOf(`async function ${fn}(`)));
    assert.match(body, /channelPrefs\.clearPermissionPreset\(rec\.channelId\)/, fn);
  }
});

test("H2: nothing in the session path ever WRITES a posture back", () => {
  // ⚠ THE SECOND HALF LOST ITS FILE (2026-08-20, F-228; INVARIANTS §14). This used to make two
  // more assertions against `main/session-ipc.js` — that changing the axes IN-WINDOW persisted
  // nothing, and that `session:set-tool-mode` (the per-session control) still existed. That
  // module is deleted with the renderer it served, so both would have thrown on a missing file;
  // and the second has no successor at all — there is NO per-session mode control any more, the
  // posture is decided once at launch and never touched again. Asserting the absence of an
  // in-window write is meaningless when there is no window, so what stands in its place is the
  // stronger claim the original was only sampling: the WRITE side is enumerated whole.
  assert.ok(!/armPermissionPreset|setPermissionPreset/.test(stripComments(ENGINE)),
    "the engine never writes an arm");
  const writers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js") && f !== "channel-prefs.js")
    .filter((f) => /channelPrefs\.armPermissionPreset\(|\.setPermissionPreset\(/.test(stripComments(read(f))))
    .sort();
  assert.deepEqual(
    writers,
    ["channel-dir-ipc.js"],
    "exactly ONE writer, and it is the pre-launch consent surface (`channels:setPermissionPreset`) " +
      "— an arm written from anywhere on the SESSION path is a session re-arming its own future"
  );
  // The one writer is behind the app-window sender gate, not reachable from a session at all.
  const handler = read("channel-dir-ipc.js");
  assert.match(handler, /ipcMain\.handle\('channels:setPermissionPreset', appWindowOnly\(/,
    "and it is bound-sender gated like every other privileged op");
});

// ── 5. THE STARTING POSTURE IS ANNOUNCED, NOT INFERRED ───────────────────────

test("the starting posture is emitted BEFORE anything can run", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, F-228; INVARIANTS §14). This read "the WINDOW is told
  // the starting posture" and pinned the `modes` emit between `bindWindow(s);` and
  // `await startQuery(s, sdk);` — the v2.9 failure mode being a session that ENFORCED a seeded
  // posture while the header still claimed "Manual / Ask". There is no header and no
  // `bindWindow`, and that is the sharp part: `ENGINE.indexOf("bindWindow(s);")` answers -1 for
  // a deleted symbol, so `at > -1` was passing for FREE — the case had already gone vacuous and
  // was reporting as green. Re-anchored on the surface attach that replaced it.
  //
  // The emit itself is live and worth keeping: it is the ONE announcement of the posture a
  // session starts at, it rides the replay ring, and it must precede the query or the first
  // thing to read it reads a stale pair.
  assert.match(ENGINE, /emit\(s, \{ type: 'modes', tool: state\.toolMode, message: state\.messageMode \}\)/);
  const attach = ENGINE.indexOf("sessionWindowless.attachSurface(s, spec)");
  const at = ENGINE.indexOf("emit(s, { type: 'modes'");
  const start = ENGINE.indexOf("await startQuery(s, sdk);");
  assert.ok(attach !== -1 && at !== -1 && start !== -1, "all three anchors exist — a -1 makes this vacuous");
  assert.ok(at > attach, "after the surface is attached, so the replay ring carries it");
  assert.ok(at < start, "and before anything can run");
  // ⚠ AND IT MUST STATE THE STATE, NOT THE SPEC. Reading `spec.startModes` here would report a
  // posture that the parked-shell guard may have refused — the header lying in the OTHER
  // direction, which is the same class of bug the original was written for.
  const line = ENGINE.slice(at, ENGINE.indexOf("\n", at));
  assert.ok(!/startModes|armedModes/.test(line), line);
});

test("M2: a park KEEPS the posture; only the AUTH HOLD resets it", () => {
  // 2026-08-05 — INVERTED. This used to read "a park still RESETS both axes; the posture is that
  // of a WATCHED window and a park is the moment that stopped being true". Fifteen quiet minutes
  // turned out to be a poor proxy for "not watched" (see M1: an exchange blocked on the peer hit
  // it routinely), and Samuel's contract is that a posture holds for the session. The reset moved
  // to the auth hold, and the away case is answered by ending an abandoned session instead.
  // What a PRESET seeds is untouched either way: a fresh session still starts where it is told.
  const REDUCER = read("session-reducer.js");
  const idle = REDUCER.slice(REDUCER.indexOf("if (type === 'idle_timeout')"),
    REDUCER.indexOf("if (type === 'abandon_timeout')"));
  assert.doesNotMatch(idle, /toolMode: 'manual'/, "the idle park writes no posture at all");
  assert.match(idle, /resetPosture: false/);
  const hold = REDUCER.slice(REDUCER.indexOf("if (type === 'auth_hold')"), REDUCER.indexOf("if (type === 'auth_release')"));
  assert.match(hold, /toolMode: 'manual', messageMode: 'ask', inboundForTask: false/,
    "a session with no credential still hard-resets to the restrictive pair");
});
