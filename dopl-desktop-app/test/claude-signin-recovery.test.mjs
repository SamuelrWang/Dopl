// THE IN-APP SIGN-IN'S RECOVERY HALF — a completed sign-in releases the sessions this Mac holds.
//
// The bug this suite was written for is an ABSENCE: every DETECTING part of Q6 shipped (the preflight
// hold, the mid-session hold), and so did the remedy, and the remedy had no caller — so a held agent
// could never be un-held. What is pinned here is therefore the WIRE:
//   1. FAN-OUT — the AUTH-RESUME-FAN-OUT block of `session-auth.js`, sliced and driven with fakes.
//   3. BOUNDARY — structural reads of `session-ipc-ops.js`, plus a driven refusal proving an unbound
//      sender reaches no flow at all. The full sender-binding census is `channel-ipc-sender.test.mjs`.
//   4. END TO END — held, signed in, running again.
// The sign-in op itself (status, prompt, which runtime is released) is `runtime-credentials.test.mjs`.
//
// Run: `node --test dopl-desktop-app/test/claude-signin-recovery.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { bootIpc } from "./_ipc-harness.mjs";
import { harness, session } from "./_auth-hold-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const AUTH_SRC = readFileSync(M("session-auth.js"), "utf8");
const OPS_SRC = readFileSync(M("session-ipc-ops.js"), "utf8");

// ── 1. THE FAN-OUT: which sessions a completed sign-in releases ──────────────

const F_BEGIN = "// ─── BEGIN AUTH-RESUME-FAN-OUT";
const F_END = "// ─── END AUTH-RESUME-FAN-OUT";
const FAN_BLOCK = AUTH_SRC.slice(AUTH_SRC.indexOf(F_BEGIN), AUTH_SRC.indexOf(F_END));

/** The block, driven with an injected registry and an injected per-session resume. */
const runtimeRegistry = createRequire(import.meta.url)(M("runtime/index.js"));
function fanOut({ sessions, resume } = {}) {
  const resumed = [];
  const api = new Function(
    "deps", "resumeAfterSignIn", "diag", "copyFor",
    `${FAN_BLOCK}\n return { resumeHeldSessions };`
  )(
    { sessions: sessions === undefined ? new Map() : sessions },
    async (s) => { resumed.push(s); if (resume) await resume(s); },
    () => {},
    (s) => runtimeRegistry.descriptorFor(s && s.runtimeId)
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
  assert.equal(await f.resumeHeldSessions("claude"), 2);
  assert.deepEqual(f.resumed, [a, b], "both held agents, in registry order, and nothing else");
});

test("P4-06: a sign-in releases ONLY its own runtime's held sessions", async () => {
  // A Claude sign-in says nothing about Codex's credential: releasing a held Codex agent here would
  // relaunch it still signed out and hold it again.
  const claude = held("c1:t1:a1");
  const legacy = held("c1:t2:b2", { runtimeId: undefined }); // un-stamped = the default runtime
  const codex = held("c1:t3:c3", { runtimeId: "codex" });
  const sessions = new Map([[claude.key, claude], [legacy.key, legacy], [codex.key, codex]]);
  const f = fanOut({ sessions });
  assert.equal(await f.resumeHeldSessions("claude"), 2);
  assert.deepEqual(f.resumed, [claude, legacy], "the Codex agent stays held");
  assert.equal(await fanOut({ sessions }).resumeHeldSessions(), 0, "no runtime named, nothing released");
});

test("a SETTLED session is never resumed, however it was holding", async () => {
  // Dead is dead (Samuel, 2026-08-22). A sign-in must not revive an agent the operator ended,
  // and `resumeAfterSignIn` on a settled session would start a query behind a closed lifecycle.
  const sessions = new Map([["c1:t1:a1", held("c1:t1:a1", { settled: true })]]);
  const f = fanOut({ sessions });
  assert.equal(await f.resumeHeldSessions("claude"), 0);
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
  assert.equal(await f.resumeHeldSessions("claude"), 2, "the two that were held when the sign-in landed");
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
  assert.equal(await f.resumeHeldSessions("claude"), 2, "both were attempted");
  assert.deepEqual(f.resumed, [a, b]);
});

test("an UNBOUND registry answers 0 rather than throwing into the sign-in", async () => {
  // A mid-wave caller or a harness that never called `bind` must degrade: a completed sign-in
  // that throws here would report failure over a credential that really is present.
  const f = fanOut({ sessions: null });
  assert.equal(await f.resumeHeldSessions("claude"), 0);
  assert.deepEqual(f.resumed, []);
});

// ── 3. THE BOUNDARY: bound, delegated, and inert when refused ────────────────

test("the op is registered, sender-bound, and delegates rather than inlining the body", () => {
  assert.match(OPS_SRC, /ipcMain\.handle\('runtime:signIn', appWindowOnly\('runtime:signIn', \{ ok: false \}/,
    "the wrapper is written LITERALLY at the site — the structural belt in " +
      "channel-ipc-sender.test.mjs reads exactly that shape");
  assert.match(OPS_SRC, /require\('\.\/runtime-credentials'\)\.signIn\(runtimeId\)/,
    "the body lives in its own module (§1's cap, the session-launch-op.js precedent)");
  assert.ok(!/claude:signIn/.test(OPS_SRC), "the Claude-only channel is gone");
  assert.match(readFileSync(M("runtime/claude/credential.js"), "utf8"), /require\('\.\.\/\.\.\/claude-auth'\)\.signIn\(\)/,
    "Claude's registry entry drives its own flow");
});

test("A REFUSED SENDER REACHES NO FLOW AT ALL — not even the require", async () => {
  // The sharpest assertion available on this op: `_ipc-harness.mjs`'s stub `require` THROWS on
  // any id it does not know, and it does not know `./runtime-signin-op`. So a refusal that
  // returned the right shape while still having loaded (or run) the sign-in would blow up here
  // instead of passing quietly. The op pops a NATIVE DIALOG once it starts, which is the one
  // side effect a forged call must never be able to buy.
  for (const which of ["foreign", "iframe"]) {
    const ipc = bootIpc();
    assert.deepEqual(await ipc.handlers["runtime:signIn"](ipc[which], { runtimeId: "claude" }), { ok: false }, which);
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
  assert.equal(await f.resumeHeldSessions("claude"), 1);

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
  // has to be true is that the preflight now lets it through (the probe caches nothing).
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
  assert.equal(await f.resumeHeldSessions("claude"), 0);
});
