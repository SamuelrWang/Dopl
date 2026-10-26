// Tests for the v1.7 first-class thread-id inheritance (Feature 2b).
//
// A responder desktop threads its reply + lifecycle under the REQUESTER's
// first-class (UUID) thread id so the whole turn groups into one thread card. Two
// pieces make that work and are exercised here against the REAL source:
//   1. targeting.firstClassThreadId(m) — a UUID-gated read of the inbound message's
//      metadata.threadId. Pure + exported + electron-free, so we `require` it.
//   2. trigger.js threadIdFor(entry, m) — prefers the message's own first-class id over the
//      legacy `thread-<channelId>-<seq>` fallback. trigger.js pulls in electron, so (like
//      classify.test) we source-extract just that one pure function and eval it, injecting
//      `targeting` (the REAL module, since it is electron-free).
//
// ⚠ THE CHAIN LOST ITS MIDDLE LINK ON 2026-08-22, AND THAT IS WHY THE SIGNATURE CHANGED.
// It used to be `firstClassThreadId(m) -> rec.threadId -> threadIdFor(rec)`: `handleTrigger` stamped
// the id onto a DURABLE pending-request record via `consent-watcher.register`, and the id was
// read back off that record when the operator eventually clicked Allow, possibly on another run
// of the app. The inbound consent lane is deleted (Samuel's ruling; `main/trigger.js`'s header)
// so there is no record and no later read: `threadIdFor(entry, m)` derives the id from the message
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
const { firstClassThreadId } = require("../main/targeting.js");

// Source-extract the REAL threadIdFor from trigger.js (electron-bound, so it can't
// be required). Same brace-balancing slice classify.test uses; threadIdFor's only
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
const { threadIdFor } = new Function(
  "targeting",
  `${extractFn(TRIGGER, "threadIdFor")}\n return { threadIdFor };`
)(require("../main/targeting.js"));

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const withThreadId = (threadId) => ({
  authorUserId: "u2",
  authorKind: "agent",
  kind: "message",
  metadata: { threadId },
});

test("firstClassThreadId returns the UUID for a first-class id (any case)", () => {
  assert.equal(firstClassThreadId(withThreadId(UUID)), UUID);
  const upper = UUID.toUpperCase();
  assert.equal(firstClassThreadId(withThreadId(upper)), upper);
});

test("firstClassThreadId returns '' for a legacy thread-<uuid>-<seq> id (legacy preserved)", () => {
  // The deterministic legacy id is NOT a bare UUID, so it must not be treated as
  // first-class — that keeps the legacy threadIdFor fallback byte-for-byte.
  assert.equal(firstClassThreadId(withThreadId(`thread-${UUID}-7`)), "");
  assert.equal(firstClassThreadId(withThreadId("thread-chan-abcdef01-3")), "");
});

test("firstClassThreadId returns '' for empty / absent / non-string metadata", () => {
  assert.equal(firstClassThreadId(withThreadId("")), "");
  assert.equal(firstClassThreadId(withThreadId("   ")), "");
  assert.equal(firstClassThreadId({ metadata: {} }), "");
  assert.equal(firstClassThreadId({}), "");
  assert.equal(firstClassThreadId(null), "");
  assert.equal(firstClassThreadId(withThreadId(12345)), "");
  assert.equal(firstClassThreadId(withThreadId({ id: UUID })), "");
});

test("firstClassThreadId returns '' for a malformed near-UUID", () => {
  assert.equal(firstClassThreadId(withThreadId(UUID.slice(0, -1))), ""); // too short
  assert.equal(firstClassThreadId(withThreadId(UUID + "0")), ""); // too long
  assert.equal(firstClassThreadId(withThreadId(UUID.replace("a", "z"))), ""); // bad hex
  assert.equal(firstClassThreadId(withThreadId(UUID.replace(/-/g, ""))), ""); // no dashes
});

const entryFor = (id) => ({ channel: { id } });

test("inheritance: a UUID inbound threads reply + lifecycle under it (threadIdFor prefers it)", () => {
  const m = { ...withThreadId(UUID), seq: 9 };
  assert.equal(firstClassThreadId(m), UUID);
  // the launch context, the reply and every lifecycle echo all route through threadIdFor:
  assert.equal(threadIdFor(entryFor("chan-1"), m), UUID);
});

test("legacy fallback unchanged: no first-class id -> deterministic thread-<ch>-<seq>", () => {
  const legacyInbound = { ...withThreadId(`thread-old-${UUID}-2`), seq: 9 }; // legacy id, not a UUID
  assert.equal(firstClassThreadId(legacyInbound), "");
  assert.equal(threadIdFor(entryFor("chan-1"), legacyInbound), "thread-chan-1-9");
  // A wholly unthreaded inbound behaves identically.
  assert.equal(threadIdFor(entryFor("chan-2"), { metadata: {}, seq: 4 }), "thread-chan-2-4");
});
