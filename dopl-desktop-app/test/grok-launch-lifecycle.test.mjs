// The Grok run lifecycle through the REAL `launch-spec.js › start`, `normalize.js` and core's
// `session-io.js › applyCoreEvents`, with only the `grok agent` connection faked — frames and answers from the
// grok 1.0.52 recordings where they exist (`fixtures/grok/`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { g, fakeConn, INIT, INIT_SIGNED_OUT, SESSION_NEW, pushQueue, userMsg, until, tick, notifications, resultOf } from "./_grok-harness.mjs";

const require = createRequire(import.meta.url);
const client = g("client.js");
const launchSpec = g("launch-spec.js");
const policy = g("policy.js");
const { normalize } = g("normalize.js");
const io = require("../main/session-io.js");

const S3 = "smoke-s3-resume-steer.ndjson";
const PROMPT_OK = resultOf(S3, "session/prompt", 0); // "Reply with just OK." (usage + context)
const configEcho = (model) => ({ configOptions: SESSION_NEW.configOptions.map((c) => (c.id === "model" ? { ...c, currentValue: model } : c)) });

function held() {
  let resolve; let reject;
  const p = new Promise((a, b) => { resolve = a; reject = b; });
  return { p, resolve, reject };
}

function run(o = {}) {
  const prompts = [];
  const f = fakeConn(Object.assign({
    initialize: INIT,
    "session/new": SESSION_NEW,
    "session/load": { models: SESSION_NEW.models, configOptions: SESSION_NEW.configOptions, _meta: {} },
    "session/prompt": () => { const h = held(); prompts.push(h); return h.p; },
    "session/set_config_option": (p) => (p.configId === "model" ? configEcho(p.value) : { configOptions: SESSION_NEW.configOptions }),
    "_x.ai/interject": { result: { status: "queued" } },
  }, o.answers || {}));
  const real = client.connect;
  client.connect = f.connect;
  const queue = pushQueue();
  const handle = launchSpec.start(Object.assign({
    session: { key: "c:t:a", state: {}, profile: "full" },
    bin: "/fake/grok", args: client.agentArgs(), env: {}, cwd: import.meta.dirname,
    prompt: queue, cfg: undefined, sessionMeta: policy.sessionMeta("default"),
    mcpServers: [{ type: "http", name: "dopl_session", url: "http://x/mcp", headers: [{ name: "Authorization", value: "Bearer t" }] }],
    model: "", effort: "", resumeSessionId: null, dispatch: () => {}, gate: async () => ({ behavior: "allow" }), log: () => {},
  }, o.spec || {}));
  return { ...f, handle, queue, prompts, restore: () => { client.connect = real; } };
}

async function drainUntil(h, stop) {
  const seen = [];
  const s = { state: {} };
  for (;;) {
    const { value, done } = await h.handle.next();
    if (done) return seen;
    for (const ev of normalize(value, {})) { seen.push(ev); if (ev.type !== "auth_hold") io.applyCoreEvents(s, [ev], () => {}, { setSdkSessionId() {}, saveRecord() {} }); }
    if (stop(seen)) return seen;
  }
}

test("handshake: initialize (ACP v1, no client fs/terminal), NO authenticate, then session/new with Dopl's MCP entry and the hook", async () => {
  const h = run();
  try {
    await until(() => h.calls.some((c) => c.method === "session/new"), "no session/new");
    const names = h.calls.map((c) => c.method);
    assert.deepEqual(names.slice(0, 2), ["initialize", "session/new"]);
    assert.ok(!names.includes("authenticate"), "never authenticate");
    const init = h.calls[0].params;
    assert.equal(init.protocolVersion, 1);
    assert.equal(init.clientInfo.name, "dopl");
    assert.deepEqual(init.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
    const sn = h.calls[1].params;
    assert.equal(sn.mcpServers[0].name, "dopl_session");
    assert.deepEqual(sn._meta["x.ai/hooks"].PreToolUse[0], { matcher: "*", hookCallbackIds: ["dopl_gate"], timeout: 600 });
    for (const k of ["yoloMode", "autoMode"]) assert.ok(!(k in sn._meta), `default mode sends no ${k}`);
    const { value } = await h.handle.next();
    assert.equal(value.method, "dopl/sessionStarted");
    assert.equal(value.params.model, "grok-4.7");
  } finally { h.restore(); h.handle.close(); }
});

test("autoMode is the only mode flag ever sent; yoloMode is refused at the source", () => {
  assert.equal(policy.sessionMeta("autoMode").autoMode, true);
  assert.ok(!("autoMode" in policy.sessionMeta("approve-all")));
  for (const m of ["default", "autoMode", "approve-all", "yolo", undefined]) assert.ok(!("yoloMode" in policy.sessionMeta(m)));
});

test("signed out (no cached_token offered): an auth hold, and Grok is never asked to authenticate", async () => {
  const h = run({ answers: { initialize: INIT_SIGNED_OUT } });
  try {
    const seen = await drainUntil(h, (s) => s.length > 0);
    assert.deepEqual(seen.map((e) => e.type), ["auth_hold"]);
    assert.ok(!h.calls.some((c) => c.method === "authenticate" || c.method === "session/new"));
  } finally { h.restore(); h.handle.close(); }
});

test("a session/new refused `-32000 Authentication required` is an auth hold, not a crash", async () => {
  const err = Object.assign(new Error("Authentication required"), { code: -32000 });
  const h = run({ answers: { "session/new": () => { throw err; } } });
  try {
    const seen = await drainUntil(h, (s) => s.length > 0);
    assert.deepEqual(seen.map((e) => e.type), ["auth_hold"]);
  } finally { h.restore(); h.handle.close(); }
});

test("the model is set per session and READ BACK: a kept model refuses the session before any prompt", async () => {
  const ok = run({ spec: { model: "grok-4.7-build-fast" } });
  try {
    const { value } = await ok.handle.next();
    assert.equal(value.params.model, "grok-4.7-build-fast");
    assert.deepEqual(ok.calls.find((c) => c.method === "session/set_config_option").params, { sessionId: SESSION_NEW.sessionId, configId: "model", value: "grok-4.7-build-fast" });
  } finally { ok.restore(); ok.handle.close(); }
  const kept = run({ spec: { model: "grok-4.6" }, answers: { "session/set_config_option": () => configEcho("grok-4.7") } });
  try {
    await assert.rejects(kept.handle.next(), /refusing a session/);
    assert.ok(!kept.calls.some((c) => c.method === "session/prompt"));
  } finally { kept.restore(); }
});

test("a turn: chunks render as ONE message, then Dopl's running total and the context window (256k, live roster)", async () => {
  const h = run();
  try {
    await h.handle.next(); // sessionStarted
    h.queue.push(userMsg("Reply with just OK."));
    await until(() => h.prompts.length === 1, "no prompt");
    const sid = SESSION_NEW.sessionId;
    for (const t of ["O", "K"]) h.notify("session/update", { sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } });
    h.prompts[0].resolve(PROMPT_OK);
    const seen = await drainUntil(h, (s) => s.some((e) => e.type === "result"));
    const said = seen.filter((e) => e.type === "assistant").map((e) => e.payload.text);
    assert.deepEqual(said, ["OK"]);
    const result = seen.find((e) => e.type === "result");
    assert.equal(result.sessionTokens, PROMPT_OK._meta.usage.totalTokens);
    const ctx = seen.find((e) => e.type === "context");
    assert.equal(ctx.tokens, PROMPT_OK._meta.totalTokens);
    assert.equal(ctx.window, 256000);
    // A second prompt ADDS (usage is per prompt; Dopl sums per process).
    h.queue.push(userMsg("again"));
    await until(() => h.prompts.length === 2, "no second prompt");
    h.prompts[1].resolve(PROMPT_OK);
    const more = await drainUntil(h, (s) => s.some((e) => e.type === "result"));
    assert.equal(more.find((e) => e.type === "result").sessionTokens, 2 * PROMPT_OK._meta.usage.totalTokens);
  } finally { h.restore(); h.handle.close(); }
});

test("a push during a turn is a STEER (`_x.ai/interject`); `queued` is final; a refused one becomes a prompt Grok queues", async () => {
  let refuse = false;
  const h = run({ answers: { "_x.ai/interject": () => { if (refuse) throw new Error("no turn"); return { result: { status: "queued" } }; } } });
  try {
    await h.handle.next();
    h.queue.push(userMsg("first"));
    await until(() => h.prompts.length === 1, "no prompt");
    h.queue.push(userMsg("Also end your reply with the word BANANA."));
    await until(() => h.calls.some((c) => c.method === "_x.ai/interject"), "no interject");
    assert.deepEqual(h.calls.find((c) => c.method === "_x.ai/interject").params, { sessionId: SESSION_NEW.sessionId, text: "Also end your reply with the word BANANA." });
    // The recorded confirmation may even arrive BEFORE the interject's answer (same chunk) — it changes nothing.
    const recorded = notifications(S3).find((m) => m.method === "_x.ai/session/interjection");
    h.notify("_x.ai/session/interjection", { ...recorded.params, sessionId: SESSION_NEW.sessionId });
    h.prompts[0].resolve(PROMPT_OK);
    await drainUntil(h, (s) => s.some((e) => e.type === "result"));
    await tick();
    assert.equal(h.prompts.length, 1, "a queued interjection is never sent again (Grok runs it — LIVE)");
    refuse = true;
    h.queue.push(userMsg("second"));
    await until(() => h.prompts.length === 2, "no second prompt");
    h.queue.push(userMsg("steer refused"));
    await until(() => h.prompts.length === 3, "a refused steer was dropped");
    assert.deepEqual(h.calls.filter((c) => c.method === "session/prompt")[2].params.prompt, [{ type: "text", text: "steer refused" }]);
    h.prompts[1].resolve(PROMPT_OK);
    h.prompts[2].resolve(PROMPT_OK);
    const seen = await drainUntil(h, (s) => s.filter((e) => e.type === "result").length === 2);
    assert.equal(seen.filter((e) => e.type === "result").length, 2, "one result per prompt of ours");
  } finally { h.restore(); h.handle.close(); }
});

test("a turn Grok starts ITSELF (a late interjection, `interject-fallback-…`) renders, ends on prompt_complete, and Stop reaches it", async () => {
  const h = run();
  try {
    await h.handle.next();
    const sid = SESSION_NEW.sessionId;
    h.notify("session/update", { sessionId: sid, update: { sessionUpdate: "available_commands_update", availableCommands: [] } });
    h.notify("session/update", { sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "late reply" } } });
    const stop = h.handle.interrupt();
    assert.ok(h.calls.some((c) => c.method === "session/cancel" && c.notification), "Stop reaches a turn Grok started");
    h.notify("_x.ai/session/prompt_complete", { sessionId: sid, promptId: "interject-fallback-x", stopReason: "cancelled" });
    await stop;
    const seen = await drainUntil(h, (s) => s.some((e) => e.type === "result"));
    assert.deepEqual(seen.filter((e) => e.type === "assistant").map((e) => e.payload.text), ["late reply"]);
    assert.equal(seen.find((e) => e.type === "result").sessionTokens, null, "no usage of ours: null, never 0");
    h.queue.push(userMsg("next"));
    await until(() => h.prompts.length === 1, "idle again: a push is a prompt");
  } finally { h.restore(); h.handle.close(); }
});

test("Stop = `session/cancel` as a NOTIFICATION; done when the prompt settles `cancelled`; waiting permissions answered cancelled", async () => {
  const h = run({ spec: { gate: () => new Promise(() => {}) } });
  try {
    await h.handle.next();
    h.queue.push(userMsg("Run the shell command `sleep 30 && echo late`"));
    await until(() => h.prompts.length === 1, "no prompt");
    const perm = h.serverRequest({ method: "session/request_permission", id: 4, params: { sessionId: SESSION_NEW.sessionId, toolCall: { toolCallId: "c1", rawInput: { command: "x" }, _meta: { "x.ai/tool": { name: "run_terminal_command" } } }, options: [{ optionId: "allow-once", kind: "allow_once" }, { optionId: "reject-once", kind: "reject_once" }] } });
    const stopped = h.handle.interrupt();
    const cancel = h.calls.find((c) => c.method === "session/cancel");
    assert.ok(cancel && cancel.notification === true, "a notification, never a request (-32601)");
    assert.deepEqual(await perm, { outcome: { outcome: "cancelled" } });
    h.prompts[0].resolve(resultOf(S3, "session/prompt", 3));
    await stopped;
    const seen = await drainUntil(h, (s) => s.some((e) => e.type === "result"));
    assert.ok(seen.some((e) => e.type === "result"));
  } finally { h.restore(); h.handle.close(); }
});

test("resume = `session/load`; the history Grok REPLAYS before answering renders nothing", async () => {
  const load = held();
  const h = run({ spec: { resumeSessionId: "01a136cb-a556-7fb2-ad13-375e032911f7" }, answers: { "session/load": () => load.p } });
  try {
    await until(() => h.calls.some((c) => c.method === "session/load"), "no load");
    const params = h.calls.find((c) => c.method === "session/load").params;
    assert.equal(params.sessionId, "01a136cb-a556-7fb2-ad13-375e032911f7");
    assert.equal(params.mcpServers[0].name, "dopl_session");
    for (const m of notifications(S3).filter((x) => x.method === "session/update" && ["user_message_chunk", "agent_message_chunk"].includes(x.params.update.sessionUpdate)).slice(0, 2)) {
      h.notify(m.method, m.params);
    }
    load.resolve({ models: SESSION_NEW.models, configOptions: SESSION_NEW.configOptions, _meta: {} });
    const { value } = await h.handle.next();
    assert.equal(value.method, "dopl/sessionStarted");
    assert.equal(value.params.sessionId, "01a136cb-a556-7fb2-ad13-375e032911f7");
    h.queue.push(userMsg("Reply with just OK2."));
    await until(() => h.prompts.length === 1, "no prompt");
    h.prompts[0].resolve(PROMPT_OK);
    const seen = await drainUntil(h, (s) => s.some((e) => e.type === "result"));
    assert.ok(!seen.some((e) => e.type === "assistant"), "the replayed OK is not said again");
  } finally { h.restore(); h.handle.close(); }
});

test("Grok reporting THIS session in yolo mode is a safety stop", async () => {
  const h = run();
  try {
    await h.handle.next();
    h.notify("_x.ai/sessions/changed", { upserted: [{ sessionId: "someone-else", yolo: true }], removed: [] });
    h.notify("_x.ai/sessions/changed", { upserted: [{ sessionId: SESSION_NEW.sessionId, yolo: true }], removed: [] });
    const seen = await drainUntil(h, (s) => s.length > 0);
    assert.deepEqual(seen.map((e) => e.type), ["safety_mismatch"]);
  } finally { h.restore(); h.handle.close(); }
});

test("a LIVE model switch on the handle is set and read back; a kept model throws", async () => {
  const h = run();
  try {
    await h.handle.next();
    await h.handle.setModel("grok-4.6");
    assert.ok(h.calls.some((c) => c.method === "session/set_config_option" && c.params.value === "grok-4.6"));
    await assert.rejects(h.handle.setModel(""), /named model/);
  } finally { h.restore(); h.handle.close(); }
});
