// THE CREDENTIAL PREFLIGHT RUNS ON EVERY SPAWN SHAPE — INCLUDING SPAWN-IDLE (2026-08-22).
//
// THE DEFECT, reachable in ONE gesture from the shipped UI. `main/session-engine.js ›
// startSession` ended with four statements in this order:
//
//   1. `if (spec.parkedShell) { scheduleIdle(s); return s; }`     ← the SPAWN-IDLE lane
//   2. `if (spec.windowless && sessionAuth.holdIfNoCredential(s)) { … authHold … }`
//   3. `if (sessionAuth.holdIfNoCredential(s)) return s;`
//   4. `await startQuery(s, sdk)`
//
// (1) returned FIRST, so "New Agent" on a machine with no Claude Code sign-in answered
// `{sessionId, agentId}` — a SUCCESS — and registered an agent holding a slot against
// MAX_CONCURRENT_SESSIONS that could never start a query. `session-launch.js › launch`'s
// `{skipped:'auth-hold'}` and every refusal copy behind it (`trigger.js › AUTH_HELD_REPLY`,
// `session-ipc-ops.js`) were UNREACHABLE on the one lane an operator reaches by clicking.
//
// ⚠ SPAWN-IDLE STARTS NO QUERY, AND THAT IS NOT THE POINT. The credential question is about the
// MACHINE, not about the first turn: the whole reason the agent registers is so a later message
// can wake it, and on a signed-out Mac that wake produces a dead session with a peer waiting on
// it. Refusing at the click is the honest moment.
//
// METHOD: session-engine.js is electron-bound and has no extractable pure block, so the TAIL of
// `startSession` — the four statements above, verbatim from the shipping file — is evaluated
// against fakes. This is behaviour, not a source grep: reordering the statements back fails it.
// (test/main-audit-resume-budget.test.mjs does the same for the same function's PREAMBLE.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");

// ⚠ GUARDED SLICE (`between` throws on an inverted or missing marker) — a fail-open slice here
// would make every case below vacuously green, which is exactly the shape this file exists to
// catch. The closing statements are re-appended because the end marker is one of them.
const TAIL = between(
  ENGINE,
  "if (spec.windowless && sessionAuth.holdIfNoCredential(s))",
  "await startQuery(s, sdk);",
  "startSession's spawn tail"
) + "await startQuery(s, sdk);\n return s;";

const runTail = new Function(
  "spec", "s", "sdk", "sessionAuth", "sessions", "sessionSummary", "scheduleIdle", "diag", "startQuery",
  `return (async () => {\n${TAIL}\n})();`
);

function drive(spec, { credential }) {
  const calls = { queries: 0, idles: 0, touches: 0, holds: 0 };
  const s = { key: "k1", agentId: "a1b2c3d4", taskId: "t1", state: {} };
  const sessions = new Map([[s.key, s]]);
  const sessionAuth = {
    holdIfNoCredential(sess) {
      calls.holds += 1;
      if (credential) return false;
      sess.authHold = { kind: "preflight" }; // what the real one stamps
      return true;
    },
  };
  return runTail(
    spec, s, { __sdk: true },
    sessionAuth,
    sessions,
    { touch: () => { calls.touches += 1; } },
    () => { calls.idles += 1; },
    () => {},
    async () => { calls.queries += 1; }
  ).then((out) => ({ out, s, sessions, calls }));
}

const IDLE = { windowless: true, parkedShell: true };
const NORMAL = { windowless: true };

test("SPAWN-IDLE on a signed-out machine is REFUSED, not answered with an address", async () => {
  const r = await drive(IDLE, { credential: false });
  assert.deepEqual(r.out, { authHold: true }, "launch turns this into {skipped:'auth-hold'}");
  assert.equal(r.sessions.has("k1"), false, "the registration is rolled back — no phantom slot");
  assert.equal(r.calls.touches, 1, "…and the projection is told, so no pill survives it");
  assert.equal(r.calls.idles, 0, "no abandonment timer is armed for a session that never existed");
  assert.equal(r.calls.queries, 0);
});

test("SPAWN-IDLE on a signed-in machine still registers and still starts NOTHING", async () => {
  const r = await drive(IDLE, { credential: true });
  assert.equal(r.out, r.s, "the session object is the answer");
  assert.equal(r.sessions.has("k1"), true, "it keeps its slot");
  assert.equal(r.calls.idles, 1, "the abandonment timer IS armed — an agent nobody messages ends");
  assert.equal(r.calls.queries, 0, "…and no `claude` child is spawned to hold a prompt open");
});

test("an ORDINARY windowless launch is unchanged in both directions", async () => {
  const held = await drive(NORMAL, { credential: false });
  assert.deepEqual(held.out, { authHold: true });
  assert.equal(held.calls.queries, 0);
  const ok = await drive(NORMAL, { credential: true });
  assert.equal(ok.out, ok.s);
  assert.equal(ok.calls.queries, 1, "the query starts");
  assert.equal(ok.calls.idles, 0, "and no idle timer — the reducer arms those");
});

test("the preflight is asked BEFORE the spawn-idle return, in the shipping source", async () => {
  // The behavioural cases above are the real guard; this states the ORDER by name, so a future
  // reordering fails saying what moved rather than only that a spawn-idle spec started a query.
  assert.ok(
    orderOf(TAIL, "sessionAuth.holdIfNoCredential(s)", "if (spec.parkedShell)", "spawn tail order"),
    "the credential preflight must precede the spawn-idle early return"
  );
  // ⚠ AND THE RETURN IS STILL THERE. Moving the preflight in front of it would be no fix if the
  // idle lane had quietly started a query instead — that is the orphan shape C3/C-8 prevent.
  assert.match(TAIL, /if \(spec\.parkedShell\) \{/);
});
