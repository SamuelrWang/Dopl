// Tests for the v1.7 first-class task-id inheritance (Feature 2b).
//
// A responder desktop threads its reply + lifecycle under the REQUESTER's
// first-class (UUID) task id so the whole turn groups into one task card. Two
// pieces make that work and are exercised here against the REAL source:
//   1. targeting.firstClassTaskId(m) — a UUID-gated read of the inbound message's
//      metadata.taskId. Pure + exported + electron-free, so we `require` it.
//   2. trigger.js taskIdFor(entry, m) — prefers the message's own first-class id over the
//      legacy `task-<channelId>-<seq>` fallback. trigger.js pulls in electron, so (like
//      classify.test) we source-extract just that one pure function and eval it, injecting
//      `targeting` (the REAL module, since it is electron-free).
//
// ⚠ THE CHAIN LOST ITS MIDDLE LINK ON 2026-08-22, AND THAT IS WHY THE SIGNATURE CHANGED.
// It used to be `firstClassTaskId(m) -> rec.taskId -> taskIdFor(rec)`: `handleTrigger` stamped
// the id onto a DURABLE pending-request record via `consent-watcher.register`, and the id was
// read back off that record when the operator eventually clicked Allow, possibly on another run
// of the app. The inbound consent lane is deleted (Samuel's ruling; `main/trigger.js`'s header)
// so there is no record and no later read: `taskIdFor(entry, m)` derives the id from the message
// that is still in hand. The RULE it encodes is unchanged and is what these cases pin — a
// first-class UUID wins, anything else falls back to the deterministic legacy form.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config; `createRequire`
// loads the CommonJS targeting module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { firstClassTaskId } = require("../main/targeting.js");

// Source-extract the REAL taskIdFor from trigger.js (electron-bound, so it can't
// be required). Same brace-balancing slice classify.test uses; taskIdFor's only
// braces are balanced template-literal `${...}`, so the naive count is exact.
const TRIGGER = readFileSync(join(HERE, "..", "main", "trigger.js"), "utf8");
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
const { taskIdFor } = new Function(
  "targeting",
  `${extractFn(TRIGGER, "taskIdFor")}\n return { taskIdFor };`
)(require("../main/targeting.js"));

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const withTaskId = (taskId) => ({
  authorUserId: "u2",
  authorKind: "agent",
  kind: "message",
  metadata: { taskId },
});

test("firstClassTaskId returns the UUID for a first-class id (any case)", () => {
  assert.equal(firstClassTaskId(withTaskId(UUID)), UUID);
  const upper = UUID.toUpperCase();
  assert.equal(firstClassTaskId(withTaskId(upper)), upper);
});

test("firstClassTaskId returns '' for a legacy task-<uuid>-<seq> id (legacy preserved)", () => {
  // The deterministic legacy id is NOT a bare UUID, so it must not be treated as
  // first-class — that keeps the legacy taskIdFor fallback byte-for-byte.
  assert.equal(firstClassTaskId(withTaskId(`task-${UUID}-7`)), "");
  assert.equal(firstClassTaskId(withTaskId("task-chan-abcdef01-3")), "");
});

test("firstClassTaskId returns '' for empty / absent / non-string metadata", () => {
  assert.equal(firstClassTaskId(withTaskId("")), "");
  assert.equal(firstClassTaskId(withTaskId("   ")), "");
  assert.equal(firstClassTaskId({ metadata: {} }), "");
  assert.equal(firstClassTaskId({}), "");
  assert.equal(firstClassTaskId(null), "");
  assert.equal(firstClassTaskId(withTaskId(12345)), "");
  assert.equal(firstClassTaskId(withTaskId({ id: UUID })), "");
});

test("firstClassTaskId returns '' for a malformed near-UUID", () => {
  assert.equal(firstClassTaskId(withTaskId(UUID.slice(0, -1))), ""); // too short
  assert.equal(firstClassTaskId(withTaskId(UUID + "0")), ""); // too long
  assert.equal(firstClassTaskId(withTaskId(UUID.replace("a", "z"))), ""); // bad hex
  assert.equal(firstClassTaskId(withTaskId(UUID.replace(/-/g, ""))), ""); // no dashes
});

const entryFor = (id) => ({ channel: { id } });

test("inheritance: a UUID inbound threads reply + lifecycle under it (taskIdFor prefers it)", () => {
  const m = { ...withTaskId(UUID), seq: 9 };
  assert.equal(firstClassTaskId(m), UUID);
  // the launch context, the reply and every lifecycle echo all route through taskIdFor:
  assert.equal(taskIdFor(entryFor("chan-1"), m), UUID);
});

test("legacy fallback unchanged: no first-class id -> deterministic task-<ch>-<seq>", () => {
  const legacyInbound = { ...withTaskId(`task-old-${UUID}-2`), seq: 9 }; // legacy id, not a UUID
  assert.equal(firstClassTaskId(legacyInbound), "");
  assert.equal(taskIdFor(entryFor("chan-1"), legacyInbound), "task-chan-1-9");
  // A wholly unthreaded inbound behaves identically.
  assert.equal(taskIdFor(entryFor("chan-2"), { metadata: {}, seq: 4 }), "task-chan-2-4");
});
