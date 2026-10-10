// Unit tests for the passive MENTION notice builder.
//
// ⚠ IT USED TO BE THE TASK-REPLY BUILDER (`taskReplyNotice`, "Reply in <thread>"). Samuel's spec
// of 2026-10-09 turns the reply notice off, but a tag inside my own thread still notifies — as a
// MENTION — because classify ranks 'task-reply' above 'fyi' and such a post never reaches
// `trigger.js › sendFyi`. So the copy became `mentionNotice`, and BOTH call sites use it, which
// is what these tests protect: one copy shape for a tag, wherever it landed.
//
// SAME source-extraction strategy as classify.test.mjs: task-notify.js is a
// CommonJS/Electron module, so instead of require()-ing it (which would drag in
// electron and the whole listener graph) we read the source and evaluate the PURE
// `mentionNotice` builder alongside the `metaStr`/`truncate` helpers it uses
// (both plain function declarations in targeting.js). Raising the notice itself is the
// route's job (`notification-route.js`) and is covered by its own test.

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

const { mentionNotice } = new Function(
  `${extractFn(TARGETING, "metaStr")}\n${extractFn(TARGETING, "truncate")}\n${extractFn(
    NOTIFY,
    "mentionNotice"
  )}\nreturn { mentionNotice };`
)();

const withMeta = (metadata, body = "the answer body") => ({ body, metadata });

test("headline prefers the server-stamped task title", () => {
  const notice = mentionNotice(withMeta({ taskTitle: "Ship the docs" }), "General", "Ada");
  assert.equal(notice.title, "Ship the docs");
});

test("headline falls back to the channel name when no task title", () => {
  assert.equal(mentionNotice(withMeta({}), "General", "Ada").title, "General");
});

test("headline degrades to a generic label when channel + title are both absent", () => {
  assert.equal(mentionNotice(withMeta({}), undefined, "Ada").title, "a channel");
});

test("body prefers the summary, then a truncated body excerpt", () => {
  assert.equal(mentionNotice(withMeta({ summary: "done" }), "General", "Ada").body, "Ada mentioned you: done");
  assert.equal(mentionNotice(withMeta({}, "raw body"), "General", "Ada").body, "Ada mentioned you: raw body");
});

test("body omits the responder prefix when the name is unknown", () => {
  assert.equal(mentionNotice(withMeta({ summary: "done" }), "General", "").body, "done");
});

test("long bodies are truncated to <= 120 chars + a single ellipsis", () => {
  const long = "x".repeat(300);
  const { body } = mentionNotice(withMeta({}, long), "General", "");
  assert.ok(body.length <= 121, `body length ${body.length}`);
  assert.ok(body.endsWith("…"));
});
