// Truth table for targeting.requesterTaskOpen(m, myId) — the v1.9 requester
// auto-open detector (contract §Q4). It answers ONE question the listener asks
// SEPARATELY from classify(): "is this MY own first-class create_task addressed to
// a peer, so I should open a requester session window that drives it?"
//
// requesterTaskOpen is pure, exported, and electron-free, so we `require` targeting
// directly (same as first-class-task-id.test). The critical invariant this file
// pins: the helper never perturbs classify's 1536-case table — it is a wholly
// separate predicate — and a self-authored message (which classify treats as
// 'ignore') is the ONLY thing this helper acts on. All four conjuncts are load
// bearing, so each is exercised failing in isolation.
//
// `.mjs` (ESM) to stay under the repo's shared eslint config; createRequire loads
// the CommonJS targeting module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { requesterTaskOpen } = require("../main/targeting.js");

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"; // a first-class task id

// A well-formed create_task message: my agent authored it, I created the task, it
// targets a peer. Overrides let each test knock out exactly one conjunct.
const makeMsg = (over = {}) => ({
  kind: "message",
  authorUserId: over.authorUserId !== undefined ? over.authorUserId : ME,
  authorKind: over.authorKind || "agent",
  metadata: {
    taskId: over.taskId !== undefined ? over.taskId : UUID,
    taskCreatedBy: over.taskCreatedBy !== undefined ? over.taskCreatedBy : ME,
    taskTarget: over.taskTarget !== undefined ? over.taskTarget : PEER,
    ...(over.metadata || {}),
  },
});

test("the canonical case -> true (my first-class create_task to a peer)", () => {
  assert.equal(requesterTaskOpen(makeMsg(), ME), true);
  // authorKind is irrelevant — my agent (agent) OR I (user) may have posted it.
  assert.equal(requesterTaskOpen(makeMsg({ authorKind: "user" }), ME), true);
});

test("not my message -> false (a peer's create_task is a RESPONDER trigger, not an open)", () => {
  assert.equal(requesterTaskOpen(makeMsg({ authorUserId: PEER }), ME), false);
});

test("not created by me -> false (I forwarded a task I did not create)", () => {
  assert.equal(requesterTaskOpen(makeMsg({ taskCreatedBy: PEER }), ME), false);
});

test("no target -> false (an unaddressed task has no counterparty to drive against)", () => {
  assert.equal(requesterTaskOpen(makeMsg({ taskTarget: "" }), ME), false);
  const noKey = makeMsg();
  delete noKey.metadata.taskTarget;
  assert.equal(requesterTaskOpen(noKey, ME), false);
});

test("self-targeted -> false (a task addressed back to me is degenerate)", () => {
  assert.equal(requesterTaskOpen(makeMsg({ taskTarget: ME }), ME), false);
});

test("legacy / absent / malformed task id -> false (first-class only)", () => {
  assert.equal(requesterTaskOpen(makeMsg({ taskId: `task-${UUID}-7` }), ME), false);
  assert.equal(requesterTaskOpen(makeMsg({ taskId: "" }), ME), false);
  assert.equal(requesterTaskOpen(makeMsg({ taskId: UUID.slice(0, -1) }), ME), false); // too short
  assert.equal(requesterTaskOpen(makeMsg({ taskId: UUID + "0" }), ME), false); // too long
});

test("non-message kind or unknown identity -> false (guards, like classify)", () => {
  assert.equal(requesterTaskOpen({ ...makeMsg(), kind: "task_started" }, ME), false);
  assert.equal(requesterTaskOpen({ ...makeMsg(), metadata: {} }, ME), false); // no task keys at all
  assert.equal(requesterTaskOpen(makeMsg(), null), false); // identity not resolved yet
  assert.equal(requesterTaskOpen(makeMsg(), ""), false);
  assert.equal(requesterTaskOpen(null, ME), false);
});

test("server-stamped keys are read as strings; a spoofed non-string is ignored", () => {
  // metaStr only accepts trimmed non-empty strings, so a numeric/object taskTarget
  // can never satisfy the addressed-to-a-peer conjunct.
  assert.equal(requesterTaskOpen(makeMsg({ taskTarget: 123 }), ME), false);
  assert.equal(requesterTaskOpen(makeMsg({ taskCreatedBy: { id: ME } }), ME), false);
});
