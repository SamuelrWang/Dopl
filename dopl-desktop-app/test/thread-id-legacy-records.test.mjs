// A session record written before the thread rename carries `taskId` and no `threadId`, under the key
// `<channel>:<thread>:<agent>`. Read back with an empty thread, a resumed agent would hear its thread but post
// to the main room, so every record reader takes the thread from the key's middle segment.
//
// Run: `node --test dopl-desktop-app/test/thread-id-legacy-records.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";

const CHANNEL = "11111111-2222-3333-4444-555555555555";
const THREAD = "66666666-7777-8888-9999-000000000000";

function loadStore(doc) {
  const store = { get: (k) => doc[k], set: (k, v) => { doc[k] = v; }, delete: (k) => { delete doc[k]; } };
  return loadWithStubs("session-store.js", {
    "electron-store": function Store() { return store; },
    "./session-runtime-truth": real("./session-runtime-truth"),
  });
}

const legacy = (key, extra) => ({ key, channelId: CHANNEL, agentId: "a1b2c3d4", taskId: "unrelated", phase: "parked", ...extra });

test("a pre-rename record reads back with the thread its key names, not its `taskId`", () => {
  const key = `${CHANNEL}:${THREAD}:a1b2c3d4`;
  const records = loadStore({ sessionRecords: { [key]: legacy(key) } }).loadRecords();
  assert.equal(records[key].threadId, THREAD);
});

test("a channel-level record stays on the main room; a stored threadId wins over the key", () => {
  const channelKey = `${CHANNEL}::a1b2c3d4`;
  const threadKey = `${CHANNEL}:${THREAD}:a1b2c3d4`;
  const records = loadStore({
    sessionRecords: {
      [channelKey]: legacy(channelKey),
      [threadKey]: legacy(threadKey, { threadId: "stored-thread" }),
    },
  }).loadRecords();
  assert.equal(records[channelKey].threadId, "");
  assert.equal(records[threadKey].threadId, "stored-thread");
});

test("a key that does not start with the record's channel or end with its agent yields no thread", () => {
  const key = `other-channel:${THREAD}:a1b2c3d4`;
  const wrongAgent = `${CHANNEL}:${THREAD}:z9y8x7w6`;
  const records = loadStore({
    sessionRecords: { [key]: legacy(key), [wrongAgent]: legacy(wrongAgent) },
  }).loadRecords();
  assert.equal(records[key].threadId, "");
  assert.equal(records[wrongAgent].threadId, "");
});

test("a thread id containing a colon survives, and a re-save writes it down without `taskId`", () => {
  const key = `${CHANNEL}:thread:with:colons:a1b2c3d4`;
  const doc = { sessionRecords: { [key]: legacy(key) } };
  const store = loadStore(doc);
  store.saveRecord(store.loadRecords()[key]);
  assert.equal(doc.sessionRecords[key].threadId, "thread:with:colons");
  assert.equal("taskId" in doc.sessionRecords[key], false, "the retired field is not carried forward");
});
