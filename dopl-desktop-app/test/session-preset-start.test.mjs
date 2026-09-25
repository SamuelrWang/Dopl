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
// ⚠ THIS FILE IS THE READ SIDE SINCE 2026-09-22 (§2, the 500-line cap). H2's WRITE half —
// "nothing on the session path ever writes a posture back", which is a census of `main/` and
// changes when a module joins or leaves it — is `session-posture-writers.test.mjs`, and the
// machinery both suites read `main/` through is `_session-preset-harness.mjs`. Nothing was
// thinned in the move; the pointer where §4 stood says what went and why.
//
// ONE CALLER supplies a posture today, and the census in §2 is the authority on that:
// session-ipc-ops.js (`sessions:launch`, the operator's own click on the Agents tab, reading the
// durable record). trigger.js still APPEARS in that census — it names the key — but what it
// hands in is a pinned `manual`; the case says so.

// ⚠ THE MACHINERY IS SHARED SINCE THE 2026-09-22 §2 SPLIT: the shipped sources, the reducer
// and `stripComments` live in `_session-preset-harness.mjs`, so this suite and
// `session-posture-writers.test.mjs` measure ONE read of `main/` and one meaning of "the code
// says". That file's docblock carries the read-side/write-side seam.
import {
  test, assert, read, ENGINE, LAUNCH, PARK, TRIGGER, CONTEXT, PREFS, DIRIPC, CHANIPC,
  initialSessionState, WIDE, stripComments, startedStateFor,
} from "./_session-preset-harness.mjs";
import { between, fnOf } from "./helpers/source-probe.mjs";

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
  const state = startedStateFor(spec);
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
  const head = between(ENGINE, "const armedModes = spec.startModes;", "const context = { ...(spec.context || {})");
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
  const body = fnOf(PARK, "startResume");
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
  const body = fnOf(LAUNCH, "launchRequesterSession");
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
  const body = fnOf(TRIGGER, "launchResponderSession");
  assert.match(body, /startModes: \{ tools: registry\.capability\.narrowestToolMode\(registry\.descriptorFor\(runtimeId\)\), messages: 'ask' \}/,
    "pinned to THIS runtime's most restrictive member, not merely absent");
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
  const body = fnOf(DIRIPC, "launchFromButton");
  assert.match(body, /channelPrefs\.launchStartModes\(p\.channelId, runtimeId\)/, "consumed here, on the LAUNCH runtime's record (C1)");
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
  const body = fnOf(TRIGGER, "launchResponderSession");
  assert.match(body, /startModes: \{ tools: registry\.capability\.narrowestToolMode\(registry\.descriptorFor\(runtimeId\)\), messages: 'ask' \}/,
    "the tool axis is the runtime's most restrictive member for anything a peer can trigger");
  assert.ok(!/getLaunchPosture|launchStartModes/.test(stripComments(body)),
    "a peer-driven launch must not inherit a setting the operator left on a tab");
});

test("H2/split: ONE windowless message floor — the launch read defers to session-profiles", () => {
  assert.match(PREFS, /function launchStartModes\(channelId, runtimeId\)/);
  assert.match(PREFS, /require\('\.\/session-profiles'\)\.floorWindowlessMessage\(p\.messages\)/);
  assert.ok(!/function windowlessMessageMode/.test(PREFS), "no second spelling of the floor");
});

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

// ── 4. THE STORAGE CONTRACT the invariant rests on → `session-posture-writers.test.mjs` ─
// ⚠ MOVED WHOLE ON 2026-09-22 (§2, the 500-line cap), not deleted and not thinned: the WRITE
// side of H2 — "nothing on the session path ever writes a posture back" — is a CENSUS of
// `main/` (the posture writers, the new-channel seed and its reachability, the defaults
// readers, the deleted `setChannelRuntime`), and it goes red when a MODULE joins or leaves it
// rather than when a spawn path changes. That is its own reason to change, so it is its own
// file; the two ⚠ excision blocks recording what the ARM took with it in 2026-08-20 travelled
// with it verbatim. Everything left in THIS file is the read side.


test("M2: a park KEEPS the posture; only the AUTH HOLD resets it", () => {
  // 2026-08-05 — INVERTED. This used to read "a park still RESETS both axes; the posture is that
  // of a WATCHED window and a park is the moment that stopped being true". Fifteen quiet minutes
  // turned out to be a poor proxy for "not watched" (see M1: an exchange blocked on the peer hit
  // it routinely), and Samuel's contract is that a posture holds for the session. The reset moved
  // to the auth hold, and the away case is answered by ending an abandoned session instead.
  // What a PRESET seeds is untouched either way: a fresh session still starts where it is told.
  const REDUCER = read("session-reducer.js");
  const idle = between(REDUCER, "if (type === 'idle_timeout')", "if (type === 'abandon_timeout')");
  assert.doesNotMatch(idle, /toolMode: 'manual'/, "the idle park writes no posture at all");
  assert.match(idle, /parkEffects\(\{ armAbandon: true \}\)/);
  const hold = between(REDUCER, "if (type === 'auth_hold')", "if (type === 'auth_release')");
  assert.match(hold, /toolMode: toolModesOf\(state\)\[0\], messageMode: MESSAGE_MODES\[0\], inboundForTask: false/,
    "a session with no credential still hard-resets to the restrictive pair, in ITS runtime's words");
});
