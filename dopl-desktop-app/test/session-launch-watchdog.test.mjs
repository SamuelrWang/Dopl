// C-4 — A LAUNCH THAT NEVER EMITS `system/init` MUST NOT JAM ITS SLOT FOREVER.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-4). `startSession` built the session with
// `idleTimer: null` and never armed one. The timer is armed ONLY by reducer effects that
// require the `launched` event, and `launched` is dispatched ONLY by the SDK's `system/init`.
// So a child that boots and never speaks — a hung MCP handshake, a wedged model start, a
// binary that starts and stalls — sat at phase 'launching' with no watchdog of any kind:
//   · `hasLiveSession` stays true, so every later request into that (channel, thread) slot
//     answers `{skipped:'busy'}` and the peer is told to resend, forever;
//   · the slot counts against MAX_WINDOWS, so six of them and the desktop opens nothing;
//   · no `thread_started` was ever posted, so the requester has nothing to look at either.
// There was no path out of it short of quitting the app.
//
// WHAT THIS FILE PINS:
//   1. THE BOUND IS ARMED, through the ONE timer decision (`session-state.idleTimeout`)
//      rather than a second timer beside it.
//   2. THE NUMBER IS EVIDENCE, not a guess — asserted as RELATIONS against the constants in
//      this tree that bracket it, so moving any of them fails here rather than drifting
//      silently (the test/mcp-client-timeout.test.mjs precedent).
//      `session-spawner.MAX_RUNTIME_MS`, the third bracket, was deleted with the headless lane;
//      the value itself is pinned directly. The other two (MCP_CLIENT_TIMEOUT_MS below it, DEFAULT_IDLE_MS / ABANDONED_MS above)
//      are untouched and still bracket it from both sides.
//   3. A REAL LAUNCH CANCELS IT. `launched` re-arms the ordinary idle TTL, so the watchdog
//      can only ever fire on a session that never started.
//   4. EXPIRY SETTLES IT THE WAY EVERY OTHER TERMINAL PATH DOES — it posts, and it frees
//      the slot (see session-inactive-notice.test.mjs for the message itself).
//
// Run: `node --test dopl-desktop-app/test/session-launch-watchdog.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// ⚠ IMPORTED FOR THE BEHAVIOURAL SECTION (2026-10-11). The two bounds this file is about are five and
// fifteen minutes, so driving them needs a clock over the engine's one timer rather than patience.
import * as clock from "./_engine-clock.mjs";
import { engine, rt, frames, settle, registryReads, launchArgs, CHANNEL, ME } from "./_engine-harness.mjs";
import { loadReducer } from "./_reducer-block.mjs";
import { codeOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const QUERY = M("session-query.js");
const ENGINE = M("session-engine.js");
const { WORK_CAP_MS } = createRequire(import.meta.url)(join(HERE, "..", "main", "session-work-cap.js"));

const {
  initialSessionState, sessionReducer, idleTimeout, LAUNCHING_MS, DEFAULT_IDLE_MS, ABANDONED_MS,
} = loadReducer();

engine.setSelfIdentity(ME);

// Raw Claude frames the harness does not carry (`runtime/claude/normalize.js › renderEvents`).
const toolUse = (id) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: "ls" } }] },
});
const toolResult = (id) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: "ok" }] },
});

/** One real windowless session on the real engine, with its runtime handle and registry entry. */
async function liveSession(agentName) {
  const before = rt.handles.length;
  const res = await engine.launchResponderSession(launchArgs({ threadId: "", agentName }));
  assert.ok(res && res.sessionId, `launched: ${JSON.stringify(res)}`);
  await settle();
  const s = registryReads.sessionOn({ channelId: CHANNEL, threadId: "", agentId: res.agentId });
  assert.ok(s, "registered");
  return { handle: rt.handles[before], s, agentId: res.agentId };
}

const launching = (opts) => initialSessionState(opts);
const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;

// ── 1. THE BOUND IS ARMED, THROUGH THE ONE TIMER DECISION ────────────────────────────

test("a LAUNCHING session's timer is the launch bound, not the idle TTL", () => {
  assert.deepEqual(idleTimeout(launching()), { ms: LAUNCHING_MS, type: "inactive" });
});

test("…and the launching branch is checked FIRST, because the other two would both claim it", () => {
  // A launching state has `parked: false` and `activity: 'working'`, so without the new
  // branch it fell through to the fifteen-minute idle TTL — which is what a session that
  // has ALREADY started gets, and is exactly the wrong answer for one that never did.
  const s = launching();
  assert.equal(s.phase, "launching");
  assert.equal(s.parked, false);
  assert.equal(s.activity, "working");
  assert.notEqual(idleTimeout(s).ms, DEFAULT_IDLE_MS);
});

test("there is ONE timer, so the watchdog cannot leak beside the idle one", () => {
  // session-state.idleTimeout is the whole timer decision (bound + event) and the engine's
  // scheduleIdle is one clearTimeout + one setTimeout over it. A second timer would be a
  // second thing to clear on settle.
  assert.equal((ENGINE.match(/setTimeout\(/g) || []).length, 1, "one arming site in the engine");
  // ⚠ THE EVENT IS STILL `t.type`, WHICH IS THE WHOLE FENCE. 2026-10-10 made the DURATION negotiable — a
  // work re-arm is clamped to what is left of the continuous-work cap (`session-work-cap.js`) so a long
  // thread is not parked mid-tool-call — but the clamp may only ever SHORTEN an `idle_timeout`. If it could
  // also choose the event, a cap could fire the launch watchdog and end a launch the transport can still
  // recover, which is exactly what this file exists to prevent. The event this file's one arming site
  // dispatches is `t.type` and nothing else.
  assert.match(ENGINE, /dispatch\(s, \{ type: t\.type \}\)/, "the ONE event the timer can dispatch");
  assert.equal(/dispatch\(s, \{ type: '/.test(codeOf(ENGINE).slice(codeOf(ENGINE).indexOf("function scheduleIdle("))), false,
    "and scheduleIdle never names an event literally — it could only be the wrong one");
});

// ── 2b. THE CLAMP AND THE WATCHDOG, DRIVEN RATHER THAN GREPPED ───────────────────────
//
// ⚠ WHAT THESE REPLACE, AND WHY (2026-10-11, review item 6). This section used to be two regexes over
// the WHOLE engine source: an exact match on the timer callback's text, and
// `assert.match(ENGINE, /t\.type === 'idle_timeout'/, "the clamp is gated on the ORDINARY park")`. The
// second one searched the entire file, so a COMMENT mentioning the expression satisfied it — and
// nothing anywhere asserted that the engine actually shortens a work re-arm, or that it leaves the
// watchdog alone. Both of those are now driven through the real engine over a virtual clock.

test("THE ENGINE REALLY SHORTENS A WORK RE-ARM — the clamp, not a comment about the clamp", async () => {
  const T0 = clock.freeze(Date.now());
  const h = await liveSession("Clamp");
  h.handle.feed(frames.init("sdk-clamp"));
  await settle();
  assert.equal(clock.armedMs(h.s), DEFAULT_IDLE_MS, "`launched` arms the ordinary TTL in full");

  // Start a work stretch, then carry it to within five minutes of the two-hour cap.
  h.handle.feed(toolUse("w1"));
  h.handle.feed(toolResult("w1"));
  await settle();
  assert.equal(h.s.workSince, T0);
  clock.advance(WORK_CAP_MS - 5 * 60 * 1000);
  h.handle.feed(toolUse("w2"));
  h.handle.feed(toolResult("w2"));
  await settle();
  assert.equal(clock.armedMs(h.s), 5 * 60 * 1000, "shortened to what the cap has left");
  assert.ok(clock.armedMs(h.s) < DEFAULT_IDLE_MS, "a work re-arm only ever SHORTENS");
});

test("…and a live frame while LAUNCHING does not touch the watchdog AT ALL", async () => {
  // THE DEFECT (review item 4). The clamp was gated on `t.type === 'idle_timeout'`; the ARMING was not.
  // So a runtime that streams before `system/init` — an assistant block, a thinking block, a tool call —
  // re-armed the five-minute WATCHDOG, at its full length and with no cap on top of it, on every frame.
  // That is an unboundedly extendable bound on exactly the session this whole file exists to bound, and
  // `scheduleIdle`'s own doc claimed the watchdog was "left exactly as they were".
  clock.freeze(Date.now());
  const h = await liveSession("Pre Init");
  assert.equal(h.s.state.phase, "launching", "no `system/init` yet");
  assert.equal(clock.armedMs(h.s), LAUNCHING_MS, "startQuery armed the watchdog");
  const armed = h.s.idleTimer;

  // Frames arrive BEFORE init. Each one is live work, so each one emits a work re-arm.
  for (const f of [frames.say("thinking out loud"), toolUse("pre1"), frames.say("still going")]) {
    h.handle.feed(f);
    await settle();
    assert.equal(h.s.idleTimer, armed, "the watchdog's own timer is untouched — not cleared, not re-armed");
    assert.equal(h.s.state.phase, "launching");
  }
  assert.equal(clock.armedMs(h.s), LAUNCHING_MS, "and it still measures the launch, from the launch");

  // …and it still FIRES, which is the property the extension defeated: the slot is freed.
  clock.advance(LAUNCHING_MS);
  assert.equal(clock.expire(h.s), true);
  await settle();
  assert.equal(h.s.state.phase, "ended", "a launch that never spoke is ended, and its slot freed");
});

// ── 2. THE NUMBER IS EVIDENCE ────────────────────────────────────────────────────────

function constFrom(src, name) {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(src);
  assert.ok(m, `${name} not found`);
  return new Function(`return (${m[1]});`)();
}

test("the launch bound sits ABOVE this process's own MCP client abort", () => {
  // 290s is the longest a single MCP request may hold before `mcp-config` aborts it. Declaring
  // a launch dead UNDER that would kill a session while the transport's own abort was still
  // the thing about to unstick it.
  const mcpClient = constFrom(M("mcp-config.js"), "MCP_CLIENT_TIMEOUT_MS");
  assert.equal(mcpClient, 290_000, "if this moved, re-derive the launch bound rather than this line");
  assert.ok(LAUNCHING_MS > mcpClient, `${LAUNCHING_MS} must exceed ${mcpClient}`);
});

test("…and it stays five minutes, with no second runtime bound in the spawner facade", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This read "…and it
  // MATCHES the headless lane's answer to the same question" and asserted
  // `LAUNCHING_MS === constFrom(M("session-spawner.js"), "MAX_RUNTIME_MS")` — this tree's
  // existing statement that a `claude` child which has produced nothing in five minutes has
  // failed. ONE answer, BOTH lanes, which was the whole argument: the number was not chosen, it
  // was inherited.
  //
  // `MAX_RUNTIME_MS` is deleted with the `claude -p` executor — `session-spawner.js` is now a
  // 46-line re-export facade — so the comparison has nothing on its right-hand side and the
  // `constFrom` regex would throw on a missing const.
  assert.equal(LAUNCHING_MS, 5 * 60 * 1000, "five minutes — the headless lane's MAX_RUNTIME_MS, inherited");
  // …and the deleted lane must not have quietly grown a second answer somewhere.
  assert.ok(!/MAX_RUNTIME_MS\s*=/.test(codeOf(M("session-spawner.js"))),
    "session-spawner.js is a re-export facade now — a runtime bound reappearing there is a second executor");
});

test("…and it is many times the repo's own price for the handshake it is waiting on", () => {
  // HOLD_MARGIN_MS is documented as what the MCP route needs for "auth + MCP boot + the
  // workspace handshake" — precisely the work between spawning the child and `system/init`.
  const BUDGET = readFileSync(
    join(HERE, "..", "..", "packages", "mcp-server", "src", "tools", "channel-hold-budget.ts"),
    "utf8"
  );
  const m = /export const HOLD_MARGIN_MS = ([\d_]+);/.exec(BUDGET);
  assert.ok(m, "HOLD_MARGIN_MS not found");
  const margin = Number(m[1].replace(/_/g, ""));
  assert.ok(LAUNCHING_MS >= 5 * margin, `${LAUNCHING_MS} should be well above ${margin}`);
});

test("…and it is comfortably UNDER the idle TTL, so the two can never be confused", () => {
  assert.ok(LAUNCHING_MS < DEFAULT_IDLE_MS);
  assert.ok(LAUNCHING_MS < ABANDONED_MS);
  assert.equal(LAUNCHING_MS * 3, DEFAULT_IDLE_MS, "one third — stated in the source, pinned here");
});

// ── 3. A REAL LAUNCH CANCELS IT ──────────────────────────────────────────────────────

test("`launched` re-arms the ORDINARY idle TTL over the watchdog", () => {
  const r = sessionReducer(launching(), { type: "launched", payload: { type: "init" } });
  assert.ok(r.effects.some((e) => e.type === "scheduleIdle"), "the launch re-arms the one timer");
  assert.deepEqual(idleTimeout(r.state), { ms: DEFAULT_IDLE_MS, type: "idle_timeout" },
    "…and it now measures idleness, which is what it always meant");
});

test("every later arming site reads a NON-launching phase, so none of them re-arms the watchdog", () => {
  const s = running();
  for (const ev of [
    { type: "result", turnCostUsd: 0 },
    { type: "steer", text: "go" },
    { type: "permission_request", requestId: "r1", name: "Bash", payload: {} },
  ]) {
    const next = sessionReducer(s, ev);
    assert.ok(next.effects.some((e) => e.type === "scheduleIdle"), ev.type);
    assert.notEqual(idleTimeout(next.state).type, "inactive", `${ev.type} must not re-arm the watchdog`);
  }
});

// ── 4. EXPIRY SETTLES IT LIKE EVERY OTHER TERMINAL PATH ──────────────────────────────

test("the watchdog's event ENDS the session — abort, post, settle, slot freed", () => {
  const r = sessionReducer(launching(), { type: "inactive" });
  assert.equal(r.state.phase, "ended", "terminal at the top of the reducer");
  const types = r.effects.map((e) => e.type);
  // ⚠ `notice` JOINED EVERY UNCHOSEN END IN #3201 — a child that never spoke is exactly the
  // shape nobody was told about — and the claim here is unchanged: this is the SAME list the
  // other unchosen end (`abandoned`) produces, so there is still no second teardown path.
  assert.deepEqual(types, ["abortQuery", "lifecycle", "notice", "emit", "settle"],
    "the SAME shape every other real end produces — no second teardown path");
  assert.ok(r.effects.some((e) => e.type === "settle" && e.outcome === "ended"),
    "settle is what deletes the registry entry, which is what frees the MAX_WINDOWS slot");
});

test("…and the ended session really is inert: nothing can wake the jammed slot back up", () => {
  const ended = sessionReducer(launching(), { type: "inactive" }).state;
  for (const ev of [{ type: "steer", text: "hi" }, { type: "inbound_arrived", message: "hi", authorName: "B" },
    { type: "launched", payload: {} }, { type: "result", turnCostUsd: 0 }]) {
    assert.deepEqual(sessionReducer(ended, ev).effects, [], `${ev.type} cannot revive it`);
  }
});

// ── THE ARMING SEAM ──────────────────────────────────────────────────────────────────

test("startQuery arms it, so every launch through it is covered by one line", () => {
  // HERE rather than in startSession: `startQuery` is the ONE deferred launch (the cold lane and
  // the MCP-guard retry), so each is covered by the same line rather than a second one.
  const body = QUERY.slice(QUERY.indexOf("async function startQuery("));
  assert.match(body, /deps\.scheduleIdle\(s\)/, "the watchdog is armed inside startQuery");
  // ⚠ 2026-08-31 (runtime-adapter port): the query is started through the runtime rather than a
  // platform handle held here. The ORDER this pins is unchanged and is the whole point.
  assert.ok(body.indexOf("rt.start(buildLaunchSpec(s))") < body.indexOf("deps.scheduleIdle(s)"),
    "armed AFTER the query exists, so a throwing assembly leaves no orphan timer");
  assert.match(ENGINE, /sessionQuery\.bind\(\{ dispatch, scheduleIdle \}\)/,
    "and the engine hands its OWN scheduleIdle in — never a second timer implementation");
});
