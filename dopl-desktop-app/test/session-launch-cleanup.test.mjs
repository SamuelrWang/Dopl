// A FAILED LAUNCH LEAVES NOTHING BEHIND — and it cleans up EXACTLY ONCE (2026-09-21, U10).
//
// ⚠ THE PROPERTY, IN THE PLAN'S WORDS: *"a failed Codex launch must not leave a visible launching
// pill, an occupied slot, a pending approval, or an orphan process."* Every one of those four is a
// different structure with a different owner, and the dangerous failure is not "cleanup did not
// happen" — it is "cleanup happened TWICE", because a second teardown re-denies resolvers that
// are already settled, re-freezes a history row, and re-deletes a registry key that a racing
// relaunch may by then own.
//
// ⚠ WHY IT CAN BE DRIVEN WITH NO CODEX CLI. Nothing below spawns anything. The adapter's own
// `start()` catches a connect failure and hands back a handle whose STREAM fails (`launch-spec.js
// › start`'s try/catch around `client.connect`), so the whole cleanup path is reachable from a
// binary that does not exist — which, per the plan's Implementation Log (2026-09-21), is the only
// kind this machine has.
//
// ⚠ THE THREE LAYERS ARE TESTED WHERE THEY LIVE:
//   1. the ADAPTER answers a failed start with a failing stream, not a throw into the funnel;
//   2. `session-query.js › consume` turns that into ONE `crash` and stamps the STRUCTURED code;
//   3. `session-teardown.js › settle` performs the sweep once and is idempotent after it.
//
// Run: `node --test dopl-desktop-app/test/session-launch-cleanup.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf, codeOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);
const read = (p) => readFileSync(join(MAIN, p), "utf8");

const QUERY = read("session-query.js");
const TEARDOWN = read("session-teardown.js");
const PERMS = read("session-permissions.js");

// ── 1. THE ADAPTER: A FAILED START IS A FAILING STREAM, NEVER A THROW INTO THE FUNNEL ────────
//
// ⚠ THE DISTINCTION IS THE WHOLE CLEANUP STORY. `session-launch.js › launch` does
// `await deps.startSession(...)` with NO try/catch, and `startSession` registers the session
// BEFORE it starts the query — so an adapter that threw synchronously out of `start()` would
// reject `launch`'s promise with the slot already taken, the pill already pushed and nothing left
// holding a handle to tear either down. Answering with a handle whose stream REJECTS routes the
// failure into `consume`, which is the one place that knows how to end a session.

test("the Codex adapter answers an unresolvable binary with a handle whose STREAM fails", async () => {
  const launchSpec = require_(join(MAIN, "runtime/codex/launch-spec.js"));
  const resolveBin = require_(join(MAIN, "runtime/codex/resolve-bin.js"));
  const prior = process.env.DOPL_CODEX_BIN;
  // ⚠ AN OVERRIDE THAT DOES NOT RESOLVE IS AN ERROR, NOT A FALLBACK (U2's rule) — which is
  // exactly the "no codex on this machine" shape, made deterministic.
  process.env.DOPL_CODEX_BIN = join(HERE, "no-such-codex-binary-9f3a");
  resolveBin.forget();
  try {
    const spec = {
      session: { key: "c1:t1:a1", state: {} },
      args: [], env: {}, cwd: HERE,
      dispatch: () => {}, emitQuiet: () => {},
    };
    let handle;
    assert.doesNotThrow(() => { handle = launchSpec.start(spec); },
      "start() must not throw into the launch funnel — the slot is already taken by then");
    assert.equal(typeof handle.close, "function", "…and it must still be a closeable handle");
    await assert.rejects(
      (async () => { for await (const _ of handle) { /* drains into the rejection */ } })(),
      "the failure has to arrive where `consume` can see it"
    );
    // ⚠ CLOSING A HANDLE THAT NEVER CONNECTED MUST BE SAFE AND IDEMPOTENT: `settle` aborts and
    // the reducer's `abortQuery` effect may reach the same object.
    assert.doesNotThrow(() => { handle.close(); handle.close(); });
  } finally {
    if (prior === undefined) delete process.env.DOPL_CODEX_BIN;
    else process.env.DOPL_CODEX_BIN = prior;
    resolveBin.forget();
  }
});

// ── 2. `consume`: ONE crash, and the STRUCTURED code that makes it readable ──────────────────

/** The shipped consumer loop, with fakes for the four modules it reaches. */
function consumeHarness(over = {}) {
  const calls = { dispatch: [], diag: [] };
  const deps = { dispatch: (s, ev) => calls.dispatch.push(ev) };
  const io = { applyCoreEvents: () => null };
  const sessionAuth = { holdIfAuthFailure: () => false };
  const mcpGuard = { handleMcpStatus: () => false };
  const fn = new Function(
    "io", "store", "diag", "sessionAuth", "mcpGuard", "deps",
    `${fnOf(QUERY, "normalizeCtx")}
     async ${fnOf(QUERY, "consume")}
     ${fnOf(QUERY, "isAbortError")}
     return consume;`
  )(io, {}, (...p) => calls.diag.push(p.join(" ")), sessionAuth, mcpGuard, deps);
  return { consume: fn, calls, ...over };
}

/** A query whose stream rejects on the first pull — the adapter's failed-start shape. */
function failingQuery(message) {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.reject(new Error(message)) };
    },
  };
}

const rtFor = () => ({ normalize: () => [] });

test("a stream that fails before any conversation exists dispatches ONE crash, coded as a START failure", async () => {
  const h = consumeHarness();
  const q = failingQuery("codex app-server exited before initialize");
  const s = { key: "c1:t1:a1", settled: false, query: q };
  await h.consume(s, q, rtFor());
  assert.deepEqual(h.calls.dispatch.map((e) => e.type), ["crash"], "exactly one terminal");
  // ⚠ THE CODE, NOT THE STRING. `text` is one runtime's own error prose — unbranchable,
  // uncountable, and impossible to re-say in another runtime's words, which is how a Codex
  // process failure came to be reported as a generic SDK problem.
  assert.equal(s.endCode, "runtime-start-failed");
  // 🔒 AND THE RUNTIME'S OWN WORDS STAY ON THE LOCAL DIAG LINE, never on the code.
  assert.ok(h.calls.diag.some((l) => l.includes("codex app-server exited before initialize")));
});

test("a stream that fails AFTER a conversation exists is coded as a CRASH, not a start failure", async () => {
  const h = consumeHarness();
  const q = failingQuery("connection reset");
  const s = { key: "c1:t1:a1", settled: false, query: q, sdkSessionId: "thread-1" };
  await h.consume(s, q, rtFor());
  assert.equal(s.endCode, "runtime-crashed");
});

test("a SUPERSEDED loop dispatches nothing — the crash belongs to whoever still owns the query", async () => {
  // ⚠ A park→resume swaps `s.query`, and a late rejection from the OLD stream must not end the
  // session the NEW one is driving. That is one of the two ways "cleanup twice" is reachable.
  const h = consumeHarness();
  const q = failingQuery("late rejection from a torn-down query");
  const s = { key: "c1:t1:a1", settled: false, query: { __fresh: true } };
  await h.consume(s, q, rtFor());
  assert.deepEqual(h.calls.dispatch, []);
  assert.equal(s.endCode, undefined, "and it does not stamp a code over a live session either");
});

test("an existing code is never overwritten — the FIRST diagnosis is the true one", async () => {
  // ⚠ `mcp-connect-guard.js › failVisibly` stamps `mcp-unreachable` and then crashes the session,
  // which lands here. Overwriting it would replace the specific cause with the generic one.
  const h = consumeHarness();
  const q = failingQuery("stream closed");
  const s = { key: "c1:t1:a1", settled: false, query: q, endCode: "mcp-unreachable" };
  await h.consume(s, q, rtFor());
  assert.equal(s.endCode, "mcp-unreachable");
});

// ── 3. `settle`: THE SWEEP RUNS ONCE, AND THE SECOND CALL IS A NO-OP ─────────────────────────

/** The shipped `settle` + the shipped `denyPendingPermissions`, with fakes for their world. */
function settleHarness() {
  const calls = { saved: [], deleted: [], tray: 0, denied: [], frozen: [] };
  const sessions = new Map();
  const store = { saveRecord: (r) => calls.saved.push(r), clearSdkSessionId: () => {} };
  const sessionSummary = { noteEnded: () => true, touch: () => {} };
  const agentHistory = { record: (r) => calls.frozen.push(r) };
  const sessionMetrics = { metrics: () => ({}) };
  const api = new Function(
    "store", "deps", "sessionSummary", "agentHistory", "sessionMetrics", "sessionNarration",
    "sessionCredential", "diag",
    `${fnOf(PERMS, "denyPendingPermissions")}
     ${fnOf(TEARDOWN, "settle")}
     return { settle, denyPendingPermissions };`
  )(
    store,
    {
      sessions,
      baseRecord: (s) => ({ key: s.key, phase: s.state.phase }),
      denyPendingPermissions: (s, msg) => api.denyPendingPermissions(s, msg),
      refreshTray: () => { calls.tray += 1; },
      sessionOn: () => null,
    },
    sessionSummary, agentHistory, sessionMetrics, { ringFor: () => [] },
    { releaseContainerCredential: () => {} }, () => {}
  );
  const s = {
    key: "c1:t1:a1", runtimeId: "codex", endCode: "runtime-start-failed",
    state: { phase: "launching" }, settled: false, idleTimer: null, context: {},
    pendingPermissions: new Map(), pendingNames: new Map(),
    pushIterator: { closes: 0, close() { this.closes += 1; } },
    abortController: { aborts: 0, abort() { this.aborts += 1; } },
  };
  s.pendingPermissions.set("r1", (v) => calls.denied.push(v));
  s.pendingNames.set("r1", "mcp__dopl__dopl_channel#post");
  sessions.set(s.key, s);
  return { ...api, s, sessions, calls };
}

test("a failed launch frees the slot, denies the pending approval, and stops the process — ONCE", () => {
  const h = settleHarness();
  h.settle(h.s, "failed", false);
  // ⚠ THE OCCUPIED SLOT. `MAX_CONCURRENT_SESSIONS` is a COST ceiling as much as a concurrency
  // one, so a slot a failed launch kept is a slot nothing can reclaim for the life of the process.
  assert.equal(h.sessions.size, 0, "the registry entry is gone");
  // ⚠ THE PENDING APPROVAL. A resolver left awaiting blocks the child forever, which is C3's
  // orphan shape — and it must be denied FAIL-CLOSED rather than simply dropped.
  assert.equal(h.calls.denied.length, 1);
  assert.equal(h.s.pendingPermissions.size, 0);
  // ⚠ THE PROCESS. The iterator closes and the controller aborts exactly once each.
  assert.equal(h.s.pushIterator.closes, 1);
  assert.equal(h.s.abortController.aborts, 1);
  // ⚠ THE PILL. The history row is what makes an ENDED card exist, and it carries the structured
  // code so the card can say WHY in the runtime's own words rather than showing a launching pill.
  assert.equal(h.calls.frozen.length, 1);
  assert.equal(h.calls.frozen[0].endCode, "runtime-start-failed");
  assert.equal(h.calls.frozen[0].runtimeId, "codex");
});

test("a SECOND settle changes nothing — no second deny, no second abort, no second history row", () => {
  // ⚠ THIS IS THE FAILURE THAT ACTUALLY BITES. Several terminals can reach one session — the
  // reducer's crash effects, the abandonment timer, the operator's End, and `mcp-connect-guard`'s
  // own end — and a second sweep re-denies resolvers that are already settled and re-freezes a
  // history row, which is a DUPLICATE ended card for one run.
  const h = settleHarness();
  h.settle(h.s, "failed", false);
  h.settle(h.s, "failed", false);
  h.settle(h.s, "completed", true);
  assert.equal(h.calls.denied.length, 1);
  assert.equal(h.s.pushIterator.closes, 1);
  assert.equal(h.s.abortController.aborts, 1);
  assert.equal(h.calls.frozen.length, 1);
  assert.equal(h.calls.saved.length, 1);
  assert.equal(h.calls.tray, 1);
});

test("the guard is `s.settled`, taken BEFORE any work — not a flag set at the end", () => {
  // ⚠ A LATE FLAG IS NOT A GUARD. If `settled` were assigned after the sweep, a re-entrant
  // terminal (the abort below can dispatch synchronously in production) would run the whole body
  // a second time. The source shape is pinned because the behavioural case above cannot see it.
  const body = codeOf(fnOf(TEARDOWN, "settle"));
  const guard = body.indexOf("if (s.settled) return;");
  const mark = body.indexOf("s.settled = true;");
  const firstWork = body.indexOf("deps.denyPendingPermissions(");
  assert.ok(guard !== -1 && mark !== -1 && firstWork !== -1, "the guard moved — re-slice rather than pass");
  assert.ok(guard < mark && mark < firstWork, "check, mark, THEN sweep");
});
