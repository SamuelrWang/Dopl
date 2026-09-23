// Parked-session records and ended-agent history written before the template→identity rename
// carry `templateName`; the record readers take it as the identity name, so a resumed session or
// an ended card keeps its identity label after the upgrade (P3-10).
//
// Run: `node --test dopl-desktop-app/test/identity-name-legacy-records.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";
import { loadWithStubs, real, MAIN } from "./helpers/module-sandbox.mjs";
import { harness, parkedRecord, CHANNEL, KEY } from "./_session-boot-harness.mjs";

/** A main module over a fake electron-store document. */
function load(file, doc) {
  const store = { get: (k) => doc[k], set: (k, v) => { doc[k] = v; }, delete: (k) => { delete doc[k]; } };
  return loadWithStubs(file, {
    "electron-store": function Store() { return store; },
    "./diag": { diag: () => {} },
    "./session-runtime-truth": real("./session-runtime-truth"),
  });
}

test("a parked record's `templateName` rebuilds the identity; a new record is untouched", () => {
  const contextFromRecord = new Function(
    `${fnOf(readFileSync(join(MAIN, "session-park.js"), "utf8"), "contextFromRecord")}\n return contextFromRecord;`
  )();
  assert.deepEqual(contextFromRecord({ templateName: "Code Auditor" }).identity, { name: "Code Auditor" });
  assert.deepEqual(contextFromRecord({ templateName: "Old", identityName: "New" }).identity, { name: "New" });
  assert.equal(contextFromRecord({}).identity, null);
});

test("a pre-rename record keeps its name through the boot pass, parked or ended", () => {
  const legacy = { identityName: undefined, templateName: "Code Auditor" };
  const parked = harness({ records: { [KEY]: parkedRecord(legacy) }, ids: { [KEY]: "sdk-y1uun32v" } });
  parked.boot.reparkDormant();
  assert.equal(parked.sessions.get(KEY).context.identity.name, "Code Auditor");

  const endedKey = `${CHANNEL}::sp4wnidl`;
  const rec = { ...parkedRecord({ ...legacy, sdkSessionId: null, agentId: "sp4wnidl" }), key: endedKey };
  const ended = harness({ records: { [endedKey]: rec }, ids: {} });
  ended.boot.reparkDormant();
  assert.equal(ended.calls.history[0].identityName, "Code Auditor");
});

test("an ended agent's `templateName` reads as its identity name", () => {
  const doc = {};
  const history = load("agent-history.js", doc);
  history.record({ key: "k-new", endedAt: 2, identityName: "Scout" });
  const historyKey = Object.keys(doc)[0];
  doc[historyKey]["k-old"] = { key: "k-old", endedAt: 1, templateName: "Code Auditor" };
  const ended = history.listEnded();
  assert.deepEqual(ended.map((r) => [r.key, r.identityName]), [["k-old", "Code Auditor"], ["k-new", "Scout"]]);
});
