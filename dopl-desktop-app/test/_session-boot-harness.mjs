// THE BOOT-PASS HARNESS — the rig `test/session-boot-repark.test.mjs` (and anything after it)
// drives `main/session-boot.js › reparkDormant` on.
//
// ⚠ ITS OWN FILE SINCE 2026-09-14, AND THE SEAM IS §1's — the same one `_session-state-push-harness.mjs`
// and `_session-summary-harness.mjs` already take. The cases file stood at 498 of the 500-line cap the
// day it shipped, i.e. with room for no case at all; a rig and the cases it serves change for different
// reasons, and the rig is the half a second suite would otherwise copy.
//
// THE DEFECT THE CASES EXIST FOR, measured on a real machine: a Dopl channel agent
// (`@agent-y1uun32v`, `phase: 'parked'`, sdk id present in the resume map, identity "Coder") was
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

// Every free var the block is handed below must be a name the module itself binds above its
// sentinel. Injecting one it never declares is how a ReferenceError shipped green (P4-01).
const BOOT_INJECTED = [
  "crypto", "store", "initialSessionState", "floorWindowlessMessage",
  "sessionPark", "sessionSummary", "agentHistory", "sessionEffects",
  "runtimeRegistry", "runtimeCapability", "runtimeTruth", "diag",
];
const BOOT_HEADER = BOOT_SRC.slice(0, BOOT_SRC.indexOf("// ─── BEGIN SESSION-BOOT-PURE"));
for (const name of BOOT_INJECTED) {
  assert.match(BOOT_HEADER, new RegExp(`^const (${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})`, "m"),
    `session-boot.js must bind ${name} above SESSION-BOOT-PURE — the harness may inject only what the module declares`);
}

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
    identityName: "Coder",
    turns: 7,
    costUsd: 0.42,
    ownPostSeq: 3,
    model: "opus",
    runtimeId: "claude",
    // ⚠ PARKED JUST NOW, AND THAT IS LOAD-BEARING SINCE 2026-09-13. `reparkDormant` revives only a
    // record inside `REPARK_WINDOW_MS`; the incident's own `startedAt` above is a YEAR old, so
    // without this stamp every "comes back as Idle" case below would be asserting the ENDED lane by
    // accident. The window cases pass their own `parkedAt`.
    parkedAt: Date.now(),
    ...over,
  };
}

function harness(over = {}) {
  const cfg = { records: {}, ids: {}, ...over };
  // `startSession` records its SPEC (2026-09-18): `startResume` is the OTHER record-driven rebuild,
  // and what a launch-depth round-trip has to assert is the spec it hands the construction site.
  const calls = { lifecycle: [], scheduleIdle: [], history: [], touch: 0, diag: [], phase: [], consume: [], buildLaunchSpec: [], startSession: [] };
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
  // ⚠ `cfg.throwHistoryFor` IS A SEAM AND NOT A CONVENIENCE: the one thing a boot pass must not do
  // is stop half way, and the only honest way to drive that is to make ONE record's write fail.
  const agentHistory = {
    record: (r) => {
      if (cfg.throwHistoryFor && cfg.throwHistoryFor === r.key) throw new Error('history disk full');
      calls.history.push(r);
    },
  };
  const boot = new Function(
    ...BOOT_INJECTED,
    `${BOOT_BLOCK}\n return { bind, parkedSessionFromRecord, endInterrupted, reparkDormant, withinReparkWindow, REPARK_WINDOW_MS };`
  )(crypto, store, initialSessionState, PROFILES.floorWindowlessMessage,
    parkReaders, sessionSummary, agentHistory, EFFECTS,
    // ⚠ THE REAL `session-runtime-truth.js` (2026-09-21, U10), REQUIRED rather than faked: it
    // requires nothing at all, so a plain require works, and what `parkedSessionFromRecord` has
    // to assert is that the SHIPPED coercion is what a restored record lands on.
    RUNTIME, RUNTIME.capability, require_(join(MAIN, "session-runtime-truth.js")), diag);

  boot.bind({
    sessions,
    runLifecycle: (info, kind, extra, body) => calls.lifecycle.push({ info, kind, extra, body }),
    scheduleIdle: (s) => calls.scheduleIdle.push(s),
  });

  // The REAL `resumeParked`, so "resumable" is the shipped function accepting this shape.
  const park = new Function(
    "io", "store", "crypto", "newAgentId", "isAgentId", "Notification", "privateTurn",
    "directedTurn", "sessionWindowless", "diag", "sessionCredential", "runtimeRegistry", "runtimeCapability",
    `${PARK_BLOCK}\n return { bind, resumeParked, startResume };`
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
    startSession: async (spec) => { calls.startSession.push(spec); return null; },
    hasLiveSession: () => false,
    emit: () => {},
  });

  return { boot, park, sessions, calls, cfg, storePure };
}

export const flush = () => new Promise((r) => setImmediate(r));
export { assert, test, harness, parkedRecord, slice, CHANNEL, KEY, storePure, parkReaders };
export { BOOT_SRC, PARK_SRC, STORE_SRC, BOOT_BLOCK, PARK_BLOCK };
export { RUNTIME, PILL, EFFECTS, PROFILES, TOOL_PROFILES, initialSessionState, MAIN, require_ };
