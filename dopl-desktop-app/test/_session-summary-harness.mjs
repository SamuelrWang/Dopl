// SHARED HARNESS for the `main/session-summary.js` suites (F-147).
//
// WHY IT IS ITS OWN FILE. `session-summary.test.mjs` stood at 498 of the 500-line cap that
// `test/**/*.mjs` is linted under, so the F-147 report/subscription cases had nowhere to go
// in it — and the alternative, a second copy of the loader in a second file, is how two
// suites drift into testing two different programs. Same seam and same precedent as
// `_classify-harness.mjs` / `_reducer-block.mjs`: the extraction machinery is shared, the
// cases are split by what they are about.
//
// THE IDIOM. `main/session-summary.js`'s three requires (`./agent-names`, `./session-model`,
// `./diag`) sit ABOVE its BEGIN sentinel, so everything from there to `module.exports` is
// import-free and can be evaluated verbatim with fakes — no window layer, no file log, no
// Electron of any kind (the session-reopen idiom). The REAL `pickAgentName` and the REAL
// `contextWindowFor` are injected from their REAL modules: the naming cases are about this
// module's ledger and the context cases about ITS projection, not about re-testing the pool or
// re-testing the frozen model/window table.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "main");
export const SRC = readFileSync(join(MAIN, "session-summary.js"), "utf8");
const req = createRequire(import.meta.url);
const { pickAgentName } = req(join(MAIN, "agent-names.js"));
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
  "PILL_STATES", "ACTIVITY_PILL", "pillState", "displayText", "liveSummary", "endedSummary",
  "nameFor", "summariesDigest", "SESSIONS_EVENT", "PUSH_COALESCE_MS", "MAX_ENDED",
  "bind", "start", "list", "nameForSession", "noteEnded", "noteActivity", "touch", "sweepEnded",
  // F-147: the report view and the change subscription the server writer rides.
  "reportEntry", "wireSummary", "reportList", "subscribe",
];

/** A fresh, isolated copy of the module (its ledger and ended set are module state, so
 *  every case gets its own). `sent` collects the frames that reached the fake window. */
export function load() {
  const sent = [];
  const logged = [];
  const api = new Function(
    "pickAgentName",
    "metricOrNull",
    "metrics",
    "noteEvent",
    "detailFor",
    "diag",
    `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
  )(pickAgentName, metricOrNull, metrics, noteEvent, detailFor, (...parts) =>
    logged.push(parts.join(" "))
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
  return { ...api, sent, logged, spaWindow };
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
export function session(over = {}) {
  const channelId = over.channelId || "chan-1";
  const taskId = over.taskId === undefined ? "task-1" : over.taskId;
  return {
    key: `${channelId}:${taskId}`,
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
