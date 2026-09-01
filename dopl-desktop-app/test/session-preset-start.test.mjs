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
// launch gets NO stored pair: the tool axis is pinned to the reducer's own `manual`. "At most
// one, and only for a human" became "none".
//
// ⚠ AND WHAT MOVED ON 2026-08-22 (Samuel's INBOUND CONSENT RETIREMENT). Once more the invariant
// is untouched and the MECHANISM it was measured through is what went: `trigger.js ›
// inboundApproved` — the consent-APPROVED responder launch, the lane every H2 argument in this
// file was framed around — is deleted with the inbound consent row, the watcher that polled it
// and the resolvers it dispatched. A peer's ask raises a NOTIFICATION whose button calls
// `launchResponderSession` directly. §3 is rewritten onto that lane, and the
// `allowed`/`auto_allowed` case is excised with its module (see the ⚠ block where it stood).
//
// ONE CALLER supplies a posture today, and the census in §2 is the authority on that:
// session-ipc-ops.js (`sessions:launch`, the operator's own click on the Agents tab, reading the
// durable record). trigger.js still APPEARS in that census — it names the key — but what it
// hands in is a pinned `manual`; the case says so.

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
const LAUNCH = read("session-launch.js"); // the spawn funnel, split off the engine 2026-08-21
const PARK = read("session-park.js");
const TRIGGER = read("trigger.js");
const CONTEXT = read("channel-context.js");
const PREFS = read("channel-prefs.js");
// ⚠ REPOINTED 2026-08-20 (F-226): `sessions:launch` moved to `session-ipc-ops.js` when
// `channel-dir-ipc.js` was split off the 500-line cap. The record's ONE consumer did not
// change — only the file it lives in. `channel-dir-ipc.js` is still read below, because the
// "and by nothing else" half must keep covering the half that stayed.
// ⚠ REPOINTED AGAIN 2026-08-22 (the agent-templates wave): the `sessions:launch` BODY moved
// to `main/session-launch-op.js` in a §1 split, so the DURABLE POSTURE READ this file is a
// census of moved with it. `session-ipc-ops.js` still registers the op.
const DIRIPC = read("session-launch-op.js");
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

test("H2: startResume (the crash/interrupted resume) passes NO startModes either", () => {
  const body = PARK.slice(PARK.indexOf("async function startResume("), PARK.indexOf("async function resume("));
  assert.ok(body.includes("deps.startSession("), "startResume really spawns");
  // ⚠ CODE ONLY SINCE 2026-08-22. The resume now passes `windowless: true` and its comment says
  // OUT LOUD that it is still not handing in a posture — which a whole-source scan read as the
  // violation. The rule is about the CALL, and the annotation explaining why is exactly what §14
  // asks for beside a change like this.
  assert.ok(!/startModes/.test(stripComments(body)), "a resume is not a fresh human decision");
  // ⚠ AND THE THING IT DOES NOW PASS IS NOT ONE. `windowless: true` is a fact about the SHAPE —
  // no accept surface — and what it buys is the AXIS B FLOOR at the construction site, which is
  // supervision widening in the safe direction. Before it, a crash-resumed responder came back at
  // the reducer's `ask` and `session-gate.js › enqueue` held the peer's next reply forever.
  assert.match(stripComments(body), /windowless: true,/);
  assert.ok(!/getLaunchPosture|launchStartModes|channelPrefs/.test(stripComments(body)),
    "…and it still reaches no stored record of any kind");
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
  // ⚠ IT MOVED FILES 2026-08-21, NOT MEANING: the funnel split off the engine at the §2 cap.
  const body = LAUNCH.slice(LAUNCH.indexOf("function launchRequesterSession("), LAUNCH.indexOf("function hasLiveSession("));
  assert.ok(!/startModes/.test(body), "the lane wrapper neither reads nor defaults one");
  for (const src of [ENGINE, LAUNCH]) {
    assert.ok(!/channel-prefs|channelPrefs/.test(stripComments(src)),
      "and neither the engine nor the funnel reaches the prefs store on any path");
  }
});

// ── 3. THE ONE CONSUMER ──────────────────────────────────────────────────────

test("H2: the peer-triggered launch consumes NOTHING, and carries no stored posture at all", () => {
  // ⚠ REWRITTEN TWICE, NEVER REMOVED (INVARIANTS §14). It began as "exactly ONE place in main/
  // consumes the arm, and it is the consent-approved launch": it sliced `inboundApproved` and
  // pinned `channelPrefs.consumePermissionPreset(entry.channel.id)`, that it ran ONLY under
  // `meta.humanAllowed === true` (standing trust — `auto_allowed` — consumed nothing, because
  // H2's rule is that a stored pair may only apply to a launch a human is approving IN THAT
  // MOMENT), and that the result reached the launch.
  //
  // The single-use ARM went on 2026-08-20 and `inboundApproved` itself went on 2026-08-22 with
  // the inbound consent lane. ⚠ THE LANE DID NOT: a peer's ask still ends in a windowless
  // responder session on this machine, and that spawn is still where a peer's request meets the
  // operator's stored preferences. It must keep meeting none of them, so the case follows the
  // lane to its new entry point rather than being deleted with the resolver's name.
  //
  // ⚠ THE RULE MOVED IN THE SAFE DIRECTION AND IS ASSERTED IN ITS STRONGEST FORM YET. "At most
  // one consumer, and only for a human decision" is now "NO consumer, and a LITERAL most-
  // restrictive value": there is no stored pair on this path at all for a future edit to widen.
  const body = TRIGGER.slice(TRIGGER.indexOf("async function launchResponderSession("));
  assert.ok(body.length > 0, "the lane still exists — an empty slice passes every negative below");
  assert.match(body, /startModes: \{ tools: 'manual', messages \}/,
    "pinned to the most restrictive member, not merely absent");
  const code = stripComments(body);
  assert.ok(!/channelPrefs\.getLaunchPosture|channelPrefs\.launchStartModes|consumePermissionPreset/.test(code),
    "the peer-triggered path reaches no stored posture on ANY path — an ambient read here IS H2");
  assert.ok(!/humanAllowed/.test(code),
    "and no authority verdict is read: nothing depends on the allowed/auto_allowed distinction now");
  // ⚠ AND THE ENTRY POINT IS A NOTIFICATION BUTTON, WHICH IS WHY THERE IS NO SECOND DECISION TO
  // CARRY A POSTURE ON. `handleTrigger` raises the banner and returns; the LAUNCH action calls
  // this function. If a future edit gives that banner a posture control, it lands here.
  const trigCode = stripComments(TRIGGER);
  assert.ok(!/createConsentRequest\(/.test(trigCode), "no inbound consent row is created");
  assert.match(trigCode, /actionText: 'Launch agent'/, "the button LAUNCHES; it approves nothing");
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
  // ⚠ THE BODY IS THE WHOLE FILE NOW (2026-08-22). `main/session-launch-op.js` IS the launch
  // handler's body — one function, one lane — so there is no longer a sibling handler to slice
  // away from. That is a strictly tighter assertion than the old prefix slice: a stray
  // `launchStartModes` anywhere in this module is still the only read, and there is nothing
  // else in it for one to hide behind.
  const body = DIRIPC.slice(DIRIPC.indexOf("async function launchFromButton("));
  assert.match(body, /channelPrefs\.launchStartModes\(p\.channelId\)/, "consumed here");
  assert.equal(stripComments(DIRIPC).match(/launchStartModes/g).length, 1, "read exactly once");
  // ...and the pinned 'manual' it replaced is really gone from this handler.
  assert.ok(!/tools: 'manual'/.test(body), "the hard-pinned tool axis that ignored the operator's pick is gone");
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
  // ⚠ REWRITTEN TWICE (INVARIANTS §14). This read "the RESPONDER lane still consumes the arm, and
  // never the posture" — the split's positive half, that a peer-driven launch took the ARM's tool
  // axis and never the durable one. The arm went 2026-08-20; the `startModes && startModes.tools`
  // plumbing that survived it went 2026-08-22, when the inbound consent lane took its ONE caller
  // (`inboundApproved`, which pinned `const startModes = null;`) with it. A parameter whose only
  // producer passed null is a seam nobody can read, so the value is spelled where it applies.
  //
  // ⚠ THE NEGATIVE HALF IS THE WHOLE POINT AND IT IS UNCHANGED: a peer-driven launch must not
  // inherit a setting the operator left on a tab. That is what separates the two lanes, and with
  // one record left it is the ONLY thing separating them — so it matters more, not less.
  const body = TRIGGER.slice(TRIGGER.indexOf("async function launchResponderSession("));
  assert.match(body, /startModes: \{ tools: 'manual', messages \}/,
    "the tool axis is the most restrictive member for anything a peer can trigger");
  assert.ok(!/getLaunchPosture|launchStartModes/.test(stripComments(body)),
    "a peer-driven launch must not inherit a setting the operator left on a tab");
  // ⚠ THE `picked` PARAMETER OF THE SHARED DERIVATION STAYS, and this lane passes an EXPLICIT
  // null rather than omitting it: the REQUESTER lane still passes a real value, and one
  // derivation with two inputs is the design. An omitted argument reads as an oversight; a
  // written `null` reads as "this lane has no pick", which is the fact.
  assert.match(body, /channelPrefs\.windowlessMessageMode\(entry\.channel\.id, null\)/);
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

// ⚠ "H2: the allowed/auto_allowed reading SURVIVES the arm, exported and uncalled" STOOD HERE AND
// IS DELETED (2026-08-22, Samuel's INBOUND CONSENT RETIREMENT). It pinned
// `consent-watcher.js › isHumanAllow` — `String(status) === 'allowed'` — kept exported with no
// production caller, as the ONE statement of how to tell a person clicking Allow from the
// server's standing trust (`auto_allowed`), so the next thing needing "was a human looking at
// this" would import it rather than re-derive it from a status string. It also asserted the
// verdict had not quietly re-acquired a caller, and was never stamped on a persisted record.
//
// ⚠ IT IS EXCISED RATHER THAN REPOINTED BECAUSE BOTH ENDS ARE GONE, and the deletion is the
// answer to the question it was preserving: `agent_trust_rules` is INBOUND-ONLY and has never
// fired — zero `auto_allowed` rows in the table's history — so the distinction it was the one
// statement of has no live producer, and `consent-watcher.js` is deleted whole. A statement of
// how to read a value nothing can set is the same hazard as dead COPY: it is what a future
// wiring reuses without re-reading. `test/removed-vocabulary.test.mjs` now refuses the module
// name, which is the guard that replaces this one.

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
// Neither function exists, and neither does `trigger-outcomes.js`'s dependency on
// `channel-prefs` (⚠ the absence used to be asserted by `test/consent-local-expiry.test.mjs`,
// which is deleted 2026-08-22 with the watcher it drove; the writer census below is what still
// refuses a regrowth, and it scans the whole of main/ rather than one file).
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
  const start = ENGINE.indexOf("await startQuery(s, rt);");
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
