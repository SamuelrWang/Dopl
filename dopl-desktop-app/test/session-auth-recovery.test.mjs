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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  M, detect, AUTH_SRC, ENGINE, HOLD_BLOCK, harness, session, sessionReducer,
} from "./_auth-hold-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DETECT_SRC = readFileSync(M("session-auth-detect.js"), "utf8");
const CLAUDE_AUTH = readFileSync(M("claude-auth.js"), "utf8");
const QUERY = readFileSync(M("session-query.js"), "utf8"); // §3 SPLIT: startQuery / consume / buildSdkOptions

// ── 1. PURE: the detector + the copy ─────────────────────────────────────────

const D_BEGIN = "// ─── BEGIN SESSION-AUTH-DETECT";
const DETECT_BLOCK = DETECT_SRC.slice(DETECT_SRC.indexOf(D_BEGIN), DETECT_SRC.indexOf("// ─── END SESSION-AUTH-DETECT"));

test("the detect block is standalone-evaluable (no electron / fs / require)", () => {
  assert.ok(DETECT_BLOCK.length > 200, "the sentinels bracket a real block");
  for (const banned of ["require(", "electron", "process.", "child_process", "fs."]) {
    assert.ok(!DETECT_BLOCK.includes(banned), `the pure block must not reference ${banned}`);
  }
  const api = new Function(`${DETECT_BLOCK}\n return { isAuthShapedError, authFailureText, authNotice };`)();
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

test("COPY: names the Claude Code credential on THIS Mac, and never a terminal command", () => {
  const strings = [detect.AUTH_TITLE, detect.AUTH_PREFLIGHT_BODY, detect.AUTH_ERROR_BODY,
    detect.AUTH_ACTION, detect.AUTH_WORKING, detect.AUTH_FAILED, detect.AUTH_DONE];
  assert.match(detect.AUTH_TITLE, /Claude Code sign-in/, "the title names WHICH credential");
  assert.match(detect.AUTH_TITLE, /this Mac/, "and WHERE it is missing");
  for (const body of [detect.AUTH_PREFLIGHT_BODY, detect.AUTH_ERROR_BODY]) {
    assert.match(body, /separate/i, "it says the credential is separate from the other two logins");
    assert.match(body, /Dopl/, "…naming the Dopl login");
    assert.match(body, /Claude app/, "…and the Claude app login");
  }
  for (const s of strings) {
    assert.ok(!/\/login/.test(s), `no slash command in: ${s}`);
    assert.ok(!/terminal|Terminal|setup-token|npm |claude /.test(s), `no terminal instruction in: ${s}`);
    assert.ok(!/—/.test(s), `no em dash in: ${s}`);
    assert.ok(!/not logged in/i.test(s), "never the words that started the confusion");
  }
});

test("authNotice carries display copy ONLY (no id, path, token or channel)", () => {
  const n = detect.authNotice("error", { busy: true, note: "x" });
  assert.deepEqual(Object.keys(n).sort(), ["action", "body", "busy", "kind", "note", "title", "type"].sort());
  assert.equal(n.type, "auth_required");
  assert.equal(n.kind, "error");
  assert.equal(detect.authNotice("anything-else", {}).kind, "preflight", "unknown kind falls back");
  assert.equal(detect.authNotice("preflight", {}).busy, false);
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
  // ONE emit survives and it is not a paint: the status the pill and the durable record agree on.
  assert.deepEqual(h.calls.emit, [{ type: "status", phase: "parked" }], "asserted WHOLE — a re-added notice comes back here");
});

test("PREFLIGHT: a healthy credential changes NOTHING (the launch continues untouched)", () => {
  const h = harness({ usable: true });
  const s = session();
  assert.equal(h.holdIfNoCredential(s), false);
  assert.deepEqual(h.calls.emit, [], "not one event");
  assert.deepEqual(h.calls.phase, []);
  assert.equal(s.state.phase, "launching");
  assert.equal(s.state.parked, false);
  assert.equal(s.state.authHeld, false, "never held");
  assert.deepEqual(h.calls.dispatch, [], "no reducer event at all");
});

test("PREFLIGHT: the resume runs the ORIGINAL first turn through the engine's own startQuery", async () => {
  // ⚠ RE-POINTED FROM `runSignIn` (F-228). Gone is the TRIGGER — the in-window button and its pty —
  // and with it two assertions: that the EXISTING claude-auth flow drove it, against the bundled
  // binary. What survives can still lose a request: when a credential appears the held launch
  // re-runs the turn it never pushed, through the engine's OWN startQuery.
  const h = harness({ usable: false });
  const s = session();
  h.holdIfNoCredential(s);
  await h.resumeAfterSignIn(s);
  assert.equal(h.calls.startQuery.length, 1, "the deferred launch runs");
  assert.equal(h.calls.startQuery[0].s.firstTurn, "FRAMED FIRST TURN", "the same framed turn, byte for byte");
  assert.equal(h.calls.startQuery[0].sdk.__sdk, true, "and through the engine's SDK handle, not a second loader");
  // The parked stamp is lifted (the reducer stops swallowing SDK messages) and the reducer-visible
  // hold RELEASED before the relaunch — or wakeEffects refuses to resume this session forever.
  assert.deepEqual([s.state.phase, s.state.parked, s.state.activity, s.state.authHeld],
    ["launching", false, "working", false]);
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["auth_hold", "auth_release"]);
  assert.equal(s.authHold, null);
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
  assert.deepEqual(h.calls.denyPending, ["Sign in to Claude to continue"], "awaited tool promises fail CLOSED first");
  assert.equal(s.pushIterator.closed, true, "the prompt stream is closed");
  assert.equal(s.abortController.aborted, true, "and the query torn down");
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["auth_hold"],
    "NO crash: no settle, no task_failed{interrupted}, no destroyed window — just the hold");
  assert.deepEqual([s.state.parked, s.state.authHeld, s.state.toolMode, s.state.messageMode],
    [true, true, "manual", "ask"], "parked, HELD (no peer wake can resume it), both axes disarmed like a park");
  assert.deepEqual(h.calls.emit, [{ type: "status", phase: "parked" }],
    "the ONE surviving emit, asserted whole so a re-added notice comes back through here");
});

test("MID-SESSION: a NON-auth failure is refused, so today's crash path still runs", () => {
  const h = harness({ usable: true });
  for (const text of ["process exited with code 143", "ENOENT", "", null, "timed out"]) {
    const s = session();
    assert.equal(h.holdIfAuthFailure(s, text), false, String(text));
    assert.deepEqual(h.calls.emit, [], "nothing painted");
    assert.equal(s.authHold, undefined);
  }
});

test("MID-SESSION: the CLI's own login bubble is CONSUMED, never rendered", () => {
  const h = harness({ usable: true });
  const s = session();
  const bubble = { type: "assistant", message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] } };
  assert.equal(h.holdIfAuthMessage(s, bubble), true, "the dead-end bubble is replaced by the action");
  const s2 = session(); // a normal assistant message is never consumed
  assert.equal(h.holdIfAuthMessage(s2, { type: "assistant", message: { content: [{ type: "text", text: "on it" }] } }), false);
  assert.equal(h.holdIfAuthMessage(s2, { type: "result", is_error: false, result: "ok" }), false);
});

test("MID-SESSION: a second failure never stacks a second hold", () => {
  // ⚠ "(or a second banner)" left the title with the banner (F-228). The emit count is still the
  // assertion: the ONE surviving emit is a status the pill and the durable record read.
  const h = harness({ usable: true });
  const s = session();
  assert.equal(h.holdIfAuthFailure(s, "401"), true);
  const emitted = h.calls.emit.length;
  assert.equal(h.holdIfAuthFailure(s, "401 again"), true, "still handled");
  assert.equal(h.calls.emit.length, emitted, "but nothing is re-emitted");
  assert.equal(h.holdIfAuthFailure({ ...session(), settled: true }, "401"), false, "a settled session is never held");
});

test("MID-SESSION: the resume takes the ordinary lazy wake (a steer), not a new query", async () => {
  // ⚠ RE-POINTED FROM `runSignIn` (F-228). The ROUTING is the point and lives entirely inside the
  // surviving `resumeAfterSignIn`: a PREFLIGHT hold re-runs the deferred launch (above), an ERROR
  // hold steers instead — re-launching would abandon the SDK session id and replay the exchange.
  const h = harness({ usable: true });
  const s = session({ state: { phase: "running", parked: false, activity: "working" } });
  h.holdIfAuthFailure(s, "401");
  await h.resumeAfterSignIn(s);
  assert.deepEqual(h.calls.startQuery, [], "an error hold never re-launches from scratch");
  assert.equal(h.calls.sdk, 0, "and never even loads the SDK — that is the preflight branch's");
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
  const hold = ENGINE.indexOf("if (sessionAuth.holdIfNoCredential(s)) return s;");
  const start = ENGINE.indexOf("await startQuery(s, sdk);");
  const windowless = ENGINE.indexOf("if (spec.windowless && sessionAuth.holdIfNoCredential(s))");
  assert.ok(Math.min(guard, hold, start, windowless) !== -1, "an anchor is gone — reslice rather than pass on -1");
  assert.ok(hold > guard, "the dormant-phase decision is made before the credential is probed");
  assert.ok(start > hold, "and a held launch returns BEFORE the query is started");
  // The WINDOWLESS launch holds too and rolls the registration back, so `launch()` answers honestly
  // instead of handing out a sessionId for a session that will never run.
  assert.ok(windowless < hold, "the windowless preflight precedes the generic one");
  assert.match(ENGINE.slice(windowless, hold), /sessions\.delete\(s\.key\).*return \{ authHold: true \}/s,
    "a held windowless launch un-registers itself and reports the hold");
});

test("the consume loop routes an auth failure to the hold before it can dispatch `crash`", () => {
  assert.match(QUERY, /if \(sessionAuth\.holdIfAuthMessage\(s, msg\)\) return; io\.handleSdkMessage/,
    "the message path consumes the bubble instead of rendering it");
  const hold = QUERY.indexOf("if (sessionAuth.holdIfAuthFailure(s, (err && err.message) || err)) return;");
  const crash = QUERY.indexOf("deps.dispatch(s, { type: 'crash' })", hold);
  assert.ok(hold !== -1 && crash > hold, "the auth branch precedes the crash dispatch");
  assert.match(QUERY, /if \(!isAbortError\(err\)\) \{/, "and an abort is still not an error at all");
});

test("what counts as a usable credential — and what the SPAWN env does about it", () => {
  const probe = AUTH_SRC.slice(AUTH_SRC.indexOf("function credentialState("), AUTH_SRC.indexOf("function forget("));
  // Three sources, most-explicit first. `stored-token` is LAST so it is chosen only when it is the
  // only credential we hold, which is exactly when withStoredCredential injects it.
  assert.match(probe, /if \(envKey\) state = \{ usable: true, source: 'env' \};/);
  assert.match(probe, /else if \(cliStoreSignedIn\(\)\) state = \{ usable: true, source: 'cli-store' \};/);
  assert.match(probe, /else if \(getStoredOAuthToken\(\)\) state = \{ usable: true, source: 'stored-token' \};/);
  // The keychain item is NEVER read: a cross-app read pops an OS prompt, a worse interruption than
  // the bug. Only markers.
  assert.ok(!/security find-generic-password|execFile|spawn\(/.test(AUTH_SRC), "no keychain shell-out");
  const marker = AUTH_SRC.slice(AUTH_SRC.indexOf("function cliStoreSignedIn("), AUTH_SRC.indexOf("function credentialState("));
  assert.match(marker, /\.credentials\.json/, "the file-backed store, when there is one");
  assert.match(marker, /account\.accountUuid/, "else the CLI's own signed-in marker (one bit, no field copied)");
  assert.match(marker, /err\.code !== 'ENOENT'/, "an unreadable file FAILS OPEN; only a MISSING one blocks");
  // The healthy path stays byte-identical: no stored-token source -> the same env object back.
  const envFn = AUTH_SRC.slice(AUTH_SRC.indexOf("function withStoredCredential("), AUTH_SRC.indexOf("// ─── BEGIN SESSION-AUTH-HOLD"));
  assert.match(envFn, /if \(state\.source !== 'stored-token'\) return env;/, "untouched on every other machine");
});

test("the engine injects its OWN startQuery + denyPending (no second query assembly)", () => {
  // ⚠ THE BIND OBJECT LOST ITS LAST MEMBER (F-228): `getSessionBySender` resolved a session from an
  // IPC `event.sender` (a window's webContents) for the two deleted auth handlers. The rest is the
  // point and is unchanged — the hold reuses the engine's OWN startQuery, so a resumed launch
  // inherits H1's supersede-before-relaunch instead of assembling a second query.
  // ⚠ `denyPendingPermissions` MOVED TO `main/session-permissions.js` ON 2026-08-22 (the §2 cap +
  // the denial-copy ruling) and is destructured at the engine's module scope, so this bind reads
  // exactly as it did. What must stay true is that the auth hold is handed the REAL fail-closed
  // sweep and not a stub — a hold that leaves a resolver dangling blocks the SDK child forever.
  assert.match(ENGINE, /sessionAuth\.bind\(\{ sessions, getSdk, startQuery, dispatch, emit, denyPending: denyPendingPermissions \}\)/);
  assert.match(ENGINE, /const \{ denyPendingPermissions, resolvePerm \} = sessionPermissions;/,
    "…and it is the shared one, not a local re-declaration");
  assert.ok(!/getSessionBySender/.test(ENGINE), "no sender-keyed session lookup survives anywhere in the engine");
  assert.match(QUERY, /env: sessionAuth\.withStoredCredential\(buildScrubbedEnv\(\)\)/,
    "and the stored setup-token reaches the SDK env through the SAME scrubbed base");
});
