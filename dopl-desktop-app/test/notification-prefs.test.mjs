// NOTIFICATION PREFERENCES (main/notification-prefs.js, 2026-10-09): the operator's ACCOUNT
// record, and the banner gate the two passive banners ask.
//
// ⚠ THE RECORD MOVED TO THE SERVER (Samuel, 2026-10-09). There is no electron-store key any
// more: the module READS `/api/user/notification-preferences` into a cache and the gate answers
// from that cache synchronously. So these tests fake `./api` (the transport) instead of a store,
// and the thing under test is the CACHE's behaviour as much as the gate's: what it answers before
// the first read, what it does when the read fails, and that a failure never clears a good copy.
//
// Driven through the REAL module with only its requires faked (helpers/module-sandbox.mjs).
//
// Run: `node --test dopl-desktop-app/test/notification-prefs.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWithStubs, MAIN } from "./helpers/module-sandbox.mjs";

/**
 * Loads the module over a fake transport.
 * @param {object} [opts]
 * @param {object|null} [opts.prefs] the record the route answers with (null = none stored).
 * @param {number} [opts.status] a non-2xx to answer instead.
 * @param {boolean} [opts.throws] make the transport reject (dead network).
 */
function load(opts = {}) {
  const calls = [];
  const state = { ...opts };
  const api = {
    apiFetch(pathname, init) {
      calls.push({ pathname, init });
      if (state.throws) return Promise.reject(new Error("ECONNREFUSED"));
      const status = state.status || 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ prefs: state.prefs ?? null }),
      });
    },
  };
  const logs = [];
  const diag = { diag: (...a) => logs.push(a.join(" ")) };
  const mod = loadWithStubs("notification-prefs.js", { "./api": api, "./diag": diag });
  return { mod, calls, logs, state };
}

const msg = (metadata) => ({ seq: 1, kind: "message", metadata });
const room = { channel: { id: "c", isDirect: false } };
const dm = { channel: { id: "c", isDirect: true } };

test("registry ids match the web registry", () => {
  const web = readFileSync(join(MAIN, "..", "..", "src", "features", "notifications", "registry.ts"), "utf8");
  const ids = [...web.match(/NOTIFICATION_EVENT_IDS = \[([^\]]*)\]/)[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  assert.deepEqual(load().mod.EVENT_IDS, ids);
});

test("before any read, and on every failure, every event reads ON", async () => {
  // Never read: the gate must not wait for the network to answer a banner.
  const fresh = load();
  assert.deepEqual(fresh.mod.getPrefs().events, { mention: true, decision: true, direct_message: true, approval: true });
  assert.equal(fresh.mod.allowsMessage(msg({}), room), true);

  // 503 while the table is unapplied, 404 on an older deploy, and a dead network: all ON.
  for (const bad of [{ status: 503 }, { status: 404 }, { throws: true }]) {
    const { mod, logs } = load(bad);
    assert.equal(await mod.refresh(true), null, "a failed read produces no record");
    assert.deepEqual(mod.getPrefs().events, { mention: true, decision: true, direct_message: true, approval: true });
    assert.equal(mod.allowsMessage(msg({}), dm), true);
    assert.equal(logs.length, 1, "the failure is logged once, not per banner");
  }
});

test("the account record is read into the cache, normalized", async () => {
  const { mod, calls } = load({ prefs: { v: 1, events: { mention: false, approval: false, bogus: false, decision: "no" } } });
  await mod.refresh(true);
  // Unknown keys dropped, non-booleans read as the default, approval FORCED ON.
  assert.deepEqual(mod.getPrefs().events, { mention: false, decision: true, direct_message: true, approval: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/user/notification-preferences");
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls[0].init.timeoutMs > 0, "the background read is bounded");
  assert.equal(calls[0].init.noStore, true, "never served from a cache the app cannot see");
});

test("a later failure never clears a good record", async () => {
  const ctx = load({ prefs: { v: 1, events: { mention: false } } });
  await ctx.mod.refresh(true);
  assert.equal(ctx.mod.getPrefs().events.mention, false);
  ctx.state.throws = true;
  assert.equal(await ctx.mod.refresh(true), null);
  assert.equal(ctx.mod.getPrefs().events.mention, false, "the last known answer still stands");
});

test("a signed-out or offline app does not fetch per banner", async () => {
  const { mod, calls } = load({ throws: true });
  await mod.refresh(true);
  // getPrefs kicks a background read when stale; the retry floor must swallow the flood.
  for (let i = 0; i < 25; i++) mod.allowsMessage(msg({}), room);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, "one attempt per retry window, not one per banner");
});

test("concurrent reads are deduped", async () => {
  const { mod, calls } = load({ prefs: { v: 1, events: {} } });
  await Promise.all([mod.refresh(true), mod.refresh(true), mod.refresh(true)]);
  assert.equal(calls.length, 1);
});

test("eventForMessage reads server-stamped facts only", () => {
  const { mod } = load();
  assert.equal(mod.eventForMessage(msg({ escalation: { options: [] } }), room), "decision");
  assert.equal(mod.eventForMessage(msg({ display: { blocks: [{ type: "text" }, { type: "choice" }] } }), dm), "decision");
  assert.equal(mod.eventForMessage(msg({ display: { blocks: [{ type: "text" }] } }), dm), "direct_message");
  assert.equal(mod.eventForMessage(msg(null), room), "mention");
  assert.equal(mod.eventForMessage(msg({ escalation: [] }), room), "mention");
});

test("the gate mutes exactly the switched-off event", async () => {
  const dmOff = load({ prefs: { v: 1, events: { direct_message: false } } });
  await dmOff.mod.refresh(true);
  assert.equal(dmOff.mod.allowsMessage(msg({}), dm), false);
  assert.equal(dmOff.mod.allowsMessage(msg({}), room), true);
  assert.equal(dmOff.mod.allowsMessage(msg({ escalation: {} }), dm), true, "a decision in a DM is a decision");

  const mentionOff = load({ prefs: { v: 1, events: { mention: false } } });
  await mentionOff.mod.refresh(true);
  assert.equal(mentionOff.mod.allowsMessage(msg({}), room), false);
  // An id this build does not know fails toward ON (the web list may name one first).
  assert.equal(mentionOff.mod.allowsIn(mentionOff.mod.getPrefs(), "some-future-event"), true);
});

test("approval can never be switched off, whatever the server says", async () => {
  const { mod } = load({ prefs: { v: 1, events: { approval: false } } });
  await mod.refresh(true);
  assert.equal(mod.getPrefs().events.approval, true);
});

test("both passive banners ask the gate before showing anything", () => {
  const src = (f) => readFileSync(join(MAIN, f), "utf8");
  assert.match(src("trigger.js"), /function sendFyi\(entry, m\) \{[\s\S]{0,300}?if \(!notificationPrefs\.allowsMessage\(m, entry\)\)/);
  assert.match(src("task-notify.js"), /function notifyTaskReply\(entry, m\) \{\s*if \(!notificationPrefs\.allowsMessage\(m, entry\)\)/);
});

test("the record has no second home: no electron-store, no local fallback", () => {
  // Code only: the header still NAMES electron-store, to say why there is no longer one.
  const src = readFileSync(join(MAIN, "notification-prefs.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /require\(['"]electron-store['"]\)/, "a local copy could only disagree with the account");
  assert.doesNotMatch(src, /\bsetPrefs\b/, "this module no longer writes; the panel writes the route");
});
