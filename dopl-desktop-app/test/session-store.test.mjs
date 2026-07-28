// Tests for the v1.9 Session Window durable-persistence pure core
// (main/session-store.js, Track T1). SOURCE EXTRACTION: the BEGIN/END
// SESSION-STORE-PURE block has no electron-store reference (the Store handle lives
// outside it), so we slice and evaluate it verbatim — the electron-bound records /
// resume-map wrappers around it are exercised in the manual E2E (§F), not here.
//
// What matters: the (channel,task) session key; the terminal-phase predicate; the
// reload disposition that decides ignore-vs-resume on restart; and the durable
// whitelist that guarantees a live handle can never leak into electron-store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-store.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-STORE-PURE";
const END = "// ─── END SESSION-STORE-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-STORE-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-STORE-PURE sentinel missing");
assert.ok(to > from, "session-store sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { sessionKey, isTerminalPhase, reloadDisposition, durableSessionRecord } = new Function(
  `${BLOCK}
   return { sessionKey, isTerminalPhase, reloadDisposition, durableSessionRecord };`
)();

// ── sessionKey ───────────────────────────────────────────────────────────────

test("sessionKey is a stable (channel,task) identity; a missing task collapses to ''", () => {
  assert.equal(sessionKey("c1", "t1"), "c1:t1");
  assert.equal(sessionKey("c1", ""), "c1:");
  assert.equal(sessionKey("c1", null), "c1:");
  assert.equal(sessionKey("c1", undefined), "c1:");
  // Same channel, different tasks are distinct sessions; a responder with no task
  // is one session per channel.
  assert.notEqual(sessionKey("c1", "t1"), sessionKey("c1", "t2"));
  assert.equal(sessionKey("c1"), sessionKey("c1", ""));
});

// ── isTerminalPhase / reloadDisposition ────────────────────────────────────────

test("only 'ended' is terminal; every live/awaiting/interrupted phase is non-terminal", () => {
  assert.equal(isTerminalPhase("ended"), true);
  for (const p of ["launching", "running", "awaiting_permission", "awaiting_inbound", "interrupted"]) {
    assert.equal(isTerminalPhase(p), false, `${p} must be non-terminal`);
  }
});

test("reloadDisposition: terminal -> ignore; anything live/crashed -> resume", () => {
  assert.equal(reloadDisposition("ended"), "ignore");
  for (const p of ["launching", "running", "awaiting_permission", "awaiting_inbound", "interrupted"]) {
    assert.equal(reloadDisposition(p), "resume", `${p} on restart -> resume affordance`);
  }
});

// ── durableSessionRecord (the leak guard) ───────────────────────────────────────

test("durableSessionRecord whitelists exactly the durable fields", () => {
  const rec = durableSessionRecord({
    key: "c1:t1",
    sessionId: "s1",
    sdkSessionId: "sdk1",
    channelId: "c1",
    taskId: "t1",
    workspaceId: "w1",
    side: "responder",
    profile: "full",
    mode: "interactive",
    phase: "running",
    startedAt: 123,
    counterpartyId: "u2", // FIX L1: the task's other party, persisted for resume
  });
  assert.deepEqual(Object.keys(rec).sort(), [
    "channelId", "counterpartyId", "key", "mode", "phase", "profile", "sdkSessionId",
    "sessionId", "side", "startedAt", "taskId", "workspaceId",
  ]);
  assert.equal(rec.counterpartyId, "u2");
});

test("durableSessionRecord defaults counterpartyId -> null when absent", () => {
  const rec = durableSessionRecord({ key: "c1:", channelId: "c1", phase: "launching" });
  assert.equal(rec.counterpartyId, null);
});

test("durableSessionRecord drops any live handle passed in an enriched record", () => {
  const rec = durableSessionRecord({
    key: "c1:t1",
    channelId: "c1",
    phase: "running",
    // Hostile / accidental live handles that must NEVER reach electron-store:
    query: { interrupt() {} },
    win: { webContents: {} },
    pushIterator: { push() {} },
    abortController: new AbortController(),
    pendingPermissions: new Map(),
  });
  for (const leak of ["query", "win", "pushIterator", "abortController", "pendingPermissions"]) {
    assert.ok(!(leak in rec), `${leak} must not survive the durable projection`);
  }
});

test("durableSessionRecord defaults sdkSessionId->null and taskId->'' for a taskless responder", () => {
  const rec = durableSessionRecord({ key: "c1:", channelId: "c1", phase: "launching" });
  assert.equal(rec.sdkSessionId, null);
  assert.equal(rec.taskId, "");
});
