// SHARED HARNESS for the `main/session-summary.js` suites (F-147), split out at the 500-line cap so
// the suites share ONE loader instead of drifting into two copies.
//
// THE IDIOM. `main/session-summary.js`'s requires sit ABOVE its BEGIN sentinel, so everything from
// there to `module.exports` is import-free and can be evaluated verbatim with fakes — no window
// layer, no file log, no Electron. Every dependency is injected REAL from its REAL module: these
// cases are about THIS module's projection, not about re-testing the tables it reads.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "main");
export const SRC = readFileSync(join(MAIN, "session-summary.js"), "utf8");
const req = createRequire(import.meta.url);
// The metrics moved out 2026-08-20 (`session-metrics.js`) — one file, one reason to change.
// Injected REAL, like every dependency here.
const { metricOrNull, metrics } = req(join(MAIN, "session-metrics.js"));
// The `detail` signal, joined 2026-08-20. Injected REAL; `session-detail.test.mjs` owns the table
// that derives it, and a stub here would let the two drift.
const { noteEvent, detailFor, endReasonFor } = req(join(MAIN, "session-detail.js")); // ⚠ `endReasonFor` joined 2026-09-21 (U10): the structured end code, re-said in the OWNING runtime's words. Injected REAL like its two neighbours — `session-detail.test.mjs` owns the mapping, this file owns the projection
// THE NAME STORE IS STUBBED, NOT LOADED (2026-08-25): `main/agent-names.js` opens an electron-store
// on require. The stub answers null (nobody renamed this agent); a test that wants a name overrides
// `names.value`.
export const names = { value: null, description: null };
const displayNameFor = () => names.value;
// The second field off the same store (2026-08-27), stubbed for the same reason. Override
// `names.description`.
const descriptionForAgent = () => names.description;
// The state mapping moved out 2026-08-22 (`main/session-pill.js`). Injected REAL and MERGED into
// the returned api below, so `m.pillState` / `m.PILL_STATES` / `m.listeningState` still resolve.
const pill = req(join(MAIN, "session-pill.js"));
const { PILL_STATES, ACTIVITY_PILL, PILL_ENDED, pillState, queryTornDown, listeningState } = pill;
// `displayText` / `IDENTITY_NAME_MAX` moved out 2026-09-13 (`main/session-summary-text.js`), and
// left `EXPORTED` in the same change — that list is a NAME LIST for a `new Function` return, so a
// name the block no longer declares is a ReferenceError at LOAD.
const summaryText = req(join(MAIN, "session-summary-text.js"));
const { displayText, IDENTITY_NAME_MAX } = summaryText;
// The held-gate projection (2026-09-17). Injected REAL; safe to `req` because that module takes NO
// requires of its own, so it cannot drag an `electron-store` into this loader.
const { heldGatesFor } = req(join(MAIN, "session-held-gates.js"));
// RC-15's one spelling of "no model pick". Injected REAL; the module requires nothing.
const { pickOf } = req(join(MAIN, "runtime", "selection-vocabulary.js"));

const BEGIN = "// ─── BEGIN SESSION-SUMMARY-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf("module.exports = {");
assert.notEqual(from, -1, "BEGIN SESSION-SUMMARY-PURE sentinel missing");
assert.ok(to > from, "module.exports not found after the sentinel");
const BLOCK = SRC.slice(from, to);

// The purity assertion IS a test — it is what makes "this module reaches no network" a fact rather
// than a docblock. `fetch(` is the one that matters now.
for (const banned of ["require(", "electron", "child_process", "@anthropic", "fetch("]) {
  assert.ok(!BLOCK.includes(banned), `the extracted block must not reference ${banned}`);
}

// A NAME LIST for a `new Function` return: a name the block no longer declares is a ReferenceError
// at LOAD — every case in all four suites, not one. Every entry must be a real declaration in the
// block; there is no such thing as a "mostly right" one.
const EXPORTED = [
  "liveSummary", "endedSummary",
  "nameOf", "summariesDigest", "SESSIONS_EVENT", "PUSH_COALESCE_MS",
  // `MAX_ENDED` / `sweepEnded` left this list 2026-08-22: retained ended cards are read from the
  // DURABLE history (`agent-history.js`), bounded by SEVEN DAYS from `endedAt` and surviving a
  // restart. `retainedEnded` is the reader; `releaseEnded` is the sweep's cleaner.
  "retainedEnded", "releaseEnded",
  "bind", "start", "list", "nameForSession", "noteEnded", "noteActivity", "touch",
  // F-147: the report view and the change subscription the server writer rides.
  "reportEntry", "wireSummary", "reportList", "subscribe",
];

/** A fresh, isolated copy of the module (its ledger and ended set are module state, so
 *  every case gets its own). `sent` collects the frames that reached the fake window. */
export function load() {
  const sent = [];
  const logged = [];
  const api = new Function(
    "metricOrNull",
    "metrics",
    "noteEvent",
    "detailFor",
    "endReasonFor",
    "displayNameFor",
    "descriptionForAgent",
    "displayText",
    "IDENTITY_NAME_MAX",
    "heldGatesFor",
    "PILL_STATES",
    "ACTIVITY_PILL",
    "PILL_ENDED",
    "pillState",
    "queryTornDown",
    "listeningState",
    "diag",
    "pickOf",
    `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
  )(
    metricOrNull, metrics, noteEvent, detailFor, endReasonFor, displayNameFor, descriptionForAgent,
    displayText, IDENTITY_NAME_MAX, heldGatesFor,
    PILL_STATES, ACTIVITY_PILL, PILL_ENDED, pillState, queryTornDown, listeningState,
    (...parts) => logged.push(parts.join(" ")),
    pickOf
  );
  const spaWindow = {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    webContents: {
      destroyed: false,
      isDestroyed() { return this.destroyed; },
      send(channel, payload) { sent.push({ channel, payload }); },
    },
  };
  // The mapping's names are merged in, not re-declared, which is what keeps the split invisible.
  return { ...pill, ...summaryText, ...api, sent, logged, spaWindow };
}

/**
 * A window handle shaped like a BrowserWindow, as the engine USED to hand one over.
 *
 * Still here because `noteEnded` / `sweepEnded` still read `s.win` (2026-08-20, F-228): a windowless
 * session's `win` is null, so the retention predicate can no longer be satisfied by anything the
 * ENGINE produces — but it is live source and the cases still drive it (INVARIANTS §14). The stale
 * predicate is a FINDING, not something to paper over: see §4 of session-summary.test.mjs.
 */
export function fakeWindow() {
  return {
    destroyed: false,
    shown: 0,
    focused: 0,
    isDestroyed() { return this.destroyed; },
    show() { this.shown += 1; },
    focus() { this.focused += 1; },
  };
}

/**
 * ONE RETAINED ENDED RECORD, as `agent-history.js › listEnded` hands them over (2026-08-22). It is a
 * RECORD, not a session: no state, no query, nothing resumable.
 */
export function endedRecord(over = {}) {
  const channelId = over.channelId || "chan-1";
  const taskId = over.taskId === undefined ? "task-1" : over.taskId;
  const agentId = over.agentId === undefined ? "a1b2c3d4" : over.agentId;
  return {
    key: `${channelId}:${taskId}:${agentId}`,
    agentId,
    sessionId: "sess-1",
    channelId,
    taskId,
    workspaceId: "ws-1",
    channelName: "General",
    threadTitle: "Ship the thing",
    startedAt: 1700000000000,
    lastActivityAt: 1700000600000,
    endedAt: 1700000600000,
    // Frozen at settle — a live read would blank the numbers at exactly the moment the operator
    // wants to read what the run cost.
    contextUsed: 84000,
    contextWindow: 200000,
    tokensSpent: 1200000,
    entries: [],
    ...over,
  };
}

export function session(over = {}) {
  const channelId = over.channelId || "chan-1";
  const taskId = over.taskId === undefined ? "task-1" : over.taskId;
    // The agent id is part of the key since 2026-08-21 (`main/session-store.js#sessionKey`) and is
    // also the NAME the pill wears. A case about several agents on one thread overrides the default,
    // and the key follows automatically.
  const agentId = over.agentId === undefined ? "a1b2c3d4" : over.agentId;
  return {
    key: `${channelId}:${taskId}:${agentId}`,
    agentId,
    sessionId: over.sessionId || "sess-1",
    channelId,
    taskId,
    workspaceId: over.workspaceId === undefined ? "ws-1" : over.workspaceId,
    settled: false,
    win: fakeWindow(),
    state: { phase: "running", activity: "working", parked: false },
    context: { channelName: "general", taskTitle: "Ship the thing" },
    // ── THE AGENT-VIEW MEASUREMENTS (wiring plan Phase 5, 2026-08-18) ──────────────
    // Defaulted to MEASURED values so the shape cases see the widened row; the absence cases
    // override them to undefined, which is what an unmeasured session and an older engine look like.
    promptTokens: 84000,
    liveModel: "claude-haiku-4-5", // 200k in the frozen table — a real denominator
    tokensSpent: 1200000,
    startedAt: 1700000000000,
    lastActivityAt: 1700000600000,
    ...over,
  };
}
