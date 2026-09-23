// Q6 — the Claude Code credential preflight and the auth HOLD it raises (main side).
//
// THE BUG: a session on a Mac with no Claude Code sign-in rendered "Not logged in · Please run
// /login" as an agent bubble and then died. Three layers are pinned here:
//   1. PURE — session-auth-detect.js (source-extracted): which failures are auth-shaped, and the
//      copy rules (names the credential, never prints a terminal command).
//   2. HOLD — the SESSION-AUTH-HOLD block of session-auth.js, sliced and driven with fakes: the
//      preflight blocks the spawn, a healthy credential leaves the launch byte-identical, an
//      auth-shaped failure parks and holds instead of crashing, a NON-auth failure keeps the crash.
//   3. WIRING — structural reads of session-engine.js: where the preflight sits, and that the
//      auth branch precedes (and can skip) the `crash` dispatch.
// ⚠ §4 (H1 — the hold is a state the rest of the engine understands) MOVED OUT WHOLE on
// 2026-08-20 to `session-auth-hold-h1.test.mjs`, and the boot machinery with it to
// `_auth-hold-harness.mjs`. This file stood at EXACTLY 500 of the cap, so neither subject could
// gain a case (F-226); the seam is reason-to-change — §1-§3 are about DETECTING and RAISING the
// hold, §4 is about what the reducer and the engine do with one.
//
// ⚠ THE REMEDY WENT; THE GUARD DID NOT (2026-08-20, F-228). The title said "in-window sign-in
// recovery", and a third of this file drove `session-auth.runSignIn`: a banner with a button in the
// session WINDOW whose click ran `claude setup-token` under a pty. It, its handlers
// (`session:auth-signin` / `session:auth-state`) and the painters (`emitHeldInit` / `showWindow` /
// `paintNotice`) are deleted; `resumeAfterSignIn` SURVIVES (the same tail, minus pty and paint) and
// is what the recovery cases are re-pointed at. THE HOLD IS UNTOUCHED, which is why this is rewritten
// down, not removed (INVARIANTS §14): where a case asserted both hold and banner, only the banner half went.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  M, detect, AUTH_SRC, ENGINE, HOLD_BLOCK, harness, session,
} from "./_auth-hold-harness.mjs";
import { sentinelBlock, fnOf } from "./helpers/source-probe.mjs";

const requireMain = (p) => createRequire(import.meta.url)(M(p));

const DETECT_SRC = readFileSync(M("session-auth-detect.js"), "utf8");
const CLAUDE_AUTH = readFileSync(M("claude-auth.js"), "utf8");
const QUERY = readFileSync(M("session-query.js"), "utf8"); // §3 SPLIT: startQuery / consume / buildSdkOptions

// ── 1. PURE: the detector + the copy ─────────────────────────────────────────

const DETECT_BLOCK = sentinelBlock(DETECT_SRC, "SESSION-AUTH-DETECT");

test("the detect block is standalone-evaluable (no electron / fs / require)", () => {
  assert.ok(DETECT_BLOCK.length > 200, "the sentinels bracket a real block");
  for (const banned of ["require(", "electron", "process.", "child_process", "fs."]) {
    assert.ok(!DETECT_BLOCK.includes(banned), `the pure block must not reference ${banned}`);
  }
  const api = new Function(`${DETECT_BLOCK}\n return { isAuthShapedError, authFailureText };`)();
  assert.equal(typeof api.authFailureText, "function");
});

test("isAuthShapedError matches the SAME shape the headless path already acts on", () => {
  // claude-auth.js owns the headless copy (trigger.js:341). The two regexes are duplicated on
  // purpose (claude-auth requires electron), so pin them against each other.
  const headless = CLAUDE_AUTH.match(/const AUTH_ERROR_RE = (\/.*\/i);/);
  assert.ok(headless, "claude-auth still declares AUTH_ERROR_RE");
  assert.equal(String(detect.AUTH_ERROR_RE), headless[1], "the session copy has not drifted");
  for (const text of ["401 Unauthorized", "OAuth token has expired", "Please Re-authenticate"]) {
    assert.equal(detect.isAuthShapedError(text), true, text);
  }
  for (const text of ["ENOENT", "process exited with code 143", "", null, undefined]) {
    assert.equal(detect.isAuthShapedError(text), false, String(text));
  }
});

test("an assistant bubble is auth-shaped ONLY when the WHOLE text is the CLI's own sentinel", () => {
  const bubble = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
  assert.equal(detect.authFailureText(bubble("Not logged in · Please run /login")), "Not logged in · Please run /login");
  assert.equal(detect.authFailureText(bubble("  Invalid API key · Please run /login  ")).trim().length > 0, true);
  // A reply that merely MENTIONS it is untrusted content, and must not pop a sign-in banner.
  for (const text of [
    "The peer said: Not logged in · Please run /login, what should I do?",
    "Not logged in",
    "Please run /login to continue with the deployment",
    "Their server returned 401 for the webhook",
  ]) {
    assert.equal(detect.authFailureText(bubble(text)), "", text);
  }
});

test("an ERRORED result is auth-shaped on the loose regex (that text is CLI-sourced)", () => {
  assert.equal(detect.authFailureText({ type: "result", is_error: true, result: "API Error: 401" }), "API Error: 401");
  assert.equal(detect.authFailureText({ type: "result", subtype: "error_during_execution", result: "OAuth token expired" }),
    "OAuth token expired");
  // A CLEAN result is never a failure, whatever it says.
  assert.equal(detect.authFailureText({ type: "result", is_error: false, result: "done, 401 rows" }), "");
  // Nor is an unrelated error.
  assert.equal(detect.authFailureText({ type: "result", is_error: true, result: "timed out" }), "");
  for (const msg of [null, undefined, {}, { type: "system" }, { type: "user" }]) {
    assert.equal(detect.authFailureText(msg), "", JSON.stringify(msg));
  }
});

// ── 2. HOLD: the sliced block, driven with fakes ─────────────────────────────

// ── 2. HOLD: driven through the shared harness ───────────────────────────────

test("the hold block holds no electron require of its own", () => {
  assert.ok(HOLD_BLOCK.length > 400, "the sentinels bracket a real block");
  for (const banned of ["require(", "ipcMain", "BrowserWindow", "child_process"]) {
    assert.ok(!HOLD_BLOCK.includes(banned), `SESSION-AUTH-HOLD must not reference ${banned}`);
  }
});

test("PREFLIGHT: no credential HOLDS the launch — no query, and the session is parked and held", () => {
  // ⚠ THE BANNER HALF IS EXCISED (F-228; INVARIANTS §14). The title said "and the window says why",
  // and four assertions drove it: `emitHeldInit`'s synthesized `init` (a held preflight got no SDK
  // system/init, so the consent card never cleared), `paintNotice`'s `auth_required` and its
  // title/kind, and `showWindow`. THE HOLD IS NOT — every assertion about it is kept verbatim.
  const h = harness({ usable: false });
  const s = session();
  assert.equal(h.holdIfNoCredential(s), true, "the caller must return before startQuery");
  assert.deepEqual(h.calls.startQuery, [], "NOTHING is spawned");
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["auth_hold"],
    "H1: one hold event through the REDUCER (so every module sees it), and no crash/lifecycle");
  assert.deepEqual([s.state.phase, s.state.parked, s.state.activity, s.state.authHeld],
    ["parked", true, "parked", true], "PARKED (dormant on restart) and HELD, which stops a wake resuming it");
  assert.deepEqual(h.calls.effects.slice(0, 4), ["denyPending", "abortQuery", "clearIdle", "persist"],
    "the park teardown really ran: awaited tool promises fail closed BEFORE the abort");
  assert.deepEqual(h.calls.phase, [{ key: "c1:t1", phase: "parked" }], "the durable record is parked, not 'launching'");
});

test("PREFLIGHT: a healthy credential changes NOTHING (the launch continues untouched)", () => {
  const h = harness({ usable: true });
  const s = session();
  assert.equal(h.holdIfNoCredential(s), false);
  assert.deepEqual(h.calls.phase, []);
  assert.equal(s.state.phase, "launching");
  assert.equal(s.state.parked, false);
  assert.equal(s.state.authHeld, false, "never held");
  assert.deepEqual(h.calls.dispatch, [], "no reducer event at all");
});

test("PREFLIGHT: the selected runtime owns the credential verdict", async () => {
  const h = harness({ usable: false }); // Claude's local markers say signed out.
  const healthy = session({ runtimeId: "codex" });
  assert.equal(await h.holdIfNoRuntimeCredential(healthy, {
    credentialState: async () => ({ usable: true, source: "login-status" }),
  }), false, "a valid Codex login is not blocked by Claude's credential state");
  assert.deepEqual(h.calls.dispatch, []);

  const missing = session({ runtimeId: "codex" });
  assert.equal(await h.holdIfNoRuntimeCredential(missing, {
    credentialState: async () => ({ usable: false, source: "login-status-nonzero" }),
  }), true);
  assert.equal(missing.state.authHeld, true);
});

// ⚠ "PREFLIGHT: a sign-in that does NOT finish leaves the hold answerable" STOOD HERE AND IS DELETED
// (F-228). It ran `runSignIn` where the credential was STILL unusable and pinned the recovery loop's
// failure arm: nothing spawned, the banner repainted `busy: false` with `note: detect.AUTH_FAILED`,
// and `s.authHold` survived so the request stayed answerable. ⚠ NO SUCCESSOR — A REAL NARROWING, NOT
// A RENAME: `resumeAfterSignIn` does not re-probe (it is called BECAUSE a credential appeared) and
// releases + relaunches unconditionally, so a still-broken credential just fails the launch again
// and `holdIfAuthFailure` re-holds it (H1(b) below). Recorded rather than dropped: what it protected
// — a failed recovery must never leave a session UNHELD — is what a future recovery UI must re-establish.

test("MID-SESSION: an auth-shaped failure parks and HOLDS (never `crash`)", () => {
  // ⚠ THE BANNER HALF IS EXCISED (F-228): the title said "parks on the button", and the last two
  // assertions read `auth_required`'s type and `kind: 'error'` off the paint. The rest is the
  // fail-closed teardown, untouched.
  const h = harness({ usable: true }); // the credential broke DURING the run
  const s = session({ state: { phase: "running", parked: false, activity: "working" } });
  s.abortController = { aborted: false, abort() { this.aborted = true; } };
  s.pushIterator = { closed: false, close() { this.closed = true; } };
  assert.equal(h.holdIfAuthFailure(s, "API Error: 401 unauthorized"), true);
  // ⚠ THE SENTENCE IS THE RUNTIME'S OWN SINCE 2026-09-21 (U10) — `Claude Code` is this
  // descriptor's own `label`, not a frozen literal, and the Codex/Cursor twin is at the bottom
  // of this file. What is pinned here is unchanged: the awaited tool promises fail CLOSED FIRST.
  assert.deepEqual(h.calls.denyPending, ["Sign in to Claude Code to continue"], "awaited tool promises fail CLOSED first");
  assert.equal(s.pushIterator.closed, true, "the prompt stream is closed");
  assert.equal(s.abortController.aborted, true, "and the query torn down");
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["auth_hold"],
    "NO crash: no settle, no task_failed{interrupted}, no destroyed window — just the hold");
  assert.deepEqual([s.state.parked, s.state.authHeld, s.state.toolMode, s.state.messageMode],
    [true, true, "manual", "ask"], "parked, HELD (no peer wake can resume it), both axes disarmed like a park");
});

test("MID-SESSION: the RUNTIME decides what is auth — a non-auth failure never reaches the hold", () => {
  // P4-03: core trusts the adapter's `auth_hold` and no longer re-tests the text with Claude's
  // patterns, so the refusal lives in each normalizer. A non-auth rejection normalizes to nothing
  // (the crash path runs); Codex's own wider auth words are held, not dropped.
  const claudeNormalize = requireMain("runtime/claude/normalize.js").normalize;
  const codexNormalize = requireMain("runtime/codex/normalize.js").normalize;
  for (const text of ["process exited with code 143", "ENOENT", "", "timed out"]) {
    assert.deepEqual(claudeNormalize({ type: "error", text }, {}), [], text);
    assert.deepEqual(codexNormalize({ type: "error", text }, {}), [], text);
  }
  for (const text of ["Not logged in", "authentication required", "403 Forbidden", "invalid api key"]) {
    assert.deepEqual(codexNormalize({ type: "error", text }, {}).map((e) => e.type), ["auth_hold"], text);
    const h = harness({ usable: true });
    const s = session({ runtimeId: "codex" });
    assert.equal(h.holdIfAuthFailure(s, text), true, `core holds on the adapter's verdict: ${text}`);
  }
});

test("D7.4: a SETTLED session answers FALSE to an auth-shaped failure — so the loop keeps draining", () => {
  // ⚠ THE FALSE ANSWER IS THE POINT, AND IT IS NOT A REFUSAL OF THE TEXT. The text below is the
  // same one the case above holds on; what changes is that the session has already settled, and
  // `holdIfAuthFailure`'s first line declines on `s.settled` because the teardown it would run has
  // already run. Nothing here aborts the child or closes the prompt stream — so the caller that
  // treats "asked" as "stopped" abandons a live iterator with nothing left to consume its tail.
  // This is the measurement behind the source pin in §3; without it that regex pins a shape whose
  // reason nobody can check.
  const h = harness({ usable: true });
  const s = session({ state: { phase: "running", parked: false, activity: "working" } });
  s.settled = true;
  s.abortController = { aborted: false, abort() { this.aborted = true; } };
  s.pushIterator = { closed: false, close() { this.closed = true; } };
  assert.equal(h.holdIfAuthFailure(s, "API Error: 401 unauthorized"), false,
    "a settled session is not held again — and the answer says so");
  assert.deepEqual(h.calls.dispatch, [], "no hold event");
  assert.equal(s.abortController.aborted, false, "nothing was torn down…");
  assert.equal(s.pushIterator.closed, false, "…so there is still a stream to drain");
});

test("MID-SESSION: the CLI's own login bubble is CONSUMED, never rendered", () => {
  // The Claude normalizer turns the bubble into `auth_hold` ALONE (no render event beside it).
  const normalize = requireMain("runtime/claude/normalize.js").normalize;
  const bubble = { type: "assistant", message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] } };
  assert.deepEqual(normalize(bubble, {}).map((e) => e.type), ["auth_hold"], "the dead-end bubble is replaced by the action");
  const plain = normalize({ type: "assistant", message: { content: [{ type: "text", text: "on it" }] } }, {});
  assert.ok(!plain.some((e) => e.type === "auth_hold"), "a normal assistant message is never consumed");
});

test("MID-SESSION: a second failure never stacks a second hold", () => {
  const h = harness({ usable: true });
  const s = session();
  assert.equal(h.holdIfAuthFailure(s, "401"), true);
  assert.equal(h.holdIfAuthFailure(s, "401 again"), true, "still handled");
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["auth_hold", "auth_hold"], "the second converges on the same hold");
  assert.equal(s.state.authHeld, true);
  assert.equal(h.holdIfAuthFailure({ ...session(), settled: true }, "401"), false, "a settled session is never held");
});

test("MID-SESSION: the resume takes the ordinary lazy wake (a steer), not a new query", async () => {
  // ⚠ RE-POINTED FROM `runSignIn` (F-228). The ROUTING is the point and lives entirely inside the
  // surviving `resumeAfterSignIn`: a hold steers — re-launching would abandon the SDK session id
  // and replay the exchange.
  const h = harness({ usable: true });
  const s = session({ state: { phase: "running", parked: false, activity: "working" } });
  h.holdIfAuthFailure(s, "401");
  await h.resumeAfterSignIn(s);
  assert.deepEqual(h.calls.startQuery, [], "an error hold never re-launches from scratch");
  assert.equal(h.calls.sdk, 0, "and never even loads the SDK");
  // H1: hold -> release -> steer. RELEASE must precede the steer: the steer wakes through
  // wakeEffects, which refuses to resume while authHeld is still true.
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["auth_hold", "auth_release", "steer"]);
  assert.equal(s.state.authHeld, false, "the hold is cleared before anything can spawn");
  assert.match(h.calls.dispatch[2].text, /Continue where you left off/);
});

// ── 3. WIRING: where the engine calls it ─────────────────────────────────────

test("the engine preflights AFTER the parked-shell branch and BEFORE startQuery", () => {
  // ⚠ THE PARKED-SHELL ANCHOR MOVED (F-228). It was the shell-recreate lane's early return —
  // `if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }` — which opened a window and
  // started no query, so a shell provably never reached the preflight. That return is deleted;
  // `spec.parkedShell` survives as the flag seeding the dormant phase, so this re-anchors on it and
  // narrows the claim. ⚠ EVERY INDEX IS CHECKED NON-NEGATIVE FIRST: `indexOf` answers -1 for a
  // deleted symbol, and `hold > -1` is how a case goes green while measuring nothing.
  const guard = ENGINE.indexOf("if (spec.parkedShell) { state.phase = 'parked';");
  const probe = ENGINE.indexOf("const credentialHeld = await sessionAuth.holdIfNoRuntimeCredential(s, rt);");
  const hold = ENGINE.indexOf("if (credentialHeld) { sessions.delete(s.key);");
  const start = ENGINE.indexOf("await startQuery(s, rt);");
  assert.ok(Math.min(guard, probe, hold, start) !== -1, "an anchor is gone — reslice rather than pass on -1");
  assert.ok(probe > guard, "the dormant-phase decision is made before the credential is probed");
  assert.ok(hold > probe, "the runtime credential is known before the hold rolls back");
  assert.ok(start > hold, "and a held launch returns BEFORE the query is started");
  // A held launch rolls the registration back, so `launch()` answers honestly instead of handing
  // out a sessionId for a session that will never run.
  assert.match(ENGINE.slice(hold, start), /sessions\.delete\(s\.key\).*return \{ authHold: true \}/s,
    "a held launch un-registers itself and reports the hold");
});

test("the consume loop routes an auth failure to the hold before it can dispatch `crash`", () => {
  // ⚠ 2026-08-31 (runtime-adapter port, step 4): the loop calls ONE thing per message where it
  // called three. The auth sentinel is now recognised by the ADAPTER's `normalize` — the shape a
  // credential failure arrives in is as platform-specific as any other message — and comes back
  // as an `auth_hold` CoreEvent that `applyCoreEvents` hands straight back, BEFORE it dispatches
  // anything else. The property this pins is unchanged: the bubble is consumed, never rendered.
  // ⚠ THE FIFTH ARGUMENT IS `diag` (2026-09-01, D7.3): `session-io.js` may not require it —
  // electron — so the swallowed context dispatch's log line is INJECTED from this loop, on the
  // `session-gate-bridge.js › makeCanUseTool(s, dispatch, log)` precedent.
  // ⚠ THE LOCAL IS `signal`, NOT `hold`, SINCE 2026-09-13 (F-692): `applyCoreEvents` hands back
  // TWO kinds of answer now — the `auth_hold` event this test is about, and `{type:'mcp_status'}`
  // after a `launched` — and the loop branches on `type` so neither can be fed to the other's
  // handler. The property pinned here is unchanged: the bubble is consumed, never rendered.
  assert.match(QUERY, /const signal = io\.applyCoreEvents\(s, rt\.normalize\(msg, normalizeCtx\(s\)\), deps\.dispatch, store\);/,
    "the message path consumes the bubble instead of rendering it");
  // ⚠ D7.4 (restored 2026-09-01): THE SENTINEL'S ANSWER IS THE STOP CONDITION, not the fact that
  // it was asked. HEAD read `if (sessionAuth.holdIfAuthMessage(s, msg)) return;`; the port dropped
  // the return value and returned unconditionally, so a SETTLED session emitting an auth-shaped
  // message stopped draining a stream HEAD kept reading (the case below proves the false answer is
  // real). ⚠ ASSERTED AS THE CONJUNCTION, not merely "holdIfAuthFailure appears": a call whose
  // answer is discarded matches any looser regex, which is exactly how this was lost.
  assert.match(QUERY, /if \(signal && signal\.type === 'auth_hold' && sessionAuth\.holdIfAuthFailure\(s, signal\.text\)\) return;/,
    "…and the loop stops only when the sentinel says it ACTED");
  assert.ok(!/holdIfAuthFailure\(s, hold\.text\);\s*return;/.test(QUERY),
    "no unconditional return past a sentinel that answered false");
  assert.match(readFileSync(M("session-io.js"), "utf8"), /if \(ev\.type === 'auth_hold'\) return ev;/,
    "applyCoreEvents returns the hold rather than dispatching past it");
  const hold = QUERY.indexOf("const held = rt.normalize({ type: 'error', text:");
  const crash = QUERY.indexOf("deps.dispatch(s, { type: 'crash' })", hold);
  assert.ok(hold !== -1 && crash > hold, "the auth branch precedes the crash dispatch");
  assert.match(QUERY, /const hold = held\.find\(\(ev\) => ev && ev\.type === 'auth_hold'\);\s*if \(hold && sessionAuth\.holdIfAuthFailure\(s, hold\.text\)\) return;/,
    "a REJECTION is asked of the same normalizer — the runtime decides what is auth-shaped");
  assert.match(QUERY, /if \(!isAbortError\(err\)\) \{/, "and an abort is still not an error at all");
});

test("what counts as a usable credential — and what the SPAWN env does about it", () => {
  const probe = fnOf(AUTH_SRC, "credentialState");
  // Three sources, most-explicit first. `stored-token` is LAST so it is chosen only when it is the
  // only credential we hold, which is exactly when withStoredCredential injects it.
  assert.match(probe, /if \(envKey\) state = \{ usable: true, source: 'env' \};/);
  assert.match(probe, /else if \(cliStoreSignedIn\(\)\) state = \{ usable: true, source: 'cli-store' \};/);
  assert.match(probe, /else if \(getStoredOAuthToken\(\)\) state = \{ usable: true, source: 'stored-token' \};/);
  // The keychain item is NEVER read: a cross-app read pops an OS prompt, a worse interruption than
  // the bug. Only markers.
  assert.ok(!/security find-generic-password|execFile|spawn\(/.test(AUTH_SRC), "no keychain shell-out");
  const marker = fnOf(AUTH_SRC, "cliStoreSignedIn");
  assert.match(marker, /\.credentials\.json/, "the file-backed store, when there is one");
  assert.match(marker, /account\.accountUuid/, "else the CLI's own signed-in marker (one bit, no field copied)");
  assert.match(marker, /err\.code !== 'ENOENT'/, "an unreadable file FAILS OPEN; only a MISSING one blocks");
  // The healthy path stays byte-identical: no stored-token source -> the same env object back.
  const envFn = fnOf(AUTH_SRC, "withStoredCredential");
  assert.match(envFn, /if \(state\.source !== 'stored-token'\) return env;/, "untouched on every other machine");
});

test("the engine injects its OWN denyPending + teardown (the hold assembles no query)", () => {
  // ⚠ THE BIND OBJECT LOST ITS LAST MEMBER (F-228): `getSessionBySender` resolved a session from an
  // IPC `event.sender` (a window's webContents) for the two deleted auth handlers. The rest is the
  // point: the hold assembles no query of its own (a resume is a steer through the engine's wake).
  // ⚠ `denyPendingPermissions` MOVED TO `main/session-permissions.js` ON 2026-08-22 (the §2 cap +
  // the denial-copy ruling) and is destructured at the engine's module scope, so this bind reads
  // exactly as it did. What must stay true is that the auth hold is handed the REAL fail-closed
  // sweep and not a stub — a hold that leaves a resolver dangling blocks the SDK child forever.
  assert.match(ENGINE, /sessionAuth\.bind\(\{ sessions, dispatch, denyPending: denyPendingPermissions, teardown: teardownHandles \}\)/);
  assert.match(ENGINE, /const \{ denyPendingPermissions, resolvePerm \} = sessionPermissions;/,
    "…and it is the shared one, not a local re-declaration");
  assert.ok(!/getSessionBySender/.test(ENGINE), "no sender-keyed session lookup survives anywhere in the engine");
  // ⚠ 2026-08-31: the assembly is the runtime adapter's (`runtime/claude/launch-spec.js`). The
  // property is unchanged — the stored token rides the SAME scrubbed base every spawn uses.
  assert.match(readFileSync(M("runtime/claude/launch-spec.js"), "utf8"),
    /env: sessionAuth\.withStoredCredential\(loader\.buildScrubbedEnv\(\)\)/,
    "and the stored setup-token reaches the spawn env through the SAME scrubbed base");
});

// ── 4. U10 (2026-09-21): THE SENTENCES ON THIS SHARED PATH NAME THE SESSION'S OWN RUNTIME ────
//
// ⚠ BOTH OF THEM ARE REACHED BY EVERY RUNTIME. `session-query.js › consume` calls
// `holdIfAuthFailure` whatever adapter produced the stream, so before this both a Codex and a
// Cursor agent were told — in a tool denial the AGENT reads, and in a steer pushed into its own
// turn — to sign in to Claude. That is not a cosmetic wrong: it names a credential the session
// does not use and sends the operator to fix something that is not broken.
//
// ⚠ AND THE OTHER HALF IS THAT CLAUDE IS UNTOUCHED. A de-naming that fires on every runtime is a
// regression, not a feature — the same rule `runtime-refusals.test.tsx` states on the web side.

test("U10: the held-tool denial names the runtime the AGENT is running on", () => {
  const seen = {};
  for (const [runtimeId, want] of [["claude", "Claude Code"], ["codex", "Codex"], ["cursor", "Cursor"]]) {
    const h = harness({ usable: true });
    const s = session({ runtimeId, state: { phase: "running", parked: false, activity: "working" } });
    s.abortController = { abort() {} };
    s.pushIterator = { close() {} };
    assert.equal(h.holdIfAuthFailure(s, "API Error: 401 unauthorized"), true);
    assert.deepEqual(h.calls.denyPending, [`Sign in to ${want} to continue`]);
    seen[runtimeId] = h.calls.denyPending[0];
  }
  // ⚠ THREE DISTINCT SENTENCES, ASSERTED AS A SET. A copy function that ignored the descriptor
  // and answered one string would satisfy every line above if they were read one at a time.
  assert.equal(new Set(Object.values(seen)).size, 3, "one runtime's words must not be another's");
});

test("U10: the post-sign-in nudge is the session's own runtime's, and Codex never says Claude", async () => {
  for (const [runtimeId, want] of [["claude", "Claude Code"], ["codex", "Codex"]]) {
    const h = harness({ usable: true });
    const s = session({ runtimeId, state: { phase: "running", parked: false, activity: "working" } });
    h.holdIfAuthFailure(s, "401");
    await h.resumeAfterSignIn(s);
    const steer = h.calls.dispatch.find((e) => e.type === "steer");
    assert.ok(steer, "the error hold still steers rather than re-launching");
    assert.ok(steer.text.startsWith(`${want} sign-in is restored on this Mac`), steer.text);
    if (runtimeId !== "claude") {
      assert.ok(!/Claude/.test(steer.text), `a ${runtimeId} agent must not be told about Claude: ${steer.text}`);
    }
  }
});

// ⚠ A RECORD FROM BEFORE THE RUNTIME STAMP STILL GETS A SENTENCE. `descriptorFor(undefined)`
// answers the DEFAULT adapter, which is the runtime such a session really ran on — failing toward
// a refusal here would leave a held agent with no reason at all.
test("U10: a session with no runtime stamp falls back to the default adapter's words", () => {
  const h = harness({ usable: true });
  const s = session({ state: { phase: "running", parked: false, activity: "working" } });
  s.abortController = { abort() {} };
  s.pushIterator = { close() {} };
  h.holdIfAuthFailure(s, "401");
  assert.match(h.calls.denyPending[0], /^Sign in to \S/);
});
