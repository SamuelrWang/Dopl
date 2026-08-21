// WHAT A SPAWN STARTS ITS TWO AXES ON — the surviving half of "THE POSTURE DOESN'T STICK"
// (2026-08-02), rewritten down on 2026-08-20 when the v1 session window went (F-228).
//
// The file was about FOUR defects behind one operator complaint. THREE of them were about the
// PRE-CONSENT CARD — its two selects, the IPC that stored their picks on that card's registry
// entry, and the single-use arm startSession consumed at launch — and that whole surface is
// deleted. What is left is the one rule that never needed the card, and it is now the WHOLE
// rule:
//
//   A SESSION STARTS AT manual/ask UNLESS A CALLER HANDS IN A POSTURE, AND A PARKED SHELL
//   REFUSES EVEN THAT UNLESS AN EXPLICIT `operatorArmed` SAYS A HUMAN CHOSE IT JUST NOW.
//
//   FIX 3   THE IDLE TIMER measured time since the last turn ENDED, not idleness. Moved WHOLE
//           to test/session-idle-bounds.test.mjs on 2026-08-05 (§4 below); untouched by F-228.
//   FIX 4   A PARKED SHELL COULD NEVER BE ARMED — startSession discarded startModes for any
//           parkedShell. The fix is the `operatorArmed === true` branch, and §3 below is the
//           ONLY place in the suite that drives it. See the ⚠ note there before deleting it.
//
// METHOD is unchanged and is the directory idiom: slice the REAL construction site out of the
// shipped engine and DRIVE it against the REAL initialSessionState. Nothing here asserts on
// source text — what a spawn PASSES is pinned in test/session-preset-start.test.mjs, which
// owns the other side of this join (every re-applying lane hands in nothing, structurally).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const ENGINE = M("session-engine.js");

const { initialSessionState } = loadReducer();

const WIDE = { tools: "bypass", messages: "auto_both" };

// ── 1. ⚠ THE THREE SENDER SHAPES ENDED HERE — 2026-08-20, F-228 ──────────────
//
// Six tests stood here, plus the two harnesses they shared (`consentRegistry`, slicing the REAL
// `armModes`/`takeStartModes` out of main/session-consent.js, and `ipcHarness`, slicing the REAL
// `session:set-tool-mode` / `session:set-message-mode` registrations out of main/session-ipc.js).
// They drove the mode handlers from all three sender shapes — (a) a live-session sender, (b) a
// CONSENT-ONLY sender, (c) an unknown one — and pinned: the axis lands on the right registry and
// nowhere else, both axes are echoed so a select can only show what main recorded, both coerce
// fail-closed, a DECIDED card answers {ok:false} with nothing written, and a live session WINS
// over a consent entry sharing the window.
//
// ⚠ THE SURFACE IS GONE, NOT THE RULE'S SUBJECT — BOTH ENDPOINTS OF IT ARE. `main/session-ipc.js`
// and `main/session-consent.js` are deleted with the window whose selects called them; there is
// no per-session mode IPC and no consent registry left to be the second sender shape. Nothing
// renderer-reachable can move a running session's axes at all now. What DOES survive is the
// reducer underneath (`set_tool_mode` / `set_message_mode`), and it is pinned whole — coercion,
// single-axis isolation, the one `modes` echo, no drain, terminal idempotency — in
// test/session-reducer.test.mjs § "the two axes". These six cases were about the TRANSPORT.
//
// FIX L1 — the twin defect on the ANSWER those handlers returned — went the same way; see the
// matching ⚠ block in test/session-decision-truth.test.mjs, which holds its own half.

// ── 2. WHAT A SPAWN ACTUALLY STARTS WITH ─────────────────────────────────────
// The real construction site from session-engine.startSession, sliced and evaluated against the
// real initialSessionState.
//
// ⚠ THE SLICE MOVED ON 2026-08-20. It used to start at `const consentModes =
// sessionConsent.takeStartModes` — the pre-consent card read — and took `sessionConsent` as a
// free var. That read is deleted; the block now opens at `const armedModes = spec.startModes`
// and closes on the same `const context =` line, so the harness lost a parameter and nothing
// else. A renamed head must fail LOUDLY (the assert below), never slice to "".

function startedState(spec) {
  const src = ENGINE.slice(ENGINE.indexOf("const armedModes = spec.startModes;"),
    ENGINE.indexOf("const context = { ...(spec.context || {})"));
  assert.ok(src.includes("initialSessionState("), "the construction site moved — reslice it");
  return new Function("spec", "initialSessionState", "readCaps", `${src}\n return state;`)(
    spec, initialSessionState, () => ({}));
}

test("a spawn handed NO posture seeds nothing: it starts at manual/ask", () => {
  // Formerly "an UNTOUCHED card seeds nothing". There is no card; the shape it was really
  // asserting is the one that outlived it — an absent `startModes` inherits the reducer's
  // most-restrictive pair rather than anything ambient. s.state.toolMode is what
  // session-io.grantArgs hands grantDecision on the very first tool call.
  const state = startedState({ key: "ch:th", side: "responder" });
  assert.equal(state.toolMode, "manual");
  assert.equal(state.messageMode, "ask");
  assert.equal(state.allowForTask.length, 0, "a posture is still not a grant");
  assert.equal(state.inboundForTask, false);
});

// ── 2b. ⚠ FIX 1b ENDED HERE — 2026-08-20, F-228 ──────────────────────────────
//
// Five tests, the blocker of the 2026-08-02 wave. The consent registry was keyed
// sessionKey(channelId, taskId) — the SAME key recreateParkedShell, openFromChannel,
// openRequesterShell and startResume all spawned under — and startSession read it
// UNCONDITIONALLY, so a card armed but not yet accepted was spent by whichever spawn reached
// that key first. `spec.adoptsConsent === true` was the fix: exactly one spawn shape, launch()'s
// own adopt test, could spend the single-use arm. The five pinned the arm invisible to every
// peer-driven shape, taken exactly once by the adopting one, STRICT on `=== true`, the full
// reproduction (peer wake then Accept on one key), and that only ONE site in the engine set the
// flag.
//
// ⚠ THE DEFECT IS NOT FIXED, IT IS UNREACHABLE: there is no registry to spend, because there is
// no card. `sessionConsent.takeStartModes` and its `adoptsConsent` gate are both deleted from
// startSession, leaving `spec.startModes` — handed in per launch by a caller executing a
// decision a human is making right now — as the ONE source, which is the shape H2 always wanted
// and the card was the exception to. Re-introducing ANY ambient, key-scoped posture source
// re-opens all five cases; that is what this block is here to say.
//
// ⚠ AND THE FLAG'S LAST WRITER IS STILL IN THE TREE. `session-engine.js › launch` still passes
// `adoptsConsent: adoptable` on a name that no longer exists anywhere in the file. Nothing reads
// the field, so no test here can go red on it — it is a REFERENCE, filed rather than fixed
// (CLAUDE.md: the code looks wrong -> a finding, not a test edit).

// ── 3. FIX 4: the operator-armed parked shell ────────────────────────────────
// `spec.parkedShell` has no producer today — the shell-recreate lane opened a window and is
// deleted — but the BRANCH is live in startSession and is deliberately kept there (see the
// engine's own note) so a future non-window dormant shape gets the safe behaviour by default.
//
// ⚠ DO NOT DELETE THE POSITIVE CASE. It is the only test in the suite that drives
// `spec.operatorArmed === true`, and without it the negative case below cannot tell "the guard
// works" from "handed-in postures are ignored entirely" — it would stay green against a
// startSession that dropped `startModes` on the floor. test/session-preset-start.test.mjs covers
// the handed-in-posture path and the parked-shell refusal, and covers `operatorArmed` NOWHERE.

test("FIX 4: a PARKED SHELL that is explicitly OPERATOR-ARMED keeps the posture", () => {
  const state = startedState({ key: "ch:a1", parkedShell: true, startModes: WIDE, operatorArmed: true });
  assert.deepEqual({ t: state.toolMode, m: state.messageMode }, { t: "bypass", m: "auto_both" });
  assert.equal(state.parked, true, "the shell is still DORMANT — the flag widens the posture, not the lifecycle");
  assert.equal(state.phase, "parked");
});

test("FIX 4: a bare recreate / reopen / wake still starts at manual/ask", () => {
  // The shapes that reach startSession with parkedShell and no human decision. `startModes`
  // present but unarmed is the important one: passing a posture is not authority.
  for (const [label, spec] of Object.entries({
    "bare recreated shell": { key: "k", parkedShell: true },
    "recreate that somehow carries modes but no arm": { key: "k", parkedShell: true, startModes: WIDE },
    "arm flag with no modes at all": { key: "k", parkedShell: true, operatorArmed: true },
    "operatorArmed as a truthy non-true value": { key: "k", parkedShell: true, startModes: WIDE, operatorArmed: 1 },
  })) {
    const state = startedState(spec);
    assert.deepEqual({ t: state.toolMode, m: state.messageMode }, { t: "manual", m: "ask" }, label);
  }
});

// TWO MORE CASES ENDED HERE EARLIER, and both were about `session-team.js`: that it handed
// `startModes` / `operatorArmed` through to startSession instead of dropping them, and that
// `channel-deliver.agentSpec` — the PEER-DRIVEN wake — carried neither, so a room message armed
// nothing. Both modules are gone with the summoned room-bound TEAM session (channels rollback
// §1). The rule they guarded survives above and is now stated once: a parked shell starts at
// manual/ask unless something explicitly arms it.

// ── 4. FIX 3 / M1 / M2: THE IDLE TIMER ────────────────────────────────────────
// §2 SPLIT (2026-08-05): the virtual-clock section moved WHOLE to
// test/session-idle-bounds.test.mjs when M1 (an `awaiting_peer` turn is not idle) and M2 (a park
// keeps the posture; an abandoned session ends) took this file past the 500-line cap. FIX 3's
// cases went with it unchanged — one subject, one file. F-228 touched none of it: the idle timer
// never knew a window existed.
