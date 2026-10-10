// NOTIFICATION PREFERENCES (main/notification-prefs.js, 2026-10-09): the record the profile
// popup's Notifications tab writes, and the gate the two passive banners ask.
// Driven through the REAL module with only electron-store faked (helpers/module-sandbox.mjs).
//
// Run: `node --test dopl-desktop-app/test/notification-prefs.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWithStubs, MAIN } from "./helpers/module-sandbox.mjs";

function load({ broken = false } = {}) {
  const data = new Map();
  class FakeStore {
    get(k) { if (broken) throw new Error("corrupt"); return data.get(k); }
    set(k, v) { if (broken) throw new Error("read-only"); data.set(k, v); }
  }
  return { mod: loadWithStubs("notification-prefs.js", { "electron-store": FakeStore }), data };
}

const msg = (metadata) => ({ seq: 1, kind: "message", metadata });
const room = { channel: { id: "c", isDirect: false } };
const dm = { channel: { id: "c", isDirect: true } };

test("registry ids match the web registry", () => {
  const web = readFileSync(join(MAIN, "..", "..", "src", "features", "notifications", "registry.ts"), "utf8");
  const ids = [...web.match(/NOTIFICATION_EVENT_IDS = \[([^\]]*)\]/)[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  assert.deepEqual(load().mod.EVENT_IDS, ids);
});

test("an empty or broken store reads every event ON", () => {
  assert.deepEqual(load().mod.getPrefs().events, { mention: true, decision: true, direct_message: true, approval: true });
  const { mod } = load({ broken: true });
  assert.equal(mod.getPrefs().events.mention, true);
  assert.equal(mod.allowsMessage(msg({}), room), true);
  assert.equal(mod.setPrefs({ events: { mention: false } }).ok, false);
});

test("set normalizes: unknown keys dropped, approval forced on", () => {
  const { mod, data } = load();
  const res = mod.setPrefs({ events: { mention: false, approval: false, bogus: false, decision: "no" } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.prefs.events, { mention: false, decision: true, direct_message: true, approval: true });
  assert.deepEqual(data.get("notificationPrefs"), res.prefs);
});

test("eventForMessage reads server-stamped facts only", () => {
  const { mod } = load();
  assert.equal(mod.eventForMessage(msg({ escalation: { options: [] } }), room), "decision");
  assert.equal(mod.eventForMessage(msg({ display: { blocks: [{ type: "text" }, { type: "choice" }] } }), dm), "decision");
  assert.equal(mod.eventForMessage(msg({ display: { blocks: [{ type: "text" }] } }), dm), "direct_message");
  assert.equal(mod.eventForMessage(msg(null), room), "mention");
  assert.equal(mod.eventForMessage(msg({ escalation: [] }), room), "mention");
});

test("the gate mutes exactly the switched-off event", () => {
  const { mod } = load();
  mod.setPrefs({ events: { direct_message: false } });
  assert.equal(mod.allowsMessage(msg({}), dm), false);
  assert.equal(mod.allowsMessage(msg({}), room), true);
  assert.equal(mod.allowsMessage(msg({ escalation: {} }), dm), true, "a decision in a DM is a decision");
  mod.setPrefs({ events: { mention: false } });
  assert.equal(mod.allowsMessage(msg({}), room), false);
  assert.equal(mod.allowsIn(mod.getPrefs(), "some-future-event"), true);
});

test("both passive banners ask the gate before showing anything", () => {
  const src = (f) => readFileSync(join(MAIN, f), "utf8");
  assert.match(src("trigger.js"), /function sendFyi\(entry, m\) \{[\s\S]{0,300}?if \(!notificationPrefs\.allowsMessage\(m, entry\)\)/);
  assert.match(src("task-notify.js"), /function notifyTaskReply\(entry, m\) \{\s*if \(!notificationPrefs\.allowsMessage\(m, entry\)\)/);
});
