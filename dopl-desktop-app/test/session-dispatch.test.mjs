// Tests for the v2.2 Session Window dispatch routing (main/session-dispatch.js, Track
// T2, item 3) — the listener's three pre-classify routes.
//
// SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-DISPATCH-PURE block holds
// feedLiveSession / maybeOpenRequesterSession / maybeSurfaceRequesterReply. Every
// dependency (settings, targeting, sessionEngine, io, store, notifyLocal, diag) is a
// module-scope binding, so we slice the block, prove it is electron/fs/require-free
// (§H-8), and inject fakes to pin the routing TRUTH TABLE without an electron require:
//   live peer reply -> feed; my create_task -> openRequester; a settled requester
//   reply with a retained sdkId -> surface (else false); a THIRD party never feeds
//   (FIX L1); window-mode OFF short-circuits every route.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-dispatch.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-DISPATCH-PURE";
const END = "// ─── END SESSION-DISPATCH-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-DISPATCH-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-DISPATCH-PURE sentinel missing");
assert.ok(to > from, "session-dispatch sentinels out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-DISPATCH-PURE block must not reference ${banned}`);
}

const ME = "me-user";
const PEER = "peer-user";
const TASK = "11111111-2222-3333-4444-555555555555";

// A fresh harness per test: configurable fakes + recorded calls.
function harness(over = {}) {
  const calls = { feedInbound: [], launch: [], resume: [], notify: [] };
  const cfg = {
    windowMode: true,
    live: false,
    counterparty: PEER,
    feedInboundReturn: true,
    requesterOpen: false,
    launchReturn: { sessionId: "sess-1" },
    sdkId: null,
    rec: null,
    ...over,
  };
  const settings = { getWindowMode: () => cfg.windowMode };
  const targeting = {
    firstClassTaskId: (m) => m.taskId || "",
    requesterTaskOpen: () => cfg.requesterOpen,
    metaStr: (m, k) => (m.meta && m.meta[k]) || "",
    resolveToolProfile: () => "full",
  };
  const sessionEngine = {
    hasLiveSession: () => cfg.live,
    counterpartyFor: () => cfg.counterparty,
    feedInbound: (a) => { calls.feedInbound.push(a); return cfg.feedInboundReturn; },
    launchRequesterSession: async (a) => { calls.launch.push(a); return cfg.launchReturn; },
    resumeRequesterForReply: async (rec, sdkId, reply) => { calls.resume.push({ rec, sdkId, reply }); return true; },
  };
  const io = { displayNameFor: (id) => `name:${id}` };
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    getSdkSessionId: () => cfg.sdkId,
    getRecord: () => cfg.rec,
  };
  const notifyLocal = (title, body) => calls.notify.push({ title, body });
  const diag = () => {};
  const api = new Function(
    "settings", "targeting", "sessionEngine", "io", "store", "notifyLocal", "diag",
    `${BLOCK}\n return { feedLiveSession, maybeOpenRequesterSession, maybeSurfaceRequesterReply };`
  )(settings, targeting, sessionEngine, io, store, notifyLocal, diag);
  return { ...api, calls, cfg };
}

const entry = { channel: { id: "c1", name: "General" }, workspaceId: "w1" };
const peerMsg = (over = {}) => ({ kind: "message", authorUserId: PEER, body: "reply body", taskId: TASK, meta: {}, ...over });

// ── (1) feedLiveSession ──────────────────────────────────────────────────────

test("feed: a live peer reply from the task's counterparty feeds the session", () => {
  const h = harness({ live: true, counterparty: PEER });
  assert.equal(h.feedLiveSession(entry, peerMsg(), ME), true);
  assert.equal(h.calls.feedInbound.length, 1);
  assert.deepEqual(h.calls.feedInbound[0], {
    channelId: "c1", taskId: TASK, message: "reply body", authorName: `name:${PEER}`,
  });
});

test("feed: a THIRD party in the same channel never injects a turn (FIX L1)", () => {
  const h = harness({ live: true, counterparty: PEER });
  // The live session's counterparty is PEER, but a different member posts.
  assert.equal(h.feedLiveSession(entry, peerMsg({ authorUserId: "third-party" }), ME), false);
  assert.equal(h.calls.feedInbound.length, 0, "no feed for a non-counterparty author");
});

test("feed: no live session -> false (falls through to classify)", () => {
  const h = harness({ live: false });
  assert.equal(h.feedLiveSession(entry, peerMsg(), ME), false);
  assert.equal(h.calls.feedInbound.length, 0);
});

test("feed: my OWN message never feeds; a non-message kind never feeds", () => {
  const h = harness({ live: true });
  assert.equal(h.feedLiveSession(entry, peerMsg({ authorUserId: ME }), ME), false);
  assert.equal(h.feedLiveSession(entry, peerMsg({ kind: "task_started" }), ME), false);
});

test("feed: window-mode OFF short-circuits (no engine call at all)", () => {
  const h = harness({ windowMode: false, live: true });
  assert.equal(h.feedLiveSession(entry, peerMsg(), ME), false);
  assert.equal(h.calls.feedInbound.length, 0);
});

// ── (2) maybeOpenRequesterSession ──────────────────────────────────────────────

test("openRequester: my own create_task launches a requester window", async () => {
  const h = harness({ requesterOpen: true, live: false, launchReturn: { sessionId: "s9" } });
  assert.equal(await h.maybeOpenRequesterSession(entry, peerMsg({ authorUserId: ME }), ME), true);
  assert.equal(h.calls.launch.length, 1);
  assert.equal(h.calls.launch[0].taskId, TASK);
});

test("openRequester: an already-live task is deduped (true, no relaunch)", async () => {
  const h = harness({ requesterOpen: true, live: true });
  assert.equal(await h.maybeOpenRequesterSession(entry, peerMsg({ authorUserId: ME }), ME), true);
  assert.equal(h.calls.launch.length, 0, "one window per (channel,task)");
});

test("openRequester: a window-cap skip returns false AND posts a passive notice", async () => {
  const h = harness({ requesterOpen: true, live: false, launchReturn: { skipped: "cap" } });
  assert.equal(await h.maybeOpenRequesterSession(entry, peerMsg({ authorUserId: ME }), ME), false);
  assert.equal(h.calls.notify.length, 1, "cap -> one passive local notice");
});

test("openRequester: not my create_task -> false", async () => {
  const h = harness({ requesterOpen: false });
  assert.equal(await h.maybeOpenRequesterSession(entry, peerMsg(), ME), false);
  assert.equal(h.calls.launch.length, 0);
});

// ── (3) maybeSurfaceRequesterReply ──────────────────────────────────────────────

const settledReply = (over = {}) =>
  peerMsg({ meta: { taskCreatedBy: ME, taskTarget: PEER }, ...over });

test("surface: a settled requester reply with a retained sdkId reopens a continuation", async () => {
  const rec = { channelId: "c1", taskId: TASK, side: "requester" };
  const h = harness({ live: false, sdkId: "sdk-123", rec });
  assert.equal(await h.maybeSurfaceRequesterReply(entry, settledReply(), ME), true);
  assert.equal(h.calls.resume.length, 1);
  assert.equal(h.calls.resume[0].sdkId, "sdk-123");
  assert.deepEqual(h.calls.resume[0].reply, { message: "reply body", authorName: `name:${PEER}` });
});

test("surface: NO retained sdkId -> false (today's passive task-reply notify)", async () => {
  const h = harness({ live: false, sdkId: null, rec: { channelId: "c1", taskId: TASK } });
  assert.equal(await h.maybeSurfaceRequesterReply(entry, settledReply(), ME), false);
  assert.equal(h.calls.resume.length, 0);
});

test("surface: a still-LIVE session is left to the live path -> false", async () => {
  const h = harness({ live: true, sdkId: "sdk-1", rec: {} });
  assert.equal(await h.maybeSurfaceRequesterReply(entry, settledReply(), ME), false);
  assert.equal(h.calls.resume.length, 0);
});

test("surface: a reply where I am NOT the requester never reopens", async () => {
  const h = harness({ live: false, sdkId: "sdk-1", rec: {} });
  // taskCreatedBy is someone else -> I am the responder, not the requester.
  assert.equal(
    await h.maybeSurfaceRequesterReply(entry, settledReply({ meta: { taskCreatedBy: "other", taskTarget: PEER } }), ME),
    false
  );
  // The author is not the task's target -> a third member -> never reopen.
  assert.equal(
    await h.maybeSurfaceRequesterReply(entry, settledReply({ meta: { taskCreatedBy: ME, taskTarget: "someone-else" } }), ME),
    false
  );
  assert.equal(h.calls.resume.length, 0);
});

test("surface: window-mode OFF and my-own-message short-circuit", async () => {
  const off = harness({ windowMode: false, sdkId: "sdk-1", rec: {} });
  assert.equal(await off.maybeSurfaceRequesterReply(entry, settledReply(), ME), false);
  const mine = harness({ live: false, sdkId: "sdk-1", rec: {} });
  assert.equal(await mine.maybeSurfaceRequesterReply(entry, settledReply({ authorUserId: ME }), ME), false);
  assert.equal(off.calls.resume.length + mine.calls.resume.length, 0);
});
