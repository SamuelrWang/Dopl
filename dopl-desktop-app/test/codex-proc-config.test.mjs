// DOPL'S RESTRICTIONS RIDE ARGV AND ARE READ BACK (`proc-config.js`, 2026-10-08). Tier 1 pins the split,
// the TOML, the no-secret rule and the comparison; the LIVE tier (`CODEX_APP_SERVER_LIVE=1`, zero quota:
// no thread, no turn) spawns the real build with Dopl's real restrictions and proves `config/read` reads
// every one back — and that a value that did NOT take is refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { client, liveGate, announceGate, skipLive, withAppServer } from "./_codex-app-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const require = createRequire(import.meta.url);
const procConfig = require(join(CODEX, "proc-config.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));
const mcp = require(join(CODEX, "mcp.js"));
const GATE = announceGate(liveGate());

const CH = "11111111-1111-4111-8111-111111111111";
const realThreadStart = (natives) => launchSpec.buildLaunchSpec({
  session: { profile: "full", channelId: CH, state: { toolMode: "on-request" }, workspaceId: "ws", model: "",
    containerToken: { token: "t" }, operatorTools: natives || false },
  dispatch: () => {},
}).threadStart;

test("every RESTRICTION key Dopl puts on a thread moves to argv; nothing restrictive is left on the thread", () => {
  const ts = realThreadStart();
  const { proc, thread } = procConfig.split(ts.config);
  for (const key of Object.keys(ts.config)) {
    assert.ok(procConfig.RESTRICTION_KEYS.includes(key), `thread config key "${key}" must be declared a restriction (or not set)`);
  }
  assert.deepEqual(Object.keys(thread), [], "nothing restrictive stays where it cannot be read back");
  assert.ok(proc.features && proc.notify && proc.projects && proc.shell_environment_policy, Object.keys(proc).join(","));
});

test("the operator's OWN servers stay on the thread (their headers are theirs); Dopl's entry goes to argv", () => {
  const { proc, thread } = procConfig.split({
    mcp_servers: { [mcp.SERVER_KEY]: { url: "u" }, mine: { url: "x", http_headers: { Authorization: "Bearer secret" } } },
  });
  assert.deepEqual(Object.keys(proc.mcp_servers), [mcp.SERVER_KEY]);
  assert.deepEqual(Object.keys(thread.mcp_servers), ["mine"]);
  assert.equal(procConfig.argsFor(proc).join(" ").includes("secret"), false);
});

test("TOML: strings, bools, numbers, arrays, tables — and refuses what it cannot write", () => {
  assert.equal(procConfig.toml({ a: "x\"y", b: [true, 2], "c.d": {} }), '{"a" = "x\\"y", "b" = [true, 2], "c.d" = {}}');
  assert.throws(() => procConfig.toml({ a: null }), /cannot write a null/);
  assert.deepEqual(procConfig.argsFor({ notify: [], features: { apps: false } }),
    ["-c", 'features={"apps" = false}', "-c", "notify=[]"]);
});

test("argv may never carry the session bearer", () => {
  assert.throws(() => procConfig.assertNoSecret(["-c", 'x={"h" = "tok-1234567890"}'], "tok-1234567890"), /credential/);
  procConfig.assertNoSecret(["-c", "notify=[]"], "tok-1234567890");
  procConfig.assertNoSecret(["-c", "notify=[]"], undefined);
});

test("readback: every leaf must be in effect and equal; extra server defaults are fine", () => {
  const proc = { features: { apps: false }, mcp_servers: { dopl: { url: "u", tools: { t: { approval_mode: "approve" } } } }, notify: [] };
  assert.deepEqual(procConfig.mismatches(proc, {
    features: { apps: false, other: true },
    mcp_servers: { dopl: { url: "u", environment_id: "local", tools: { t: { approval_mode: "approve" } } } },
    notify: [],
  }), []);
  const bad = procConfig.mismatches(proc, { features: { apps: true }, mcp_servers: { dopl: { url: "u" } } });
  assert.deepEqual(bad, [
    "features.apps reads back as true",
    "mcp_servers.dopl.tools.t.approval_mode is not in effect",
    "notify is not in effect",
  ]);
  assert.equal(procConfig.mismatches(proc, null).length, 4, "no config read = no leaf confirmed");
});

test("readback: a failed or empty read REFUSES the session, naming why", async () => {
  const proc = { notify: [] };
  await assert.rejects(procConfig.assertRestrictionsTook({ request: async () => { throw new Error("method not found"); } }, proc, "/x"),
    /could not read back Codex's settings \(method not found\)/);
  await assert.rejects(procConfig.assertRestrictionsTook({ request: async () => ({}) }, proc, "/x"), /not running with Dopl's restrictions/);
  await procConfig.assertRestrictionsTook({ request: async () => { throw new Error("never asked"); } }, {}, "/x");
});

// ── LIVE: the real build reads back Dopl's REAL restrictions ─────────────────────────────────

test("live: Dopl's real restrictions all read back from the running build (zero quota)", async (t) => {
  if (skipLive(t, GATE)) return;
  const { proc } = procConfig.split(realThreadStart().config);
  const cwd = mkdtempSync(join(tmpdir(), "dopl-pc-cwd-"));
  await withAppServer({
    args: procConfig.argsFor(proc),
    connect: (a) => client.connect({ ...a, env: { ...process.env, CODEX_HOME: mkdtempSync(join(tmpdir(), "dopl-pc-")) }, cwd }),
  }, async (conn) => {
    await conn.request("initialize", client.initializeParams("0.0.0-test"));
    conn.notify("initialized");
    await procConfig.assertRestrictionsTook(conn, proc, cwd);
    // And a restriction that did NOT take (claimed, never sent) is refused against the same live answer.
    const claimed = { ...proc, notify: ["/bin/echo", "x"] };
    await assert.rejects(procConfig.assertRestrictionsTook(conn, claimed, cwd), /notify/);
  });
});

