// THE BOOT PASS — main/session-boot.js › reparkDormant (F-694, 2026-09-13).
//
// THE DEFECT THIS FILE EXISTS FOR, measured on a real machine: a Dopl channel agent
// (`@agent-y1uun32v`, `phase: 'parked'`, sdk id present in the resume map, template "Coder") was
// idle when Electron was hard-restarted, and after the restart it was NOWHERE — no card in the
// Agents tab, not even an Ended one, no `agentHistory` entry, its `channel_sessions` row gone.
// `session-engine.js › init` loops the stored records and `continue`s on anything whose
// `store.reloadDisposition(rec.phase)` is not `'resume'`; a parked record's disposition is
// `'dormant'`, so it was neither RE-REGISTERED (never published, never re-projected, unwakeable —
// every wake path resolves against the in-memory registry) nor ENDED (no phase flip, no
// lifecycle, no history). The rule is TWO OUTCOMES AND NEVER A THIRD.
//
// METHOD: source extraction with injection, the `session-park.test.mjs` idiom. The
// SESSION-BOOT-PURE block references its leaf deps as free vars and takes the engine's handles
// through `bind()`; we slice it, prove it is electron/require-free, and inject.
//
// ⚠ WHAT IS REAL RATHER THAN FAKED, and each choice is about a test that could otherwise agree
// with itself:
//   `reloadDisposition` / `resumedPostSeq` / `prunableKeys`  sliced from `session-store.js`. The
//        disposition IS the bug, so a fake one would pin nothing; `prunableKeys` is the retention
//        policy the re-parked key has to survive.
//   `knownProfile` / `contextFromRecord`  sliced from `session-park.js`. They are the OTHER
//        record-driven rebuild's readers, exported for this lane precisely so there is no second
//        copy — and `knownProfile` is fail-restrictive, which a stub would quietly not be.
//   `resumeParked`  the REAL function, sliced from the same file and driven with the object
//        `session-boot.js` built. "Resumable" is not a field check: it is that the shipped resume
//        accepts this shape and rebuilds the query through `buildLaunchSpec`.
//   `pillState` / `listeningState`  the real `session-pill.js` (it requires nothing), so "published
//        as Idle" is the shipped derivation rather than this file's opinion.
//   `initialSessionState` / `floorWindowlessMessage` / `session-effects` / `tool-profiles` / the
//        runtime REGISTRY  all required for real; they load in plain node.
// FAKED: `sessionModel.normalizeModel` (it requires `diag`, i.e. electron; the frozen-enum
// coercion is `session-model.test.mjs`'s), the electron-store shells (`sessionRecords`,
// `sessionIds`, `agentHistory`), and `session-summary.touch` — counted, because registration is a
// projection move and a pill that waits for a first dispatch is the invisibility bug again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);

const BOOT_SRC = readFileSync(join(MAIN, "session-boot.js"), "utf8");
const PARK_SRC = readFileSync(join(MAIN, "session-park.js"), "utf8");
const STORE_SRC = readFileSync(join(MAIN, "session-store.js"), "utf8");

const RUNTIME = require_(join(MAIN, "runtime", "index.js"));
const PILL = require_(join(MAIN, "session-pill.js"));
const EFFECTS = require_(join(MAIN, "session-effects.js"));
const PROFILES = require_(join(MAIN, "session-profiles.js"));
const TOOL_PROFILES = require_(join(MAIN, "tool-profiles.js"));
const { initialSessionState } = require_(join(MAIN, "session-state.js"));

function slice(src, label) {
  const from = src.indexOf(`// ─── BEGIN ${label}`);
  const to = src.indexOf(`// ─── END ${label}`);
  assert.notEqual(from, -1, `BEGIN ${label} sentinel missing`);
  assert.notEqual(to, -1, `END ${label} sentinel missing`);
  assert.ok(to > from, `${label} sentinels out of order`);
  return src.slice(from, to);
}

const BOOT_BLOCK = slice(BOOT_SRC, "SESSION-BOOT-PURE");
const PARK_BLOCK = slice(PARK_SRC, "SESSION-PARK-PURE");

// The purity assertion is what makes the block sliceable at all — and it matters more here than
// almost anywhere, because this code runs BEFORE anything else in a restarted app.
for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BOOT_BLOCK.includes(banned), `SESSION-BOOT-PURE block must not reference ${banned}`);
}

// ⚠ THE EXPORTS ARE PINNED BY SOURCE SCAN, not only used. `session-boot.js` reaches
// `contextFromRecord` / `knownProfile` through `session-park.js`'s module.exports precisely so no
// third copy of either exists; dropping them from that list is a production break this file
// could otherwise slice straight past.
const PARK_EXPORTS = PARK_SRC.slice(PARK_SRC.lastIndexOf("module.exports"));
for (const name of ["contextFromRecord", "knownProfile"]) {
  assert.ok(new RegExp(`^\\s*${name},`, "m").test(PARK_EXPORTS), `session-park.js must export ${name} for session-boot.js`);
}

// The REAL store rules the boot pass turns on.
const storePure = new Function(
  `${fnOf(STORE_SRC, "isTerminalPhase")}\n${fnOf(STORE_SRC, "reloadDisposition")}\n` +
    `${fnOf(STORE_SRC, "resumedPostSeq")}\n${fnOf(STORE_SRC, "protectedRecord")}\n${fnOf(STORE_SRC, "prunableKeys")}\n` +
    `${(STORE_SRC.match(/^const RESUME_POST_SEQ_SLACK = [^\n]*$/m) || [])[0]}\n` +
    `${(STORE_SRC.match(/^const RECORD_TTL_MS = [^\n]*$/m) || [])[0]}\n` +
    `${(STORE_SRC.match(/^const MAX_RECORDS = [^\n]*$/m) || [])[0]}\n` +
    ` return { reloadDisposition, resumedPostSeq, prunableKeys };`
)();

// ...and the REAL record readers the two record-driven rebuilds share.
const parkReaders = new Function(
  `${fnOf(PARK_SRC, "knownProfile")}\n${fnOf(PARK_SRC, "contextFromRecord")}\n` +
    `${(PARK_SRC.match(/^const KNOWN_PROFILES = [^\n]*$/m) || [])[0]}\n` +
    ` return { knownProfile, contextFromRecord };`
)();

const CHANNEL = "bb0f57db-1111-4222-8333-444455556666";
const KEY = `${CHANNEL}::y1uun32v`; // ⚠ the INCIDENT's own key shape: a CHANNEL-LEVEL agent, so the thread segment is empty

/** The record `@agent-y1uun32v` left on disk, as `durableSessionRecord` would have written it. */
function parkedRecord(over = {}) {
  return {
    key: KEY,
    sessionId: "11111111-2222-3333-4444-555555555555",
    sdkSessionId: "sdk-y1uun32v",
    channelId: CHANNEL,
    taskId: "",
    workspaceId: "a5b5a013-d2dc-4387-a41b-e08b47d68e79",
    side: "responder",
    profile: "channel_agent",
    mode: "interactive",
    phase: "parked",
    startedAt: 1757000000000,
    counterpartyId: "peer-1",
    direct: false,
    bind: "pair",
    agentId: "y1uun32v",
    counterpartyName: "Samuel",
    channelName: "Dopl",
    taskTitle: null,
    templateName: "Coder",
    turns: 7,
    costUsd: 0.42,
    ownPostSeq: 3,
    model: "opus",
    runtimeId: "claude",
    ...over,
  };
}

function harness(over = {}) {
  const cfg = { records: {}, ids: {}, ...over };
  const calls = { lifecycle: [], scheduleIdle: [], history: [], touch: 0, diag: [], phase: [], consume: [], buildLaunchSpec: [] };
  const sessions = new Map();

  // The two electron-store shells, with the REAL rules spliced in.
  const store = {
    loadRecords: () => cfg.records,
    getSdkSessionId: (k) => cfg.ids[k] || null,
    setRecordPhase: (k, phase) => { calls.phase.push([k, phase]); if (cfg.records[k]) cfg.records[k].phase = phase; },
    reloadDisposition: storePure.reloadDisposition,
    resumedPostSeq: storePure.resumedPostSeq,
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && a.taskId) || ""}:${(a && a.agentId) || ""}`,
  };
  const crypto = { randomBytes: () => ({ toString: () => "cafebabe" }) };
  const diag = (...parts) => calls.diag.push(parts.join(" "));
  const sessionSummary = { touch: () => { calls.touch += 1; } };
  const agentHistory = { record: (r) => calls.history.push(r) };
  // ⚠ FAKED FOR ONE REASON ONLY (`session-model.js` requires `diag`, i.e. electron) and it still
  // RECORDS what it was handed, so "the operator's model pick survives the restart" is asserted
  // against the record rather than against a constant.
  const sessionModel = { normalizeModel: (m) => (m == null ? "default" : String(m)) };

  const boot = new Function(
    "crypto", "store", "initialSessionState", "floorWindowlessMessage", "sessionModel",
    "sessionPark", "toolProfiles", "sessionSummary", "agentHistory", "sessionEffects",
    "runtimeRegistry", "runtimeCapability", "diag",
    `${BOOT_BLOCK}\n return { bind, parkedSessionFromRecord, endInterrupted, reparkDormant };`
  )(crypto, store, initialSessionState, PROFILES.floorWindowlessMessage, sessionModel,
    parkReaders, TOOL_PROFILES, sessionSummary, agentHistory, EFFECTS,
    RUNTIME, RUNTIME.capability, diag);

  boot.bind({
    sessions,
    runLifecycle: (info, kind, extra, body) => calls.lifecycle.push({ info, kind, extra, body }),
    scheduleIdle: (s) => calls.scheduleIdle.push(s),
  });

  // The REAL `resumeParked`, so "resumable" is the shipped function accepting this shape.
  const park = new Function(
    "io", "store", "crypto", "newAgentId", "isAgentId", "Notification", "privateTurn",
    "directedTurn", "sessionWindowless", "diag", "sessionCredential", "runtimeRegistry", "runtimeCapability",
    `${PARK_BLOCK}\n return { bind, resumeParked };`
  )({ makePushIterator: () => ({ __iter: true, pushed: [], push(m) { this.pushed.push(m); }, close() { this.closed = true; } }) },
    store, crypto, () => "zzzzzzzz", () => true, null,
    require_(join(MAIN, "session-private.js")), require_(join(MAIN, "session-directed.js")),
    { MAX_CONCURRENT_SESSIONS: 15, liveCount: (m) => { let n = 0; for (const s of m.values()) if (!s.settled) n += 1; return n; } },
    diag, { ensureContainerCredential: async () => null }, RUNTIME, RUNTIME.capability);
  park.bind({
    sessions,
    acquireRuntime: async () => ({ resume: () => ({ __query: true }) }),
    buildLaunchSpec: (s) => { calls.buildLaunchSpec.push(s); return { prompt: s.pushIterator, options: { resume: s.resumeSdkId } }; },
    consume: (s, q) => calls.consume.push({ s, q }),
    dispatch: () => {},
    startSession: async () => null,
    hasLiveSession: () => false,
    emit: () => {},
  });

  return { boot, park, sessions, calls, cfg, storePure };
}

const flush = () => new Promise((r) => setImmediate(r));

// ── 1. PARKED + AN SDK ID -> re-registered, published Idle, resumable ────────────────────────

test("a parked record with an sdk id comes back as a registered PARKED session", () => {
  const rec = parkedRecord();
  const h = harness({ records: { [KEY]: rec }, ids: { [KEY]: "sdk-y1uun32v" } });

  const out = h.boot.reparkDormant();

  assert.deepEqual(out, { reparked: 1, ended: 0 });
  const s = h.sessions.get(KEY);
  assert.ok(s, "the record is re-registered under its OWN key — the third segment names WHICH agent");
  // The identity that has to survive a restart, field by field. A new sessionId or a restamped
  // startedAt would destroy the record's identity by the act of restoring it.
  assert.equal(s.sessionId, rec.sessionId);
  assert.equal(s.startedAt, rec.startedAt);
  assert.equal(s.agentId, "y1uun32v");
  assert.equal(s.channelId, CHANNEL);
  assert.equal(s.taskId, "");
  assert.equal(s.workspaceId, rec.workspaceId);
  assert.equal(s.side, "responder");
  assert.equal(s.counterpartyId, "peer-1", "L1: the feed stays bound to the stored counterparty");
  assert.equal(s.bind, "pair");
  assert.equal(s.model, "opus", "the operator's model pick survives, rather than reverting to the CLI default");
  assert.equal(s.runtimeId, "claude", "the conversation handle belongs to ONE vendor");
  assert.equal(s.context.template.name, "Coder", "F-288: a null templateName here ERASES channel_sessions.template_name");
  assert.equal(s.context.channelName, "Dopl");
  assert.equal(s.profile, "channel_agent", "the stored profile, through the fail-restrictive reader");
  // The counters: spent turns/cost for display, and the post counter with its crash slack.
  assert.equal(s.state.turns, 7);
  assert.equal(s.state.costUsd, 0.42);
  assert.equal(s.ownPostSeq, storePure_resumedPostSeq(3), "2026-08-22: a re-minted client_msg_id is silently discarded by the server");
  // Nothing live is fabricated.
  assert.equal(s.query, null);
  assert.equal(s.abortController, null);
  assert.equal(s.pushIterator, null);
  assert.equal(s.settled, false);
  // ⚠ FAIL-CLOSED, NOT A GAP: the record carries no owner and `setSelfIdentity` has not run yet.
  assert.equal(s.operatorUserId, null);
  // ⚠ NOT a spawn-idle shell: this agent has a conversation and has already been directed.
  assert.equal(s.awaitingDirective, false);
  assert.equal(s.freshFraming, false, "the SDK resume carries the original ROLE block");
});

function storePure_resumedPostSeq(n) {
  const slack = Number((STORE_SRC.match(/RESUME_POST_SEQ_SLACK = (\d+)/) || [])[1]);
  assert.ok(slack > 0, "RESUME_POST_SEQ_SLACK moved or changed shape in session-store.js");
  return n + slack;
}

test("the re-parked session is PUBLISHED as Idle, and the abandonment bound is armed", () => {
  const h = harness({ records: { [KEY]: parkedRecord() }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.reparkDormant();
  const s = h.sessions.get(KEY);

  // The shipped derivation, not this file's opinion.
  assert.equal(PILL.pillState(s.state), "idle", "the Agents tab card reads Idle");
  assert.equal(PILL.listeningState(s.state), false, "'Idle' rather than 'Waiting': a message must RELAUNCH the query");
  assert.equal(PILL.queryTornDown(s.state), true);
  assert.equal(s.state.phase, "parked");
  assert.equal(s.state.parked, true, "the reducer's wakeEffects fires resumeQuery off this flag");
  // F-236: no accept surface, so the message axis is floored or session-gate.enqueue HOLDS the
  // peer's next reply with nothing left able to release it.
  assert.equal(s.state.messageMode, PROFILES.floorWindowlessMessage("ask"));
  assert.equal(s.windowless, true);

  assert.equal(h.calls.touch, 1, "§3.3: registration is a projection move — the pill must not wait for a first dispatch");
  assert.equal(h.calls.scheduleIdle.length, 1, "an agent nobody comes back to must END on its own");
  assert.equal(h.calls.scheduleIdle[0], s);
  assert.ok(h.calls.diag.some((l) => l.includes("re-parked dormant agent") && l.includes("y1uun32v")), "the boot diag names the agent");
  // Nothing was ended and nothing was echoed.
  assert.deepEqual(h.calls.lifecycle, []);
  assert.deepEqual(h.calls.history, []);
  assert.deepEqual(h.calls.phase, []);
});

test("the re-parked session is RESUMABLE by the real resumeParked, through buildLaunchSpec", async () => {
  const h = harness({ records: { [KEY]: parkedRecord() }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.reparkDormant();
  const s = h.sessions.get(KEY);

  h.park.resumeParked(s); // what the lazy path runs on the next addressed message

  assert.ok(s.abortController instanceof AbortController, "a fresh controller, SYNCHRONOUSLY");
  assert.ok(s.pushIterator && s.pushIterator.__iter, "...and a fresh iterator, so the queued push lands on it");
  assert.equal(s.resumeSdkId, "sdk-y1uun32v", "options.resume continues the SAME conversation");
  await flush();
  assert.equal(h.calls.buildLaunchSpec.length, 1, "the v1.9 security path, never a divergent assembly");
  assert.equal(h.calls.consume.length, 1, "the consumer loop is running");
});

// ── 2. NEVER INVISIBLE: no sdk id, or a runtime that refuses -> ENDED + history ──────────────

test("a parked record with NO sdk id is ENDED with a history entry, not dropped", () => {
  const rec = parkedRecord({ sdkSessionId: null, agentId: "sp4wnidl", templateName: null });
  const key = `${CHANNEL}::sp4wnidl`;
  rec.key = key;
  const h = harness({ records: { [key]: rec }, ids: {} }); // nothing in the resume map

  const out = h.boot.reparkDormant();

  assert.deepEqual(out, { reparked: 0, ended: 1 });
  assert.equal(h.sessions.has(key), false, "an unresumable agent must not hold a slot it can never use");
  assert.deepEqual(h.calls.phase, [[key, "ended"]]);
  assert.equal(h.calls.lifecycle.length, 1);
  assert.equal(h.calls.lifecycle[0].kind, "task_failed");
  assert.deepEqual(h.calls.lifecycle[0].extra, { interrupted: true });
  assert.equal(h.calls.lifecycle[0].body, EFFECTS.terminalBody({ interrupted: true }), "a terminal says why, in the shared calm one-liner");
  assert.equal(h.calls.lifecycle[0].info.key, key);
  // ⚠ THE HISTORY ENTRY IS WHAT MAKES THE CARD EXIST — `session-summary.js` reads its ended set
  // from `agent-history.js › listEnded`. A phase flip alone is the F-694 symptom by a shorter path.
  assert.equal(h.calls.history.length, 1);
  const hist = h.calls.history[0];
  assert.equal(hist.key, key);
  assert.equal(hist.agentId, "sp4wnidl");
  assert.equal(hist.channelName, "Dopl");
  assert.ok(Number(hist.endedAt) > 0);
  assert.deepEqual(hist.entries, [], "the narration ring lived on a session object this process never had");
  assert.ok(typeof hist.diag === "string" && hist.diag.length > 0, "the card says WHY it is Ended");
  assert.equal(h.calls.touch, 1, "the ended half needs the projection refreshed too");
});

test("a parked record on a runtime that REFUSES resume is ENDED, never left Idle-and-unwakeable", () => {
  // ⚠ NOT A MADE-UP RUNTIME: the id is read back out of the REGISTRY, and the refusal is the
  // shipped `capability.js › resumeRefusal` over that adapter's own descriptor — two of the three
  // answer `'unverified'` today (smoke items C8/X4), so this is a real shipped state.
  const refusing = RUNTIME.ids().find((id) => RUNTIME.capability.resumeRefusal(RUNTIME.descriptorFor(id)));
  assert.ok(refusing, "no registered runtime refuses a resume — this case needs rewriting, not deleting");
  const rec = parkedRecord({ runtimeId: refusing });
  const h = harness({ records: { [KEY]: rec }, ids: { [KEY]: "sdk-y1uun32v" } });

  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 1 });
  assert.equal(h.sessions.has(KEY), false);
  assert.deepEqual(h.calls.phase, [[KEY, "ended"]]);
  assert.equal(h.calls.history.length, 1, "an Ended card with a readable reason is the floor");
  assert.equal(h.calls.lifecycle[0].kind, "task_failed");
});

// ── 3. NON-PARKED RECORDS ARE UNTOUCHED (the two other dispositions) ────────────────────────

test("'ended' and live-when-it-died records are left entirely to init()'s own scan", () => {
  const endedKey = `${CHANNEL}::aaaaaaaa`;
  const runningKey = `${CHANNEL}::bbbbbbbb`;
  const records = {
    [endedKey]: parkedRecord({ key: endedKey, agentId: "aaaaaaaa", phase: "ended" }),
    [runningKey]: parkedRecord({ key: runningKey, agentId: "bbbbbbbb", phase: "awaiting_inbound" }),
  };
  const h = harness({ records, ids: { [endedKey]: "sdk-a", [runningKey]: "sdk-b" } });

  // The dispositions under test are the SHIPPED ones, asserted here so this case cannot pass
  // against a record shape that stopped meaning what it means.
  assert.equal(storePure.reloadDisposition("ended"), "ignore");
  assert.equal(storePure.reloadDisposition("awaiting_inbound"), "resume");

  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 0 });
  assert.equal(h.sessions.size, 0, "nothing is registered");
  assert.deepEqual(h.calls.phase, [], "the interrupted echo + phase flip belong to init()'s loop, and would DOUBLE here");
  assert.deepEqual(h.calls.lifecycle, []);
  assert.deepEqual(h.calls.history, []);
  assert.equal(h.calls.touch, 0, "nothing moved, so nothing is published");
});

test("a session already live on this key is never overwritten", () => {
  const h = harness({ records: { [KEY]: parkedRecord() }, ids: { [KEY]: "sdk-y1uun32v" } });
  const live = { key: KEY, settled: false, __theRealOne: true };
  h.sessions.set(KEY, live);

  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 0 });
  assert.equal(h.sessions.get(KEY), live, "replacing the Map entry orphans a live query");
});

// ── 4. THE PRUNE KEEPS THE RE-PARKED KEY ─────────────────────────────────────────────────────

test("pruneRecords' REAL policy keeps a re-parked key, even one older than the TTL", () => {
  // ⚠ ANCIENT ON PURPOSE. `init()` runs the re-park BEFORE the prune, and the prune's `keep` is
  // the live registry's key set — so an agent parked longer than RECORD_TTL_MS must be protected
  // by having been re-parked, not by luck of its timestamp.
  const rec = parkedRecord({ startedAt: 1 });
  const h = harness({ records: { [KEY]: rec }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.reparkDormant();

  const drop = h.storePure.prunableKeys(h.cfg.records, {
    now: Date.now(),
    keep: new Set(h.sessions.keys()), // exactly what session-engine.js › init hands it
    hasSdkId: (k) => !!h.cfg.ids[k],
  });
  assert.deepEqual(drop, [], "the re-parked record survives the sweep that runs right behind it");

  // ...and the same record is prunable when it was NOT re-parked and nothing retains it, so the
  // assertion above is about the protection rather than about a policy that drops nothing.
  const drop2 = h.storePure.prunableKeys({ [KEY]: { ...rec, phase: "ended" } }, {
    now: Date.now(), keep: new Set(), hasSdkId: () => false,
  });
  assert.deepEqual(drop2, [KEY]);
});
