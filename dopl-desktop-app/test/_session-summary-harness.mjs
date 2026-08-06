// SHARED HARNESS for the `main/session-summary.js` suites (F-147).
//
// WHY IT IS ITS OWN FILE. `session-summary.test.mjs` stood at 498 of the 500-line cap that
// `test/**/*.mjs` is linted under, so the F-147 report/subscription cases had nowhere to go
// in it — and the alternative, a second copy of the loader in a second file, is how two
// suites drift into testing two different programs. Same seam and same precedent as
// `_classify-harness.mjs` / `_reducer-block.mjs`: the extraction machinery is shared, the
// cases are split by what they are about.
//
// THE IDIOM. `main/session-summary.js`'s two requires (`./agent-names`, `./diag`) sit ABOVE
// its BEGIN sentinel, so everything from there to `module.exports` is import-free and can be
// evaluated verbatim with fakes — no window layer, no file log, no Electron of any kind (the
// session-reopen idiom). The REAL `pickAgentName` is injected from the REAL module: the
// naming cases are about this module's ledger, not about re-testing the pool.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "main");
export const SRC = readFileSync(join(MAIN, "session-summary.js"), "utf8");
const { pickAgentName } = createRequire(import.meta.url)(join(MAIN, "agent-names.js"));

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

const EXPORTED = [
  "PILL_STATES", "ACTIVITY_PILL", "pillState", "displayText", "liveSummary", "endedSummary",
  "nameFor", "summariesDigest", "SESSIONS_EVENT", "PUSH_COALESCE_MS", "MAX_ENDED",
  "bind", "start", "list", "nameForSession", "noteEnded", "keptWindow", "touch", "sweepEnded",
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
    "diag",
    `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
  )(pickAgentName, (...parts) => logged.push(parts.join(" ")));
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

/** A window handle shaped like a BrowserWindow, as the engine hands one over. */
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
    ...over,
  };
}
