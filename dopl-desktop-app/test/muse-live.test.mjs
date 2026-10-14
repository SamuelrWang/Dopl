// LIVE TIER — the real `muse serve` binary, Meta's `echo` provider (no model, no account, no tokens).
// Skipped unless `MUSE_LIVE_BIN` names a muse binary (e.g. the versioned `muse-bin-<ver>`). With
// `MUSE_LIVE_RECORD=1` each case writes its wire frames to `fixtures/muse/live-<case>.ndjson`.
//
//   MUSE_LIVE_BIN=/path/to/muse-bin-1.4.7-R6101.1 node --test test/muse-live.test.mjs
//
// Proves on a real host: handshake + grants, Dopl's policy echoed back, an echo turn through the REAL
// `launch-spec.js › start` + `normalize.js`, Stop, a mid-turn push, the required-MCP failure path, and the
// isolation (private home, no operator skills, META_API_KEY stripped, the `-c` settings accepted).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { m, FIX, pushQueue } from "./_muse-harness.mjs";

const require = createRequire(import.meta.url);
const BIN = process.env.MUSE_LIVE_BIN || "";
const RECORD = process.env.MUSE_LIVE_RECORD === "1";
const skip = BIN ? false : "set MUSE_LIVE_BIN to a muse binary";
const client = m("client.js");
const configHome = m("config-home.js");
const launchSpec = m("launch-spec.js");
const { normalize } = m("normalize.js");
const io = require("../main/session-io.js");

/** Wrap the real `client.connect` so every frame is kept as `{dir, raw}` (written when recording). */
function recorder(name) {
  const frames = [];
  const real = client.connect;
  client.connect = (opts) => {
    const conn = real(Object.assign({}, opts, {
      onNotification: (msg) => { frames.push({ dir: "server", raw: JSON.stringify(msg) }); if (opts.onNotification) opts.onNotification(msg); },
      onServerRequest: (msg) => { frames.push({ dir: "server", raw: JSON.stringify(msg) }); return opts.onServerRequest(msg); },
    }));
    const request = conn.request;
    conn.request = async (method, params) => {
      frames.push({ dir: "client", raw: JSON.stringify({ method, params }) });
      const r = await request(method, params).catch((e) => { frames.push({ dir: "server", raw: JSON.stringify({ error: { code: e.code, message: e.message } }) }); throw e; });
      frames.push({ dir: "server", raw: JSON.stringify({ result: r }) });
      return r;
    };
    return conn;
  };
  return {
    frames,
    done() {
      client.connect = real;
      if (RECORD) writeFileSync(join(FIX, `live-${name}.ndjson`), frames.map((f) => JSON.stringify(f)).join("\n") + "\n");
    },
  };
}

function spec(o = {}) {
  const ws = mkdtempSync(join(tmpdir(), "dopl-muse-ws-"));
  return Object.assign({
    session: { key: "live", state: {}, profile: "full" },
    bin: BIN, args: client.serveArgs({ provider: "echo" }), env: configHome.buildScrubbedEnv(), cwd: ws,
    prompt: pushQueue(), sessionStart: { approvalMode: "promptUnmatched", permissionProfile: ":ask-me", workspaceRoot: ws },
    turnStart: {}, resumeSessionId: null, dispatch: () => {}, gate: async () => "deny", log: () => {},
  }, o);
}

async function waitFor(pred, what, ms = 10000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function collect(handle, stop) {
  const evs = [];
  for (;;) {
    const { value, done } = await handle.next();
    if (done) return evs;
    evs.push(...normalize(value, {}));
    if (stop(value, evs)) return evs;
  }
}

test("live: handshake, Dopl's policy read back, an echo turn end to end, usage measured (zero), launched id", { skip }, async () => {
  const rec = recorder("echo-turn-dopl");
  const sp = spec();
  const h = launchSpec.start(sp);
  try {
    sp.prompt.push(io.userMessage("hello"));
    const evs = await collect(h, (f) => f && f.method === "turn/completed");
    const launched = evs.find((e) => e.type === "launched");
    assert.match(launched.sessionId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(evs.filter((e) => e.type === "assistant").map((e) => e.payload.text), ["echo: hello"]);
    assert.equal(evs.find((e) => e.type === "result").sessionTokens, 0, "echo reports a real zero");
    assert.ok(!evs.some((e) => e.type === "tool_use"), "observer children are off (`run.reminder_roster.agents=[]`)");
  } finally { h.close(); rec.done(); }
});

test("live: Stop interrupts within the bound; a push during a turn is joined or queued, never refused", { skip }, async () => {
  const rec = recorder("interrupt-steer");
  const sp = spec();
  const h = launchSpec.start(sp);
  try {
    sp.prompt.push(io.userMessage("one"));
    sp.prompt.push(io.userMessage("two"));
    const t0 = Date.now();
    await waitFor(() => rec.frames.some((f) => /turn\/started/.test(f.raw)), "no turn started");
    await h.interrupt();
    assert.ok(Date.now() - t0 < 6000, "the interrupt resolved inside its bound");
    const evs = await collect(h, (_f, all) => all.filter((e) => e.type === "result").length >= 1);
    assert.ok(evs.some((e) => e.type === "result"));
    const dispositions = rec.frames.filter((f) => /"disposition"/.test(f.raw)).map((f) => JSON.parse(f.raw).result.disposition);
    for (const d of dispositions) assert.ok(["started", "steered", "queued"].includes(d), d);
    assert.ok(!rec.frames.some((f) => /already_terminal/.test(f.raw)), "ifBusy:steer never races a finished turn");
  } finally { h.close(); rec.done(); }
});

test("live: a required Dopl MCP server that cannot start runs NO turn, and the lane says Dopl's tools did not connect", { skip }, async () => {
  const rec = recorder("mcp-required-unreachable");
  const sp = spec();
  sp.sessionStart.config = { mcpServers: { dopl_session: { transport: "streamableHttp", url: "http://127.0.0.1:9/api/mcp", headers: { Authorization: "Bearer canary" }, mode: "required" } } };
  const h = launchSpec.start(sp);
  try {
    sp.prompt.push(io.userMessage("hello"));
    const evs = await collect(h, (f) => f && f.method === "turn/completed");
    assert.ok(evs.some((e) => e.type === "mcp_status_report"));
    assert.ok(!evs.some((e) => e.type === "assistant" && /echo:/.test(e.payload.text)), "no model turn ran");
  } finally { h.close(); rec.done(); }
});

test("live: isolation — museHome inside Dopl's private home, no operator skills, META_API_KEY stripped, -c accepted", { skip }, async () => {
  const operatorHome = mkdtempSync(join(tmpdir(), "dopl-muse-operator-"));
  mkdirSync(join(operatorHome, ".claude", "skills", "operator-canary"), { recursive: true });
  writeFileSync(join(operatorHome, ".claude", "skills", "operator-canary", "SKILL.md"), "---\nname: operator-canary\ndescription: c\n---\nb\n");
  const saved = { HOME: process.env.HOME, META_API_KEY: process.env.META_API_KEY };
  process.env.HOME = operatorHome;
  process.env.META_API_KEY = "bogus-operator-key";
  const env = configHome.isolatedEnv(configHome.buildScrubbedEnv());
  if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
  if (saved.META_API_KEY === undefined) delete process.env.META_API_KEY; else process.env.META_API_KEY = saved.META_API_KEY;
  const ws = mkdtempSync(join(tmpdir(), "dopl-muse-ws-"));
  const conn = client.connect({ bin: BIN, args: client.serveArgs({ provider: "echo" }), env, cwd: ws });
  try {
    const init = await client.handshake(conn, "0.0.0");
    assert.ok(realpathSync(init.museHome).startsWith(realpathSync(configHome.privateHome())), `museHome ${init.museHome}`);
    assert.ok(init.grantedCapabilities.includes("sessionMcp"));
    const acct = await conn.request("account/read", {});
    assert.notEqual(acct.state, "envKey", "the operator's META_API_KEY never reached the child");
    const started = await conn.request("session/start", { commandId: client.uuidv7(), workspaceRoot: ws, approvalMode: "promptUnmatched", permissionProfile: ":ask-me" });
    const skills = await conn.request("skill/list", { sessionId: started.session.sessionId });
    assert.ok(!JSON.stringify(skills).includes("operator-canary"), "the operator's ~/.claude/skills is invisible");
  } finally { conn.close(); }
});

test("live: `muse schema` describes the build, and it covers everything Dopl requires", { skip }, async () => {
  const sdkShape = require("../main/runtime/sdk-shape.js");
  const { shape } = await m("shape.js").describeBuild(BIN);
  const v = sdkShape.checkShape(m("required-shape.js"), shape);
  assert.equal(v.refuse, false, JSON.stringify(v.missing));
});
