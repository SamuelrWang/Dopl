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
// THE INVARIANT: the posture travels ONLY as an explicit `spec.startModes`, supplied by
// exactly one caller (trigger.js, on a human `allowed` consent, consuming a single-use arm).
// Every other shape passes nothing and inherits the reducer's own manual/ask.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const read = (p) => readFileSync(M(p), "utf8");
const ENGINE = read("session-engine.js");
const PARK = read("session-park.js");
const TRIGGER = read("trigger.js");
const CONTEXT = read("channel-context.js");
const PREFS = read("channel-prefs.js");
const WATCHER = read("consent-watcher.js");

const { initialSessionState } = loadReducer();

const WIDE = { tools: "bypass", messages: "auto_both" };

// ── 1. THE CONSTRUCTION SITE, driven ─────────────────────────────────────────
// The real `startSession` head: the ONE expression that decides a new session's axes,
// sliced from the shipped engine and evaluated against the real initialSessionState.
// This is what the old file should have exercised.

// FIX 1 (2026-08-02) added a SECOND, tighter source: the posture the operator picks on the
// pre-consent card itself, consumed by entry rather than by channel. `consentArm` stands in
// for that registry — null (the default) is "the card was never touched", which is every
// pre-existing case below, so all of them still drive the identical expression.
function startModesFor(spec, consentArm) {
  const src = ENGINE.slice(ENGINE.indexOf("const consentModes = sessionConsent.takeStartModes"),
    ENGINE.indexOf("const context = { ...(spec.context || {})"));
  assert.ok(src.includes("initialSessionState("), "the construction site moved — reslice it");
  const sessionConsent = { takeStartModes: () => consentArm || null };
  const state = new Function("spec", "initialSessionState", "readCaps", "sessionConsent",
    `${src}\n return state;`)(spec, initialSessionState, () => ({}), sessionConsent);
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

test("H2: a PARKED SHELL refuses a posture even if a caller hands one in", () => {
  // Defence in depth. A shell starts dormant and is woken later by something that is NOT
  // the approving human, so it must never carry a posture forward into that wake.
  assert.deepEqual(startModesFor({ mode: "interactive", side: "requester", parkedShell: true, startModes: WIDE }),
    { toolMode: "manual", messageMode: "ask" });
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

test("H2: recreateParkedShell and openFromChannel pass NO startModes to startSession", () => {
  for (const fn of ["recreateParkedShell", "openFromChannel"]) {
    const body = PARK.slice(PARK.indexOf(`async function ${fn}(`), PARK.indexOf("\n}", PARK.indexOf(`async function ${fn}(`)));
    assert.ok(body.includes("deps.startSession("), `${fn} really spawns`);
    assert.ok(!/startModes/.test(body), `${fn} must never hand in a posture`);
    assert.ok(/parkedShell: true/.test(body), `${fn} spawns a dormant shell`);
  }
});

test("H2: startResume (the crash/interrupted resume) passes NO startModes either", () => {
  const body = PARK.slice(PARK.indexOf("async function startResume("), PARK.indexOf("async function resume("));
  assert.ok(body.includes("deps.startSession("), "startResume really spawns");
  assert.ok(!/startModes/.test(body), "a resume is not a fresh human decision");
});

test("H2: the requester launch passes NO startModes (no card is ever shown for it)", () => {
  const body = ENGINE.slice(ENGINE.indexOf("function launchRequesterSession("), ENGINE.indexOf("function hasLiveSession("));
  assert.ok(!/startModes/.test(body), "the operator's own goal opens at manual/ask");
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
  assert.ok(!/armPermissionPreset|setPermissionPreset/.test(ENGINE), "the engine never writes an arm");
  assert.ok(!/armPermissionPreset|setPermissionPreset/.test(read("session-ipc.js")),
    "and changing the axes in-window persists nothing");
  assert.match(read("session-ipc.js"), /session:set-tool-mode/, "the per-session control still exists");
});

// ── 5. THE HEADER MUST NOT LIE ABOUT THE POSTURE ─────────────────────────────

test("the window is TOLD the starting posture, before anything can run", () => {
  // The renderer's selects + posture line move only on a `modes` event from main (they
  // start at manual/ask). Without this echo a session seeded with a posture would ENFORCE
  // it while the header claimed "Manual / Ask" — the v2.9 failure mode.
  assert.match(ENGINE, /emit\(s, \{ type: 'modes', tool: state\.toolMode, message: state\.messageMode \}\)/);
  const at = ENGINE.indexOf("emit(s, { type: 'modes'");
  assert.ok(at > ENGINE.indexOf("bindWindow(s);"), "after the window is bound, so the replay ring carries it");
  assert.ok(at < ENGINE.indexOf("await startQuery(s, sdk);"), "and before anything can run");
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
