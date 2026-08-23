// SHARED HARNESS for the Q6 auth-hold suites (`main/session-auth.js`'s SESSION-AUTH-HOLD block).
//
// WHY IT IS ITS OWN FILE. `session-auth-recovery.test.mjs` stood at EXACTLY 500 of the cap that
// `test/**/*.mjs` is linted under, so neither of its two subjects could gain a case — and §4
// (H1: the hold is a state the rest of the engine understands) is the half most likely to,
// because it drives the REDUCER end to end and every new wake path has to be held against it.
// Split on the seam INVARIANTS §1 names — one file per reason to change — rather than at the
// moment a lint failed (F-226). Same precedent as `_session-summary-harness.mjs` /
// `_classify-harness.mjs`: the extraction machinery is shared, the cases are split by subject.
//
// ⚠ THE FAKE DISPATCH RUNS THE REAL REDUCER and applies its state, so the cases prove the hold
// actually reaches the state the rest of the engine reads (`authHeld`, `parked`) rather than
// merely that a function was called. `effects` records the effect types the hold produced,
// which is how the fail-closed teardown (denyPending -> abortQuery) is pinned end to end.
//
// ⚠ THE INJECTION SET IS WHAT THE BLOCK STILL NAMES (F-228): `claudeAuth`, `spawner` and
// `forget` are free variables it no longer references, and `runSignIn` in the return statement
// threw a ReferenceError before a single case ran — which is why SIXTEEN went red at once
// rather than the four really about deleted behaviour. `gate` replaces `cfg.signIn`:
// `deps.getSdk()` is the only await left in the resume, so that is where a re-entrancy race is
// made now.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const M = (p) => join(HERE, "..", "main", p);
export const detect = require(M("session-auth-detect.js"));
export const AUTH_SRC = readFileSync(M("session-auth.js"), "utf8");
export const ENGINE = readFileSync(M("session-engine.js"), "utf8");

export const { initialSessionState, sessionReducer } = loadReducer();

export const H_BEGIN = "// ─── BEGIN SESSION-AUTH-HOLD";
export const H_END = "// ─── END SESSION-AUTH-HOLD";
export const HOLD_BLOCK = AUTH_SRC.slice(AUTH_SRC.indexOf(H_BEGIN), AUTH_SRC.indexOf(H_END));

// H1: the fake dispatch runs the REAL reducer and applies its state, so these tests prove the
// hold actually reaches the state the rest of the engine reads (`authHeld`, `parked`) rather
// than just that a function was called. `effects` records the effect types the hold produced, which
// is how the fail-closed teardown (denyPending -> abortQuery) is pinned end to end.
// ⚠ THE INJECTION SET SHRANK TO WHAT THE BLOCK STILL NAMES (F-228): `claudeAuth`, `spawner` and
// `forget` are free variables it no longer references, and `runSignIn` in the return statement threw
// a ReferenceError before a single case ran — which is why SIXTEEN went red at once rather than the
// four really about deleted behaviour. `gate` replaces `cfg.signIn`: `deps.getSdk()` is the only
// await left in the resume, so that is where a re-entrancy race is made now.
export function harness(over = {}) {
  const cfg = { usable: false, gate: null, ...over };
  const calls = { emit: [], dispatch: [], effects: [], startQuery: [], denyPending: [], phase: [], sdk: 0 };
  const state = { usable: cfg.usable };
  const deps = {
    getSdk: async () => { calls.sdk += 1; if (cfg.gate) await cfg.gate; return { __sdk: true }; },
    startQuery: async (s, sdk) => calls.startQuery.push({ s, sdk }),
    dispatch: (s, ev) => {
      calls.dispatch.push(ev);
      const next = sessionReducer(s.state, ev);
      s.state = next.state;
      for (const e of next.effects) calls.effects.push(e.type);
    },
    emit: (s, payload) => calls.emit.push(payload),
    denyPending: (s, message) => calls.denyPending.push(message),
  };
  // ⚠ `floorWindowlessMessage` JOINED THE INJECTED SET ON 2026-08-22 (F-236's last hole). The
  // AUTH HOLD is the one park that RESETS the posture, so `resumeAfterSignIn` has to put AXIS B's
  // windowless floor back or a recovered session comes back at `ask` on a shape with no accept
  // surface — and `session-gate.js › enqueue` then holds the peer's next reply with no drain left
  // to release it. The REAL rule is injected rather than a stub: it is pure, and it is the
  // behaviour these cases are about.
  const api = new Function(
    "deps", "detect", "store", "diag", "credentialState", "floorWindowlessMessage",
    `${HOLD_BLOCK}\n return { holdIfNoCredential, holdIfAuthFailure, holdIfAuthMessage, resumeAfterSignIn };`
  )(deps, detect, { setRecordPhase: (key, phase) => calls.phase.push({ key, phase }) }, () => {},
    () => ({ usable: state.usable, source: state.usable ? "cli-store" : null }),
    require(M("session-profiles.js")).floorWindowlessMessage);
  return { ...api, calls, state };
}

// A REAL initial state (not a three-field stub): the hold flows through the reducer, so the fields it
// sets have to be the ones wakeEffects / inboundAutoAccepted actually read. ⚠ `win: null` and no
// `windowHidden` — agents run WINDOWLESS (F-228). The fake carried a `show()` counter (the preflight
// surfaced a hidden window); one that still answered it would hide a re-added paint.
export const session = (over = {}) => ({
  key: "c1:t1", sessionId: "s1", side: "responder", profile: "read_only", mode: "interactive",
  channelId: "c1", taskId: "t1", context: { channelName: "Ops" }, counterpartyName: "David",
  state: initialSessionState({ mode: "interactive", side: "responder" }),
  win: null, settled: false, firstTurn: "FRAMED FIRST TURN", ...over,
});
