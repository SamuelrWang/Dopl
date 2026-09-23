// THE ACT HALF of F-692's connect assertion — `main/mcp-connect-guard.js`, driven for real.
//
// ⚠ WHY THIS FILE EXISTS AT ALL. `mcp-connect-guard.test.mjs` is the READ: the SDK's init shape,
// `doplStatus`, `mcpConnectVerdict`, the operator sentence, and three source pins. Every one of
// them is pure. `handleMcpStatus` / `relaunch` / `failVisibly` — the half that kills a launch,
// re-runs it and ends a session visibly — had NO behavioural coverage, and that is how F-696
// shipped: the retry always re-entered the COLD `startQuery`, so a woken parked session was
// relaunched with `s.firstTurn` (`''` after a boot re-park) instead of the framed peer message
// that woke it, and the peer waited forever. A source pin could not have caught it; only driving
// both arms can.
//
// METHOD: the module is required FOR REAL and `bind()` with fakes — it holds no electron of its
// own beyond `diag` and `session-store`, and its whole contract IS the handles it is bound with.
//
// Run: `node --test dopl-desktop-app/test/mcp-connect-guard-act.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require_ = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const guard = require_(join(MAIN, "mcp-connect-guard.js"));
const io = require_(join(MAIN, "session-io.js"));
const mcpConnect = require_(join(MAIN, "mcp-connect.js"));

/** A session mid-launch, with a live push iterator its child has already drained. */
function session(over = {}) {
  const s = {
    key: "c1::a1",
    settled: false,
    state: { phase: "launching", parked: false, activity: "working" },
    runtimeId: "claude",
    firstTurn: "",
    pushIterator: io.makePushIterator(),
    ...over,
  };
  return s;
}

function rig(over = {}) {
  const calls = { startQuery: [], resumeParked: [], abort: [], deny: [], dispatch: [] };
  guard.bind({
    acquireRuntime: async () => ({ __rt: true }),
    startQuery: async (s, rt) => { calls.startQuery.push({ s, rt }); },
    dispatch: (s, ev) => calls.dispatch.push(ev),
    denyPending: (s, why) => calls.deny.push(why),
    abortInFlight: (s) => { calls.abort.push(s.key); s.query = null; },
    // The REAL `resumeParked` contract in one line: it mints a FRESH push iterator synchronously
    // on every path it takes, and returns silently on the ones it refuses.
    resumeParked: (s) => {
      calls.resumeParked.push(s.key);
      if (over.resumeRefuses) return;
      s.pushIterator = io.makePushIterator();
    },
    ...over.deps,
  });
  return calls;
}

const flush = () => new Promise((r) => setImmediate(r));

// ── 1. HEALTHY / UNWIRED ────────────────────────────────────────────────────────────────────

test("a CONNECTED server is not acted on: the stream keeps being read", () => {
  rig();
  assert.equal(guard.handleMcpStatus(session(), mcpConnect.CONNECTED), false);
});

test("a SETTLED session and an UNWIRED guard both answer false rather than throwing", () => {
  rig();
  assert.equal(guard.handleMcpStatus(session({ settled: true }), "failed"), false);
  guard.bind(null);
  assert.equal(guard.handleMcpStatus(session(), "failed"), false,
    "a guard that cannot act must not stop a stream it has no way to replace");
});

// ── 2. THE COLD ARM ─────────────────────────────────────────────────────────────────────────

test("COLD: a first failure denies pending, re-arms the phase and re-enters startQuery", async () => {
  const calls = rig();
  const s = session({ launchVia: "start", state: { phase: "launching", parked: true, activity: "idle" } });

  assert.equal(guard.handleMcpStatus(s, "failed"), true, "the caller must stop reading the dead stream");
  assert.equal(s.mcpConnectAttempt, 1, "the counter lives on the SESSION, or two launches at once share it");
  await flush();

  assert.deepEqual(calls.deny, ["Reconnecting the Dopl MCP server"], "fail closed BEFORE the teardown");
  assert.equal(calls.startQuery.length, 1, "the engine's own deferred launch, never a second spec assembly");
  assert.equal(calls.resumeParked.length, 0);
  // The watchdog re-arms off the phase; `startQuery` is what supersedes the dead child.
  assert.equal(s.state.phase, "launching");
  assert.equal(s.state.parked, false);
  assert.deepEqual(calls.dispatch, [], "a retry is not a visible failure");
});

test("COLD: a SECOND failure ends the session visibly — exactly one retry, ever", async () => {
  const calls = rig();
  const s = session({ launchVia: "start", mcpConnectAttempt: 1 });

  assert.equal(guard.handleMcpStatus(s, "missing"), true);
  await flush();

  assert.equal(calls.startQuery.length, 0, "no second retry");
  assert.match(s.mcpDiag, /MCP unavailable/, "the sentence survives on the session for the card");
  assert.match(s.mcpDiag, /after a retry/);
  assert.deepEqual(calls.dispatch, [{ type: "crash" }], "`crash` is reused, never a fourth terminal path");
  assert.ok(calls.deny.includes(mcpConnect.MCP_UNAVAILABLE_LABEL));
});

test("COLD: a retry whose relaunch THROWS still ends visibly rather than hanging at 'launching'", async () => {
  const calls = rig({ deps: { startQuery: async () => { throw new Error("no runtime"); } } });
  const s = session({ launchVia: "start" });
  guard.handleMcpStatus(s, "failed");
  await flush();
  assert.deepEqual(calls.dispatch, [{ type: "crash" }]);
  assert.match(s.mcpDiag, /MCP unavailable/);
});

// ── 3. THE RESUME ARM (F-696) ───────────────────────────────────────────────────────────────

test("RESUME: the retry goes through resumeParked and REPLAYS the message that woke it", async () => {
  const calls = rig();
  const s = session({ launchVia: "resume", firstTurn: "" }); // a boot re-park carries no first turn
  const woke = io.userMessage("PEER: are you there?");
  s.pushIterator.push(woke);
  await s.pushIterator.next(); // the dead child already drained it — this is the whole defect

  assert.equal(guard.handleMcpStatus(s, "failed"), true);
  await flush();

  assert.equal(calls.startQuery.length, 0, "the COLD lane would push an EMPTY s.firstTurn");
  assert.deepEqual(calls.resumeParked, ["c1::a1"]);
  assert.deepEqual(calls.abort, ["c1::a1"],
    "resumeParked does NOT abort (it normally follows a park), so this lane must");
  assert.deepEqual(s.pushIterator.replayable(), [woke], "the peer's message is on the FRESH iterator");
  assert.deepEqual(calls.deny, ["Reconnecting the Dopl MCP server"]);
});

test("RESUME: input still QUEUED is replayed too, and in order, and only once", async () => {
  rig();
  const s = session({ launchVia: "resume" });
  const a = io.userMessage("first");
  const b = io.userMessage("second");
  s.pushIterator.push(a);
  s.pushIterator.push(b);
  await s.pushIterator.next(); // `a` delivered, `b` still queued

  guard.handleMcpStatus(s, "failed");
  await flush();
  assert.deepEqual(s.pushIterator.replayable(), [a, b], "delivered AND queued, oldest first");
});

test("RESUME: a resume that REFUSES ends visibly rather than leaving an unwakeable Idle pill", async () => {
  const calls = rig({ resumeRefuses: true });
  const s = session({ launchVia: "resume" });

  guard.handleMcpStatus(s, "failed");
  await flush();

  assert.deepEqual(calls.resumeParked, ["c1::a1"], "it was asked");
  assert.deepEqual(calls.dispatch, [{ type: "crash" }], "…and refused, so the agent ENDS");
  assert.match(s.mcpDiag, /MCP unavailable/);
  assert.equal(calls.startQuery.length, 0, "a refused resume must NOT fall back to the cold lane");
});

test("RESUME: with no resumeParked bound at all, the cold lane is the fallback", async () => {
  const calls = rig({ deps: { resumeParked: null } });
  const s = session({ launchVia: "resume" });
  guard.handleMcpStatus(s, "failed");
  await flush();
  assert.equal(calls.startQuery.length, 1, "a mid-wave bind must still retry, not do nothing");
});

// ── 4. THE LANE STAMP IS WRITTEN WHERE THE CHILD IS MADE ────────────────────────────────────

test("the lane is stamped at both spawn sites, and is NOT read off `resumeSdkId`", () => {
  const { readFileSync } = require_("node:fs");
  const q = readFileSync(join(MAIN, "session-query.js"), "utf8");
  const p = readFileSync(join(MAIN, "session-park.js"), "utf8");
  const g = readFileSync(join(MAIN, "mcp-connect-guard.js"), "utf8");
  // ⚠ CODE ONLY for the negative claim below — the guard's docblock says the words `resumeSdkId`
  // while explaining why it does NOT read it, and a raw scan fails on the record of the decision.
  // Same stripping `window-chrome.test.mjs` does, for the same reason.
  const gCode = g.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  // ⚠ ORDERED: a stamp AFTER the spawn is a stamp the guard cannot have read.
  assert.ok(q.indexOf("s.launchVia = 'start';") < q.indexOf("rt.start(buildLaunchSpec(s))") &&
    q.indexOf("s.launchVia = 'start';") > 0, "startQuery must stamp the cold lane before it spawns");
  assert.ok(p.indexOf("s.launchVia = 'resume';") < p.indexOf("rt.resume(deps.buildLaunchSpec(s)") &&
    p.indexOf("s.launchVia = 'resume';") > 0, "startResumedConsumer must stamp the resume lane before it spawns");
  assert.match(g, /s\.launchVia === 'resume'/, "the guard must branch on the stamp");
  assert.equal(/resumeSdkId/.test(gCode), false,
    "`resumeSdkId` is set by startResume, which launches COLD — it cannot answer which lane ran");
  // And the pre-flight really is on BOTH lanes now (the 'route was warmed' claim was false).
  assert.match(p, /deps\.preflightMcp/, "the resume lane lost its MCP pre-flight");
  assert.equal(/does not pass through here and does not need to/.test(q), false,
    "the false 'its route was warmed by the launch it is resuming' comment is back");
});
