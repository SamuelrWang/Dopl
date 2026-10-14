// LIVE TIER — the real `grok agent` on a real subscription sign-in (real model turns: keep them few and tiny).
// Skipped unless BOTH are set:
//   GROK_LIVE_BIN   a grok binary
//   GROK_LIVE_HOME  a signed-in GROK_HOME (its `auth.json` is used IN PLACE as `GROK_AUTH_PATH` — never read,
//                   copied or printed; every other path is Dopl's own private home, as a real launch builds it)
//
//   GROK_LIVE_BIN=… GROK_LIVE_HOME=…/.grok node --test test/grok-live.test.mjs
//
// Proves on a real build, through the REAL `launch-spec.js › start` + `approval.js` + `normalize.js`: the
// isolation (`grok inspect`: only Dopl's config, project `.mcp.json` blocked, XAI_API_KEY stripped, private
// HOME), a Dopl-like MCP tool's permission round-trip in Grok's `default` AND `autoMode` (the ask rule), the
// headers on the wire, per-session model + plain-string effort, usage + the 256k window, resume (no replay),
// a live model switch, interject (steer) and cancel, and (F-777) an operator Deny held in the hook failing only
// that call. ≈5 prompts on `grok-4.7-build-fast`.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { g, pushQueue, userMsg } from "./_grok-harness.mjs";

const require = createRequire(import.meta.url);
const BIN = process.env.GROK_LIVE_BIN || "";
const LIVE_HOME = process.env.GROK_LIVE_HOME || "";
const AUTH = LIVE_HOME ? join(LIVE_HOME, "auth.json") : "";
const skip = BIN && LIVE_HOME && existsSync(AUTH) ? false : "set GROK_LIVE_BIN and GROK_LIVE_HOME (a signed-in GROK_HOME)";
const MODEL = "grok-4.7-build-fast";
const client = g("client.js");
const configHome = g("config-home.js");
const launchSpec = g("launch-spec.js");
const policy = g("policy.js");
const mcp = g("mcp.js");
const { normalize } = g("normalize.js");
const sdkShape = require("../main/runtime/sdk-shape.js");

/** A Dopl-like MCP server: `post_message` (write) + `read_channel` (read-only). Records headers per call. */
function stubServer() {
  const seen = [];
  const tools = [
    { name: "post_message", description: "Post a message to the team channel.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: false } },
    { name: "read_channel", description: "Read recent channel messages.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  ];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      let m = null;
      try { m = JSON.parse(body); } catch (_) { m = null; }
      seen.push({ method: req.method, auth: req.headers.authorization || null, vendor: req.headers["x-dopl-vendor"] || null, runtime: req.headers["x-dopl-runtime"] || null, rpc: m });
      if (req.method !== "POST" || !m) { res.writeHead(req.method === "POST" ? 400 : 405); res.end(); return; }
      if (m.id == null) { res.writeHead(202); res.end(); return; }
      let result;
      if (m.method === "initialize") result = { protocolVersion: (m.params && m.params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "dopl-stub", version: "0" } };
      else if (m.method === "tools/list") result = { tools };
      else if (m.method === "tools/call") result = { content: [{ type: "text", text: m.params.name === "post_message" ? "posted #42" : "msg#41: hello" }] };
      else if (m.method === "ping") result = {};
      const reply = result ? { jsonrpc: "2.0", id: m.id, result } : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "nf" } };
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

/** The real `client.connect`, with `GROK_AUTH_PATH` pointed at the live sign-in IN PLACE and every frame kept. */
function liveConnect() {
  const real = client.connect;
  const box = { env: null, requests: [], notes: [] };
  client.connect = (opts) => {
    box.env = Object.assign({}, opts.env, { GROK_AUTH_PATH: AUTH });
    return real(Object.assign({}, opts, {
      env: box.env,
      onServerRequest: (msg) => { box.requests.push(msg); return opts.onServerRequest(msg); },
      onNotification: (msg) => { box.notes.push(msg); return opts.onNotification(msg); },
    }));
  };
  box.restore = () => { client.connect = real; };
  return box;
}

function workspace() {
  const ws = mkdtempSync(join(tmpdir(), "dopl-grok-ws-"));
  // A project MCP server that must NOT join a Dopl session.
  writeFileSync(join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { evil: { command: "/usr/bin/true" } } }));
  return ws;
}

function spec(stub, o = {}) {
  const asked = [];
  const verdict = o.verdict || (() => ({ behavior: "allow" }));
  return Object.assign({
    session: { key: "live", state: {}, profile: "full" },
    bin: BIN, args: client.agentArgs(), env: configHome.buildScrubbedEnv(), cwd: o.cwd || workspace(),
    prompt: pushQueue(), sessionMeta: policy.sessionMeta(o.mode || "default"),
    mcpServers: [{ type: "http", name: mcp.SERVER_KEY, url: stub.url, headers: mcp.headerList(Object.assign({ Authorization: "Bearer live-canary" }, mcp.RUNTIME_HEADERS)) }],
    model: MODEL, effort: o.effort || "", resumeSessionId: o.resume || null, dispatch: () => {}, log: () => {},
    gate: (name, input) => { asked.push({ name, input }); return verdict(name, input); },
  }, o.extra || {}, { asked });
}

async function collect(handle, stop, ms = 150000) {
  const evs = [];
  const deadline = Date.now() + ms;
  for (;;) {
    const next = await Promise.race([handle.next(), new Promise((r) => setTimeout(() => r({ timeout: true }), Math.max(1, deadline - Date.now())))]);
    if (next.timeout) throw new Error(`timed out; saw ${evs.map((e) => e.type).join(",")}`);
    if (next.done) return evs;
    evs.push(...normalize(next.value, {}));
    if (stop(evs, next.value)) return evs;
  }
}
const resultOf = (evs) => evs.filter((e) => e.type === "result").pop();
const said = (evs) => evs.filter((e) => e.type === "assistant").map((e) => e.payload.text).join("\n");
const later = (v, ms) => new Promise((r) => setTimeout(() => r(v), ms));

test("isolation: `grok inspect` in Dopl's env loads ONLY Dopl's config, blocks a project .mcp.json, and no key reaches it", { skip }, () => {
  const saved = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "xai-live-canary";
  try {
    const env = configHome.isolatedEnv(configHome.buildScrubbedEnv());
    assert.equal(env.XAI_API_KEY, undefined);
    const ws = workspace();
    const out = JSON.parse(execFileSync(BIN, ["inspect", "--json"], { cwd: ws, env: Object.assign({}, env, { GROK_AUTH_PATH: AUTH }), encoding: "utf8", timeout: 30000 }));
    assert.deepEqual(out.permissions.sources, [`${join(env.GROK_HOME, "config.toml")} (config)`], "no ~/.claude settings, no other config layer");
    assert.deepEqual(out.permissions.mcpServerAllowlist, ["name:dopl_session"]);
    const evil = out.mcpServers.find((s) => s.name === "evil");
    assert.match(evil.disabledReason, /not in allowedMcpServers/);
    assert.equal(out.projectTrusted, false);
    assert.deepEqual(out.hooks, []);
    assert.deepEqual(out.plugins, []);
    assert.ok(out.externalCompat.cells.every((c) => c.enabled === false), "every foreign-agent source off");
  } finally {
    if (saved === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = saved;
  }
});

// A session is filed under its cwd (LIVE: `session/load` from another folder answers -32603 "Path not found."),
// so the resume runs in the first session's folder — as a real one does (`channel-dirs.js › sessionSpawnDir`).
let firstSession = null;
let firstCwd = null;

test("`default` mode: a Dopl MCP call is HELD for Dopl's gate, then runs; headers, model, effort, usage, window", { skip, timeout: 200000 }, async () => {
  const stub = await stubServer();
  const live = liveConnect();
  const sp = spec(stub, { effort: "low", verdict: () => later({ behavior: "allow" }, 300) });
  firstCwd = sp.cwd;
  const h = launchSpec.start(sp);
  try {
    const started = await collect(h, (evs) => evs.some((e) => e.type === "launched"), 60000);
    firstSession = started.find((e) => e.type === "launched").sessionId;
    assert.equal(started.find((e) => e.type === "launched").model, MODEL, "the model is per session, read back");
    assert.equal(live.env.HOME.includes(configHome.PRIVATE_HOME), true);
    assert.equal(sdkShape.driftReport("grok").some((d) => d.where === "effort"), false, "plain-string effort `low` accepted (SMOKE S4 closed)");
    sp.prompt.push(userMsg("Call the dopl_session post_message tool with text 'live-default', then reply with the single word DONE."));
    const evs = await collect(h, (e) => !!resultOf(e));
    assert.deepEqual(sp.asked.filter((a) => /dopl_session/.test(a.name)).map((a) => [a.name, a.input]),
      [["mcp__dopl_session__post_message", { text: "live-default" }]], "asked once, by its real name, with its own arguments");
    assert.ok(live.requests.some((r) => r.method === "session/request_permission" && /post_message/.test(JSON.stringify(r.params))), "held in request_permission");
    assert.ok(stub.seen.some((s) => s.rpc && s.rpc.method === "tools/call" && s.rpc.params.name === "post_message"), "the post ran after the allow");
    const calls = stub.seen.filter((s) => s.method === "POST");
    assert.ok(calls.length && calls.every((s) => s.auth === "Bearer live-canary" && s.vendor === "grok" && s.runtime === "desktop-session"), "headers verbatim on every request");
    assert.ok(!live.notes.some((n) => n.method === "_x.ai/mcp/server_status" && n.params.name === "evil"), "the project server never joined");
    const r = resultOf(evs);
    assert.ok(r.sessionTokens > 0, "usage summed (null-not-0)");
    const ctx = evs.filter((e) => e.type === "context").pop();
    assert.equal(ctx && ctx.window, 256000, "the signed-in roster's window, not the 500k fallback");
  } finally { h.close(); live.restore(); stub.server.close(); }
});

test("`autoMode` + the ask rule: the classifier still hands a Dopl MCP call to Dopl's gate", { skip, timeout: 200000 }, async () => {
  const stub = await stubServer();
  const live = liveConnect();
  const sp = spec(stub, { mode: "autoMode", verdict: () => later({ behavior: "allow" }, 300) });
  const h = launchSpec.start(sp);
  try {
    await collect(h, (evs) => evs.some((e) => e.type === "launched"), 60000);
    sp.prompt.push(userMsg("Call the dopl_session post_message tool with text 'live-auto', then reply with the single word DONE."));
    await collect(h, (e) => !!resultOf(e));
    assert.ok(sp.asked.some((a) => a.name === "mcp__dopl_session__post_message"), "the gate saw it");
    assert.ok(live.requests.some((r) => r.method === "session/request_permission" && /post_message/.test(JSON.stringify(r.params))), "held under autoMode (ask rule)");
    assert.ok(live.requests.some((r) => r.method === "_x.ai/hooks/run" && r.params.permissionMode === "auto"), "the hook reports Grok's own auto mode");
  } finally { h.close(); live.restore(); stub.server.close(); }
});

test("F-777: an operator's Deny on a PARKED Dopl call (held in the hook) fails only that call — the turn goes on", { skip, timeout: 200000 }, async () => {
  const stub = await stubServer();
  const live = liveConnect();
  const sp = spec(stub, { verdict: () => later({ behavior: "deny", message: "The operator denied this call." }, 2500) });
  const h = launchSpec.start(sp);
  try {
    await collect(h, (evs) => evs.some((e) => e.type === "launched"), 60000);
    sp.prompt.push(userMsg("Call the dopl_session post_message tool with text 'live-deny'. If it is denied, reply with the single word NOTED."));
    const evs = await collect(h, (e) => !!resultOf(e));
    assert.ok(sp.asked.some((a) => a.name === "mcp__dopl_session__post_message"), "the gate was asked");
    assert.ok(!stub.seen.some((s) => s.rpc && s.rpc.method === "tools/call" && s.rpc.params.name === "post_message"), "the post never ran");
    assert.ok(!live.requests.some((r) => r.method === "session/request_permission" && /post_message/.test(JSON.stringify(r.params))), "answered in the hook, never in a permission request");
    const done = live.notes.filter((n) => n.method === "_x.ai/session/prompt_complete").pop();
    assert.equal(done && done.params.stopReason, "end_turn", "not a cancelled turn (contrast reject_once → PermissionRejected)");
    assert.match(said(evs), /NOTED/i, "the model carried on after the denial");
  } finally { h.close(); live.restore(); stub.server.close(); }
});

test("resume (no replay rendered), live model switch, interject (steer) and cancel on one loaded session", { skip, timeout: 300000 }, async () => {
  assert.ok(firstSession, "the default-mode case must run first");
  const stub = await stubServer();
  const live = liveConnect();
  const sp = spec(stub, { resume: firstSession, cwd: firstCwd });
  const h = launchSpec.start(sp);
  try {
    const started = await collect(h, (evs) => evs.some((e) => e.type === "launched"), 60000);
    assert.equal(started.find((e) => e.type === "launched").sessionId, firstSession);
    assert.equal(started.filter((e) => e.type === "assistant").length, 0, "the replayed DONE is not said again");
    await h.setModel("grok-4.7-build-fast");
    sp.prompt.push(userMsg("Run the shell command `sleep 8 && echo slept`, then reply with its output."));
    await new Promise((r) => setTimeout(r, 4000));
    sp.prompt.push(userMsg("Also end your reply with the word BANANA."));
    const evs = await collect(h, (e) => !!resultOf(e));
    assert.ok(live.notes.some((n) => n.method === "_x.ai/session/interjection"), "the steer joined the running turn");
    assert.match(said(evs), /BANANA/i);
    sp.prompt.push(userMsg("Run the shell command `sleep 30 && echo late`, then reply with its output."));
    await new Promise((r) => setTimeout(r, 6000));
    const t0 = Date.now();
    await h.interrupt();
    const cancelled = await collect(h, (e) => !!resultOf(e), 30000);
    assert.ok(Date.now() - t0 < 15000, "Stop resolved promptly");
    assert.ok(resultOf(cancelled));
  } finally { h.close(); live.restore(); stub.server.close(); }
});
