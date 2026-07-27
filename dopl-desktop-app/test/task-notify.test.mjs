// Unit tests for the passive task-reply notice builder (Feature 4, requester side).
//
// SAME source-extraction strategy as classify.test.mjs: task-notify.js is a
// CommonJS/Electron module, so instead of require()-ing it (which would drag in
// electron and the whole listener graph) we read the source and evaluate the PURE
// `taskReplyNotice` builder alongside the `metaStr`/`truncate` helpers it uses
// (both plain function declarations in targeting.js). The notification side effect
// itself (Notification.show + the click → openChannelForEntry handoff) is an
// Electron boundary and is intentionally NOT covered here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGETING = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");
const NOTIFY = readFileSync(join(HERE, "..", "main", "task-notify.js"), "utf8");

// Brace-balance a top-level `function <name>(...) { ... }` out of `src`.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return src.slice(start, i);
}

const { taskReplyNotice } = new Function(
  `${extractFn(TARGETING, "metaStr")}\n${extractFn(TARGETING, "truncate")}\n${extractFn(
    NOTIFY,
    "taskReplyNotice"
  )}\nreturn { taskReplyNotice };`
)();

const withMeta = (metadata, body = "the answer body") => ({ body, metadata });

test("headline prefers the server-stamped task title", () => {
  const notice = taskReplyNotice(withMeta({ taskTitle: "Ship the docs" }), "General", "Ada");
  assert.equal(notice.title, "Reply in Ship the docs");
});

test("headline falls back to the channel name when no task title", () => {
  assert.equal(taskReplyNotice(withMeta({}), "General", "Ada").title, "Reply in General");
});

test("headline degrades to a generic label when channel + title are both absent", () => {
  assert.equal(taskReplyNotice(withMeta({}), undefined, "Ada").title, "Reply in a channel");
});

test("body prefers the summary, then a truncated body excerpt", () => {
  assert.equal(taskReplyNotice(withMeta({ summary: "done" }), "General", "Ada").body, "Ada: done");
  assert.equal(taskReplyNotice(withMeta({}, "raw body"), "General", "Ada").body, "Ada: raw body");
});

test("body omits the responder prefix when the name is unknown", () => {
  assert.equal(taskReplyNotice(withMeta({ summary: "done" }), "General", "").body, "done");
});

test("long bodies are truncated to <= 120 chars + a single ellipsis", () => {
  const long = "x".repeat(300);
  const { body } = taskReplyNotice(withMeta({}, long), "General", "");
  assert.ok(body.length <= 121, `body length ${body.length}`);
  assert.ok(body.endsWith("…"));
});
