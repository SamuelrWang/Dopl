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
import { fnOf } from "./helpers/source-probe.mjs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-store.js"), "utf8");
// ⚠ REQUIRED, NOT SLICED: `session-runtime-truth.js` requires nothing (no electron, no store), so
// `saveRecord`'s U10 whitelist is driven against the shipped module rather than a lookalike.
const RUNTIME_TRUTH = createRequire(import.meta.url)(join(HERE, "..", "main", "session-runtime-truth.js"));

const BEGIN = "// ─── BEGIN SESSION-STORE-PURE";
const END = "// ─── END SESSION-STORE-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-STORE-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-STORE-PURE sentinel missing");
assert.ok(to > from, "session-store sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { sessionKey, slotKey, threadKeyPrefix, isTerminalPhase, reloadDisposition, durableName, durableSessionRecord } = new Function(
  `${BLOCK}
   return { sessionKey, slotKey, threadKeyPrefix, isTerminalPhase, reloadDisposition, durableName, durableSessionRecord };`
)();

// ── sessionKey ───────────────────────────────────────────────────────────────

// ⚠ THE KEY GAINED A THIRD SEGMENT ON 2026-08-21 (Samuel's multiplayer ruling). It was
// `(channel, thread)` and that pair WAS the de-dupe — one session per thread. An operator may
// now run several agents on one thread, so only (channel, thread, AGENT INSTANCE) identifies a
// session. The empty-middle form is the CHANNEL-LEVEL agent (`<channelId>::<agentId>`); the
// empty-tail form is a mid-wave caller, well-formed but never produced by a real spawn.
test("sessionKey is a stable (channel, thread, agent) identity; missing parts collapse to ''", () => {
  assert.equal(sessionKey("c1", "t1", "a1b2c3d4"), "c1:t1:a1b2c3d4");
  assert.equal(sessionKey("c1", "", "a1b2c3d4"), "c1::a1b2c3d4", "a CHANNEL-LEVEL agent");
  assert.equal(sessionKey("c1", "t1"), "c1:t1:");
  assert.equal(sessionKey("c1", null, null), "c1::");
  assert.equal(sessionKey("c1", undefined, undefined), "c1::");
  // ⚠ THE THREE AXES ARE INDEPENDENT — that is the whole point of the third segment.
  assert.notEqual(sessionKey("c1", "t1", "a1b2c3d4"), sessionKey("c1", "t2", "a1b2c3d4"));
  assert.notEqual(sessionKey("c1", "t1", "a1b2c3d4"), sessionKey("c1", "t1", "z9y8x7w6"));
  assert.notEqual(sessionKey("c1", "", "a1b2c3d4"), sessionKey("c2", "", "a1b2c3d4"));
  assert.equal(sessionKey("c1"), sessionKey("c1", "", ""));
});

// ⚠ THE TRAILING COLON IS LOAD-BEARING. Without it `<channel>:<thread>` would also prefix a
// NEIGHBOURING thread whose id merely starts with the same characters, and the registry scans
// that find "every agent on this thread" would claim sessions from it.
test("threadKeyPrefix matches every agent on ONE thread and nothing next door", () => {
  const prefix = threadKeyPrefix("c1", "t1");
  assert.equal(prefix, "c1:t1:");
  assert.ok(sessionKey("c1", "t1", "a1b2c3d4").startsWith(prefix));
  assert.ok(sessionKey("c1", "t1", "z9y8x7w6").startsWith(prefix));
  assert.ok(!sessionKey("c1", "t10", "a1b2c3d4").startsWith(prefix), "t10 is not t1");
  assert.ok(!sessionKey("c2", "t1", "a1b2c3d4").startsWith(prefix), "another channel");
  // The CHANNEL-LEVEL scope is its own prefix and never catches a threaded agent.
  assert.equal(threadKeyPrefix("c1", ""), "c1::");
  assert.ok(sessionKey("c1", "", "a1b2c3d4").startsWith(threadKeyPrefix("c1", "")));
  assert.ok(!sessionKey("c1", "t1", "a1b2c3d4").startsWith(threadKeyPrefix("c1", "")));
});

test("slotKey composes the same three parts from a call's own argument object", () => {
  assert.equal(slotKey({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }), "c1:t1:a1b2c3d4");
  assert.equal(slotKey({ channelId: "c1", agentId: "a1b2c3d4" }), "c1::a1b2c3d4");
  assert.equal(slotKey({}), "::");
  assert.equal(slotKey(null), "::");
  // ⚠ `agentId` NO LONGER REPLACES `taskId`. The old rule was a CHOICE between two key spaces
  // (pair vs room), "never blended"; multiplayer needs exactly what that forbade — two agents
  // told apart on the SAME thread.
  assert.notEqual(
    slotKey({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4" }),
    slotKey({ channelId: "c1", taskId: "", agentId: "a1b2c3d4" })
  );
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
    identityName: "Code Auditor", // F-288: the agent's IDENTITY identity, persisted for a resume
    turns: 7, // FIX #9: the running counter, persisted for a P2 rehydrate
    costUsd: 0.42, // ⚠ DELETED 2026-09-22 — still handed IN here, to prove the whitelist drops it
    ownPostSeq: 11, // 2026-08-22: the outbound post counter, persisted for the SAME resume
    runtimeId: "codex", // 2026-08-31: WHICH RUNTIME this session ran on — see the note below
  });
  assert.deepEqual(Object.keys(rec).sort(), [
    // "model" (2026-08-02) is the operator's per-session model pick. It is on this list rather
    // than left off it because a P2 recreate that silently reverted to the CLI default while the
    // picker still claimed the pick is exactly the defect class this whitelist exists to kill.
    // "ownPostSeq" (2026-08-22) is on it for the sharper version of the same argument: the agent
    // id is persisted and RE-USED by a resume, so a counter that reset re-minted client_msg_ids
    // the server already held and its idempotency short-circuit swallowed the resumed agent's
    // replies — a silent data loss, not a cosmetic revert.
    // "identityName" (2026-08-23, F-288) is the third of that family and the same argument again:
    // `context.identity` lives only on the live session object, so a CRASH RESUME rebuilt the
    // context without it, reported `identityName: null`, and — because `identityName` is in
    // `session-telemetry.js › STATE_FIELDS` and so bypasses the cadence floor — ERASED
    // `channel_sessions.identity_name` on the next push, under a still-running agent.
    // "runtimeId" (2026-08-31, the runtime-adapter port) is the FOURTH of that family and has
    // the sharpest version of the argument yet: `session-park.js › startResume` rebuilds the whole
    // session from this record and hands the persisted `sdkSessionId` to whatever runtime it
    // acquires — so a record without it resumed onto the DEFAULT adapter, which would be asked to
    // continue ANOTHER PLATFORM's conversation id, in another platform's tool vocabulary, against
    // another credential. Not a cosmetic revert and not silent data loss: a broken resume.
    // "turnCap" (2026-09-05, task 9a) was the FIFTH and is DELETED FROM THIS LIST (2026-09-07,
    // Samuel's ruling) with the cap itself. It joined because the default had become issuer-keyed
    // and a recreate does not resurrect `launchDepth`, so a 200-turn session that crashed at turn
    // 80 would have resumed capped at 24. Nothing bounds turns now, so persisting the bound would
    // be persisting a number with no reader — and this list is exactly where such a field goes
    // unnoticed. Its ABSENCE is pinned here rather than merely untested.
    // "parkedAt" (2026-09-13) is the SIXTH of the family and the argument is a REGRESSION that
    // shipped: `session-boot.js › reparkDormant` revives a dormant record only if it was parked
    // inside `REPARK_WINDOW_MS`, and without this field the only clock on the record is
    // `startedAt` — which answers a different question, so a 46-day-old agent parked this morning
    // would be ended and a months-dead one whose start happened to be recent would be revived.
    // "launchDepth" / "launchChain" (2026-09-18, Samuel's ruling) are the SEVENTH of the family
    // and the only pair that REVERSED a rule to get here. They were deliberately omitted — *a
    // recreate cannot verify what it did not see* — and that held until parked agents began
    // surviving a restart: a record-driven rebuild has nothing BUT this record, so an
    // operator-launched orchestrator woke at `launchDepth: undefined`, which the gate reads as
    // the CAP, and was denied `launch-depth-capped` for the rest of its life. ⚠ THE OMISSION IS
    // STILL THE DEFAULT for a record written by an OLDER build — neither key is there, absent is
    // the cap, and nothing migrates it.
    // 🔒 ⚠ **`costUsd` WAS ON THIS LIST AND IS DELETED (2026-09-22, Samuel: *"there shouldnt be
    // cost? Claude theres no cost tracking. we dont need cost tracking"*).** The input above
    // still HANDS ONE IN, deliberately: this is a WHITELIST, so its absence from the expected
    // keys is the proof that a record written by an older build drops the field on read rather
    // than carrying it forward — the same treatment `turnCap` got when the caps went.
    "agentId", "bind", "channelId", "channelName", "counterpartyId",
    "counterpartyName", "direct", "identityName", "key", "launchChain", "launchDepth", "mode", "model",
    "ownPostSeq", "parkedAt", "phase", "profile", "runtimeId", "sdkSessionId", "sessionId",
    "side", "startedAt", "taskId", "taskTitle", "turns", "workspaceId",
  ]);
  // ⚠ A PASSTHROUGH, AND **NULL IS OLD** — `durableSessionRecord` is in the PURE block and may not
  // read a clock; `saveRecord` / `setRecordPhase` stamp it at the two park writes.
  assert.equal(rec.parkedAt, null, "a RUNNING record was never parked, so it carries no park stamp");
  assert.equal(durableSessionRecord({ parkedAt: 1757900000000 }).parkedAt, 1757900000000);
  for (const junk of [undefined, null, 0, -1, "x", NaN, {}]) {
    assert.equal(durableSessionRecord({ parkedAt: junk }).parkedAt, null,
      `a park stamp of ${JSON.stringify(junk)} must read as UNSTAMPED, which reparkDormant treats as OLD`);
  }
  assert.equal("turnCap" in durableSessionRecord({ turnCap: 200 }), false,
    "a record written by an OLDER build carries a cap; the whitelist must drop it, not carry it");
  assert.equal(rec.ownPostSeq, 11);
  assert.equal(rec.identityName, "Code Auditor");
  // ⚠ AT THE COLUMN'S OWN 120, NOT `durableName`'s 80 DISPLAY DEFAULT (F-287): an identity name is
  // an IDENTITY, and persisting a clipped one would resume reporting a name no identity has.
  assert.equal(durableSessionRecord({ identityName: "N".repeat(200) }).identityName.length, 120);
  assert.equal(durableSessionRecord({ channelName: "C".repeat(200) }).channelName.length, 80,
    "…and a DISPLAY string keeps the display default");
  for (const junk of [undefined, null, "", "   ", 7, {}]) {
    assert.equal(durableSessionRecord({ identityName: junk }).identityName, null, JSON.stringify(junk));
  }
  // Same NaN discipline as `turns`: a hand-edited store lands on 0, never NaN.
  for (const junk of [undefined, null, "x", NaN, {}, -1 / 0]) {
    assert.equal(durableSessionRecord({ ownPostSeq: junk }).ownPostSeq, 0, JSON.stringify(junk));
  }
  // ...and it is NO PICK ('' — the product fallback at launch), because the input above never
  // named a model. ⚠ 2026-09-22: it was the literal 'default' while the whitelist was the frozen
  // five-alias enum; it is a grammar now (`session-store.js`), and absent is ''.
  assert.equal(rec.model, "");
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

test("durableSessionRecord persists the turn counter (FIX #9) and coerces bad values to 0", () => {
  const rec = durableSessionRecord({ key: "c1:t1", channelId: "c1", phase: "parked", turns: 24, costUsd: 1.5 });
  assert.equal(rec.turns, 24, "the running turn count survives so a P2 recreate does not reset it");
  assert.equal(rec.costUsd, undefined, "…and the COST counter beside it is deleted, not zeroed");
  // A hand-edited store (or a legacy record missing the field) can never inject NaN.
  const legacy = durableSessionRecord({ key: "c1:", channelId: "c1", phase: "launching" });
  assert.equal(legacy.turns, 0);
  const bad = durableSessionRecord({ key: "c1:", channelId: "c1", phase: "parked", turns: "x" });
  assert.equal(bad.turns, 0);
});

// 🔒 "…and the CAP those counters are measured against (9a)" STOOD HERE AND IS DELETED
// (2026-09-07, Samuel's ruling). It pinned `turnCap` as a DURABLE field — persisted because the
// default was issuer-keyed and a recreate carries no issuer, coerced harder than `turns` so
// a hand-edited store could not hand a session `Infinity` (no bound at all). The caps are gone,
// the field is off the state and off the record, and the whitelist case above now pins its
// ABSENCE. `turns` is still durable — a reopened session must show what it has already run — and
// the case above it still owns the coercion. ⚠ `costUsd` JOINED `turnCap` IN THAT DELETED SET on
// 2026-09-22, for a different reason: not "nothing enforces it" but "nothing reads it at all".

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

// ── THE PARK STAMP (2026-09-13, F-694's REGRESSION) ──────────────────────────
//
// `session-boot.js › reparkDormant` revives a dormant record ONLY if it was parked inside
// `REPARK_WINDOW_MS`, so the window is only as true as this write. The two functions that make it
// are IMPURE (they hold the electron-store handle), so they are source-extracted and driven against
// a fake store — the `main-audit-record-prune.test.mjs` idiom, one layer out.
//
// ⚠ WHY BOTH WRITES ARE COVERED RATHER THAN "the park path". There are TWO ways a record ends up
// parked on disk — `session-engine.js`'s `persist` effect saves the FULL record (FIX #9) and
// `session-auth.js`'s sign-out park flips the phase alone — and a stamp on one of them leaves the
// other's agents looking dormant-since-`startedAt`, i.e. silently unrevivable.
const storeWrites = (() => {
  const fake = { data: {} };
  const api = new Function(
    "store", "RECORDS_KEY", "durableSessionRecord", "runtimeTruth",
    `${fnOf(SRC, "stampParked")}\n${fnOf(SRC, "loadRecords")}\n${fnOf(SRC, "saveRecord")}\n${fnOf(SRC, "setRecordPhase")}\n` +
      ` return { saveRecord, setRecordPhase, stampParked };`
  )(
    { get: (k) => fake.data[k], set: (k, v) => { fake.data[k] = v; } },
    "sessionRecords",
    durableSessionRecord,
    // ⚠ THE REAL U10 WHITELIST (2026-09-21), required rather than faked: `session-runtime-truth.js`
    // requires nothing, so a plain require works here, and what `saveRecord` has to be driven
    // against is the SHIPPED coercion — a fake would let a widened whitelist pass unnoticed.
    RUNTIME_TRUTH
  );
  return { ...api, fake };
})();

test("saveRecord stamps parkedAt when the phase it persists is 'parked' — and only then", () => {
  const { saveRecord, fake } = storeWrites;
  fake.data = {};
  const base = { key: "c1:t1:a1", channelId: "c1", taskId: "t1", workspaceId: "w1", startedAt: 1 };

  const before = Date.now();
  saveRecord({ ...base, phase: "parked" });
  const stamped = fake.data.sessionRecords["c1:t1:a1"].parkedAt;
  assert.ok(stamped >= before && stamped <= Date.now(), `parkedAt must be the park's own clock, got ${stamped}`);

  // ⚠ A RUNNING SAVE MUST NOT STAMP. `session-io.js` re-saves a LIVE record, and a stamp there
  // would make "when was this parked" mean "when was it last touched" — the window would then keep
  // reviving an agent that was busy yesterday and parked six weeks ago.
  saveRecord({ ...base, key: "c1:t1:a2", phase: "running" });
  assert.equal(fake.data.sessionRecords["c1:t1:a2"].parkedAt, null);
});

test("setRecordPhase stamps parkedAt on a park, and leaves it alone on every other flip", () => {
  const { setRecordPhase, fake } = storeWrites;
  fake.data = { sessionRecords: { k1: { key: "k1", phase: "running", startedAt: 1, parkedAt: null } } };

  setRecordPhase("k1", "parked"); // session-auth.js's sign-out park
  const at = fake.data.sessionRecords.k1.parkedAt;
  assert.ok(at > 0, "the sign-out park is a park");

  setRecordPhase("k1", "ended"); // the interrupted-end route, later
  assert.equal(fake.data.sessionRecords.k1.phase, "ended");
  assert.equal(fake.data.sessionRecords.k1.parkedAt, at, "ending a record must not restamp when it was parked");

  setRecordPhase("missing", "parked"); // an unknown key is a no-op, not a new row
  assert.equal("missing" in fake.data.sessionRecords, false);
});
