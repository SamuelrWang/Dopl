// SHARED HARNESS for the `main/session-summary.js` suites (F-147).
//
// WHY IT IS ITS OWN FILE. `session-summary.test.mjs` stood at 498 of the 500-line cap that
// `test/**/*.mjs` is linted under, so the F-147 report/subscription cases had nowhere to go
// in it — and the alternative, a second copy of the loader in a second file, is how two
// suites drift into testing two different programs. Same seam and same precedent as
// `_classify-harness.mjs` / `_reducer-block.mjs`: the extraction machinery is shared, the
// cases are split by what they are about.
//
// THE IDIOM. `main/session-summary.js`'s requires sit ABOVE its BEGIN sentinel, so everything
// from there to `module.exports` is import-free and can be evaluated verbatim with fakes — no
// window layer, no file log, no Electron of any kind (the session-reopen idiom). Every
// dependency is injected REAL from its REAL module: these cases are about THIS module's
// projection, not about re-testing the tables it reads.
//
// ⚠ `pickAgentName` LEFT THIS HARNESS ON 2026-08-21. The stone-name pool and its ledger are
// DELETED (Samuel's multiplayer ruling): a pill's name is the session object's own `agentId`,
// minted per instance at spawn, so there is nothing to inject and nothing to pick.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "main");
export const SRC = readFileSync(join(MAIN, "session-summary.js"), "utf8");
const req = createRequire(import.meta.url);
// ⚠ THE METRICS MOVED OUT ON 2026-08-20 (session-metrics.js) — one file, one reason to
// change: this projection answers "what STATE is this session in", the metrics answer "what
// has it COST". Injected REAL, like every other dependency here, so these cases still drive
// one program rather than a slice plus a stub.
const { metricOrNull, metrics } = req(join(MAIN, "session-metrics.js"));
// ⚠ THE FOURTH ABOVE-SENTINEL DEPENDENCY, JOINED 2026-08-20 (the `detail` signal). Injected
// REAL, like the two above and for the same reason: these cases are about THIS module's
// projection carrying the detail, not about re-testing the table that derives it —
// `session-detail.test.mjs` owns that. Injecting a stub here would let the two drift.
const { noteEvent, detailFor } = req(join(MAIN, "session-detail.js"));
// ⚠ THE STATE MAPPING MOVED OUT ON 2026-08-22 (`main/session-pill.js`) — see that file's header
// for the seam. Injected REAL, like every dependency here: these cases are about the PROJECTION
// carrying the pill, not about re-testing the table that derives one. The names are MERGED into
// the returned api below, so `m.pillState` / `m.PILL_STATES` / `m.listeningState` still resolve
// exactly as they did when the mapping lived in the sliced block.
const pill = req(join(MAIN, "session-pill.js"));
const { PILL_STATES, ACTIVITY_PILL, PILL_ENDED, pillState, queryTornDown, listeningState } = pill;

const BEGIN = "// ─── BEGIN SESSION-SUMMARY-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf("module.exports = {");
assert.notEqual(from, -1, "BEGIN SESSION-SUMMARY-PURE sentinel missing");
assert.ok(to > from, "module.exports not found after the sentinel");
const BLOCK = SRC.slice(from, to);

// The purity assertion IS a test — it is what makes "this module reaches no network" a fact
// rather than a docblock, and F-147 put a writer next door that would be tempting to fold
// back in here. `fetch(` is the one that matters now.
for (const banned of ["require(", "electron", "child_process", "@anthropic", "fetch("]) {
  assert.ok(!BLOCK.includes(banned), `the extracted block must not reference ${banned}`);
}

// ⚠ `keptWindow` STOOD IN THIS LIST AND IS GONE (2026-08-20, F-228). It is a NAME LIST for a
// `new Function` return, so a name the block no longer declares is a ReferenceError at LOAD —
// not one failing case but every case in all four suites that share this loader, which is
// exactly what happened. ⚠ Anything added here must be a real declaration inside the block;
// there is no such thing as a "mostly right" entry.
const EXPORTED = [
  "displayText", "liveSummary", "endedSummary",
  "nameOf", "summariesDigest", "SESSIONS_EVENT", "PUSH_COALESCE_MS",
  // ⚠ `MAX_ENDED` and `sweepEnded` LEFT THIS LIST ON 2026-08-22 (Samuel's ended-agent ruling):
  // retained ended cards are read from the DURABLE history (`agent-history.js`), bounded by
  // SEVEN DAYS from `endedAt` rather than by a count of 12, and they survive a restart — which
  // the in-memory set never did. `retainedEnded` is the reader; `releaseEnded` is the sweep's
  // cleaner. ⚠ This is a NAME LIST for a `new Function` return, so a name the block no longer
  // declares is a ReferenceError at LOAD — every case in all four suites, not one.
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
    "PILL_STATES",
    "ACTIVITY_PILL",
    "PILL_ENDED",
    "pillState",
    "queryTornDown",
    "listeningState",
    "diag",
    `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
  )(
    metricOrNull, metrics, noteEvent, detailFor,
    PILL_STATES, ACTIVITY_PILL, PILL_ENDED, pillState, queryTornDown, listeningState,
    (...parts) => logged.push(parts.join(" "))
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
  // ⚠ The mapping's names are merged in, not re-declared: `m.pillState` and friends resolve to
  // the REAL `session-pill.js`, which is what keeps the split invisible to every case here.
  return { ...pill, ...api, sent, logged, spaWindow };
}

/**
 * A window handle shaped like a BrowserWindow, as the engine USED to hand one over.
 *
 * ⚠ IT IS STILL HERE BECAUSE `noteEnded` / `sweepEnded` STILL READ `s.win` (2026-08-20, F-228).
 * The session-window model is deleted and a windowless session's `win` is null, so the
 * retention predicate `keepWindow === true && windowAlive(s.win)` can no longer be satisfied by
 * anything the ENGINE produces — but the predicate is live source in `main/session-summary.js`
 * and the cases below still drive it. Keeping a fake window here is what lets the retention,
 * sweep and MAX_ENDED rules keep running instead of being silently deleted with the feature
 * that used to reach them (INVARIANTS §14). ⚠ The stale predicate itself is a FINDING, not
 * something this harness should paper over: see the ⚠ block over §4 of session-summary.test.mjs.
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

/** A live session object shaped like the engine's registry entries. */
/**
 * ONE RETAINED ENDED RECORD, as `agent-history.js › listEnded` hands them over (2026-08-22).
 * ⚠ It is a RECORD, not a session: it carries no state, no query and nothing resumable, which
 * is the point — an ended agent is dead and only its history survives.
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
    // Frozen at settle — the session object is gone, so a live read would blank the numbers at
    // exactly the moment the operator wants to read what the run cost.
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
  // ⚠ THE AGENT ID IS PART OF THE KEY SINCE 2026-08-21 (`main/session-store.js#sessionKey`),
  // and it is also the NAME the pill wears — the stone-name pool that used to supply one is
  // deleted. A default keeps every existing case working; a case about several agents on one
  // thread overrides it, and the key follows automatically.
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
    // Real fields on a real live session object, exactly where session-summary reads
    // them: `promptTokens` from session-model's observer, `liveModel` from the SDK's
    // system/init (the frozen window table turns it into a denominator), `tokensSpent`
    // accumulated in session-io beside the cost, and the two stamps from the engine.
    // ⚠ Defaulted to MEASURED values so the shape cases see the widened row; the
    // absence cases override them to undefined, which is what an unmeasured session
    // and an older engine both look like.
    promptTokens: 84000,
    liveModel: "claude-haiku-4-5", // 200k in the frozen table — a real denominator
    tokensSpent: 1200000,
    startedAt: 1700000000000,
    lastActivityAt: 1700000600000,
    ...over,
  };
}
