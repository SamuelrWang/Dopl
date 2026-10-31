// A DEAD FULL LOGIN DOES NOT LOOP THE TOKEN PROMPT (2026-10-30). An auth hold on a session that spawned on the full
// login asks whether that login is dead; a token sign-in could never revive it.
//   Part 1 drives the REAL `session-auth.js` with the REAL reducer; the adapter and the status row are stubbed.
//   Part 2 drives the REAL `claude-auth.js › settleFullLogin` over fake `auth status` children.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";
import { evalModule, MAIN, real } from "./helpers/module-sandbox.mjs";

const require = createRequire(import.meta.url);
const sessionAuth = require("../main/session-auth.js");
const credentials = require("../main/runtime-credentials.js");
const runtimeRegistry = require("../main/runtime/index.js");
const { initialSessionState, sessionReducer } = loadReducer();

const tick = () => new Promise((r) => setImmediate(r));
const claude = () => runtimeRegistry.resolve("claude").runtime;

// One held-capable session plus recorders. `settle` is the adapter's answer; `token` whether one is stored.
function world({ settle = async () => true, token = true, onFullLogin = true } = {}) {
  const calls = { settle: [], rejected: [], signIn: [], refresh: 0, steers: 0 };
  const sessions = new Map();
  const rt = claude();
  rt.settleFullLogin = (didNotHelp) => { calls.settle.push(didNotHelp); return settle(didNotHelp); };
  rt.credentialState = async () => ({ usable: token, source: token ? "dopl-token" : null });
  credentials.noteRejected = (id) => calls.rejected.push(id);
  credentials.needSignIn = (id) => calls.signIn.push(id);
  credentials.refresh = async () => { calls.refresh += 1; };
  const dispatch = (s, ev) => {
    if (ev.type === "steer") calls.steers += 1;
    s.state = sessionReducer(s.state, ev).state;
  };
  sessionAuth.bind({
    sessions, dispatch, denyPending: () => {}, teardown: () => {},
    acquireRuntime: async () => ({}), startQuery: async () => {},
  });
  const s = {
    key: "chan-1:thread-9:a1b2c3d4", channelId: "chan-1", threadId: "thread-9", agentId: "a1b2c3d4",
    sessionId: "s-1", runtimeId: "claude", settled: false, context: {}, spawnedOnFullLogin: onFullLogin,
    state: initialSessionState({ mode: "interactive", side: "responder" }),
    abortController: { abort() {} }, pushIterator: { close() {} },
  };
  sessions.set(s.key, s);
  return { s, calls };
}

test("logged out + token stored: no prompt, no rejection, the hold releases onto the token once", async () => {
  const { s, calls } = world();
  assert.equal(sessionAuth.holdIfAuthFailure(s, "Not logged in"), true);
  assert.equal(s.state.authHeld, true, "held until the check answers");
  await s.authHold.settling;
  assert.equal(s.authHold, null);
  assert.equal(s.state.authHeld, false);
  assert.equal(calls.steers, 1, "one wake");
  assert.deepEqual(calls.rejected, []);
  assert.deepEqual(calls.signIn, []);
  assert.equal(calls.refresh, 1, "the row is pushed so Enable returns");
  assert.deepEqual(calls.settle, [false]);
});

test("logged out + no token: the ordinary prompt, still held, not an expired state", async () => {
  const { s, calls } = world({ token: false });
  sessionAuth.holdIfAuthFailure(s, "Not logged in");
  await s.authHold.settling;
  assert.equal(s.state.authHeld, true);
  assert.deepEqual(calls.signIn, ["claude"]);
  assert.deepEqual(calls.rejected, []);
  assert.equal(calls.steers, 0);
});

test("logged in or unknown: today's prompt; refused again after a token sign-in, the login is dropped with no second prompt", async () => {
  const { s, calls } = world({ settle: async (didNotHelp) => didNotHelp === true });
  sessionAuth.holdIfAuthFailure(s, "401");
  await s.authHold.settling;
  assert.deepEqual(calls.rejected, ["claude"], "first refusal prompts, as today");
  assert.equal(s.state.authHeld, true);

  assert.equal(await sessionAuth.resumeHeldSessions("claude"), 1, "the operator signed in");
  assert.equal(s.state.authHeld, false);

  sessionAuth.holdIfAuthFailure(s, "401");
  await s.authHold.settling;
  assert.deepEqual(calls.settle, [false, true]);
  assert.deepEqual(calls.rejected, ["claude"], "the token prompt is not raised again");
  assert.equal(s.authHold, null, "released onto the token");
  assert.equal(calls.steers, 2);
});

test("a token session's auth failure behaves as today: no check, rejected, prompt, and a sign-in arms nothing", async () => {
  const { s, calls } = world({ onFullLogin: false });
  sessionAuth.holdIfAuthFailure(s, "401");
  await tick();
  assert.deepEqual(calls.settle, []);
  assert.deepEqual(calls.rejected, ["claude"]);
  assert.equal(s.state.authHeld, true);
  await sessionAuth.resumeHeldSessions("claude");
  assert.equal(s.signInTriedOnFullLogin, false);
});

test("a fallback's token spawn cannot fall back again: its refusal is an ordinary rejection", async () => {
  const { s, calls } = world();
  sessionAuth.holdIfAuthFailure(s, "401");
  await s.authHold.settling;
  s.spawnedOnFullLogin = false; // what `buildLaunchSpec` stamps on the token spawn
  sessionAuth.holdIfAuthFailure(s, "401");
  await tick();
  assert.deepEqual(calls.settle, [false], "no second check");
  assert.deepEqual(calls.rejected, ["claude"]);
  assert.equal(calls.steers, 1, "no second automatic respawn");
  assert.equal(s.state.authHeld, true);
});

test("races: a converging failure joins the one check; a sign-in during it leaves that release alone", async () => {
  let answer;
  const { s, calls } = world({ settle: () => new Promise((r) => { answer = r; }) });
  sessionAuth.holdIfAuthFailure(s, "401");
  const hold = s.authHold;
  sessionAuth.holdIfAuthFailure(s, "401");
  assert.equal(s.authHold, hold);
  assert.equal(calls.settle.length, 1, "one check per hold");
  await sessionAuth.resumeHeldSessions("claude");
  assert.equal(calls.steers, 1);
  answer(true);
  await hold.settling;
  assert.equal(calls.steers, 1, "the late answer does not wake it twice");
  assert.deepEqual(calls.rejected, []);
  assert.equal(calls.refresh, 1, "the marker's change is still pushed");
});

test("a check that throws is not a fallback: the hold stays, with the prompt", async () => {
  const { s, calls } = world({ settle: async () => { throw new Error("boom"); } });
  sessionAuth.holdIfAuthFailure(s, "401");
  await s.authHold.settling;
  assert.deepEqual(calls.rejected, ["claude"]);
  assert.equal(s.state.authHeld, true);
});

// ── Part 2: the verdict over fake children ──────────────────────────────────────────────────

function authWorld({ marker = true, clearable = true } = {}) {
  const calls = { spawn: [], full: [], diag: [] };
  const state = { marker };
  const children = [];
  const stubs = {
    fs: { mkdirSync: () => {} },
    child_process: {
      spawn: (cmd, args, opts) => {
        calls.spawn.push({ args, env: opts.env });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        children.push(child);
        return child;
      },
    },
    "./session-spawner": { cliEnv: () => ({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "inherited" }), getClaudeBinPath: async () => "/x/claude" },
    "./runtime/cli-spawn": real("./runtime/cli-spawn"),
    "./runtime/claude/credential": real("./runtime/claude/credential"),
    "./claude-token": {
      setStoredOAuthToken: () => true,
      fullLoginDir: () => "/userData/claude-full-login",
      hasFullLogin: () => state.marker,
      setFullLogin: (on) => { calls.full.push(on); if (clearable) state.marker = on; return clearable; },
    },
    "./diag": { diag: (...a) => calls.diag.push(a.join(" ")) },
    "./runtime/claude/resolve-bin": { resolveClaudeExecutable: () => "/bundle/claude" },
  };
  const auth = evalModule(readFileSync(join(MAIN, "claude-auth.js"), "utf8"), (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`unexpected require: ${id}`);
  });
  const answer = (text, code = 0) => {
    const c = children[children.length - 1];
    if (text) c.stdout.emit("data", Buffer.from(text, "utf8"));
    c.emit("close", code);
  };
  return { auth, calls, state, answer };
}

const SECRET = "sk-ant-oat01-should-never-be-logged";
const OUT = JSON.stringify({ loggedIn: false, note: SECRET });
const IN = JSON.stringify({ loggedIn: true, authMethod: "claude.ai" });

test("status says logged out: the marker drops; the check ran in the private store with no inherited token; nothing printed is logged", async () => {
  const w = authWorld();
  const p = w.auth.settleFullLogin(false);
  await tick();
  assert.deepEqual(w.calls.spawn[0].args, ["auth", "status", "--json"]);
  assert.equal(w.calls.spawn[0].env.CLAUDE_CONFIG_DIR, "/userData/claude-full-login");
  assert.equal(w.calls.spawn[0].env.CLAUDE_SECURESTORAGE_CONFIG_DIR, "/userData/claude-full-login");
  assert.equal("CLAUDE_CODE_OAUTH_TOKEN" in w.calls.spawn[0].env, false);
  w.answer(OUT, 1);
  assert.equal(await p, true);
  assert.deepEqual(w.calls.full, [false]);
  assert.equal(w.calls.diag.join("\n").includes(SECRET), false);
});

for (const [name, text, code] of [
  ["logged in", IN, 0],
  ["unreadable output", "boom", 1],
  ["no answer", "", null],
]) {
  test(`status ${name}: the marker stays`, async () => {
    const w = authWorld();
    const p = w.auth.settleFullLogin(false);
    await tick();
    w.answer(text, code);
    assert.equal(await p, false);
    assert.deepEqual(w.calls.full, []);
  });
}

test("one status child at a time, and a Cancel does not count it as a sign-in", async () => {
  const w = authWorld();
  const a = w.auth.settleFullLogin(false);
  const b = w.auth.settleFullLogin(false);
  await tick();
  assert.equal(w.calls.spawn.length, 1);
  assert.equal(w.auth.cancel(), false);
  w.answer(OUT, 1);
  assert.deepEqual([await a, await b], [true, true]);
});

test("a sign-in that did not help drops the marker without asking status", async () => {
  const w = authWorld();
  assert.equal(await w.auth.settleFullLogin(true), true);
  assert.equal(w.calls.spawn.length, 0);
  assert.deepEqual(w.calls.full, [false]);
});

test("marker already off: true, no child. A marker that will not clear: false, so nothing respawns onto it", async () => {
  const off = authWorld({ marker: false });
  assert.equal(await off.auth.settleFullLogin(false), true);
  assert.equal(off.calls.spawn.length, 0);
  const stuck = authWorld({ clearable: false });
  assert.equal(await stuck.auth.settleFullLogin(true), false);
});

test("a full-login flow in flight wins: nothing is dropped under it", async () => {
  const w = authWorld();
  void w.auth.signInFull();
  await tick();
  assert.equal(await w.auth.settleFullLogin(true), false);
  assert.deepEqual(w.calls.full, []);
  w.auth.cancel();
});

test("the spawn stamp reads the final env: only no token plus the private store is the full login", () => {
  const { ranOnFullLogin } = require("../main/runtime/claude/credential.js");
  assert.equal(ranOnFullLogin({ CLAUDE_SECURESTORAGE_CONFIG_DIR: "/d" }), true);
  assert.equal(ranOnFullLogin({ CLAUDE_CODE_OAUTH_TOKEN: "t" }), false, "a token spawn: connectors stay off by themselves");
  assert.equal(ranOnFullLogin({}), false);
});
