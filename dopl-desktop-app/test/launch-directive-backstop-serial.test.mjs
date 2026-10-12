// The launch-directive backstop poll (`launch-directives.js › poll`) across many workspaces
// (KB codebase-cleanup sectors/D08 §Backlog; measured first on cleanup/d09 78558130).
//
// It used to visit workspaces SERIALLY with `handle()` awaited inside the loop, and was not
// single-flight: with 21 armed workspaces whose GETs ran to the 15s timeout, the 9th GET started
// at 120s = the directive TTL. These cases pin the fix, on the real module over a virtual clock:
//   1. at most POLL_CONCURRENCY (4) GETs are in flight, and the next starts as a slot frees;
//   2. so 21 timed-out GETs all START inside the TTL;
//   3. a pass is single-flight: a tick during a pass joins it; the next pass starts fresh;
//   4. `handle()` still runs one row at a time, in WORKSPACE order, even when a later
//      workspace's GET answers first;
//   5. a REJECTING read settles its slot anyway (Review 26), because an unsettled slot stops the
//      whole lane for good, not just that workspace.
//
// Run: `node --test dopl-desktop-app/test/launch-directive-backstop-serial.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, MAIN, SRC, require_, row, ME, OTHER, boot, claimPosts } from "./_launch-directive-harness.mjs";

const wire = require_(join(MAIN, "launch-directive-wire.js"));

// The TTL the server stamps on a directive, read from its one definition and required to exist.
const CONSTANTS = readFileSync(
  join(HERE, "..", "..", "src", "features", "channels", "constants.ts"), "utf8");
const ttlMatch = /LAUNCH_DIRECTIVE_TTL_MS\s*=\s*([\d_]+)/.exec(CONSTANTS);
assert.ok(ttlMatch, "LAUNCH_DIRECTIVE_TTL_MS must be declared in src/features/channels/constants.ts");
const TTL_MS = Number(ttlMatch[1].replace(/_/g, ""));

// The one declaration lives in `launch-directive-calls.js` (the watcher imports it from there).
const CALLS = readFileSync(join(MAIN, "launch-directive-calls.js"), "utf8");
const timeoutMatch = /const HTTP_TIMEOUT_MS = (\d+);/.exec(CALLS);
assert.ok(timeoutMatch, "launch-directive-calls.js must declare HTTP_TIMEOUT_MS");
const HTTP_TIMEOUT_MS = Number(timeoutMatch[1]);
const LIMIT = 4;

const ws = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const did = (i) => `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`;

/**
 * The real module with a stubbed `./api` whose GET is driven by `fetchFor(wsId, clock)` and
 * answers `rowsFor(wsId)`. `claims` records every claim `handle()` reached, in order.
 */
function load(workspaces, fetchFor, rowsFor = () => []) {
  const clock = { now: 0 };
  const gets = [];
  const claims = [];
  const logged = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const stub = (id) => {
    if (id === "./api") {
      return {
        apiFetch: async (path, opts) => {
          assert.equal(path, wire.ROUTES.pending, "only the backstop GET is expected here");
          gets.push({ wsId: opts.workspaceId, start: clock.now });
          inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
          try { await fetchFor(opts.workspaceId, clock); } finally { inFlight -= 1; }
          return { ok: true, status: 200, json: async () => ({ directives: rowsFor(opts.workspaceId) }) };
        },
      };
    }
    if (id === "./realtime") return { setDirectives: () => {}, isWorkspaceHealthy: () => false };
    if (id === "./channel-prefs") return { getOrchestratorLaunch: () => true };
    if (id === "./launch-directive-wire") return wire;
    if (id === "./diag") return { diag: (...a) => logged.push(a.map(String).join(" ")) };
    if (id === "./launch-directive-calls") {
      return { claim: async (d) => { claims.push(d.id); return null; }, decide: async () => true, HTTP_TIMEOUT_MS };
    }
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  const api = mod.exports;
  api.start({
    getUserId: () => ME,
    launch: async () => ({}),
    watchedChannel: () => null,
    workspaces: () => workspaces,
  });
  const deps = {
    getUserId: () => ME,
    launch: async () => ({}),
    watchedChannel: () => null,
    workspaces: () => workspaces,
  };
  return { api, gets, claims, logged, clock, deps, maxInFlight: () => maxInFlight };
}

/**
 * A virtual-time fetch: each GET ends `latency(wsId)` virtual ms after it STARTS. `run(promise)`
 * advances the clock to the earliest pending end, one at a time, until `promise` settles — so
 * GETs in flight together really overlap on the clock, and serial ones really queue.
 */
function virtualFetch(latency) {
  const timers = [];
  let clock = null;
  const fetchFor = (id, c) => {
    clock = c;
    return new Promise((resolve) => timers.push({ end: c.now + latency(id), resolve }));
  };
  async function run(promise) {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    for (;;) {
      await new Promise((r) => setImmediate(r));
      if (settled) return promise;
      if (!timers.length) throw new Error("poll is waiting on nothing the clock can advance");
      timers.sort((a, b) => a.end - b.end);
      const t = timers.shift();
      clock.now = t.end;
      t.resolve();
    }
  }
  return { fetchFor, run };
}

test("the backstop runs at most 4 GETs at once, and the next starts as a slot frees", async () => {
  const list = [1, 2, 3, 4, 5, 6].map(ws);
  const v = virtualFetch(() => 1000);
  const { api, gets, maxInFlight } = load(list, v.fetchFor);
  try {
    await v.run(api.poll());
  } finally { api.stop(); }
  assert.deepEqual(gets.map((g) => g.wsId), list, "every armed workspace is polled, in order");
  assert.deepEqual(gets.map((g) => g.start), [0, 0, 0, 0, 1000, 1000],
    "four start together; the fifth and sixth wait for a free slot, not for all four");
  assert.equal(maxInFlight(), LIMIT, "never more than the bound in flight");
});

test("21 workspaces whose GETs run to the 15s timeout: every GET starts inside the 120s TTL", async () => {
  const N = 21; // armed workspaces in the 2026-10-11 listener.log
  const list = Array.from({ length: N }, (_, i) => ws(i + 1));
  const v = virtualFetch(() => HTTP_TIMEOUT_MS);
  const { api, gets } = load(list, v.fetchFor);
  try {
    await v.run(api.poll());
  } finally { api.stop(); }
  assert.equal(gets.length, N);
  const last = gets[N - 1].start;
  assert.equal(last, (Math.ceil(N / LIMIT) - 1) * HTTP_TIMEOUT_MS, "75s for the 21st workspace");
  assert.ok(last < TTL_MS, `last start ${last}ms vs TTL ${TTL_MS}ms`);
});

test("a pass is single-flight: a tick during a pass joins it, and the next pass starts fresh", async () => {
  const list = [ws(1), ws(2)];
  const pending = [];
  const { api, gets } = load(list, () => new Promise((resolve) => pending.push(resolve)));
  try {
    const first = api.poll();
    await new Promise((r) => setImmediate(r));
    assert.equal(gets.length, 2, "pass 1 has both workspaces in flight");
    const second = api.poll();
    await new Promise((r) => setImmediate(r));
    assert.equal(second, first, "the tick joined the running pass");
    assert.equal(gets.length, 2, "and issued no GET of its own");
    while (pending.length) { pending.shift()(); await new Promise((r) => setImmediate(r)); }
    await first;
    const third = api.poll();
    await new Promise((r) => setImmediate(r));
    assert.notEqual(third, first, "a finished pass is not reused");
    assert.equal(gets.length, 4, "the next pass polls every workspace again");
    while (pending.length) { pending.shift()(); await new Promise((r) => setImmediate(r)); }
    await third;
  } finally { api.stop(); }
});

test("handle() runs rows in WORKSPACE order, even when a later workspace answers first", async () => {
  const list = [ws(1), ws(2), ws(3)];
  const latency = { [ws(1)]: 3000, [ws(2)]: 10, [ws(3)]: 500 };
  const rows = {
    [ws(1)]: [row({ id: did(1), workspace_id: ws(1) }), row({ id: did(2), workspace_id: ws(1) })],
    [ws(2)]: [row({ id: did(3), workspace_id: ws(2) })],
    [ws(3)]: [row({ id: did(4), workspace_id: ws(3) })],
  };
  const v = virtualFetch((id) => latency[id]);
  const { api, claims } = load(list, v.fetchFor, (id) => rows[id]);
  try {
    await v.run(api.poll());
  } finally { api.stop(); }
  assert.deepEqual(claims, [did(1), did(2), did(3), did(4)],
    "the funnel saw every row, one at a time, in workspace then row order");
});

/**
 * ⚠ **AN UNSETTLED SLOT IS NOT ONE MISSED WORKSPACE — IT IS THE LANE, FOR GOOD** (Review 26).
 * `runPass` awaits the slots in order and `poll()` is single-flight, so a slot that never settles
 * hangs the pass, leaves `passInFlight` set, and makes every later tick join the dead pass. The
 * read is therefore wrapped in `worker()`, the only place that owns a slot.
 *
 * These cases REACH that catch: `fetchPending` deliberately does not swallow a rejection, so an
 * apiFetch that rejects arrives at `worker()`. Measured before the fix: with the catch inside
 * `fetchPending` instead, all three of these PASSED while the hazard was live — the guard was
 * unreachable and a test written against it was vacuous.
 */
function raceHang(promise, label) {
  let timer;
  const hung = new Promise((r) => { timer = setTimeout(() => r("HUNG"), 2000); });
  return Promise.race([promise.then(() => "completed", () => "rejected"), hung])
    .then((outcome) => { clearTimeout(timer); assert.equal(outcome, "completed", label); });
}

test("a REJECTING read settles its slot: the pass completes and every other workspace is handled", async () => {
  const bad = ws(2);
  const list = [ws(1), bad, ws(3)];
  const rows = {
    [ws(1)]: [row({ id: did(1), workspace_id: ws(1) })],
    [ws(3)]: [row({ id: did(4), workspace_id: ws(3) })],
  };
  const { api, gets, claims, logged } = load(
    list,
    async (id) => { if (id === bad) throw new Error("socket hangup"); },
    (id) => rows[id] || []
  );
  try {
    await raceHang(api.poll(), "a rejecting GET must not hang the pass");
    assert.deepEqual(gets.map((g) => g.wsId), list, "every workspace was still read");
    assert.deepEqual(claims, [did(1), did(4)],
      "the good workspaces are handled, in workspace order, and the faulted one contributes none");
    assert.equal(logged.filter((l) => l.includes("backstop read FAULTED")).length, 1,
      "the fault is named once, with the workspace");
    assert.ok(logged.some((l) => l.includes("backstop read FAULTED") && l.includes(bad)));
  } finally { api.stop(); }
});

test("a REJECTING read does not poison the next tick: a fresh pass runs", async () => {
  const bad = ws(1);
  const list = [bad, ws(2)];
  const { api, gets } = load(list, async (id) => { if (id === bad) throw new Error("socket hangup"); });
  try {
    const first = api.poll();
    await raceHang(first, "pass 1 must finish");
    const second = api.poll();
    assert.notEqual(second, first, "the dead pass is not what the next tick joins");
    await raceHang(second, "pass 2 must finish");
    assert.equal(gets.length, 4, "both workspaces were polled again on the next tick");
  } finally { api.stop(); }
});

test("the FAULT line is edge-triggered, and the recovery is logged once", async () => {
  let failing = true;
  const list = [ws(1)];
  const { api, logged } = load(list, async () => { if (failing) throw new Error("socket hangup"); });
  try {
    await raceHang(api.poll(), "tick 1");
    await raceHang(api.poll(), "tick 2");
    assert.equal(logged.filter((l) => l.includes("backstop read FAULTED")).length, 1,
      "two failing ticks, ONE line — not one a minute");
    failing = false;
    await raceHang(api.poll(), "tick 3");
    assert.equal(logged.filter((l) => l.includes("backstop read recovered")).length, 1,
      "the recovery is named once");
    await raceHang(api.poll(), "tick 4");
    assert.equal(logged.filter((l) => l.includes("backstop read recovered")).length, 1,
      "and not repeated while it stays healthy");
  } finally { api.stop(); }
});

test("stop() drops the fault edges, so a re-armed watcher names a still-failing workspace again", async () => {
  // ⚠ Same reason `stop()` clears `pollDegraded`: a consumed edge must not outlive the watcher,
  // or after a restart a workspace that is STILL failing never says so again.
  const list = [ws(1)];
  const h = load(list, async () => { throw new Error("socket hangup"); });
  await raceHang(h.api.poll(), "tick 1");
  assert.equal(h.logged.filter((l) => l.includes("backstop read FAULTED")).length, 1);
  h.api.stop();
  h.api.start(h.deps);
  try {
    await raceHang(h.api.poll(), "tick after the restart");
    assert.equal(h.logged.filter((l) => l.includes("backstop read FAULTED")).length, 2,
      "the re-armed watcher names the still-failing workspace again");
  } finally { h.api.stop(); }
});

// Moved here from launch-directives.test.mjs (that file was at the 480-line split threshold):
// the backstop's own behaviour, on the shared harness.
// ── 7. THE BACKSTOP ──────────────────────────────────────────────────────────────────────
//
// ⚠ IT COVERS THE BREAKER **AND** A DROPPED FRAME (2026-09-18, S18/S56). It used to check
// `realtime.isWorkspaceHealthy` and skip, which is right for an outage and wrong for the failure
// it was reported under: ONE `postgres_changes` INSERT that never arrives on a socket that is
// perfectly healthy. A health signal is evidence about the TRANSPORT and never about a row.
test("BACKSTOP: a HEALTHY workspace is still reconciled — a live socket is not a delivery receipt", async () => {
  const h = boot({ healthy: true, pending: [row()] });
  await h.api.poll();
  // ⚠ Filtered on the backstop's own route: a SPAWN reads the pinned startup context too
  // (2026-09-01, T81), so counting every GET would fail on an unrelated feature.
  const polls = h.gets.filter((g) => g.path === wire.ROUTES.pending);
  assert.equal(polls.length, 1, "the reconcile read runs while push is up");
  assert.equal(h.api.POLL_MS, 60000);
  // ⚠ Bounded by the lane's one HTTP timeout; an undefined `timeoutMs` would be an unbounded GET.
  assert.equal(polls[0].opts.timeoutMs, HTTP_TIMEOUT_MS, "the backstop GET carries the lane's timeout");
});

// ⚠ 60s IS THE RECONCILE'S CEILING, NOT A PREFERENCE: `LAUNCH_DIRECTIVE_TTL_MS` is 120s, so a
// slower tick could not reach a dropped row before it lapsed and the whole reconcile would be
// decorative. This pins the relationship rather than the number alone.
test("BACKSTOP: the tick fits inside the directive TTL, with room for one miss", () => {
  const TTL_MS = 120000; // src/features/channels/constants.ts › LAUNCH_DIRECTIVE_TTL_MS
  assert.ok(h_POLL_MS() * 2 <= TTL_MS, "two ticks must fit inside the TTL");
});
function h_POLL_MS() { return boot({}).api.POLL_MS; }

test("BACKSTOP: a DOWN workspace is polled too — the recovery lane is unchanged", async () => {
  const h = boot({ healthy: false, pending: [row()] });
  await h.api.poll();
  assert.equal(h.gets.filter((g) => g.path === wire.ROUTES.pending).length, 1);
});

// ⚠ THE HEALTH SIGNAL IS STILL WORTH HAVING — it is the difference between "push is down, this
// read IS the lane" and "push is up, this read is a reconcile" — so it is LOGGED rather than
// acted on, and edge-triggered so an outage does not bury it one line a minute.
test("BACKSTOP: push going down is logged ONCE, not once per tick", async () => {
  const h = boot({ healthy: false });
  await h.api.poll();
  await h.api.poll();
  const down = h.logged.filter((l) => l.includes("push is DOWN"));
  assert.equal(down.length, 1, "edge-triggered, not per tick");
});

test("BACKSTOP: an unreadable health signal polls rather than skipping", async () => {
  const h = boot({ pending: [row()], healthyThrows: true });
  await h.api.poll();
  assert.equal(h.gets.filter((g) => g.path === wire.ROUTES.pending).length, 1);
});

// ⚠ A second entry point that skipped `handle` would bypass the toggle, the owner check and the
// dedupe in one edit — safe through the door everyone reads and open through the one nobody does.
// Driven, not grepped (the source probe it replaces stayed green on any loop that said `handle`).
test("BACKSTOP: the poll runs the SAME funnel — a polled row passes the toggle, owner and dedupe guards", async () => {
  const ok = boot({ pending: [row()] });
  await ok.api.poll();
  assert.equal(claimPosts(ok).length, 1, "control: an ordinary pending row IS claimed through the poll");
  await ok.api.poll();
  assert.equal(claimPosts(ok).length, 1, "the dedupe ledger holds across ticks");

  const off = boot({ enabled: false, pending: [row()] });
  await off.api.poll();
  assert.equal(claimPosts(off).length, 0, "the launch toggle gates a polled row");

  const foreign = boot({ pending: [row({ operator_user_id: OTHER })] });
  await foreign.api.poll();
  assert.equal(claimPosts(foreign).length, 0, "another operator's polled row is never claimed");
});

test("BACKSTOP: the health gate stays out of the control flow", () => {
  // ⚠ AND THE HEALTH GATE IS GONE FROM THE CONTROL FLOW. It read
  // `if (realtime.isWorkspaceHealthy(wsId)) continue;` until 2026-09-18; a re-introduction would
  // restore the dropped-frame hole in one line and pass every behavioural test that does not
  // boot a healthy workspace.
  assert.equal(/isWorkspaceHealthy\(wsId\)\) continue;/.test(SRC), false);
  assert.match(SRC, /function deliver\(workspaceId, row\) \{\s*void handle\(row, workspaceId\);/);
});

