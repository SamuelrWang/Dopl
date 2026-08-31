// C-8 — QUITTING MUST NOT ORPHAN RUNNING `claude` CHILDREN.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-8). `before-quit` set `app.isQuitting` and stopped
// the listener. It never iterated the session registry, never aborted a controller, and never
// flushed the final state push — and repo-wide the only `.kill(` in this tree is the auth pty.
// So every live `sdk.query()` left a bundled `claude` child RUNNING after the app was gone,
// still holding that session's PRE-APPROVED `dopl_channel` MCP access and still able to post
// into the channel on behalf of an operator whose app is closed. `session-engine`'s C3
// teardown already solved this for the CRASH path; the quit path never reached it.
//
// SAMUEL'S DECISIONS, one test section each:
//   1. THE DIALOG NAMES THE WORK. Thread title and channel, per row — not "3 agents are
//      running". The point is that the operator recognises what they are interrupting.
//   2. BOTH WAYS FORWARD ARE REAL. "Quit anyway" kills now. "Wait for them to finish" waits
//      and then quits BY ITSELF; it is not a disguised cancel, and it is capped.
//   2b. …AND SINCE 2026-08-30 THERE IS A THIRD, WHICH IS A REAL CANCEL. Both of the original
//      buttons ended in a quit, so an accidental ⌘Q could be deferred but never taken back.
//      "Cancel" aborts outright: no teardown, no latch, no pending auto-quit, `isQuitting` put
//      back. It takes the default, because the safest of three is the one that does nothing.
//      ⚠ It is CHOSEN, never fallen into: every failure still resolves to QUIT (see rule 6).
//   3. MID-TOOL-CALL IS NOT A REASON TO WAIT. On Quit anyway there is no grace period.
//   4. THE PEER IS TOLD. Killed sessions take C-5's calm `inactive` terminal, so the waiting
//      requester's card stops pulsing "Working…" — one terminal path, not a second one.
//   5. THE ROWS ARE FLUSHED IF THAT IS FREE. Raced against a short deadline, never awaited.
//   6. QUITTING ALWAYS REMAINS POSSIBLE. Every failure path lets the quit through.
//
// Run: `node --test dopl-desktop-app/test/quit-guard.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("quit-guard.js");
const REOPEN = M("session-reopen.js");
const INDEX = M("index.js");

const BLOCK = SRC.slice(
  SRC.indexOf("// ─── BEGIN QUIT-GUARD-PURE"),
  SRC.indexOf("// ─── END QUIT-GUARD-PURE")
);
for (const banned of ["require(", "electron", "child_process"]) {
  assert.ok(!BLOCK.includes(banned), `the QUIT-GUARD-PURE block must not reference ${banned}`);
}

const pure = (over = {}) => new Function(
  "deps", "BUTTON_QUIT", "BUTTON_WAIT", "BUTTON_CANCEL", "WAIT_CAP_MS", "diag",
  `${BLOCK}\n return { describeSession, describeAll, quitMessage, buildDialogOptions,
                       waitSatisfied, waitExpired, quitDetailTail };`
)(over.deps || {}, 0, 1, 2, over.cap || 16 * 60 * 1000, () => {});

const s = (o = {}) => ({
  key: "c1:t1", channelName: "Ops", taskTitle: "Ship the invoice import",
  counterpartyName: "David", working: true, ...o,
});

// ── 1. THE DIALOG NAMES THE WORK ─────────────────────────────────────────────────────

test("a row is the THREAD and the CHANNEL, so the operator can recognise it", () => {
  const q = pure();
  const line = q.describeSession(s());
  assert.ok(line.includes("Ship the invoice import"), line);
  assert.ok(line.includes("Ops"), line);
  assert.ok(line.includes("working now"), "…and which one is mid-turn right now");
});

test("a thread with no title still reads as something, and a DM falls back to the peer", () => {
  const q = pure();
  assert.match(q.describeSession(s({ taskTitle: null })), /untitled thread/);
  assert.match(q.describeSession(s({ channelName: null })), /in David/,
    "a DM's channel name is the peer, which is what the operator calls it");
  assert.ok(!q.describeSession(s({ working: false })).includes("working now"));
});

test("the dialog is a LIST, not a count — the count alone was the thing being fixed", () => {
  const q = pure();
  const opts = q.buildDialogOptions([s(), s({ key: "c2:t2", taskTitle: "Fix the importer", channelName: "Eng" })]);
  assert.equal(opts.message, "You have 2 active agent sessions.");
  for (const needle of ["Ship the invoice import", "Fix the importer", "Ops", "Eng"]) {
    assert.ok(opts.detail.includes(needle), `${needle} missing from the dialog body`);
  }
  assert.equal(q.quitMessage([s()]), "You have 1 active agent session.", "…and it reads right for one");
});

test("the copy says what quitting COSTS, that it is PERMANENT, and that the peer will be told", () => {
  const q = pure();
  const opts = q.buildDialogOptions([s()]);
  assert.ok(opts.detail.includes("stops where it is"), opts.detail);
  // 2026-08-30, Samuel's ruling: the dialog must say the ending is PERMANENT, not merely that
  // the agents stop. The teardown settles each record and nothing resumes a settled session.
  assert.ok(opts.detail.includes("permanently"), "the consequence Samuel asked to be named");
  assert.ok(opts.detail.includes("cannot be resumed"), opts.detail);
  assert.ok(opts.detail.includes("went inactive"), "it promises exactly what C-5 posts");
  for (const n of [1, 2]) assert.ok(!/—/.test(q.quitDetailTail(n)), "no em dash in copy");
});

test("the tail is singular/plural aware — one agent is never 'these agents'", () => {
  const q = pure();
  assert.match(q.quitDetailTail(1), /this agent permanently\. It stops where it is/);
  assert.match(q.quitDetailTail(1), /The person waiting is told/);
  assert.match(q.quitDetailTail(3), /these agents permanently\. They stop where they are/);
  assert.match(q.quitDetailTail(3), /The people waiting are told/);
});

// ── 2. BOTH WAYS FORWARD ARE REAL ────────────────────────────────────────────────────

test("the dialog offers THREE, and the default is the one that does nothing at all", () => {
  const q = pure();
  const opts = q.buildDialogOptions([s()]);
  // ⚠ THIS PINNED EXACTLY TWO UNTIL 2026-08-30, and both of them ended in a quit — so an
  // accidental ⌘Q could be deferred but never taken back, and the "safe" default still closed
  // the app minutes later unattended. Cancel is the third, and it is the default.
  assert.deepEqual(opts.buttons, ["Quit anyway", "Wait for them to finish", "Cancel"]);
  assert.equal(opts.defaultId, 2, "Return does nothing — the safest of three has no effect");
  assert.equal(opts.cancelId, 2, "…and Escape means Escape");
});

// ── 2b. CANCEL IS A REAL ABORT (2026-08-30, Samuel's ruling) ─────────────────────────

test("Cancel is wired to its OWN branch, and that branch is checked before the others", () => {
  const prompt = SRC.slice(SRC.indexOf("async function promptThenQuit("));
  assert.match(prompt, /if \(choice === BUTTON_CANCEL\) \{ cancelQuit\(/,
    "Cancel must not fall through to the wait or the kill");
  assert.ok(prompt.indexOf("BUTTON_CANCEL") < prompt.indexOf("BUTTON_WAIT"),
    "…and it is tested first, so no reordering can make Cancel mean Wait");
  assert.equal(SRC.match(/const BUTTON_CANCEL = 2;/) !== null, true);
});

test("cancelQuit tears NOTHING down and does NOT latch — the next quit re-prompts", () => {
  const cancel = SRC.slice(SRC.indexOf("function cancelQuit("), SRC.indexOf("// \"Wait for them to finish\""));
  assert.ok(!/teardown\(|endLiveSessions|flushSessionState|app\.quit\(\)/.test(cancel),
    "an aborted quit must not kill a session, flush the rows, or close the app");
  assert.ok(!/disarmed = true/.test(cancel),
    "latching here would make the NEXT quit skip the dialog entirely");
});

test("Cancel also kills a pending WAIT — the quit is off, not rescheduled", () => {
  const cancel = SRC.slice(SRC.indexOf("function cancelQuit("), SRC.indexOf("// \"Wait for them to finish\""));
  assert.match(cancel, /stopWaiting\(\);/,
    "an auto-quit still ticking after Cancel is the bug this button exists to prevent");
  assert.match(cancel, /prompting = false;/, "…and the dialog is no longer on screen");
});

test("Cancel puts app.isQuitting BACK, so an aborted quit leaves no trace of itself", () => {
  // `onBeforeQuit` sets the flag on the way IN, before it knows the answer. Five modules write
  // it; leaving it true after an abort means the app permanently believes it is on its way out.
  const cancel = SRC.slice(SRC.indexOf("function cancelQuit("), SRC.indexOf("// \"Wait for them to finish\""));
  assert.match(cancel, /app\.isQuitting = false;/);
  assert.match(cancel, /try \{ app\.isQuitting = false; \} catch/, "even this is survivable");
});

test("the wait is satisfied when nobody is mid-turn — that is what 'finish' means", () => {
  const q = pure();
  assert.equal(q.waitSatisfied([s({ working: true })]), false);
  assert.equal(q.waitSatisfied([s({ working: false }), s({ key: "c2:t2", working: false })]), true);
  assert.equal(q.waitSatisfied([]), true, "and an empty registry is trivially done");
});

test("the wait is CAPPED, and the cap is derived rather than picked", () => {
  const q = pure();
  assert.equal(q.waitExpired(1000, 1000), false);
  assert.equal(q.waitExpired(1000 + 16 * 60 * 1000, 1000), true);
  // An agent mid-turn that stops producing is PARKED by its own idle TTL, and a parked
  // session holds no child — so the wait terminates on its own inside one TTL for anything
  // that is going to terminate at all. The cap is that bound plus a minute for the park to
  // land and the projection (200ms coalesce) to catch up.
  const { DEFAULT_IDLE_MS } = new Function(
    `${M("session-state.js").slice(
      M("session-state.js").indexOf("// ─── BEGIN SESSION-STATE"),
      M("session-state.js").indexOf("// ─── END SESSION-STATE")
    )}\n return { DEFAULT_IDLE_MS };`
  )();
  const capExpr = /const WAIT_CAP_MS = ([^;]+);/.exec(SRC);
  assert.ok(capExpr, "WAIT_CAP_MS not found");
  assert.match(capExpr[1], /DEFAULT_IDLE_MS/, "the cap must be derived from the idle TTL");
  assert.match(SRC, /const \{ DEFAULT_IDLE_MS \} = require\('\.\/session-state'\);/,
    "…from the real constant, not a copy of its value");
  assert.ok(DEFAULT_IDLE_MS > 0);
});

test("the wait path is a real quit: it calls finishQuit itself, and says so out loud", () => {
  const waiting = SRC.slice(SRC.indexOf("function startWaiting()"));
  assert.match(waiting, /waitSatisfied\(list\)\) \{ void finishQuit\(/, "it quits by itself when done");
  assert.match(waiting, /waitExpired\(Date\.now\(\), waitStartedAt\)/, "…and when the cap runs out");
  assert.match(waiting, /notify\(/, "the operator is told the app is waiting, not that it ignored them");
  assert.match(waiting, /Choose Quit again to stop them now/, "…and how to get back out");
});

test("a SECOND quit while waiting re-opens the dialog — Quit anyway is always one click away", () => {
  const handler = SRC.slice(SRC.indexOf("function onBeforeQuit("));
  assert.match(handler, /stopWaiting\(\);\s*\n\s*void promptThenQuit\(list\);/,
    "the wait is cancelled and the choice is offered again");
  assert.match(handler, /if \(prompting\) \{ event\.preventDefault\(\); return; \}/,
    "…but a dialog already on screen is never stacked twice");
});

// ── 3. NO GRACE PERIOD, and 4. THE PEER IS TOLD ──────────────────────────────────────

test("Quit anyway tears down immediately — there is no wait for the current tool call", () => {
  const teardown = SRC.slice(SRC.indexOf("async function teardown("), SRC.indexOf("function stopWaiting()"));
  assert.match(teardown, /deps\.endLiveSessions\(\)/);
  // The ONLY await in the teardown is the raced flush, i.e. the wire, not the child.
  assert.equal((teardown.match(/await /g) || []).length, 1,
    "the kill is synchronous; nothing waits on the agent");
  assert.ok(teardown.indexOf("deps.endLiveSessions()") < teardown.indexOf("await"),
    "…and it happens BEFORE the flush deadline, not after it");
});

test("the killed sessions take C-5's calm terminal — not a second teardown path", () => {
  const end = REOPEN.slice(REOPEN.indexOf("function endLiveSessions()"));
  assert.match(end, /deps\.dispatch\(s, \{ type: 'inactive' \}\)/,
    "the SAME event the launch watchdog and the window-budget eviction use");
  assert.ok(!/settle\(|destroy\(|abortController/.test(end),
    "quit must not grow its own teardown beside the reducer's");
});

test("one throwing session cannot stop the quit — the loop is guarded per session", () => {
  const end = REOPEN.slice(REOPEN.indexOf("function endLiveSessions()"));
  assert.match(end, /try \{ deps\.dispatch\(s, \{ type: 'inactive' \}\); ended \+= 1; \} catch/);
});

// ── THE PREDICATE: what actually holds a child ───────────────────────────────────────

function reopen() {
  const block = REOPEN.slice(
    REOPEN.indexOf("// ─── BEGIN SESSION-REOPEN-PURE"),
    REOPEN.indexOf("// ─── END SESSION-REOPEN-PURE")
  );
  const sessions = new Map();
  const dispatched = [];
  const api = new Function("store", `${block}\n return { bind, listOrphanRisk, endLiveSessions };`)(
    { sessionKey: (c, t) => `${c}:${t}` }
  );
  api.bind({ sessions, dispatch: (s, ev) => dispatched.push([s.key, ev.type]) });
  return { ...api, sessions, dispatched };
}

const live = (key, over = {}) => ({
  key, settled: false, context: { channelName: "Ops", taskTitle: "T " + key },
  counterpartyName: "David",
  state: { parked: false, activity: "working", ...(over.state || {}) },
  ...over,
});

test("the set is 'holds a live child', NOT 'is working' — an idle session owns one too", () => {
  // A session between turns sits at activity 'idle' with its push iterator open and the
  // process alive. Reading the pill state here would have spared exactly those, which are
  // the majority of the orphans.
  const r = reopen();
  r.sessions.set("a", live("a", { state: { parked: false, activity: "idle" } }));
  r.sessions.set("b", live("b", { state: { parked: false, activity: "awaiting_peer" } }));
  assert.deepEqual(r.listOrphanRisk().map((x) => x.key).sort(), ["a", "b"]);
  assert.deepEqual(r.listOrphanRisk().map((x) => x.working), [false, false],
    "…they are named as not-working, and killed anyway");
  assert.equal(r.endLiveSessions(), 2);
});

test("a PARKED session is left alone: its query is already torn down, so it orphans nothing", () => {
  const r = reopen();
  r.sessions.set("p", live("p", { state: { parked: true, activity: "parked" } }));
  r.sessions.set("s", { key: "s", settled: true, state: { parked: false } });
  assert.deepEqual(r.listOrphanRisk(), []);
  assert.equal(r.endLiveSessions(), 0);
  assert.deepEqual(r.dispatched, [], "settling a parked record would rewrite its phase for nothing");
});

test("the dialog list and the kill list are the SAME predicate — one cannot name what the other spares", () => {
  const r = reopen();
  r.sessions.set("a", live("a"));
  r.sessions.set("p", live("p", { state: { parked: true } }));
  const named = r.listOrphanRisk().map((x) => x.key);
  r.endLiveSessions();
  assert.deepEqual(r.dispatched.map(([k]) => k), named);
  assert.match(REOPEN, /function liveChildSessions\(\)/, "…because both read one function");
});

// ── 5. THE FINAL FLUSH IS RACED, NEVER AWAITED ───────────────────────────────────────

test("the flush is bounded, and the bound is stated as a quit-perception number", () => {
  assert.match(SRC, /const FLUSH_DEADLINE_MS = 1500;/);
  const teardown = SRC.slice(SRC.indexOf("async function teardown("), SRC.indexOf("function stopWaiting()"));
  assert.match(teardown, /Promise\.race\(\[/, "raced — never a bare await");
  assert.match(teardown, /sleep\(FLUSH_DEADLINE_MS\)\.then\(\(\) => false\)/);
  assert.match(teardown, /SKIPPED/, "a flush that did not land says so, and says what it costs");
  // `send` carries a 15s HTTP timeout and one retry: right for a running app, absurd for a quit.
  assert.match(M("session-state-push.js"), /const HTTP_TIMEOUT_MS = 15000;/);
});

test("the push exposes an AWAITABLE flush, so the race has something to race", () => {
  const push = M("session-state-push.js");
  assert.match(push, /function flush\(\)/);
  assert.match(push, /return draining \|\| Promise\.resolve\(\);/);
  assert.match(push, /draining = drain\(\);/, "the in-flight cycle is captured, not fire-and-forgotten");
});

// ── 6. QUITTING ALWAYS REMAINS POSSIBLE ──────────────────────────────────────────────

test("every failure path lets the quit through — the latch, the dialog, the registry", () => {
  const handler = SRC.slice(SRC.indexOf("function onBeforeQuit("));
  assert.match(handler, /if \(disarmed\) return;/, "a second pass never re-prompts");
  assert.match(handler, /catch \(err\) \{[\s\S]*?disarmed = true;/,
    "any throw in before-quit latches and allows the quit");
  assert.match(SRC, /diag\('quit-guard: the confirmation dialog failed[\s\S]*?await finishQuit\('dialog failed'\)/,
    "a dialog that cannot be shown must not become a quit that cannot happen");
  assert.match(SRC, /function orphanRisk\(\)[\s\S]*?return \[\];[\s\S]*?\}/,
    "an unreadable registry reads as 'nothing running', which quits");
});

test("the fail-open fallback is QUIT, never the new CANCEL — Cancel must be CHOSEN", () => {
  // Adding a third button added a way to get this exactly backwards: if a dialog that throws or
  // answers garbage resolved to Cancel, a broken dialog would become an app that cannot be
  // closed — rule (6) inverted by one constant.
  const prompt = SRC.slice(SRC.indexOf("async function promptThenQuit("));
  assert.match(prompt, /let choice = BUTTON_QUIT;/, "the pre-answer default is the quit");
  assert.match(prompt, /res && typeof res\.response === 'number' \? res\.response : BUTTON_QUIT/,
    "a malformed answer quits rather than silently cancelling");
  assert.ok(!/= BUTTON_CANCEL;/.test(prompt), "nothing may DEFAULT to Cancel");
});

test("no live agents means no dialog at all — the teardown just runs", () => {
  const handler = SRC.slice(SRC.indexOf("function onBeforeQuit("));
  assert.match(handler, /if \(!list\.length\) \{ disarmed = true; void teardown\(/);
  assert.ok(handler.indexOf("if (!list.length)") < handler.indexOf("event.preventDefault();\n    stopWaiting();"),
    "the quit is only held when there is something to hold it for");
});

test("finishQuit is the ONE exit: it latches, tears down, and re-issues app.quit()", () => {
  const finish = SRC.slice(SRC.indexOf("async function finishQuit("), SRC.indexOf("function startWaiting()"));
  assert.match(finish, /disarmed = true;/);
  assert.match(finish, /try \{ await teardown\(reason\); \} catch/);
  assert.match(finish, /try \{ app\.quit\(\); \} catch/, "even a throwing quit call is survivable");
});

// ── THE WIRING ───────────────────────────────────────────────────────────────────────

test("index.js hands over the whole decision, and keeps none of the old handler", () => {
  assert.match(INDEX, /quitGuard\.arm\(\{/);
  assert.ok(!/app\.on\('before-quit'/.test(INDEX),
    "the two-line handler is gone; quit-guard owns before-quit");
  assert.match(INDEX, /listOrphanRisk: \(\) => sessionEngine\.listOrphanRisk\(\)/);
  assert.match(INDEX, /endLiveSessions: \(\) => sessionEngine\.endLiveSessions\(\)/);
  assert.match(INDEX, /flushSessionState: \(\) => require\('\.\/session-state-push'\)\.flush\(\)/);
  assert.match(SRC, /app\.isQuitting = true;/, "the flag every other module reads is still set first");
});
