// MEASUREMENT: the launch-directive backstop poll (`launch-directives.js › poll`) across many
// workspaces (KB dopl-development "Silent Agent Drops 2026-10-11", open follow-up 4).
//
// These cases pin what the poll does TODAY, measured on the real module with a virtual clock:
//   1. it visits workspaces SERIALLY — workspace k's GET starts only when k-1's has finished;
//   2. so a pass where each GET runs to its 15s timeout starts the 21st workspace (the count
//      the field log showed armed) 300s in, past the 120s directive TTL;
//   3. a pass is not single-flight: a second tick starts while the first is still in flight.
// They describe behaviour, not a target. A fix (bounded concurrency, a per-pass deadline,
// single-flight) is a timing change and will flip them on purpose.
//
// Run: `node --test dopl-desktop-app/test/launch-directive-backstop-serial.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, MAIN, SRC, require_ } from "./_launch-directive-harness.mjs";

const wire = require_(join(MAIN, "launch-directive-wire.js"));

// The TTL the server stamps on a directive, read from its one definition and required to exist.
const CONSTANTS = readFileSync(
  join(HERE, "..", "..", "src", "features", "channels", "constants.ts"), "utf8");
const ttlMatch = /LAUNCH_DIRECTIVE_TTL_MS\s*=\s*([\d_]+)/.exec(CONSTANTS);
assert.ok(ttlMatch, "LAUNCH_DIRECTIVE_TTL_MS must be declared in src/features/channels/constants.ts");
const TTL_MS = Number(ttlMatch[1].replace(/_/g, ""));

const HTTP_TIMEOUT_MS = Number(/const HTTP_TIMEOUT_MS = (\d+);/.exec(SRC)[1]);

const ws = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

/**
 * The real module with a stubbed `./api` whose GET is driven by `fetchFor(wsId, clock)`. Returns
 * the module and the ordered list of `{ wsId, start }` GETs on the virtual clock.
 */
function load(workspaces, fetchFor) {
  const clock = { now: 0 };
  const gets = [];
  const stub = (id) => {
    if (id === "./api") {
      return {
        apiFetch: async (path, opts) => {
          assert.equal(path, wire.ROUTES.pending, "only the backstop GET is expected here");
          gets.push({ wsId: opts.workspaceId, start: clock.now });
          await fetchFor(opts.workspaceId, clock);
          return { ok: true, status: 200, json: async () => ({ directives: [] }) };
        },
      };
    }
    if (id === "./realtime") return { setDirectives: () => {}, isWorkspaceHealthy: () => false };
    if (id === "./channel-prefs") return { getOrchestratorLaunch: () => true };
    if (id === "./launch-directive-wire") return wire;
    if (id === "./diag") return { diag: () => {} };
    if (id === "./launch-directive-calls") return {};
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  const api = mod.exports;
  api.start({
    getUserId: () => "me",
    launch: async () => ({}),
    watchedChannel: () => null,
    workspaces: () => workspaces,
  });
  return { api, gets, clock };
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

test("the backstop visits workspaces serially: each GET starts when the previous one ends", async () => {
  const list = [1, 2, 3, 4, 5].map(ws);
  const latency = { [ws(1)]: 400, [ws(2)]: 100, [ws(3)]: 2500, [ws(4)]: 0, [ws(5)]: 50 };
  const v = virtualFetch((id) => latency[id]);
  const { api, gets } = load(list, v.fetchFor);
  try {
    await v.run(api.poll());
  } finally { api.stop(); }
  assert.deepEqual(gets.map((g) => g.wsId), list, "every armed workspace is polled, in order");
  assert.deepEqual(gets.map((g) => g.start), [0, 400, 500, 3000, 3000],
    "workspace k starts at the sum of the latencies before it");
});

test("21 workspaces whose GETs run to the 15s timeout: the last starts past the 120s TTL", async () => {
  const N = 21; // armed workspaces in the 2026-10-11 listener.log
  const list = Array.from({ length: N }, (_, i) => ws(i + 1));
  const v = virtualFetch(() => HTTP_TIMEOUT_MS);
  const { api, gets } = load(list, v.fetchFor);
  try {
    await v.run(api.poll());
  } finally { api.stop(); }
  assert.equal(gets.length, N);
  const last = gets[N - 1].start;
  assert.equal(last, (N - 1) * HTTP_TIMEOUT_MS, "300s for the 21st workspace");
  assert.ok(last > TTL_MS, `last start ${last}ms vs TTL ${TTL_MS}ms`);
  // The first workspace whose GET cannot start inside one TTL.
  const firstLate = gets.findIndex((g) => g.start >= TTL_MS);
  assert.equal(firstLate, Math.ceil(TTL_MS / HTTP_TIMEOUT_MS), "the 9th workspace (index 8) already starts at 120s");
});

test("a pass is not single-flight: a second tick starts while the first is still waiting", async () => {
  const list = [ws(1), ws(2)];
  const pending = [];
  const { api, gets } = load(list, () => new Promise((resolve) => pending.push(resolve)));
  try {
    const first = api.poll();
    await Promise.resolve();
    assert.equal(gets.length, 1, "pass 1 is waiting on workspace 1");
    const second = api.poll();
    await Promise.resolve();
    assert.equal(gets.length, 2, "pass 2 issued its own GET while pass 1 was in flight");
    assert.deepEqual(gets.map((g) => g.wsId), [ws(1), ws(1)]);
    while (pending.length) { pending.shift()(); await new Promise((r) => setImmediate(r)); }
    await Promise.all([first, second]);
    assert.equal(gets.length, 4, "both passes completed every workspace");
  } finally { api.stop(); }
});
