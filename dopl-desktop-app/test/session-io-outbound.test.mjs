// Tests for the v2.0 Session Window outbound-post classifier + render mapping
// (main/session-io.js, Track T2, items 1 & 2).
//
// TWO layers:
//   1. SOURCE EXTRACTION with INJECTION — the BEGIN/END SESSION-IO-PURE block holds
//      the pure `isOutboundPost` classifier. It references DOPL_CHANNEL_TOOL +
//      session-profiles.isOwnChannelPost (required at the module top, OUTSIDE the
//      block), so we slice the block and inject the REAL exports as parameters. This
//      proves the block is electron/fs/path/SDK-free and pins it to what ships (same
//      idiom as session-profiles / tool-profiles).
//   2. DIRECT REQUIRE — session-io.js imports nothing electron-bound, so we require
//      it in plain Node and exercise `sdkRenderEvents` end to end: an own-channel
//      op=post renders as an `outbound_post` AND its generic tool card is suppressed
//      (item 2 — a sent message must never double-render as a tool call).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-io.js"), "utf8");

// The REAL exports the block depends on — pins the classifier to what ships.
const { DOPL_CHANNEL_TOOL } = require(join(HERE, "..", "main", "tool-profiles.js"));
const { isOwnChannelPost, isChannelTool } = require(join(HERE, "..", "main", "session-profiles.js"));

const BEGIN = "// ─── BEGIN SESSION-IO-PURE";
const END = "// ─── END SESSION-IO-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-IO-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-IO-PURE sentinel missing");
assert.ok(to > from, "session-io-pure sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The sliced pure block must stay electron/fs/path/SDK/require-free (§H-7).
for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-IO-PURE block must not reference ${banned}`);
}

const { isOutboundPost } = new Function(
  "isChannelTool",
  "isOwnChannelPost",
  `${BLOCK}\n return { isOutboundPost };`
)(isChannelTool, isOwnChannelPost);

// ── isOutboundPost truth table ────────────────────────────────────────────────

test("isOutboundPost: an op=post into the OWN channel is the outbound message (TRUE)", () => {
  // Implicit own channel (no target) and explicit own channelId both count.
  assert.equal(isOutboundPost(DOPL_CHANNEL_TOOL, { op: "post", body: "hi" }, "ch1"), true);
  assert.equal(isOutboundPost(DOPL_CHANNEL_TOOL, { op: "post", channel: "ch1", body: "hi" }, "ch1"), true);
  assert.equal(isOutboundPost(DOPL_CHANNEL_TOOL, { op: "post", channel: "" }, "ch1"), true);
});

test("isOutboundPost: a cross-channel or slug-addressed post is NOT own-channel (FALSE)", () => {
  assert.equal(isOutboundPost(DOPL_CHANNEL_TOOL, { op: "post", channel: "ch2" }, "ch1"), false);
  assert.equal(isOutboundPost(DOPL_CHANNEL_TOOL, { op: "post", channel: "some-slug" }, "ch1"), false);
});

test("isOutboundPost: any non-post dopl_channel op gates and is NOT outbound (FALSE)", () => {
  for (const op of ["open", "invite", "create_task", "close_task", "set_task_mode", "read", undefined]) {
    assert.equal(isOutboundPost(DOPL_CHANNEL_TOOL, { op, channel: "ch1" }, "ch1"), false, `op=${op} is not an outbound post`);
  }
});

test("isOutboundPost: only the dopl_channel tool qualifies — any other tool name is FALSE", () => {
  assert.equal(isOutboundPost("Bash", { op: "post" }, "ch1"), false);
  assert.equal(isOutboundPost("mcp__dopl__dopl_kb", { op: "post" }, "ch1"), false);
  assert.equal(isOutboundPost("Write", { op: "post", channel: "ch1" }, "ch1"), false);
});

// ── sdkRenderEvents: outbound emission + tool-card suppression (item 2) ─────────

const io = require(join(HERE, "..", "main", "session-io.js"));

const assistantMsg = (blocks) => ({ type: "assistant", message: { content: blocks } });
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });

test("sdkRenderEvents: an own-channel post -> a single outbound_post, NO tool card", () => {
  const msg = assistantMsg([toolUse("t1", DOPL_CHANNEL_TOOL, { op: "post", body: "on it, shipping now" })]);
  const evs = io.sdkRenderEvents(msg, "ch1", "Bob");
  assert.equal(evs.length, 1, "exactly one event — the tool card is suppressed");
  assert.equal(evs[0].type, "outbound_post");
  assert.deepEqual(evs[0].payload, {
    type: "outbound_post",
    toolUseId: "t1",
    to: "Bob",
    text: "on it, shipping now",
  });
  assert.ok(!evs.some((e) => e.type === "tool_use"), "the generic tool card must not also render");
});

test("sdkRenderEvents: a non-post dopl_channel op still renders as a generic tool card", () => {
  const msg = assistantMsg([toolUse("t2", DOPL_CHANNEL_TOOL, { op: "open", target: "someone" })]);
  const evs = io.sdkRenderEvents(msg, "ch1", "Bob");
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, "tool_use");
  assert.equal(evs[0].payload.toolUseId, "t2");
});

test("sdkRenderEvents: a plain work tool stays a tool card (not an outbound post)", () => {
  const msg = assistantMsg([toolUse("t3", "Bash", { command: "ls" })]);
  const evs = io.sdkRenderEvents(msg, "ch1", "Bob");
  assert.equal(evs[0].type, "tool_use");
});

test("sdkRenderEvents: narration + a post in one message emit a turn THEN the outbound", () => {
  const msg = assistantMsg([
    { type: "text", text: "Let me reply to Bob." },
    toolUse("t4", DOPL_CHANNEL_TOOL, { op: "post", body: "done" }),
  ]);
  const evs = io.sdkRenderEvents(msg, "ch1", "Bob");
  assert.deepEqual(evs.map((e) => e.type), ["assistant", "outbound_post"]);
  assert.equal(evs[0].payload.text, "Let me reply to Bob.");
  assert.equal(evs[1].payload.text, "done");
});

test("sdkRenderEvents: a missing peer name -> to:null; a missing body -> text:''", () => {
  const msg = assistantMsg([toolUse("t5", DOPL_CHANNEL_TOOL, { op: "post" })]);
  const evs = io.sdkRenderEvents(msg, "ch1"); // peerName omitted
  assert.equal(evs[0].payload.to, null);
  assert.equal(evs[0].payload.text, "");
});

test("sdkRenderEvents: a cross-channel post is NOT suppressed (gated op keeps its card)", () => {
  const msg = assistantMsg([toolUse("t6", DOPL_CHANNEL_TOOL, { op: "post", channel: "other", body: "leak?" })]);
  const evs = io.sdkRenderEvents(msg, "ch1", "Bob");
  assert.equal(evs[0].type, "tool_use", "a cross-channel post gates and renders as a tool card, not outbound");
});
