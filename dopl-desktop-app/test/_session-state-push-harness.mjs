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

/** One report entry, as `session-summary.reportList()` builds them. */
export function entry(over = {}) {
  const channelId = over.channelId || "chan-1";
  const taskId = over.taskId === undefined ? "task-1" : over.taskId;
  return {
    sessionId: "sess-1",
    key: `${channelId}:${taskId}`,
    channelId,
    taskId,
    workspaceId: "ws-1",
    name: "flint",
    state: "working",
    channelName: "General",
    threadTitle: "Ship the thing",
    ...over,
  };
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
