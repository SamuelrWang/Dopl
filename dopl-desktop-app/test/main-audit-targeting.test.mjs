// THE REQUESTER-SIDE SUPPRESSION COVERS EVERY AUTHOR KIND AND EVERY MODE (2026-08-20).
//
// main/targeting.js's 'task-reply' verdict is the REQUESTER-side suppression: an inbound
// reply belonging to a thread I created, addressed back to me, authored by the thread's
// target, is passive news — NO consent row, NO spawn. The @-tag gates only the NOTICE, one
// layer up in listener-messages.js.
//
// HISTORY, BECAUSE THIS FILE USED TO PIN THE OPPOSITE (AUDIT D1): the branch carried
// `authorKind === 'agent'` and `taskMode === 'interactive'` conjuncts when the requester ran
// a live SESSION WINDOW that consumed replies first — a human's addressed reply was left to
// the addressed rule so the window's inbound gate (its Accept) could claim it. Window mode
// was retired 2026-08-20 (settings.js header): there is no Accept for a reply any more and
// nothing to swallow it FROM — the reply renders in the thread view, which is the surface.
// With the window lane gone, either conjunct failing turned the counterparty's reply IN MY
// OWN THREAD into a consent card against myself (the self-trigger bug, observed live
// 2026-08-20). What must still trigger is anybody OUTSIDE the (my thread, its target) pair.
//
// SOURCE EXTRACTION (the classify.test.mjs idiom): classify / metaStr are private, so we read
// the real source and evaluate those function bodies verbatim.

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

// classify also calls the LEGACY-THREADS registry (targeting.js), which holds module state
// and so is sliced whole between its sentinels instead of function by function.
// §2 SPLIT (2026-07-31): the registry itself moved to main/legacy-threads.js when
// targeting.js went past the 500-line cap. classify calls into it as free variables
// exactly as before, so only the FILE this block is read out of changed.
const LEGACY_SRC = readFileSync(join(HERE, "..", "main", "legacy-threads.js"), "utf8");
const LEGACY = LEGACY_SRC.slice(
  LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
);
assert.ok(LEGACY.includes("function knownLegacyReply"), "LEGACY-THREADS sentinels missing");

// `isChatIntent` (2026-08-06) and `mentionsMe` (2026-08-18) are free variables inside classify
// — both hoisted out of its body so the dispatcher can ask the same question, the first BEFORE
// classify runs and the second AFTER it, to gate the passive task-reply notice. Self-contained,
// so the plain brace-matcher above slices all of each.
const { classify } = new Function(
  `${extractFn("metaStr")}\n${LEGACY}\n${extractFn("isChatIntent")}\n${extractFn("mentionsMe")}\n` +
    `${extractFn("classify")}\nreturn { classify, metaStr, mentionsMe };`
)();

const ME = "me-uuid"; // the REQUESTER (I created the thread)
const PEER = "peer-uuid"; // the thread's target (the responder)
const THIRD = "third-uuid";

const entry = (over = {}) => ({
  channel: { id: "chan-abcdef01", name: "General", memberCount: 2, isMember: true, ...over },
});

// A reply inside a thread I created, addressed back to me, authored by the thread's target.
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

// ── the pair suppresses, whoever and however it answers ──────────────────────────

test("a HUMAN reply in my own thread -> task-reply, never a consent card against myself", () => {
  const got = classify(reply("user"), entry(), ME);
  assert.equal(got, "task-reply", "the counterparty answering me is passive news, not a fresh ask");
});

test("an AGENT reply in the same thread -> task-reply, in every channel shape", () => {
  assert.equal(classify(reply("agent"), entry(), ME), "task-reply");
  assert.equal(classify(reply("agent"), entry({ memberCount: 5, isMember: false }), ME), "task-reply");
});

test("mode is not read: an AUTONOMOUS thread's reply suppresses the same", () => {
  assert.equal(classify(reply("agent", { taskMode: "autonomous" }), entry(), ME), "task-reply");
  assert.equal(classify(reply("user", { taskMode: "autonomous" }), entry(), ME), "task-reply");
});

test("the shape session-peer-post posts (authorKind user + taskId) is covered too", () => {
  // main/session-peer-post.js postBody: { body, authorKind: 'user', metadata: { taskId } }.
  // The server stamps the rest of the task keys, so the peer sees exactly `reply('user')`.
  assert.equal(classify(reply("user"), entry(), ME), "task-reply");
});

// ── everybody OUTSIDE the (my thread, its target) pair still gates ───────────────

test("the pair guards still decide: not-my-thread and third-party posts trigger", () => {
  // Not my thread -> the RESPONDER side, unchanged.
  assert.equal(classify(reply("agent", { taskCreatedBy: THIRD }), entry(), ME), "trigger");
  assert.equal(classify(reply("user", { taskCreatedBy: THIRD }), entry(), ME), "trigger");
  // A third member posting into my thread (author !== taskTarget) -> never suppressed.
  assert.equal(classify({ ...reply("agent"), authorUserId: THIRD }, entry({ memberCount: 3 }), ME), "trigger");
  assert.equal(classify({ ...reply("user"), authorUserId: THIRD }, entry({ memberCount: 3 }), ME), "trigger");
  // The kind guard still wins over everything.
  assert.equal(classify({ ...reply("agent"), kind: "task_finished" }, entry(), ME), "ignore");
  // 'system' and friends are still ignored outright.
  assert.equal(classify(reply("system"), entry(), ME), "ignore");
});

test("the widening is structural: no authorKind or taskMode conjunct in the branch", () => {
  const body = extractFn("classify");
  const at = body.indexOf("return 'task-reply'");
  assert.notEqual(at, -1, "the task-reply verdict still exists");
  const branch = body.slice(body.lastIndexOf("if (", at), at);
  assert.ok(
    !branch.includes("authorKind") && !branch.includes("taskMode"),
    "the task-reply branch reads only the server-stamped pair (taskCreatedBy/taskTarget) plus the address — " +
      "an authorKind or taskMode conjunct reintroduces the self-trigger the 2026-08-20 widening removed"
  );
});
