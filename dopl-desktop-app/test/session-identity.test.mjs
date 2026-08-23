// Tests for the v1.7.5 D1 identity plumbing on the MAIN side:
//
//   1. session-io.baseRecord projects the header identity (counterpartyName /
//      channelName / taskTitle) into the durable record, so a P2 recreate or an
//      opt-in resume has something to rebuild the header from.
//   2. handleSdkMessage's system/init payload carries the same three fields to the
//      renderer, and persists the record on the way.
//   3. The RESPONDER spawn path (trigger.js) threads taskTitle into the session
//      context — the value already existed for the consent payload.
//
// session-io.js is electron-free (crypto + session-profiles + tool-profiles only), so
// it is required directly; trigger.js is electron-bound, so the responder-context
// wiring is pinned structurally against its source (the classify.test.mjs idiom).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = (p) => fileURLToPath(new URL("../main/" + p, import.meta.url));
const io = require(M("session-io.js"));

// A live session object shaped like the engine's (only the fields baseRecord reads).
function liveSession(over = {}) {
  return {
    key: "c1:t1",
    sessionId: "s1",
    sdkSessionId: "sdk-1",
    channelId: "c1",
    taskId: "t1",
    workspaceId: "w1",
    side: "responder",
    profile: "full",
    mode: "autonomous",
    startedAt: 123,
    counterpartyId: "peer-1",
    counterpartyName: "David",
    context: { channelName: "Ops", taskTitle: "Ship the invoice import", authorName: "David" },
    state: { phase: "running", turns: 3, costUsd: 0.25 },
    ...over,
  };
}

// ── baseRecord: the durable projection carries the identity ────────────────────

test("baseRecord projects the header identity from the session + its context", () => {
  const rec = io.baseRecord(liveSession());
  assert.equal(rec.counterpartyName, "David", "the peer display name (derived at startSession)");
  assert.equal(rec.channelName, "Ops");
  assert.equal(rec.taskTitle, "Ship the invoice import");
  // The pre-v1.7.5 fields are untouched (the park feature's rehydrate contract).
  assert.equal(rec.phase, "running");
  assert.equal(rec.turns, 3);
  assert.equal(rec.costUsd, 0.25);
  assert.equal(rec.counterpartyId, "peer-1");
});

test("baseRecord defaults every identity field to null, never undefined", () => {
  const rec = io.baseRecord(liveSession({ counterpartyName: null, context: {} }));
  assert.equal(rec.counterpartyName, null);
  assert.equal(rec.channelName, null);
  assert.equal(rec.taskTitle, null);
  // A session with NO context object at all must not throw (a parked shell can have one).
  const bare = io.baseRecord(liveSession({ counterpartyName: undefined, context: undefined }));
  assert.equal(bare.channelName, null);
  assert.equal(bare.taskTitle, null);
});

test("baseRecord still copies NO live handle (the durability leak guard holds)", () => {
  const rec = io.baseRecord(liveSession({
    query: { interrupt() {} }, win: {}, pushIterator: { push() {} }, pendingPermissions: new Map(),
  }));
  for (const leak of ["query", "win", "pushIterator", "pendingPermissions", "context", "state"]) {
    assert.ok(!(leak in rec), `${leak} must not reach the durable record`);
  }
});

// ── system/init: the renderer gets the same identity, and the record is saved ──

test("handleSdkMessage's init payload carries taskTitle / channelName / from", () => {
  const s = liveSession();
  const events = [];
  const saved = [];
  const store = { setSdkSessionId: () => {}, saveRecord: (r) => saved.push(r) };
  io.handleSdkMessage(s, { type: "system", subtype: "init", session_id: "sdk-2", model: "claude" },
    (_s, ev) => events.push(ev), store);

  const init = events.find((e) => e.type === "launched").payload;
  assert.equal(init.type, "init");
  assert.equal(init.taskTitle, "Ship the invoice import");
  assert.equal(init.channelName, "Ops");
  assert.equal(init.from, "David");
  // The SAME identity is persisted on the way, so a later reopen can rebuild it.
  assert.equal(saved.length, 1);
  assert.equal(saved[0].taskTitle, "Ship the invoice import");
  assert.equal(saved[0].channelName, "Ops");
  assert.equal(saved[0].counterpartyName, "David");
});

// ── the responder spawn path threads taskTitle into the context ────────────────

test("trigger.js: the responder session context carries taskTitle", () => {
  const src = readFileSync(M("trigger.js"), "utf8");
  // ⚠ THE SLICE BOUND MOVED ON 2026-08-22 and the old one was `toolProfile: rec.toolProfile` —
  // both `rec.*` reads named a PERSISTED consent record, and the inbound consent lane is deleted
  // (Samuel's ruling; `main/trigger.js`'s header). `String.slice` with a -1 end silently returns
  // almost the whole file, so a stale bound here degrades into a scan of the module rather than
  // of the call: the bound is a live literal from inside the object.
  const call = src.slice(
    src.indexOf("sessionEngine.launchResponderSession({"),
    src.indexOf("startModes: { tools: 'manual', messages }")
  );
  assert.ok(call.length > 0 && call.length < 3000, "the slice really bounds the call");
  assert.match(call, /channelName: entry\.channel\.name/, "the channel name still rides");
  assert.match(call, /authorName: requesterName/, "the peer name still rides");
  assert.match(call, /taskTitle: targeting\.metaStr\(m, 'taskTitle'\) \|\| null/,
    "the responder context now carries the SAME server-stamped taskTitle the consent payload reads");
});

// ── v2.x: the spawn context also carries the ids the framing addresses ─────────

test("trigger.js: the responder session context carries the channel + workspace ids", () => {
  const src = readFileSync(M("trigger.js"), "utf8");
  const call = src.slice(
    src.indexOf("sessionEngine.launchResponderSession({"),
    src.indexOf("startModes: { tools: 'manual', messages }")
  );
  assert.ok(call.length > 0 && call.length < 3000, "the slice really bounds the call");
  assert.match(call, /channelId: entry\.channel\.id/, "the concrete channel id, not just its name");
  assert.match(call, /workspaceId: entry\.workspaceId/, "and the workspace a multi-workspace token needs");
});

test("session-engine: startSession merges the spec ids into the context for EVERY spawn shape", () => {
  const src = readFileSync(M("session-engine.js"), "utf8");
  // One merge, read by BOTH the eager first turn (fresh responder / requester) and the
  // session object the lazy fresh-shell framing later reads (io.takeFraming -> s.context).
  assert.match(src, /const context = \{ \.\.\.\(spec\.context \|\| \{\}\), channelId: spec\.channelId, workspaceId: spec\.workspaceId \};/);
  assert.match(src, /framing\.buildFencedTurn\(\{ side: spec\.side, message: spec\.firstMessage, context, nonce \}\)/);
  assert.match(src, /\n {4}context, \/\//, "the SAME merged object is what the session carries");
  assert.ok(!/context: spec\.context/.test(src), "no path keeps the un-merged context");
});

test("prompt-framing: a responder prompt is NOT changed by the new context field", () => {
  // Only the REQUESTER branch reads ctx.taskTitle, so threading it into the responder
  // context is display-only — the fenced first turn stays byte-for-byte identical.
  const framing = require(M("prompt-framing.js"));
  const base = { side: "responder", message: "please do X", nonce: "abcd1234" };
  const without = framing.buildFencedTurn({ ...base, context: { channelName: "Ops", authorName: "David" } });
  const withTitle = framing.buildFencedTurn({
    ...base, context: { channelName: "Ops", authorName: "David", taskTitle: "Ship the invoice import" },
  });
  assert.equal(withTitle, without, "the responder framing must not gain the task title");
  // The requester branch DOES use it (unchanged behavior, pinned here for contrast).
  const req = framing.buildFencedTurn({ ...base, side: "requester", context: { channelName: "Ops", taskTitle: "Reconcile Q3" } });
  assert.match(req, /"Reconcile Q3"/);
});
