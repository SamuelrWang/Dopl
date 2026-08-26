// THE SEVEN-DAY WINDOW: what an ended agent leaves, and what sweeps it (2026-08-22, Samuel).
//
// TWO MODULES, ONE RULE. `main/agent-history.js` owns the DATA and the CLOCK (`RETENTION_MS`,
// `endedAt`, which keys expired); `main/agent-retention.js` owns the PASS (who else is told).
// The split is the point: the history file cannot know what other stores exist, and the sweep
// must not own a second opinion about when something expires.
//
// ⚠ THE ORPHAN IS THE FAILURE THIS FILE IS ABOUT. An agent's traces sit in five stores keyed by
// the SAME session key, and a retention rule that cleans four of them is a slow leak with a
// comforting name. `agent-retention.js` writes the list out; these cases drive it, and the
// "every bound cleaner is called with the same keys" case is what fails when a sixth store is
// added without a cleaner.
//
// ⚠ CHANNEL MESSAGES ARE NOT IN THE LIST AND MUST NEVER BE. What an agent POSTED is
// `channel_messages` on the server — the shared record. This sweep deletes a LOCAL view of how
// work happened, never the work.
//
// SOURCE EXTRACTION: `agent-history.js` requires `electron-store` at module scope, so its pure
// block (the clock, the whitelist, the sweep decision) is sliced and evaluated with `store` and
// `diag` injected. `agent-retention.js` requires only the history module and `diag`, so it is
// evaluated whole against a fake history.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const HISTORY_SRC = read("agent-history.js");
const BLOCK = HISTORY_SRC.slice(
  HISTORY_SRC.indexOf("// ─── BEGIN AGENT-HISTORY-PURE"),
  HISTORY_SRC.indexOf("// ─── END AGENT-HISTORY-PURE")
);

// The purity assertion IS a test: this block decides what reaches the disk, and a require here
// would end the extraction that lets these cases drive the real code.
for (const banned of ["require(", "electron", "child_process", "fetch("]) {
  assert.ok(!BLOCK.includes(banned), `AGENT-HISTORY-PURE must not reference ${banned}`);
}

const pure = new Function(
  `${BLOCK}\n return { RETENTION_MS, MAX_HISTORY, numberOrNull, historyName, durableHistory, expired, sweepableKeys };`
)();

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const rec = (over = {}) => ({
  key: `${CH}:t-1:a1b2c3d4`,
  agentId: "a1b2c3d4",
  channelId: CH,
  taskId: "t-1",
  endedAt: NOW,
  entries: [],
  ...over,
});

// ── 1. THE CLOCK ─────────────────────────────────────────────────────────────

test("WINDOW: the retention window is SEVEN DAYS, stated once", () => {
  // ⚠ ONE CONSTANT. A second copy is how a card outlives its history, or a history outlives its
  // card — the two halves read the SAME number or the rule is not one rule.
  assert.equal(pure.RETENTION_MS, 7 * DAY);
  const CODE = HISTORY_SRC.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")).join("\n");
  assert.equal((CODE.match(/RETENTION_MS =/g) || []).length, 1, "declared exactly once");
});

test("WINDOW: expiry is measured from `endedAt`, inclusive at the boundary", () => {
  assert.equal(pure.expired(rec(), NOW), false, "the moment it ended");
  assert.equal(pure.expired(rec(), NOW + 6 * DAY), false, "day six: still viewable");
  assert.equal(pure.expired(rec(), NOW + 7 * DAY), true, "day seven: gone");
  assert.equal(pure.expired(rec(), NOW + 30 * DAY), true);
});

test("WINDOW: CLOCK SKEW is bounded in both directions and can never delete a live run", () => {
  // ⚠ THE COMPARISON IS ON `endedAt`, which is stamped once at settle. A clock that jumped
  // FORWARD sweeps early; one that jumped BACK sweeps late. Neither can touch something that
  // has not ended, because an un-ended agent has no record here at all.
  assert.equal(pure.expired(rec(), NOW - 365 * DAY), false, "a clock far in the past sweeps nothing");
  assert.equal(pure.expired(rec({ endedAt: NOW + 5 * DAY }), NOW), false, "an end 'in the future' waits");
  // A record with no usable stamp is ancient by construction: nothing can renew it and no card
  // can render a date for it.
  for (const endedAt of [0, null, undefined, NaN, "soon"]) {
    assert.equal(pure.expired(rec({ endedAt }), NOW), true, JSON.stringify(endedAt));
  }
});

// ── 2. WHAT MAY REACH THE DISK ───────────────────────────────────────────────

test("RECORD: the whitelist keeps a live handle off the disk", () => {
  // The same rule `session-store.durableSessionRecord` follows: `query`, `win` and the push
  // iterator are handles, not data, and a caller handing over an enriched object must not be
  // able to serialize one.
  const out = pure.durableHistory({
    ...rec(),
    query: { interrupt() {} }, win: {}, pushIterator: {}, abortController: {},
    state: { toolMode: "bypass" }, ownPostIds: new Set(["x"]),
  });
  for (const banned of ["query", "win", "pushIterator", "abortController", "state", "ownPostIds"]) {
    assert.equal(banned in out, false, `${banned} must not be persisted`);
  }
  assert.equal(out.key, `${CH}:t-1:a1b2c3d4`);
  assert.equal(out.agentId, "a1b2c3d4");
});

test("RECORD: an UNMEASURED number is null, never a confident zero", () => {
  // INVARIANTS §11 — UNKNOWN is not EMPTY. A run with no measurement must not render "0 tokens".
  const out = pure.durableHistory(rec());
  for (const f of ["contextUsed", "contextWindow", "tokensSpent", "startedAt", "lastActivityAt"]) {
    assert.equal(out[f], null, f);
  }
  const measured = pure.durableHistory(rec({ contextUsed: 84000, tokensSpent: 0 }));
  assert.equal(measured.contextUsed, 84000);
  assert.equal(measured.tokensSpent, 0, "a real zero survives — it is only ABSENCE that is null");
});

test("RECORD: counterparty-influenced text is bounded and single-line", () => {
  const out = pure.durableHistory(rec({ channelName: "a\nb\tc", threadTitle: "x".repeat(200) }));
  assert.equal(out.channelName, "a b c");
  assert.equal(out.threadTitle.length, 80);
  assert.equal(pure.durableHistory(rec({ channelName: 42 })).channelName, null);
});

// ⚠ **F-287 — THE ONE IDENTITY IN THIS WHITELIST IS NOT A DISPLAY STRING.** `channelName` and
// `threadTitle` above are display text and 80 is right for them. `templateName` is an IDENTITY,
// legal to 120 on both ends (`agent_templates_name_charset_check` and
// `channel_sessions_template_name_charset_check`), and clipping it at the WRITE destroyed it:
// `session-summary.js › endedSummary` re-bounds at 120 on the way out, which is a no-op on an
// already-80-character string, and the operator's `read_sessions` line then named a template that
// exists under no such spelling — with §5A's "a stale name here is correct, not drift" rule
// telling them not to read it as an error.
test("RECORD: the frozen TEMPLATE name keeps its own 120 bound, not the 80 display default", () => {
  assert.equal(pure.durableHistory(rec({ templateName: "N".repeat(100) })).templateName.length, 100,
    "a legal 100-character template name must survive the write intact");
  assert.equal(pure.durableHistory(rec({ templateName: "N".repeat(400) })).templateName.length, 120,
    "…and 120 is still enforced — the bound moved, it did not go away");
  // The neutralization is unchanged at every bound: one line, collapsed, null for a non-string.
  assert.equal(pure.durableHistory(rec({ templateName: "a\nb\tc" })).templateName, "a b c");
  assert.equal(pure.durableHistory(rec({ templateName: 42 })).templateName, null);
  assert.equal(pure.durableHistory(rec({ templateName: "   " })).templateName, null);
});

// ── 3. THE SWEEP DECISION ────────────────────────────────────────────────────

test("SWEEP: it drops what expired and keeps what has not", () => {
  const all = {
    old: rec({ endedAt: NOW - 8 * DAY }),
    edge: rec({ endedAt: NOW - 7 * DAY }),
    fresh: rec({ endedAt: NOW - 1 * DAY }),
  };
  assert.deepEqual(pure.sweepableKeys(all, NOW).sort(), ["edge", "old"]);
});

test("SWEEP: garbage is never a record and always goes", () => {
  const all = { a: null, b: "not an object", c: 7, d: rec({ endedAt: NOW }) };
  assert.deepEqual(pure.sweepableKeys(all, NOW).sort(), ["a", "b", "c"]);
});

test("SWEEP: the COUNT belt bounds the set under the clock, oldest first", () => {
  // ⚠ A TIME BOUND ALONE IS NOT A BOUND. Seven days of a machine at MAX_CONCURRENT_SESSIONS is
  // unbounded in principle; this is the belt, and it must drop the OLDEST — the least likely to
  // still matter to the operator.
  const all = {};
  for (let i = 0; i < pure.MAX_HISTORY + 5; i += 1) {
    all[`k-${i}`] = rec({ endedAt: NOW - i }); // k-0 newest, higher i older
  }
  const dropped = pure.sweepableKeys(all, NOW);
  assert.equal(dropped.length, 5);
  assert.deepEqual(
    dropped.sort(),
    ["k-200", "k-201", "k-202", "k-203", "k-204"].sort(),
    "the five oldest, not five arbitrary ones"
  );
});

// ── 4. THE PASS: every store keyed by that key, or it is an orphan ───────────

function retention(historyFake) {
  const mod = { exports: {} };
  const req = (id) => {
    if (id === "./agent-history") return historyFake;
    if (id === "./diag") return { diag: () => {} };
    throw new Error(`unexpected require: ${id}`);
  };
  new Function("require", "module", "exports", read("agent-retention.js"))(req, mod, mod.exports);
  return mod.exports;
}

const KEYS = ["k1", "k2"];

test("PASS: EVERY bound cleaner is called with the SAME keys the history dropped", () => {
  // ⚠ THIS IS THE ORPHAN GUARD. A sixth store added without a cleaner does not fail here — it
  // fails in production, silently — which is why `agent-retention.js` writes the list out and
  // why the missing-cleaner case below exists beside this one.
  const seen = {};
  const r = retention({ sweep: () => KEYS, forget: () => {}, keysForThread: () => [] });
  r.bind({
    clearRecord: (k) => { seen.clearRecord = k; },
    releaseEnded: (k) => { seen.releaseEnded = k; },
    forgetNotice: (k) => { seen.forgetNotice = k; },
  });
  assert.deepEqual(r.sweepNow(NOW), KEYS);
  assert.deepEqual(seen, { clearRecord: KEYS, releaseEnded: KEYS, forgetNotice: KEYS });
});

test("PASS: nothing expired means nothing is touched at all", () => {
  let called = 0;
  const r = retention({ sweep: () => [], forget: () => {}, keysForThread: () => [] });
  r.bind({ clearRecord: () => { called += 1; }, releaseEnded: () => { called += 1; }, forgetNotice: () => { called += 1; } });
  assert.deepEqual(r.sweepNow(NOW), []);
  assert.equal(called, 0, "a quiet sweep costs no writes");
});

test("PASS: ONE THROWING CLEANER must not abandon the rest half-swept", () => {
  // A partial sweep that stops at the first failure leaves precisely the orphans this exists to
  // prevent, and leaves them silently.
  const seen = [];
  const r = retention({ sweep: () => KEYS, forget: () => {}, keysForThread: () => [] });
  r.bind({
    clearRecord: () => { throw new Error("disk gone"); },
    releaseEnded: () => seen.push("releaseEnded"),
    forgetNotice: () => seen.push("forgetNotice"),
  });
  assert.doesNotThrow(() => r.sweepNow(NOW));
  assert.deepEqual(seen, ["releaseEnded", "forgetNotice"]);
});

test("PASS: a MISSING cleaner is survivable and says so — it does not throw", () => {
  const r = retention({ sweep: () => KEYS, forget: () => {}, keysForThread: () => [] });
  r.bind({}); // a mid-wave caller that forgot the literal
  assert.doesNotThrow(() => r.sweepNow(NOW));
});

test("PASS: a history sweep that THROWS returns no keys rather than a half-clean", () => {
  let called = 0;
  const r = retention({ sweep: () => { throw new Error("unreadable"); }, forget: () => {}, keysForThread: () => [] });
  r.bind({ clearRecord: () => { called += 1; } });
  assert.deepEqual(r.sweepNow(NOW), []);
  assert.equal(called, 0, "no key was proven expired, so nothing is cleaned");
});

// ── 5. THE THREAD-DELETE CASCADE'S DESKTOP HALF ──────────────────────────────

test("CASCADE: forgetting a THREAD drops its agents' history whatever their age", () => {
  // A deleted thread takes its agents' local history with it: the statement the history makes
  // is about work on an exchange that no longer exists. Same argument
  // `deleteSessionStatesForThread` makes on the server.
  const forgotten = [];
  const seen = [];
  const r = retention({
    sweep: () => [],
    forget: (k) => forgotten.push(k),
    keysForThread: (prefix) => (prefix === `${CH}:t-1:` ? KEYS : []),
  });
  r.bind({ clearRecord: (k) => seen.push(k), releaseEnded: (k) => seen.push(k), forgetNotice: (k) => seen.push(k) });
  assert.deepEqual(r.forgetThread(CH, "t-1"), KEYS);
  assert.deepEqual(forgotten, [KEYS]);
  assert.deepEqual(seen, [KEYS, KEYS, KEYS], "every store hears about it, not just the history");
});

test("CASCADE: the prefix is thread-scoped and cannot reach a neighbouring thread", () => {
  const asked = [];
  const r = retention({ sweep: () => [], forget: () => {}, keysForThread: (p) => { asked.push(p); return []; } });
  r.bind({});
  r.forgetThread(CH, "t-1");
  // ⚠ THE TRAILING COLON: without it `<channel>:t-1` also prefixes `<channel>:t-10`.
  assert.deepEqual(asked, [`${CH}:t-1:`]);
  r.forgetThread(CH, "");
  assert.equal(asked[1], `${CH}::`, "a CHANNEL-level agent's own scope, not every thread");
});

// ── 5A. THE SINGLE-AGENT DELETE (2026-08-25, Samuel's ruling) ────────────────

test("DELETE: forgetting ONE agent runs the SAME cleaner list the clock does", () => {
  // ⚠ THE ORPHAN GUARD AGAIN, FROM THE OTHER DOOR. An explicit delete that cleaned its own
  // subset of the stores would be this file's "slow leak with a comforting name", arriving one
  // card at a time instead of on a timer — so `forgetAgent` shares `forgetKeys` with the sweep
  // and the cascade rather than restating the list.
  const forgotten = [];
  const seen = [];
  const r = retention({ sweep: () => [], forget: (k) => forgotten.push(k), keysForThread: () => [] });
  r.bind({ clearRecord: (k) => seen.push(k), releaseEnded: (k) => seen.push(k), forgetNotice: (k) => seen.push(k) });
  const key = `${CH}:t-1:a1b2c3d4`;
  assert.deepEqual(r.forgetAgent(key), [key]);
  assert.deepEqual(forgotten, [[key]]);
  assert.deepEqual(seen, [[key], [key], [key]], "every store hears about it, not just the history");
});

test("DELETE: the key is EXACT — one agent, never its siblings on the thread", () => {
  // ⚠ A `<channel>:<thread>:` prefix is the THREAD cascade. Reaching a sibling agent from one
  // card's trash icon is the mistake this lane cannot make quietly, so the key is passed whole
  // and `keysForThread` is never consulted.
  let prefixAsked = 0;
  const forgotten = [];
  const r = retention({
    sweep: () => [],
    forget: (k) => forgotten.push(k),
    keysForThread: () => { prefixAsked += 1; return ["someone-elses-key"]; },
  });
  r.bind({});
  r.forgetAgent(`${CH}:t-1:a1b2c3d4`);
  assert.equal(prefixAsked, 0, "a delete never scans the thread");
  assert.deepEqual(forgotten, [[`${CH}:t-1:a1b2c3d4`]]);
});

test("DELETE: an empty key is a no-op rather than a wildcard", () => {
  const forgotten = [];
  const r = retention({ sweep: () => [], forget: (k) => forgotten.push(k), keysForThread: () => [] });
  r.bind({});
  assert.deepEqual(r.forgetAgent(""), []);
  assert.deepEqual(r.forgetAgent(null), []);
  assert.deepEqual(forgotten, []);
});

// ── 6. THE TIMER ─────────────────────────────────────────────────────────────

test("TIMER: it sweeps ONCE at start, then daily, and never stacks", () => {
  let sweeps = 0;
  const r = retention({ sweep: () => { sweeps += 1; return []; }, forget: () => {}, keysForThread: () => [] });
  r.bind({});
  r.start();
  assert.equal(sweeps, 1, "app start does not wait a day for the first pass");
  r.start();
  r.start();
  assert.equal(sweeps, 3, "…each start sweeps, but");
  assert.equal(r.SWEEP_INTERVAL_MS, DAY, "the interval is coarse on purpose — the bound is 7 days");
  r.stop();
  assert.doesNotThrow(() => r.stop(), "stopping twice is a no-op");
});
