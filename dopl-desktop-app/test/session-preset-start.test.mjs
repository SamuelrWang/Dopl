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
// ⚠ WHAT MOVED LATER THE SAME DAY (Samuel's ruling — THE SINGLE-USE ARM IS DELETED). The
// invariant is untouched AGAIN, and this time the mechanism it was measured through is what went:
//   · THE ARM — single use, 30-minute TTL, consumable only by the consent-APPROVED launch — is
//     gone entirely (`consumePermissionPreset`, `clearPermissionPreset`, `armPermissionPreset`,
//     `PRESETS_KEY`, both IPC ops). It was deleted because its web controls had ALREADY stopped
//     rendering at the 2026-08-18 consent rewrite and nobody noticed (F-233): an arm nothing can
//     arm is a store key, not a safety mechanism.
//   · So §3's one-consumer case, §4's two storage cases and the watcher's `humanAllowed` case had
//     no subjects. §3 and the watcher case are REWRITTEN onto what replaced them (no consumer at
//     all, and the surviving `isHumanAllow` reading); §4's two are excised with a ⚠ block, because
//     what they enforced is now true BY CONSTRUCTION rather than by a check.
//
// ⚠ AND THE DIRECTION IS THE SAFE ONE, WHICH IS WHY THIS IS NOT A WEAKENING. H2's rule was "a
// stored pair may only apply to a launch a human is approving in that moment". A peer-triggered
// launch now gets NO stored pair: `inboundApproved` pins `const startModes = null;` and the tool
// axis floors at the reducer's `manual`. "At most one, and only for a human" became "none".
//
// ONE CALLER supplies a posture today, and the census in §2 is the authority on that:
// channel-dir-ipc.js (`sessions:launch`, the operator's own click on the Agents tab, reading the
// durable record). trigger.js still APPEARS in that census — it names the key — but what it
// hands in is null; the case says so.

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
// ⚠ REPOINTED 2026-08-20 (F-226): `sessions:launch` moved to `session-ipc-ops.js` when
// `channel-dir-ipc.js` was split off the 500-line cap. The record's ONE consumer did not
// change — only the file it lives in. `channel-dir-ipc.js` is still read below, because the
// "and by nothing else" half must keep covering the half that stayed.
const DIRIPC = read("session-ipc-ops.js");
const CHANIPC = read("channel-dir-ipc.js");

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

test("H2: the consent-approved launch consumes NOTHING, and carries no posture at all", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This was
  // "exactly ONE place in main/ consumes the arm, and it is the consent-approved launch". It
  // sliced `inboundApproved` and pinned three things: `channelPrefs.consumePermissionPreset(entry.channel.id)`
  // was called there, that it happened ONLY under `meta && meta.humanAllowed === true` (standing
  // trust — `auto_allowed` — consumed nothing, because H2's rule is that a stored pair may only
  // apply to a launch a human is approving IN THAT MOMENT), and that the result was handed to
  // the launch. Then it asserted no other module consumed one.
  //
  // The single-use ARM is deleted. `inboundApproved` now reads `const startModes = null;`, the
  // watcher no longer passes `humanAllowed`, and `consumePermissionPreset` does not exist.
  //
  // ⚠ THE RULE MOVED IN THE SAFE DIRECTION AND IS ASSERTED IN ITS NEW, STRONGER FORM. "At most
  // one consumer, and only for a human decision" has become "NO consumer, and no posture at
  // all": a peer-triggered launch inherits the reducer's `manual`, the most restrictive value,
  // and there is no stored pair on this path for a future edit to widen. The census in §2 is
  // what keeps that true across the tree; this case pins the lane itself, because the lane is
  // where a peer's request meets the operator's stored preferences and it must keep meeting
  // none of them.
  const body = TRIGGER.slice(TRIGGER.indexOf("async function inboundApproved("), TRIGGER.indexOf("async function launchResponderSession("));
  assert.ok(body.length > 0, "the resolver still exists — an empty slice passes every negative below");
  assert.match(body, /const startModes = null;/, "pinned null, not merely absent");
  assert.match(body, /startModes/, "…and still handed to the launch, so the seam stays visible");
  const code = stripComments(body);
  assert.ok(!/channelPrefs\.|consumePermissionPreset|getLaunchPosture|launchStartModes/.test(code),
    "the approval path reaches the prefs store on NO path — an ambient read here IS H2");
  assert.ok(!/humanAllowed/.test(code),
    "and no authority verdict is read: nothing depends on the allowed/auto_allowed distinction now");
  // Nowhere else in the tree either — the arm's whole API is gone, not merely unused.
  for (const [name, src] of [["session-engine", ENGINE], ["session-park", PARK], ["channel-context", CONTEXT]]) {
    assert.ok(!/consumePermissionPreset|armPermissionPreset|getPermissionPreset/.test(src),
      `${name} must not reach the deleted arm API`);
  }
  // CODE only: `channel-prefs.js`'s header explains at length what the arm was and why it went
  // (the ⚠ block §14 asks for), so a whole-source scan would fail on the excision note itself.
  assert.ok(!/consumePermissionPreset|armPermissionPreset|getPermissionPreset|clearPermissionPreset/.test(stripComments(PREFS)),
    "channel-prefs.js no longer defines it, so a caller anywhere would be a ReferenceError");
});

// ── 3b. THE DURABLE POSTURE'S ONE CONSUMER (2026-08-20) ──────────────────────
// The split WAS: the ARM single-use / expiring / consent-only, and a SECOND durable record
// serving the one launch shape where the operator's own click is the decision.
//
// ⚠ THE ARM'S HALF IS DELETED (Samuel's ruling, the same day the split landed), so this record
// is the only one left. That changes nothing about what these cases pin. H2 is not about
// durability — it is about an AMBIENT read at a spawn nobody is attending — so the rule is the
// CONSUMER COUNT, which is what actually kept the failure closed. It is ONE. If this record ever
// gains a second reader, H2 is re-openable and these are the tests that must go red first.

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
  // ⚠ AND THE HALF THE SPLIT LEFT BEHIND (2026-08-20, F-226). `channel-dir-ipc.js` keeps the
  // `channels:getLaunchPosture` DISCLOSURE — the Settings tab reading back what it wrote — and
  // that is not a consumer: nothing spawns from it. What it must never regain is the SPAWN
  // read, `launchStartModes`, which is the call that turns a stored record into a session.
  assert.ok(!/launchStartModes/.test(stripComments(CHANIPC)),
    "channel-dir-ipc.js discloses the posture but must never spawn from it");
});

test("H2/split: the RESPONDER lane reads NO stored record, and its tool axis floors at manual", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20; INVARIANTS §14). This read "the RESPONDER lane still
  // consumes the arm, and never the posture" — the split's positive half, that a peer-driven
  // launch took the ARM's tool axis and never the durable one. The arm is deleted, so the
  // positive half has no subject.
  //
  // ⚠ THE NEGATIVE HALF IS THE WHOLE POINT AND IT IS UNCHANGED: a peer-driven launch must not
  // inherit a setting the operator left on a tab. That is what separates the two lanes, and with
  // one record left it is the ONLY thing separating them — so it matters more, not less. The
  // `startModes && startModes.tools` expression survives with `startModes` pinned null upstream,
  // which is why the FLOOR is asserted rather than the read: `|| 'manual'` is what a peer's
  // request actually gets, and it is the most restrictive member.
  const body = TRIGGER.slice(TRIGGER.indexOf("async function launchResponderSession("));
  assert.match(body, /startModes: \{ tools: \(startModes && startModes\.tools\) \|\| 'manual', messages \}/,
    "the tool axis floors at manual for anything a peer can trigger");
  assert.ok(!/getLaunchPosture|launchStartModes/.test(stripComments(body)),
    "a peer-driven launch must not inherit a setting the operator left on a tab");
  // ⚠ THE `startModes` PARAMETER STAYS EVEN THOUGH ITS ONE CALLER NOW PASSES null, and it is
  // asserted rather than left implicit: the REQUESTER lane still passes a real value into the
  // SHARED message derivation below, and one derivation with two inputs is the design. Scrubbing
  // the parameter here is how the two lanes get two answers again.
  assert.match(body, /channelPrefs\.windowlessMessageMode\(\s*entry\.channel\.id,\s*startModes && startModes\.messages\s*\)/);
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

test("H2: the allowed/auto_allowed reading SURVIVES the arm, exported and uncalled", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This read "the
  // watcher tells the resolver WHICH kind of allow it was" and pinned
  // `safeResolve('inboundApproved', rec, { humanAllowed: isHumanAllow(status) })`. The
  // distinction existed for ONE reason — only a live human decision could consume the
  // single-use arm — and with the arm deleted `processRecord` no longer passes it.
  //
  // ⚠ `isHumanAllow` IS DELIBERATELY KEPT, EXPORTED, WITH NO PRODUCTION CALLER, and that is
  // exactly the shape that gets deleted as dead code by the next person tidying up — so it is
  // pinned here rather than left to a comment. The server still makes the distinction and this
  // is the ONE statement of how to read it; the next thing that needs "was a human looking at
  // this" must import it instead of re-deriving it from a status string.
  assert.match(WATCHER, /function isHumanAllow\(status\) \{\s*return String\(status \|\| ''\) === 'allowed';/,
    "`allowed` is a person clicking; `auto_allowed` is standing server-side trust");
  assert.match(WATCHER, /isHumanAllow,/, "still exported, or the next caller cannot reach it");
  // ⚠ AND IT MUST NOT HAVE QUIETLY RE-ACQUIRED ONE. A verdict flowing again without the review
  // that removing it got is the same class of drift in the other direction.
  const code = stripComments(WATCHER);
  assert.ok(!/humanAllowed/.test(code), "no authority verdict is passed to any resolver");
  // It was always a call ARGUMENT and never stamped on the persisted record — an authority
  // verdict must not survive a restart and re-authorize a later launch from disk. Still true,
  // now trivially, and kept because the storage shape is what made it safe.
  assert.ok(!/rec\.humanAllowed/.test(WATCHER), "never persisted on the record");
});

// ── 4. THE STORAGE CONTRACT the invariant rests on ───────────────────────────
//
// ⚠ TWO CASES STOOD HERE AND ARE DELETED WITH THE ARM (2026-08-20, Samuel's ruling):
//   · "H2: consuming DELETES, so one arm can only ever serve one launch" — it sliced
//     `channel-prefs.js › consumePermissionPreset` and pinned `takeArmFrom(map, channelId, now)`
//     (take-and-remove in ONE step, so a second launch could not find the same pair) and
//     `writeAll(map)` (the removal persisted, so a restart could not resurrect it).
//   · "H2: a denied or expired request CLEARS the arm rather than leaving it to age out" — it
//     pinned `channelPrefs.clearPermissionPreset(rec.channelId)` inside BOTH `inboundDenied` and
//     `inboundExpired`, so a posture armed for a request the operator then refused or ignored
//     could not survive into the NEXT launch on that channel.
// Neither function exists. `trigger-outcomes.js` no longer requires `channel-prefs` at all,
// which `test/consent-local-expiry.test.mjs` asserts as an absence so a regrowth cannot be a
// one-line edit.
//
// ⚠ WHAT THOSE TWO ENFORCED IS NOW TRUE BY CONSTRUCTION, WHICH IS WHY THEY ARE NOT REPOINTED.
// They existed to stop a stored pair reaching a launch nobody approved. An inbound request now
// carries NO stored pair — `startModes` is pinned null and the tool axis floors at `manual` —
// so there is nothing to spend, nothing to expire and nothing to clear. The DURABLE record has
// no consume twin by design (`channel-launch-posture.test.mjs` asserts none has appeared), and
// the write side is enumerated whole below.

test("H2: nothing in the session path ever WRITES a posture back", () => {
  // ⚠ THIS CASE HAS NOW LOST BOTH ITS ORIGINAL SUBJECTS AND KEPT ITS RULE, TWICE (INVARIANTS §14).
  // It began as two assertions against `main/session-ipc.js` — that changing the axes IN-WINDOW
  // persisted nothing, and that `session:set-tool-mode` still existed. That module went with the
  // renderer it served (F-228), and there is NO per-session mode control any more: the posture is
  // decided once at launch and never touched again. So it became an enumeration of every writer
  // of an ARM — and on 2026-08-20 the arm went too, taking `armPermissionPreset` and
  // `channels:setPermissionPreset` with it.
  //
  // ⚠ THE RULE IS THE ENUMERATION, NOT THE RECORD IT ENUMERATES. "A session must not re-arm its
  // own future" is what this pins, and it re-points cleanly onto the DURABLE posture, which is
  // now the only writable permission record on the machine. If anything on the session path ever
  // writes one, a session can widen the posture its own next launch starts at — which is the
  // v3.1 failure H2 was filed for, arriving by a different door.
  assert.ok(!/setLaunchPosture|setAutoSend/.test(stripComments(ENGINE)),
    "the engine never writes a posture");
  const writers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js") && f !== "channel-prefs.js")
    .filter((f) => /channelPrefs\.setLaunchPosture\(|\.setLaunchPosture\(/.test(stripComments(read(f))))
    .sort();
  assert.deepEqual(
    writers,
    ["channel-dir-ipc.js"],
    "exactly ONE writer, and it is the Settings tab's own control (`channels:setLaunchPosture`) " +
      "— a posture written from anywhere on the SESSION path is a session re-arming its own future"
  );
  // The one writer is behind the app-window sender gate, not reachable from a session at all.
  const handler = read("channel-dir-ipc.js");
  assert.match(handler, /ipcMain\.handle\('channels:setLaunchPosture', appWindowOnly\(/,
    "and it is bound-sender gated like every other privileged op");
  // ⚠ AND THE ARM'S WRITER IS GONE FROM THE WIRE, not merely unused: a registered op with no
  // storage behind it is worse than either half alone.
  assert.ok(!/channels:setPermissionPreset|channels:getPermissionPreset/.test(stripComments(handler)),
    "the arm's two handlers are deleted, so no session or page can reach them");
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
