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

const { sessionKey, isTerminalPhase, reloadDisposition, durableName, durableSessionRecord } = new Function(
  `${BLOCK}
   return { sessionKey, isTerminalPhase, reloadDisposition, durableName, durableSessionRecord };`
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

test("reloadDisposition: terminal -> ignore; parked -> dormant; else -> resume", () => {
  assert.equal(reloadDisposition("ended"), "ignore");
  // P1 (v1.7.4): a parked record is EXEMPT from the interrupted echo — the init scan
  // must NOT treat it as 'resume' (which would post task_failed{interrupted:true}); it
  // stays dormant + resumable via P2.
  assert.equal(reloadDisposition("parked"), "dormant");
  assert.notEqual(reloadDisposition("parked"), "resume", "parked never echoes interrupted");
  assert.equal(isTerminalPhase("parked"), false, "parked is not terminal (it is resumable)");
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
    direct: true, // H2: whether the server addresses this session's posts (a DM), persisted with the binding
    counterpartyName: "David", // D1: the header identity, persisted for a reopen
    channelName: "Ops",
    taskTitle: "Ship the invoice import",
    turns: 7, // FIX #9: the running cap counters, persisted for a P2 rehydrate
    costUsd: 0.42,
  });
  assert.deepEqual(Object.keys(rec).sort(), [
    // "model" (2026-08-02) is the operator's per-session model pick. It is on this list rather
    // than left off it because a P2 recreate that silently reverted to the CLI default while the
    // picker still claimed the pick is exactly the defect class this whitelist exists to kill.
    "agentId", "bind", "channelId", "channelName", "costUsd", "counterpartyId",
    "counterpartyName", "direct", "key", "mode", "model", "phase", "profile", "sdkSessionId",
    "sessionId", "side", "startedAt", "taskId", "taskTitle", "turns", "workspaceId",
  ]);
  // ...and it defaults to the CLI's own pick, because the input above never named a model.
  assert.equal(rec.model, "default");
  assert.equal(rec.counterpartyId, "u2");
  assert.equal(rec.direct, true);
  // H2 fail-quiet: a hand-edited store can only ever turn this OFF, which understates the
  // destination on the reopened shell's approval card. It can never invent an addressee.
  for (const junk of [undefined, null, "true", 1, {}]) {
    assert.equal(durableSessionRecord({ direct: junk }).direct, false, JSON.stringify(junk));
  }
});

// ── D1: the header identity survives to a reopen ────────────────────────────────

test("durableSessionRecord persists the header identity (D1) so a reopen can rebuild it", () => {
  const rec = durableSessionRecord({
    key: "c1:t1", channelId: "c1", phase: "parked",
    counterpartyName: "David", channelName: "Ops", taskTitle: "Ship the invoice import",
  });
  assert.equal(rec.counterpartyName, "David", "the peer display name survives");
  assert.equal(rec.channelName, "Ops");
  assert.equal(rec.taskTitle, "Ship the invoice import");
  // A legacy record written before v1.7.5 has none of them — null, never undefined.
  const legacy = durableSessionRecord({ key: "c1:", channelId: "c1", phase: "launching" });
  assert.equal(legacy.counterpartyName, null);
  assert.equal(legacy.channelName, null);
  assert.equal(legacy.taskTitle, null);
});

test("durableName bounds an identity string exactly like prompt-framing.sanitizeName", () => {
  assert.equal(durableName("  David  "), "David");
  assert.equal(durableName("David\nSmith\tJr"), "David Smith Jr", "collapsed to ONE line");
  assert.equal(durableName("A".repeat(200)).length, 80, "capped at 80 chars");
  // Nothing usable -> null, so the renderer falls through to the next identity down.
  for (const empty of ["", "   ", "\n\t", null, undefined, 42, {}, []]) {
    assert.equal(durableName(empty), null, `${JSON.stringify(empty)} -> null`);
  }
});

test("durableSessionRecord persists the cap counters (FIX #9) and coerces bad values to 0", () => {
  const rec = durableSessionRecord({ key: "c1:t1", channelId: "c1", phase: "parked", turns: 24, costUsd: 1.5 });
  assert.equal(rec.turns, 24, "the running turn count survives so a P2 recreate does not reset the budget");
  assert.equal(rec.costUsd, 1.5, "the running cost survives for the cost cap");
  // A hand-edited store (or a legacy record missing the fields) can never inject NaN.
  const legacy = durableSessionRecord({ key: "c1:", channelId: "c1", phase: "launching" });
  assert.equal(legacy.turns, 0);
  assert.equal(legacy.costUsd, 0);
  const bad = durableSessionRecord({ key: "c1:", channelId: "c1", phase: "parked", turns: "x", costUsd: NaN });
  assert.equal(bad.turns, 0);
  assert.equal(bad.costUsd, 0);
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
