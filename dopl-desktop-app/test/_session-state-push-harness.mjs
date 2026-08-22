// SHARED HARNESS for the `main/session-state-push.js` suites (F-147).
//
// WHY IT IS ITS OWN FILE. The writer's cases are two subjects — what it SENDS (the row, the
// trigger, the row lifetime) and what it REFUSES to send (another operator's sessions, and
// a failure repeated) — and together they overran the 500-line cap `test/**/*.mjs` is
// linted under. Splitting them without sharing the loader would be two copies of the
// extraction, which is how two suites end up testing two different programs. Same seam and
// same precedent as `_classify-harness.mjs` / `_session-summary-harness.mjs`.
//
// THE IDIOM. The module's three deps (`apiFetch`, `diag`, `store`) sit ABOVE its BEGIN
// sentinel, so everything from there to `module.exports` is evaluated verbatim with fakes —
// no Electron, no network, no disk. `setTimeout` is injected too, so the retry's real 2s
// gap costs the suite nothing; the code under test is unchanged by it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
export const SRC = readFileSync(join(MAIN, "session-state-push.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-STATE-PUSH";
export const BLOCK_START = SRC.indexOf(BEGIN);
const to = SRC.indexOf("module.exports = {");
assert.notEqual(BLOCK_START, -1, "BEGIN SESSION-STATE-PUSH sentinel missing");
assert.ok(to > BLOCK_START, "module.exports not found after the sentinel");
export const BLOCK = SRC.slice(BLOCK_START, to);

for (const banned of ["require(", "electron", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `the extracted block must not reference ${banned}`);
}

const EXPORTED = [
  "ENDPOINT", "HTTP_TIMEOUT_MS", "REPORTED_WORKSPACES_KEY", "MAX_ATTEMPTS", "RETRY_DELAY_MS",
  "reportRow", "setDigest", "trackOrigin", "ownedBy", "groupByWorkspace",
  "reportedWorkspaces", "rememberWorkspace", "retryable", "send", "cycle", "schedule",
  "start", "kick", "stop",
  // C-2: the client-side refusal to put an ad-hoc (thread-less) session on the wire.
  "serverReportable", "reportable",
  // 2026-08-22: the refusal to put an ENDED session on it. Retention is 7 days and DURABLE now,
  // and `SESSION_REPORT_MAX` bounds the array at 32 — an unfiltered set 400s the whole push.
  "liveForWire",
  // 2026-08-22: …and the belt against a NAMELESS row, which 400s the array the same way.
  "nameReportable",
];

/** A fresh copy of the module, with a fake transport, a fake log and a fake store. */
export function load(opts = {}) {
  const posts = [];
  const logged = [];
  const disk = { ...(opts.disk || {}) };
  let answers = opts.answers ? [...opts.answers] : [];
  const apiFetch = async (pathname, options) => {
    posts.push({ pathname, options });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    const answer = next || { ok: true, status: 200 };
    if (answer.throws) throw new Error(answer.throws);
    return answer;
  };
  const store = {
    get: (key) => disk[key],
    set: (key, value) => { disk[key] = value; },
  };
  // Immediate, so RETRY_DELAY_MS costs nothing here. It shadows the global inside the block.
  const fakeSetTimeout = (fn) => { Promise.resolve().then(fn); return { unref() {} }; };
  const api = new Function(
    "apiFetch", "diag", "store", "setTimeout",
    `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
  )(apiFetch, (...parts) => logged.push(parts.join(" ")), store, fakeSetTimeout);
  return {
    ...api,
    posts,
    logged,
    disk,
    setAnswers: (list) => { answers = [...list]; },
  };
}

// THE FIXTURE IS A REAL WIRE VALUE NOW (C-2, 2026-08-08). It used to read
// `chan-1` / `task-1`, and BOTH halves of that are rejected by the endpoint this module
// posts to: `SESSION_KEY_RE` is hex-and-dashes only (`t`, `s`, `k` are not hex) and
// `threadId` is `z.string().uuid()`. So every assertion in these suites was green about a
// payload the server would 400 — the audit's "asserted as correct by a test on one side of
// a boundary the other side violates". These are uuids, so the suites now prove the CONTRACT
// and `ADHOC_TASK_ID` is the shape that must be filtered rather than the shape we pretend is
// normal. `ADHOC_TASK_ID` is exactly what `trigger.taskIdFor` mints for an unthreaded inbound.
export const CHAN_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const TASK_A = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const CHAN_B = "cccccccc-3333-4333-8333-cccccccccccc";
export const TASK_B = "dddddddd-4444-4444-8444-dddddddddddd";
export const ADHOC_TASK_ID = `task-${CHAN_A}-42`;

/** One report entry, as `session-summary.reportList()` builds them. */
export function entry(over = {}) {
  const channelId = over.channelId || CHAN_A;
  const taskId = over.taskId === undefined ? TASK_A : over.taskId;
  // ⚠ THE KEY IS THREE PARTS SINCE 2026-08-21 (`main/session-store.js#sessionKey`) and the NAME
  // is the agent instance id — the stone-name pool that supplied "flint" is deleted in both
  // trees. `agent-id.js`'s charset was chosen as a strict subset of `channel_sessions.name`'s
  // CHECK, so the server schema did not have to move for it.
  const agentId = over.agentId === undefined ? "a1b2c3d4" : over.agentId;
  return {
    sessionId: "sess-1",
    key: `${channelId}:${taskId}:${agentId}`,
    channelId,
    taskId,
    agentId,
    workspaceId: "ws-1",
    name: agentId,
    state: "working",
    channelName: "General",
    threadTitle: "Ship the thing",
    ...over,
  };
}

/** The unthreaded inbound — the ordinary DM — as the engine really keys it. */
export function adHocEntry(over = {}) {
  return entry({ taskId: ADHOC_TASK_ID, agentId: "z9y8x7w6", ...over });
}

/** A summary module stand-in: the writer only ever uses `subscribe` + `reportList`. */
export function fakeSummary(initial = []) {
  const subs = new Set();
  let current = initial;
  return {
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    reportList() { return current; },
    emit(entries) { current = entries; for (const fn of subs) fn(entries); },
    subscriberCount: () => subs.size,
  };
}

/** Arm a writer over a fake summary. `user` is what `getUserId()` answers, and it is a
 *  BOX so a case can change identity mid-flight the way a sign-out does. */
export function armed(opts = {}) {
  const m = load(opts);
  const summary = fakeSummary(opts.initial || []);
  const who = { id: opts.user === undefined ? "user-a" : opts.user };
  m.start({ getUserId: () => who.id, summary });
  return { m, summary, who };
}

/** Let the writer's async cycle finish. It is promise-driven end to end (the injected
 *  setTimeout resolves on the microtask queue), so a few macrotask turns are plenty. */
export const drained = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};

export const bodies = (m) => m.posts.map((p) => p.options.body.sessions);
