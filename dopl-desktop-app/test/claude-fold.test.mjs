// P4-05 — A DIRECTION THE CLAUDE CLI FOLDS INTO THE RUNNING TURN REPORTS ON THAT TURN.
//
// A direction pushed while a turn is in flight is armed at depth 2 (`session-directed.js ›
// armAndOpen`). Measured live (`claude-mid-turn-fold-live.test.mjs`): the CLI folds such a push into
// the running turn, so ONE `result` answers both. Without a join the capture stayed armed at depth 1
// and the NEXT unrelated turn's text was reported as the direction's reply. These cases replay the
// measured frame order through `runtime/claude/fold.js` and the real capture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");
const fold = require_(join(MAIN, "runtime", "claude", "fold.js"));
const directed = require_(join(MAIN, "session-directed.js"));
const io = require_(join(MAIN, "session-io.js"));

const WS = "11111111-2222-3333-4444-555555555555";
const D1 = "44444444-5555-6666-7777-888888888888";
const DIRECTION = "[framed] what is the status?";

/** A session with a capture armed while a turn is in flight, and the fold watch joined to it. */
function rig() {
  const s = {};
  const joined = [];
  const closed = [];
  const watch = fold.makeFoldWatch((text) => { joined.push(text); closed.push(...directed.noteSteerJoined(s, text)); });
  const prompts = io.makePushIterator();
  const stamped = watch.stamp(prompts);
  return { s, joined, closed, watch, prompts, stamped };
}

async function pushAndRead(r, text) {
  r.prompts.push(io.userMessage(text));
  const { value } = await r.stamped.next();
  return value;
}

/** Core's two observer calls for one raw frame: the watch, then the capture on the core events. */
function feed(r, msg) {
  r.watch.observe(msg);
  if (msg.type === "assistant") {
    for (const b of msg.message.content) if (b.type === "text") directed.noteDirectedText(r.s, b.text);
  }
  if (msg.type === "result") r.closed.push(...directed.closeDirected(r.s));
}

const assistantTool = { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } };
const toolResult = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "tick" }] } };
const say = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const lifecycle = (uuid, state) => ({ type: "command_lifecycle", command_uuid: uuid, state });
const result = { type: "result", subtype: "success" };

test("MEASURED ORDER: a folded direction reports on the turn that answered it, and only once", async () => {
  const r = rig();
  const first = await pushAndRead(r, "run the tool, then say FIRST");
  feed(r, lifecycle(first.uuid, "queued"));
  feed(r, lifecycle(first.uuid, "started"));
  feed(r, assistantTool);
  // The direction arrives mid-tool-call: armed at depth 2, exactly as `messageByTask` does.
  const pushed = await pushAndRead(r, DIRECTION);
  directed.armAndOpen(r.s, { id: D1, workspaceId: WS }, true, DIRECTION);
  feed(r, lifecycle(pushed.uuid, "queued"));
  feed(r, toolResult);
  feed(r, lifecycle(pushed.uuid, "started"));
  assert.deepEqual(r.joined, [DIRECTION], "the fold is reported with the pushed text");
  feed(r, say("FIRST, and the status is green"));
  feed(r, lifecycle(pushed.uuid, "completed"));
  feed(r, result);
  assert.deepEqual(r.closed, [{ id: D1, workspaceId: WS, reply: "FIRST, and the status is green" }]);
  assert.equal(directed.isDirectedTurn(r.s), false, "no capture is left armed for the next turn");
  // The next, unrelated turn reports nothing.
  feed(r, say("an unrelated channel reply"));
  feed(r, result);
  assert.equal(r.closed.length, 1);
});

test("a push that runs as its OWN turn is not a join: the depth-2 path answers it", async () => {
  const r = rig();
  await pushAndRead(r, "first");
  feed(r, assistantTool);
  const pushed = await pushAndRead(r, DIRECTION);
  directed.armAndOpen(r.s, { id: D1, workspaceId: WS }, true, DIRECTION);
  feed(r, toolResult);
  feed(r, say("first turn text"));
  feed(r, result);
  assert.deepEqual(r.closed, [], "the in-flight turn's text is never the reply");
  feed(r, lifecycle(pushed.uuid, "started"));
  assert.deepEqual(r.joined, [], "started after a result opens a turn; it joins nothing");
  feed(r, say("the direction's own answer"));
  feed(r, result);
  assert.deepEqual(r.closed, [{ id: D1, workspaceId: WS, reply: "the direction's own answer" }]);
});

test("commands coalesced at the start of a new turn are not folds", async () => {
  const r = rig();
  const a = await pushAndRead(r, "one");
  const b = await pushAndRead(r, "two");
  feed(r, lifecycle(a.uuid, "started"));
  feed(r, lifecycle(b.uuid, "started"));
  assert.deepEqual(r.joined, []);
});

test("an unstamped or unknown uuid, and a repeated lifecycle, join nothing", async () => {
  const r = rig();
  await pushAndRead(r, "first");
  feed(r, assistantTool);
  const pushed = await pushAndRead(r, "second");
  feed(r, lifecycle("not-ours", "started"));
  feed(r, lifecycle(pushed.uuid, "started"));
  feed(r, lifecycle(pushed.uuid, "started"));
  assert.deepEqual(r.joined, ["second"], "reported once");
});

test("stamping copies the pushed message: the iterator's replay keeps the original", async () => {
  const r = rig();
  const sent = await pushAndRead(r, "hello");
  assert.match(sent.uuid, /^[0-9a-f-]{36}$/);
  assert.equal(sent.message.content, "hello");
  assert.equal(r.prompts.replayable()[0].uuid, undefined);
  r.prompts.close();
  assert.deepEqual(await r.stamped.next(), { value: undefined, done: true });
});

test("observeQuery yields every frame unchanged and keeps the query's own methods", async () => {
  const frames = [assistantTool, result];
  const seen = [];
  const calls = [];
  const query = {
    interrupt() { calls.push(["interrupt", this === query]); return Promise.resolve(); },
    close() { calls.push(["close", this === query]); },
    async *[Symbol.asyncIterator]() { for (const f of frames) yield f; },
  };
  const q = fold.observeQuery(query, (m) => seen.push(m));
  const out = [];
  for await (const m of q) out.push(m);
  assert.deepEqual(out, frames);
  assert.deepEqual(seen, frames);
  await q.interrupt();
  q.close();
  assert.deepEqual(calls, [["interrupt", true], ["close", true]]);
});

test("the Claude adapter's start() stamps the prompt and watches the stream", () => {
  const src = readFileSync(join(MAIN, "runtime", "claude", "launch-spec.js"), "utf8");
  const start = src.slice(src.indexOf("function start(spec) {"), src.indexOf("function resume("));
  assert.match(start, /fold\.makeFoldWatch\(\(text\) => sessionDirected\.steerJoined\(spec\.session, text\)\)/);
  assert.match(start, /fold\.observeQuery\(sdk\.query\(\{ prompt: watch\.stamp\(spec\.prompt\), options: spec\.options \}\), watch\.observe\)/);
  assert.match(src, /return \{ prompt: s\.pushIterator, options: buildOptions\(s, req\.dispatch, req\.emitQuiet\), session: s \};/);
});
