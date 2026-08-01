// FIX S4 — THE POOL SLOT IS RELEASED ON EVERY PATH, INCLUDING THE ONES THAT THROW.
//
// WHY THIS FILE EXISTS. session-pool.test.mjs proves the pool's bookkeeping in isolation
// (claim / release / cap), but nothing anywhere drove its LIFECYCLE: who takes a slot, and
// whether every exit gives it back. That gap hid a machine-wide stall. `runForChannel`
// claimed a slot and then called `execOnce(...)` bare inside a `.then` callback — and
// execOnce runs a lot of code synchronously before execFile schedules anything (the cwd
// resolution, the env assembly, an fs probe, the scoped-settings write, execFile itself on a
// bad cwd). A throw there escaped into the promise chain: the slot stayed claimed, the outer
// promise never settled, and the caller — which awaits it — hung with it. The global cap is
// 4, so four such throws stop headless spawning on the whole machine, permanently.
//
// Two more holes came with it: `resolveClaude()` had no `.catch`, so a rejecting resolver
// left the promise pending forever; and inside execOnce the retry branch calls
// clearSessionId — an electron-store DISK write — ABOVE the release, from inside the
// execFile callback, where a throw is unobservable.
//
// METHOD: the session-pool / session-dispatch idiom. `runForChannel` and `execOnce` are
// brace-matched out of session-spawner.js and evaluated with fakes for their module-top
// bindings, driving the REAL shipped control flow against the REAL pool (sliced from
// session-pool.js with the REAL key from session-store.js). Nothing here is a lookalike.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SPAWNER = readFileSync(join(MAIN, "session-spawner.js"), "utf8");

function block(file, name) {
  const src = readFileSync(join(MAIN, file), "utf8");
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing in ${file}`);
  assert.ok(to > from, `${name} sentinels missing or out of order in ${file}`);
  return src.slice(from, to);
}

const { sessionKey, slotKey } = new Function(
  `${block("session-store.js", "SESSION-STORE-PURE")}\n return { sessionKey, slotKey };`
)();

// A fresh REAL pool per test (the block's `active` map is module scope, so re-evaluating it
// is what isolates the tests from each other).
function realPool() {
  return new Function(
    "store",
    `${block("session-pool.js", "SESSION-POOL-PURE")}\n` +
      ` return { MAX_CONCURRENT_SESSIONS, claim, release, isBusy, atCap, size, listActive };`
  )({ sessionKey, slotKey });
}

const CHANNEL = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TASK = "11111111-2222-3333-4444-555555555555";

// ── runForChannel, driven against the real pool ──────────────────────────────────

function spawner(cfg = {}) {
  const pool = cfg.pool || realPool();
  const calls = { exec: [], diag: [], onStart: 0 };
  const api = new Function(
    "pool", "sessionStore", "getSessionId", "resolveClaude", "execOnce", "diag",
    `${fnOf(SPAWNER, "runForChannel")}\n return { runForChannel };`
  )(
    pool,
    { sessionKey },
    (key) => {
      if (cfg.getSessionIdThrows) throw new Error("store read exploded");
      return `resume-for-${key}`;
    },
    async () => {
      if (cfg.resolverRejects) throw new Error("no cli, and the lookup itself failed");
      return cfg.bin === undefined ? "/usr/bin/claude" : cfg.bin;
    },
    (bin, args, resolve) => {
      calls.exec.push(args.key);
      if (cfg.execThrows) throw new Error("bad cwd");
      if (cfg.execResolves) {
        pool.release(args.key); // what the real execOnce does before it settles
        resolve({ text: "done", sessionId: "sdk-1", isError: false });
      }
    },
    (...a) => calls.diag.push(a.join(" "))
  );
  return { ...api, pool, calls };
}

const slot = { channelId: CHANNEL, taskId: TASK };

test("a THROWING execOnce frees the slot and settles the caller (it used to do neither)", async () => {
  const s = spawner({ execThrows: true });
  const res = await s.runForChannel(slot);
  assert.equal(res.skipped, "busy", "the caller gets the defer it already knows how to answer");
  assert.equal(res.isError, true);
  assert.equal(s.pool.size(), 0, "THE fix: the slot is not held by a spawn that never started");
  assert.equal(s.pool.isBusy(slot), false, "…so the very next trigger for this session can run");
  assert.ok(s.calls.diag.some((d) => d.includes("spawn start failed")), "and it is visible in the log");
});

test("four throwing spawns in a row do not exhaust the machine-wide cap", async () => {
  // The reason a leak here is a BLOCKER and not a nuisance: the cap is global, so four
  // leaked slots stop every headless spawn in every channel until the app restarts.
  const s = spawner({ execThrows: true });
  for (let i = 0; i < s.pool.MAX_CONCURRENT_SESSIONS + 2; i++) {
    await s.runForChannel({ channelId: `chan-${i}`, taskId: TASK });
  }
  assert.equal(s.pool.size(), 0);
  assert.equal(s.pool.atCap(), false);
  // …and a real spawn still gets in afterwards.
  const ok = spawner({ execResolves: true, pool: s.pool });
  assert.equal((await ok.runForChannel(slot)).text, "done");
});

test("a REJECTING cli resolver settles the promise instead of hanging on it forever", async () => {
  const s = spawner({ resolverRejects: true });
  const res = await s.runForChannel(slot);
  assert.equal(res.skipped, "no-cli");
  assert.equal(s.pool.size(), 0, "nothing was claimed, and nothing is left claimed");
  assert.deepEqual(s.calls.exec, [], "and no spawn was attempted");
  assert.ok(s.calls.diag.some((d) => d.includes("cli resolve failed")));
});

test("no CLI at all is still the quiet 'no-cli' skip, with no slot taken", async () => {
  const s = spawner({ bin: null });
  const res = await s.runForChannel(slot);
  assert.equal(res.skipped, "no-cli");
  assert.equal(s.pool.size(), 0);
});

test("a throwing onStart callback breaks neither the spawn nor the slot", async () => {
  const s = spawner({ execResolves: true });
  const res = await s.runForChannel({ ...slot, onStart: () => { throw new Error("telemetry"); } });
  assert.equal(res.text, "done", "telemetry can never break the spawn");
  assert.equal(s.pool.size(), 0);
});

test("a busy slot defers without touching it, and an at-cap claim leaks nothing", async () => {
  const s = spawner({ execThrows: true });
  const held = s.pool.claim(slot); // somebody else's live spawn on this exact session
  const res = await s.runForChannel(slot);
  assert.equal(res.skipped, "busy");
  assert.deepEqual(s.calls.exec, [], "the fast-path refusal never reaches execOnce");
  assert.equal(s.pool.size(), 1, "the OTHER spawn's slot is untouched");
  assert.equal(s.pool.release(held.key), true);

  // Now the cap: fill it with other sessions, then try a fresh one.
  for (let i = 0; i < s.pool.MAX_CONCURRENT_SESSIONS; i++) s.pool.claim({ channelId: `c-${i}`, taskId: TASK });
  assert.equal((await s.runForChannel(slot)).skipped, "busy");
  assert.equal(s.pool.size(), s.pool.MAX_CONCURRENT_SESSIONS, "a refused claim never grows the pool");
});

test("even a throwing session-id read still settles the caller", async () => {
  // getSessionId is an electron-store read on every bail path; it must not be able to turn a
  // skip into an unhandled rejection.
  const s = spawner({ execThrows: true, getSessionIdThrows: true });
  const res = await s.runForChannel(slot);
  assert.equal(res.skipped, "busy");
  assert.equal(res.sessionId, null);
  assert.equal(s.pool.size(), 0);
});

// ── execOnce's own callback: the retry path writes to disk ABOVE the release ─────

function once(cfg = {}) {
  const pool = cfg.pool || realPool();
  const calls = { spawns: 0, diag: [], cleared: 0 };
  const api = new Function(
    "crypto", "buildPrompt", "getSessionId", "spawnMcpConfigPath", "fs", "buildRestrictionArgs",
    "writeScopedSettings", "execFile", "channelDirs", "channelCwd", "spawnEnv", "MAX_RUNTIME_MS",
    "MAX_OUTPUT_BYTES", "clearSessionId", "pool", "setSessionId", "diag",
    `${fnOf(SPAWNER, "execOnce")}\n return { execOnce };`
  )(
    { randomBytes: () => ({ toString: () => "nonce" }) },
    () => "prompt",
    () => (cfg.existing === undefined ? "sdk-existing" : cfg.existing),
    () => "/tmp/mcp.json",
    { existsSync: () => false },
    () => [],
    () => null,
    (bin, args, opts, cb) => {
      calls.spawns += 1;
      if (cfg.spawnThrowsOnRetry && calls.spawns > 1) throw new Error("bad cwd on the retry");
      cb(cfg.err || null, cfg.stdout || "", cfg.stderr || "");
    },
    { spawnDirFor: () => "/tmp" },
    () => "/tmp",
    () => ({}),
    1000,
    1000,
    () => {
      calls.cleared += 1;
      if (cfg.clearThrows) throw new Error("electron-store write failed");
    },
    pool,
    () => {},
    (...a) => calls.diag.push(a.join(" "))
  );
  return { ...api, pool, calls };
}

const RUN = { key: sessionKey(CHANNEL, TASK), channelId: CHANNEL, message: "hi", context: {}, toolProfile: "full", isRetry: false };
const failed = { err: new Error("session not found"), stdout: "" };

test("the retry path still works, and still HOLDS the slot across the retry", async () => {
  const o = once({ ...failed, stdout: "" });
  o.pool.claim({ channelId: CHANNEL, taskId: TASK });
  const res = await new Promise((r) => o.execOnce("/usr/bin/claude", { ...RUN }, r));
  assert.equal(o.calls.spawns, 2, "a stale --resume id is retried exactly once");
  assert.equal(o.calls.cleared, 1);
  assert.equal(res.isError, true);
  assert.equal(o.pool.size(), 0, "and the slot is released once, at the end of the whole request");
});

test("a THROWING clearSessionId on the retry path releases the slot and settles", async () => {
  // clearSessionId is a disk write inside the execFile callback, ABOVE the release. Without
  // the guard its throw was an unobservable exception: slot held, promise pending forever.
  const o = once({ ...failed, clearThrows: true });
  o.pool.claim({ channelId: CHANNEL, taskId: TASK });
  const res = await new Promise((r) => o.execOnce("/usr/bin/claude", { ...RUN }, r));
  assert.equal(res.isError, true);
  assert.equal(res.skipped, "busy");
  assert.equal(o.pool.size(), 0, "the slot is free");
  assert.ok(o.calls.diag.some((d) => d.includes("result handling failed")));
});

test("a THROWING re-entry into execOnce on the retry releases the slot and settles", async () => {
  // The other half of the same branch: the retry re-enters execOnce, whose synchronous work
  // (cwd resolution, env assembly, execFile) can throw in turn.
  const o = once({ ...failed, spawnThrowsOnRetry: true });
  o.pool.claim({ channelId: CHANNEL, taskId: TASK });
  const res = await new Promise((r) => o.execOnce("/usr/bin/claude", { ...RUN }, r));
  assert.equal(res.isError, true);
  assert.equal(o.pool.size(), 0);
  assert.equal(o.calls.spawns, 2);
});

test("the ordinary success path is unchanged: one spawn, one release, the reply", async () => {
  const o = once({ existing: null, stdout: JSON.stringify({ result: "the answer", session_id: "sdk-2" }) });
  o.pool.claim({ channelId: CHANNEL, taskId: TASK });
  const res = await new Promise((r) => o.execOnce("/usr/bin/claude", { ...RUN }, r));
  assert.deepEqual({ text: res.text, sessionId: res.sessionId, isError: res.isError }, {
    text: "the answer", sessionId: "sdk-2", isError: false,
  });
  assert.equal(o.calls.spawns, 1);
  assert.equal(o.pool.size(), 0);
});
