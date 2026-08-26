// THE IN-APP CLAUDE CODE SIGN-IN — the RECOVERY half of Q6, wired 2026-08-25.
//
// THE BUG THIS SUITE EXISTS FOR IS AN ABSENCE, which is why it is a suite rather than a case.
// Every DETECTING part of Q6 shipped and worked: `session-auth.js › holdIfNoCredential` preflights
// a windowless launch and HOLDS it, `session-query.js` turns an auth-shaped mid-session failure
// into the same hold, and the channels composer says so in as many words. Every REMEDYING part
// shipped too — `claude-auth.js › startSignInFlow` and `session-auth.js › resumeAfterSignIn`, both
// complete, both test-covered. **Neither had a single production caller.** So a held agent could
// never be un-held: re-posting was refused with `auth-hold` forever and no dialog could ever
// appear, on a machine whose own UI was telling the operator to sign in.
//
// A test suite over either half would have stayed green through all of it. What is pinned here is
// therefore the WIRE — that the op exists, that it is bound, that it drives the flow exactly once,
// that success is measured from the CREDENTIAL rather than reported by the flow, and that the
// sessions this Mac is holding are the ones released.
//
// ⚠ THREE LAYERS, THE SAME WAY THE REST OF Q6 IS DRIVEN:
//   1. FAN-OUT — the AUTH-RESUME-FAN-OUT block of `session-auth.js`, sliced and driven with fakes
//      (it reads the engine's registry, which is why it sits outside the hold block's sentinels).
//   2. OP — `main/claude-signin-op.js`, evaluated against a stub `require` so the real ordering
//      (flow -> forget -> re-probe -> fan-out) is the thing under test.
//   3. BOUNDARY — structural reads of `session-ipc-ops.js`, plus a driven refusal proving an
//      unbound sender reaches no flow at all. The full sender-binding census is
//      `channel-ipc-sender.test.mjs`, which carries this op's row.
//
// Run: `node --test dopl-desktop-app/test/claude-signin-recovery.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evalModule, bootIpc } from "./_ipc-harness.mjs";
import { harness, session } from "./_auth-hold-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const AUTH_SRC = readFileSync(M("session-auth.js"), "utf8");
const OP_SRC = readFileSync(M("claude-signin-op.js"), "utf8");
const OPS_SRC = readFileSync(M("session-ipc-ops.js"), "utf8");

// ── 1. THE FAN-OUT: which sessions a completed sign-in releases ──────────────

const F_BEGIN = "// ─── BEGIN AUTH-RESUME-FAN-OUT";
const F_END = "// ─── END AUTH-RESUME-FAN-OUT";
const FAN_BLOCK = AUTH_SRC.slice(AUTH_SRC.indexOf(F_BEGIN), AUTH_SRC.indexOf(F_END));

/** The block, driven with an injected registry and an injected per-session resume. */
function fanOut({ sessions, resume } = {}) {
  const resumed = [];
  const api = new Function(
    "deps", "resumeAfterSignIn", "diag",
    `${FAN_BLOCK}\n return { resumeHeldSessions };`
  )(
    { sessions: sessions === undefined ? new Map() : sessions },
    async (s) => { resumed.push(s); if (resume) await resume(s); },
    () => {}
  );
  return { ...api, resumed };
}

const held = (key, over = {}) => ({ key, settled: false, authHold: { kind: "error" }, ...over });

test("the fan-out block is standalone (no electron, no fs, no require of its own)", () => {
  assert.ok(FAN_BLOCK.length > 400, "the sentinels bracket a real block");
  for (const banned of ["require(", "electron", "child_process", "fs."]) {
    assert.ok(!FAN_BLOCK.includes(banned), `AUTH-RESUME-FAN-OUT must not reference ${banned}`);
  }
});

test("it resumes EVERY held session, and only the held ones", async () => {
  // The whole point of the fan-out: one sign-in, N releases. A machine that has been signed out
  // for a while holds every agent that tried to run, and releasing one of them is the bug this
  // wire is fixing wearing a smaller hat.
  const a = held("c1:t1:a1");
  const b = held("c1:t2:b2");
  const sessions = new Map([
    ["c1:t1:a1", a],
    ["c1:t2:b2", b],
    ["c1:t3:c3", { key: "c1:t3:c3", settled: false }], // running fine, never held
  ]);
  const f = fanOut({ sessions });
  assert.equal(await f.resumeHeldSessions(), 2);
  assert.deepEqual(f.resumed, [a, b], "both held agents, in registry order, and nothing else");
});

test("a SETTLED session is never resumed, however it was holding", async () => {
  // Dead is dead (Samuel, 2026-08-22). A sign-in must not revive an agent the operator ended,
  // and `resumeAfterSignIn` on a settled session would start a query behind a closed lifecycle.
  const sessions = new Map([["c1:t1:a1", held("c1:t1:a1", { settled: true })]]);
  const f = fanOut({ sessions });
  assert.equal(await f.resumeHeldSessions(), 0);
  assert.deepEqual(f.resumed, []);
});

test("it takes the list BEFORE walking it — a resume that spawns cannot hide a peer", async () => {
  // `resumeAfterSignIn` mutates the sessions it releases and `steer` can wake one, so iterating
  // the live Map while that happens is how a held session comes to be skipped. Registering a new
  // session mid-walk is the sharpest version of that, and it must not change this call's answer.
  const a = held("c1:t1:a1");
  const b = held("c1:t2:b2");
  const sessions = new Map([["c1:t1:a1", a], ["c1:t2:b2", b]]);
  const f = fanOut({
    sessions,
    resume: (s) => { if (s === a) sessions.set("c1:t9:z9", held("c1:t9:z9")); },
  });
  assert.equal(await f.resumeHeldSessions(), 2, "the two that were held when the sign-in landed");
  assert.deepEqual(f.resumed.map((s) => s.key), ["c1:t1:a1", "c1:t2:b2"]);
});

test("ONE session's failure does not strand the ones behind it", async () => {
  // A resume awaits `getSdk()` and starts a query. A machine-level failure on the first agent
  // would otherwise leave every later one in the hold forever, with nothing to retry it — the
  // exact shape of the bug this whole wire removes, re-created inside the fix.
  const a = held("c1:t1:a1");
  const b = held("c1:t2:b2");
  const f = fanOut({
    sessions: new Map([["c1:t1:a1", a], ["c1:t2:b2", b]]),
    resume: (s) => { if (s === a) throw new Error("sdk load failed"); },
  });
  assert.equal(await f.resumeHeldSessions(), 2, "both were attempted");
  assert.deepEqual(f.resumed, [a, b]);
});

test("an UNBOUND registry answers 0 rather than throwing into the sign-in", async () => {
  // A mid-wave caller or a harness that never called `bind` must degrade: a completed sign-in
  // that throws here would report failure over a credential that really is present.
  const f = fanOut({ sessions: null });
  assert.equal(await f.resumeHeldSessions(), 0);
  assert.deepEqual(f.resumed, []);
});

// ── 2. THE OP: flow -> forget -> RE-PROBE -> fan-out ─────────────────────────

/** `claude-signin-op.js` against fakes, recording every call it makes. */
function bootOp({ usable = true, bundled = "/bundle/claude", external = "/usr/local/bin/claude",
  bundledThrows = false, resumed = 3 } = {}) {
  const calls = { flow: [], forget: 0, probe: 0, resume: 0, order: [] };
  const stub = (id) => {
    if (id === "./claude-auth") {
      return {
        startSignInFlow: async (opts) => {
          calls.order.push("flow");
          // The bin is resolved by the FLOW, through the accessor we hand it — exactly as
          // `claude-auth.js` really does it, so the resolution order is driven rather than read.
          calls.flow.push({ bin: await opts.getClaudeBin() });
        },
      };
    }
    if (id === "./session-auth") {
      return {
        forget: () => { calls.forget += 1; calls.order.push("forget"); },
        credentialState: () => {
          calls.probe += 1;
          calls.order.push("probe");
          return { usable, source: usable ? "cli-store" : null };
        },
        resumeHeldSessions: async () => { calls.resume += 1; calls.order.push("resume"); return resumed; },
      };
    }
    if (id === "./diag") return { diag: () => {} };
    if (id === "./sdk-loader") {
      if (bundledThrows) throw new Error("electron.app unavailable");
      return { resolveClaudeExecutable: () => bundled };
    }
    if (id === "./session-spawner") return { getClaudeBinPath: async () => external };
    throw new Error("unexpected require: " + id);
  };
  return { op: evalModule(OP_SRC, stub), calls };
}

test("a completed sign-in re-probes the CREDENTIAL and releases every held session", async () => {
  const { op, calls } = bootOp({ usable: true, resumed: 2 });
  assert.deepEqual(await op.signIn(), { ok: true, resumed: 2 });
  assert.equal(calls.flow.length, 1, "the flow ran");
  assert.equal(calls.resume, 1, "and the fan-out ran once, not once per session");
  // ⚠ THE ORDER IS THE CONTRACT. `forget` MUST precede the probe: `credentialState` is a 5s
  // click-rate cache, and the moment a sign-in returns is precisely the moment it is wrong — a
  // probe taken before it would answer with the state this flow just changed, and report failure
  // over a credential that is now present.
  assert.deepEqual(calls.order, ["flow", "forget", "probe", "resume"]);
});

test("SUCCESS IS THE CREDENTIAL, NOT THE FLOW — a sign-in that did not take resumes nothing", async () => {
  // `startSignInFlow` resolves `undefined` on every path: a completed sign-in, a declined dialog,
  // a failed pty and the single-flight no-op are indistinguishable from the caller. So the answer
  // is re-probed, and a machine still without a credential must NOT release its held sessions —
  // resuming them would spawn queries that fail auth and re-hold, one round per click.
  const { op, calls } = bootOp({ usable: false });
  assert.deepEqual(await op.signIn(), { ok: false }, "the bare refusal shape, no reason to probe");
  assert.equal(calls.resume, 0, "nothing was released");
  assert.deepEqual(calls.order, ["flow", "forget", "probe"]);
});

test("ONE FLOW PER CALL — the single-flight stays in claude-auth.js, unduplicated", async () => {
  // N held sessions produce exactly ONE dialog because the flow is driven once and the RESUME is
  // the fan-out. And there is no second latch here: `claude-auth.js › startSignInFlow` already
  // refuses to stack two sign-ins, and a local one would be a second answer to that question,
  // able to drift out of step with it.
  const { op, calls } = bootOp({ resumed: 5 });
  await op.signIn();
  assert.equal(calls.flow.length, 1, "one call, whatever the fan-out then releases");
  assert.equal(calls.resume, 1);
  assert.ok(!/inProgress|signingIn|inFlight/.test(OP_SRC), "no second single-flight latch here");
  assert.match(OP_SRC, /require\('\.\/claude-auth'\)|claudeAuth\.startSignInFlow/,
    "it CALLS the existing flow rather than re-implementing one");
});

test("the flow is pointed at the BUNDLED binary first, the external CLI second", async () => {
  // The executable a session really runs ships inside the app bundle
  // (`sdk-loader.resolveClaudeExecutable`), and most machines we distribute to never installed a
  // `claude` on PATH at all — offering THEM a sign-in that needs one is the silent-drop defect
  // `claude-runtime.js › sessionSpawnAvailable` was written for. Same order, same reason.
  const bundledFirst = bootOp({ bundled: "/bundle/claude", external: "/usr/local/bin/claude" });
  await bundledFirst.op.signIn();
  assert.equal(bundledFirst.calls.flow[0].bin, "/bundle/claude");
  // No bundled binary -> the external CLI, so a developer machine behaves exactly as it did.
  const fallback = bootOp({ bundled: null });
  await fallback.op.signIn();
  assert.equal(fallback.calls.flow[0].bin, "/usr/local/bin/claude");
  // And a THROWING sdk-loader (it pulls `electron.app` at module scope) degrades to the same
  // fallback rather than taking the sign-in down.
  const thrown = bootOp({ bundledThrows: true });
  await thrown.op.signIn();
  assert.equal(thrown.calls.flow[0].bin, "/usr/local/bin/claude");
});

test("a flow that THROWS still re-probes — the credential may have landed anyway", async () => {
  const calls = [];
  const stub = (id) => {
    if (id === "./claude-auth") return { startSignInFlow: async () => { throw new Error("boom"); } };
    if (id === "./session-auth") {
      return {
        forget: () => calls.push("forget"),
        credentialState: () => { calls.push("probe"); return { usable: true }; },
        resumeHeldSessions: async () => { calls.push("resume"); return 1; },
      };
    }
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
  const op = evalModule(OP_SRC, stub);
  assert.deepEqual(await op.signIn(), { ok: true, resumed: 1 });
  assert.deepEqual(calls, ["forget", "probe", "resume"]);
});

// ── 3. THE BOUNDARY: bound, delegated, and inert when refused ────────────────

test("the op is registered, sender-bound, and delegates rather than inlining the body", () => {
  assert.match(OPS_SRC, /ipcMain\.handle\('claude:signIn', appWindowOnly\('claude:signIn', \{ ok: false \}/,
    "the wrapper is written LITERALLY at the site — the structural belt in " +
      "channel-ipc-sender.test.mjs reads exactly that shape");
  assert.match(OPS_SRC, /require\('\.\/claude-signin-op'\)\.signIn\(\)/,
    "the body lives in its own module (§1's cap, the session-launch-op.js precedent)");
  assert.ok(!/startSignInFlow/.test(OPS_SRC), "the IPC layer never drives the flow itself");
});

test("A REFUSED SENDER REACHES NO FLOW AT ALL — not even the require", async () => {
  // The sharpest assertion available on this op: `_ipc-harness.mjs`'s stub `require` THROWS on
  // any id it does not know, and it does not know `./claude-signin-op`. So a refusal that
  // returned the right shape while still having loaded (or run) the sign-in would blow up here
  // instead of passing quietly. The op pops a NATIVE DIALOG once it starts, which is the one
  // side effect a forged call must never be able to buy.
  for (const which of ["foreign", "iframe"]) {
    const ipc = bootIpc();
    assert.deepEqual(await ipc.handlers["claude:signIn"](ipc[which]), { ok: false }, which);
    assert.deepEqual(ipc.dialogs, [], `${which}: no native dialog was opened`);
  }
});

// ── 4. END TO END: held, signed in, running again ────────────────────────────

test("HELD -> SIGN IN -> RUNNING: the fan-out really un-holds a session the engine held", async () => {
  // The two halves joined, both real: `holdIfAuthFailure` raises the hold through the REDUCER,
  // and the fan-out block hands that same session to the REAL `resumeAfterSignIn`. This is the
  // path that did not exist — the hold was reachable and the release was not.
  const h = harness({ usable: true }); // the credential broke DURING the run
  const s = session({ state: { phase: "running", parked: false, activity: "working" } });
  assert.equal(h.holdIfAuthFailure(s, "API Error: 401 unauthorized"), true);
  assert.equal(s.state.authHeld, true, "held: no wake can resume it, and a re-post is refused");

  const f = fanOut({ sessions: new Map([[s.key, s]]), resume: h.resumeAfterSignIn });
  assert.equal(await f.resumeHeldSessions(), 1);

  assert.equal(s.state.authHeld, false, "the reducer-visible hold is RELEASED");
  assert.equal(s.authHold, null, "…and the ticket is claimed, so a second sign-in is a no-op");
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["auth_hold", "auth_release", "steer"],
    "an error hold takes the ordinary lazy wake, never a second query assembly");
});

test("a WINDOWLESS PREFLIGHT hold, then a sign-in, and the RE-POST launches", async () => {
  // ⚠ THE PREFLIGHT LANE RECOVERS DIFFERENTLY, and it is worth pinning because the difference is
  // invisible from the composer. A windowless launch that holds is UN-REGISTERED by the engine
  // (`session-engine.js`: `sessions.delete(s.key); return { authHold: true }`), so there is no
  // session left for the fan-out to release — the operator's next post makes a NEW one, and what
  // has to be true is that the preflight now lets it through. That is why the op re-probes and
  // calls `forget()` first: the 5s probe cache is the only thing that could still refuse here.
  const h = harness({ usable: false });
  const first = session({ windowless: true });
  assert.equal(h.holdIfNoCredential(first), true, "the launch is held, and the engine drops it");
  assert.deepEqual(h.calls.startQuery, [], "nothing spawned on a machine with no credential");

  h.state.usable = true; // the sign-in landed
  const repost = session({ key: "c1:t1:a2", windowless: true });
  assert.equal(h.holdIfNoCredential(repost), false, "the re-post is not held");
  assert.equal(repost.state.authHeld, false, "…and reaches the engine's own startQuery untouched");
  // The fan-out has nothing to do on this lane, and must say so rather than inventing work.
  const f = fanOut({ sessions: new Map() });
  assert.equal(await f.resumeHeldSessions(), 0);
});
