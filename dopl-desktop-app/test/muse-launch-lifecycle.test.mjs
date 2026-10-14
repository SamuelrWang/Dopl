// The Muse run lifecycle through the REAL `launch-spec.js › start`, `normalize.js` and core's
// `session-io.js › applyCoreEvents`, with only the `muse serve` connection faked (frames from the measured
// 1.4.7 echo recording where they exist).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { m, fakeConn, sessionEcho, INIT, pushQueue, until, notifications } from "./_muse-harness.mjs";

const require = createRequire(import.meta.url);
const client = m("client.js");
const launchSpec = m("launch-spec.js");
const tools = m("tools.js");
const { normalize } = m("normalize.js");
const io = require("../main/session-io.js");

const SENT = { approvalMode: "promptUnmatched", permissionProfile: ":ask-me", workspaceRoot: import.meta.dirname };

function run(o = {}) {
  let turnSeq = 0;
  const f = fakeConn(Object.assign({
    initialize: INIT,
    "session/start": (params) => sessionEcho(params),
    "turn/start": () => ({ status: "accepted", turnId: `tu-${++turnSeq}`, startedNewTurn: true, disposition: "started" }),
    "turn/interrupt": (p) => ({ status: "accepted", turnId: p.turnId }),
  }, o.answers || {}));
  const real = client.connect;
  client.connect = f.connect;
  const prompts = pushQueue();
  const handle = launchSpec.start({
    session: { key: "c:t:a", state: {}, profile: "full" },
    bin: "/fake/muse", args: client.serveArgs({ provider: "echo" }), env: {}, cwd: import.meta.dirname,
    prompt: prompts, sessionStart: Object.assign({}, SENT, o.sessionStart || {}), turnStart: {},
    resumeSessionId: null, dispatch: () => {}, gate: async () => "allow", log: () => {},
  });
  return { ...f, handle, prompts, restore: () => { client.connect = real; } };
}

async function drain(h, s, stop) {
  const seen = [];
  for (;;) {
    const { value, done } = await h.handle.next();
    if (done) return seen;
    for (const ev of normalize(value, {})) { seen.push(ev); if (ev.type !== "auth_hold") io.applyCoreEvents(s, [ev], () => {}, { setSdkSessionId() {}, saveRecord() {} }); }
    if (stop(value, seen)) return seen;
  }
}

test("handshake order: initialize (sessionMcp + experimental requested, userInput withheld), then initialized, then session/start with Dopl's policy", async () => {
  const h = run();
  try {
    await until(() => h.calls.some((c) => c.method === "session/start"), "no session/start");
    const names = h.calls.map((c) => c.method);
    assert.deepEqual(names.slice(0, 3), ["initialize", "initialized", "session/start"]);
    const init = h.calls[0].params;
    assert.equal(init.clientInfo.name, "dopl");
    assert.deepEqual(init.capabilities.requestedCapabilities, ["sessionMcp"]);
    assert.equal(init.capabilities.userInputDialogs, false);
    const start = h.calls[2].params;
    assert.equal(start.approvalMode, "promptUnmatched");
    assert.equal(start.permissionProfile, ":ask-me");
    assert.match(start.commandId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "a UUIDv7");
    const { value } = await h.handle.next();
    assert.equal(value.method, "dopl/sessionStarted");
  } finally { h.restore(); h.handle.close(); }
});

test("a session the host started WIDER than asked is refused before any turn (mode, profile, judge)", async () => {
  for (const over of [
    { approvalMode: { mode: "allowAll", source: "startup", lastCommandId: null } },
    { permissionState: { profileId: ":unrestricted", reviewerAuthority: "none" } },
    { permissionState: { profileId: ":ask-me", reviewerAuthority: "autoReview" } },
  ]) {
    const h = run({ answers: { "session/start": (p) => sessionEcho(p, over) } });
    try {
      await assert.rejects(h.handle.next(), /refusing a session/);
      assert.ok(!h.calls.some((c) => c.method === "turn/start"));
    } finally { h.restore(); }
  }
});

test("Dopl's MCP entry rides session/start only when the host GRANTED sessionMcp — else the launch is refused", async () => {
  const h = run({ answers: { initialize: { ...INIT, grantedCapabilities: [] } }, sessionStart: { config: { mcpServers: { dopl_session: { transport: "streamableHttp", url: "https://x/api/mcp" } } } } });
  try {
    await assert.rejects(h.handle.next(), /sessionMcp/);
    assert.ok(!h.calls.some((c) => c.method === "session/start"));
  } finally { h.restore(); }
});

test("every push is ONE turn/start with ifBusy:steer (no turn/steer race); a steered push is told to directed capture", async () => {
  const h = run({ answers: { "turn/start": (p, calls) => (calls.filter((c) => c.method === "turn/start").length === 1
    ? { status: "accepted", turnId: "tu-1", disposition: "started" } : { status: "accepted", turnId: "tu-1", disposition: "steered" }) } });
  try {
    h.prompts.push(io.userMessage("one"));
    h.prompts.push(io.userMessage("two"));
    await until(() => h.calls.filter((c) => c.method === "turn/start").length === 2, "two pushes");
    for (const c of h.calls.filter((x) => x.method === "turn/start")) assert.equal(c.params.ifBusy, "steer");
    assert.ok(!h.calls.some((c) => c.method === "turn/steer"));
  } finally { h.restore(); h.handle.close(); }
});

test("echo turn (real frames): usage folds into the turn's result; an interrupted turn with NO usage carries the cumulative baseline", async () => {
  const h = run();
  try {
    const s = { tokensSpent: 0, lastTotalTokens: 0, state: {} };
    h.prompts.push(io.userMessage("hello"));
    await until(() => h.calls.some((c) => c.method === "turn/start"), "no turn");
    // Replay the measured echo turn's notifications, with a real-shaped non-zero cumulative injected.
    for (const n of notifications("echo-turn-1.4.7.ndjson")) {
      if (n.method === "session/tokenUsage") h.notify(n.method, { ...n.params, cumulative: { promptTokens: 1200, outputTokens: 34, totalTokens: 1234 } });
      else h.notify(n.method, n.params);
    }
    const seen = await drain(h, s, (f) => f && f.method === "turn/completed");
    assert.ok(seen.some((e) => e.type === "assistant" && e.payload.text === "echo: hello"));
    assert.equal(s.tokensSpent, 1234);
    // Stop: the next turn ends cancelled with no tokenUsage at all.
    h.prompts.push(io.userMessage("again"));
    await until(() => h.calls.filter((c) => c.method === "turn/start").length === 2, "no second turn");
    h.notify("turn/started", { turnId: "tu-2" });
    await h.handle.interrupt();
    const intr = h.calls.find((c) => c.method === "turn/interrupt");
    assert.equal(intr.params.turnId, "tu-2");
    h.notify("turn/completed", { turnId: "tu-2", terminal: "cancelled" });
    await drain(h, s, (f) => f && f.method === "turn/completed");
    assert.equal(s.lastTotalTokens, 1234, "the baseline is the last cumulative total, never reset to 0");
    assert.equal(s.tokensSpent, 1234, "nothing billed twice");
  } finally { h.restore(); h.handle.close(); }
});

test("Stop with no active turn sends nothing (and never hangs)", async () => {
  const h = run();
  try {
    await until(() => h.calls.some((c) => c.method === "session/start"), "no start");
    await h.handle.interrupt();
    assert.ok(!h.calls.some((c) => c.method === "turn/interrupt"));
  } finally { h.restore(); h.handle.close(); }
});

test("the child exiting fails the stream with the cause; close() ends it cleanly", async () => {
  const h = run();
  try {
    await until(() => h.hooks() !== null, "no connect");
    h.hooks().onExit(3, null, null);
    await assert.rejects(async () => { for (;;) { const r = await h.handle.next(); if (r.done) break; } }, /exited \(code 3/);
  } finally { h.restore(); }
});

test("buildLaunchSpec: Dopl's policy, the host fences on argv, the bearer only inside session/start (never argv or env)", () => {
  const spec = launchSpec.buildLaunchSpec({ session: { profile: "dopl_only", channelId: "11111111-1111-4111-8111-111111111111", state: { toolMode: "allowAll" }, workspaceId: "ws", model: "muse-spark", containerToken: { token: "tok-secret" } }, dispatch: () => {} });
  assert.equal(spec.sessionStart.approvalMode, "onRequest");
  assert.equal(spec.sessionStart.permissionProfile, ":ask-me");
  assert.equal(spec.sessionStart.modelId, "muse-spark");
  for (const f of ["serve", "--provider", "meta", "--contributor-mode", "off", "--disable-write", "--disable-shell"]) assert.ok(spec.args.includes(f), f);
  assert.ok(!spec.args.includes("--trust-workspace"));
  const argv = spec.args.join(" ");
  assert.ok(!/tok-secret/.test(argv) && !/tok-secret/.test(JSON.stringify(spec.env)), "the bearer is never on argv or in env");
  const entry = spec.sessionStart.config && spec.sessionStart.config.mcpServers.dopl_session;
  assert.ok(entry, "the container credential mounts Dopl's server");
  assert.equal(entry.transport, "streamableHttp");
  assert.equal(entry.headers.Authorization, "Bearer tok-secret", "the bearer rides the JSON-RPC request on stdin");
  assert.equal(entry.headers["X-Dopl-Runtime"], "desktop-session");
  assert.equal(entry.headers["X-Dopl-Vendor"], "muse");
  assert.equal(entry.mode, "required");
  assert.deepEqual(tools.TOOL_MODES, ["promptUnmatched", "onRequest", "allowAll"]);
});

test("resume is REFUSED until the token baseline is measured", () => {
  assert.throws(() => launchSpec.resume({ session: {} }, null), /resume|usage|unverified/i);
});
