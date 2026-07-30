// AUDIT D1 — an @-tagged HUMAN message must never be swallowed as a passive notification.
//
// main/targeting.js's 'task-reply' verdict is the REQUESTER-side suppression: an inbound
// reply belonging to an interactive thread I created, addressed back to me, authored by the
// thread's target, is passive news and gets a silent OS banner (channel-listener routes it to
// taskNotify.notifyTaskReply — NO consent row, NO gate, NO spawn, and no Accept anywhere).
//
// That predicate is ALSO the exact shape of a human responder @-tagging the requester back:
// the 1.7.9 peer-post path (main/session-peer-post.js postBody) posts authorKind 'user' with
// metadata.taskId, and the server stamps the same taskMode / taskCreatedBy / taskTarget keys.
// The three pre-classify routes in session-dispatch usually claim it first, but feedLiveSession
// needs a LIVE session and maybeSurfaceRequesterReply needs a durable record plus window budget;
// when both miss, classify decides — and a person's addressed message became a banner nobody
// could answer. CHOICE: exempt authorKind 'user' from the suppression (rather than bolting an
// Accept onto the passive notice), so a human addressing me falls through to the ordinary
// addressed rule and returns 'trigger' — the full consent gate. The agent reply the branch was
// designed for is unchanged.
//
// SOURCE EXTRACTION (the classify.test.mjs idiom): classify / metaStr are private, so we read
// the real source and evaluate those two function bodies verbatim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");

function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in targeting.js`);
  let depth = 0;
  let i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return SRC.slice(start, i);
}

const { classify } = new Function(
  `${extractFn("metaStr")}\n${extractFn("classify")}\nreturn { classify, metaStr };`
)();

const ME = "me-uuid"; // the REQUESTER (I created the thread)
const PEER = "peer-uuid"; // the thread's target (the responder)
const THIRD = "third-uuid";

const entry = (over = {}) => ({
  channel: { id: "chan-abcdef01", name: "General", memberCount: 2, isMember: true, ...over },
});

// A reply inside an interactive thread I created, addressed back to me, authored by the
// thread's target. `authorKind` is the ONE thing under test.
const reply = (authorKind, over = {}) => ({
  id: "m1",
  seq: 9,
  kind: "message",
  body: "can you double check the invoice mapping?",
  authorKind,
  authorUserId: PEER,
  metadata: {
    to_user_id: ME,
    taskId: "11111111-2222-3333-4444-555555555555",
    taskMode: "interactive",
    taskCreatedBy: ME,
    taskTarget: PEER,
    ...over,
  },
});

// ── the bug ──────────────────────────────────────────────────────────────────────

test("D1: a HUMAN @-tagging me inside my own interactive thread -> trigger, never task-reply", () => {
  const got = classify(reply("user"), entry(), ME);
  assert.equal(got, "trigger", "a person addressing me always gates (consent + spawn)");
  assert.notEqual(got, "task-reply", "a human message must never be swallowed as a passive banner");
});

test("D1: the human path gates in a GROUP channel and a public one too", () => {
  // The suppression sat ABOVE the addressed rules, so member count / membership never saved it.
  assert.equal(classify(reply("user"), entry({ memberCount: 5 }), ME), "trigger");
  assert.equal(classify(reply("user"), entry({ memberCount: 3, isMember: false }), ME), "trigger");
  // And an explicit per-channel mute never suppresses an explicit address.
  assert.equal(classify(reply("user"), entry({ myNotifyScope: "none" }), ME), "trigger");
});

test("D1: this is the shape session-peer-post actually posts (authorKind user + taskId)", () => {
  // main/session-peer-post.js postBody: { body, authorKind: 'user', metadata: { taskId } }.
  // The server stamps the rest of the task keys, so the peer sees exactly `reply('user')`.
  const PEER_POST_SRC = readFileSync(join(HERE, "..", "main", "session-peer-post.js"), "utf8");
  assert.ok(PEER_POST_SRC.includes("authorKind: 'user'"), "the peer-post path is human-authored");
  assert.equal(classify(reply("user"), entry(), ME), "trigger");
});

// ── the branch the suppression WAS designed for is untouched ─────────────────────

test("D1: an AGENT reply in the same thread still suppresses to the passive task-reply notice", () => {
  assert.equal(classify(reply("agent"), entry(), ME), "task-reply");
  assert.equal(classify(reply("agent"), entry({ memberCount: 5, isMember: false }), ME), "task-reply");
});

test("D1: every other task-reply guard still decides before authorKind can matter", () => {
  // Not my thread -> the RESPONDER side, unchanged.
  assert.equal(classify(reply("agent", { taskCreatedBy: THIRD }), entry(), ME), "trigger");
  // Autonomous mode -> never suppressed.
  assert.equal(classify(reply("agent", { taskMode: "autonomous" }), entry(), ME), "trigger");
  // A third member posting into my thread (author !== taskTarget) -> never suppressed.
  assert.equal(classify({ ...reply("agent"), authorUserId: THIRD }, entry({ memberCount: 3 }), ME), "trigger");
  // The kind guard still wins over everything.
  assert.equal(classify({ ...reply("agent"), kind: "task_finished" }, entry(), ME), "ignore");
  // 'system' and friends are still ignored outright.
  assert.equal(classify(reply("system"), entry(), ME), "ignore");
});

test("D1: the fix is the authorKind test itself, ahead of the metadata reads", () => {
  const body = extractFn("classify");
  const at = body.indexOf("return 'task-reply'");
  assert.notEqual(at, -1, "the task-reply verdict still exists");
  const branch = body.slice(body.lastIndexOf("if (", at), at);
  assert.ok(
    branch.includes("m.authorKind === 'agent'"),
    "the task-reply branch must be AGENT-ONLY, so a human author can never reach it"
  );
});
