// DISMISSED-AGENT NOTIFICATION SPAM (adversarial review of F1-F7).
//
// WHAT CHANGED UNDERNEATH THE NOTICE. Before F1, a `task_*` addressed to a DISMISSED row
// produced nothing at all: the blanket kind gate at the top of routeAddressedAgent refused every
// milestone before the roster was consulted, so the 'dismissed' verdict was unreachable for the
// noisiest kind in the product. F1 opened that gate on purpose (a milestone that NAMES an agent
// is exactly the wake the feature is for), and the consequence nobody costed is here: the
// verdict now fires per POST, listener-messages -> task-notify.notifyAgentDismissed, with no
// dedupe and no rate limit. An agent mid-run posts a dozen task_progress lines a minute; each
// one raised its own OS banner saying the same thing about the same retired handle.
//
// THE FIX. A per-(channel, agent) suppression window, local to task-notify.js: the first post of
// a burst notifies, the rest are silent for SUPPRESS_WINDOW_MS, and the window is a RATE LIMIT
// rather than a mute — a peer still addressing a dismissed agent after it elapses is news again.
//
// WHY IT IS A PLAIN MAP AND NOTHING ELSE. task-notify.js has a PINNED DEPENDENCY SET
// (test/wake-external-requester.test.mjs): it may reach nothing that can spawn, gate or record a
// consent. That guarantee is the reason the passive lane is safe, so the suppression brings no
// new import, no timer and no disk — its state is a bounded LRU in the module, and losing it on
// a restart is correct (a fresh run is in the middle of no burst).
//
// METHOD: the same source-extraction idiom as its neighbours — slice the
// TASK-NOTIFY-SUPPRESS sentinel block and evaluate it verbatim, with the CLOCK supplied by the
// test, so what is driven is the shipped rule and not a restatement of it. Each load() gets its
// own module state, so the tests cannot leak bursts into each other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "task-notify.js"), "utf8");

const BEGIN = "// ─── BEGIN TASK-NOTIFY-SUPPRESS";
const END = "// ─── END TASK-NOTIFY-SUPPRESS";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN TASK-NOTIFY-SUPPRESS sentinel missing");
assert.ok(to > from, "TASK-NOTIFY-SUPPRESS sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "fs.", "setTimeout", "setInterval"]) {
  assert.ok(!BLOCK.includes(banned), `TASK-NOTIFY-SUPPRESS must not reference ${banned}`);
}

/** A FRESH copy of the suppression state — no test inherits another's burst. */
const load = () =>
  new Function(`${BLOCK}\n return { mayNotifyDismissed, SUPPRESS_WINDOW_MS, SUPPRESS_CAP };`)();

const CH = "chan-1";
const OTHER_CH = "chan-2";
const A = "agent-a";
const B = "agent-b";

// ── one notice per burst ──────────────────────────────────────────────────────

test("the FIRST post of a burst notifies and the rest are silent", () => {
  const { mayNotifyDismissed, SUPPRESS_WINDOW_MS } = load();
  const t0 = 5_000_000;
  assert.equal(mayNotifyDismissed(CH, A, t0), true, "somebody addressed a retired agent: news");
  let fired = 0;
  for (let i = 1; i <= 30; i++) {
    if (mayNotifyDismissed(CH, A, t0 + i * 1000)) fired++;
  }
  assert.equal(fired, 0, "thirty milestones later, still one banner");
  assert.ok(SUPPRESS_WINDOW_MS >= 60_000, "the window is minutes, not a debounce");
});

test("the window is a RATE LIMIT, not a mute: it fires again once it elapses", () => {
  const { mayNotifyDismissed, SUPPRESS_WINDOW_MS } = load();
  const t0 = 5_000_000;
  assert.equal(mayNotifyDismissed(CH, A, t0), true);
  assert.equal(mayNotifyDismissed(CH, A, t0 + SUPPRESS_WINDOW_MS - 1), false, "one tick short");
  assert.equal(mayNotifyDismissed(CH, A, t0 + SUPPRESS_WINDOW_MS), true, "the boundary itself opens it");
  // …and the NEW notice restarts the window rather than leaving it open.
  assert.equal(mayNotifyDismissed(CH, A, t0 + SUPPRESS_WINDOW_MS + 1), false);
});

test("a burst that runs for an hour is bounded to one notice per window", () => {
  const { mayNotifyDismissed, SUPPRESS_WINDOW_MS } = load();
  const t0 = 5_000_000;
  let fired = 0;
  for (let ms = 0; ms <= 60 * 60_000; ms += 5_000) {
    if (mayNotifyDismissed(CH, A, t0 + ms)) fired++;
  }
  const expected = Math.floor((60 * 60_000) / SUPPRESS_WINDOW_MS) + 1;
  assert.equal(fired, expected, "720 posts in an hour, one notice per window and no more");
});

// ── the key really is (channel, agent) ────────────────────────────────────────

test("a DIFFERENT agent is a different fact and notifies on its own", () => {
  const { mayNotifyDismissed } = load();
  const t0 = 5_000_000;
  assert.equal(mayNotifyDismissed(CH, A, t0), true);
  assert.equal(mayNotifyDismissed(CH, B, t0 + 1), true, "a second retired row is its own news");
  assert.equal(mayNotifyDismissed(CH, A, t0 + 2), false, "…and neither unmutes the other");
  assert.equal(mayNotifyDismissed(CH, B, t0 + 3), false);
});

test("the SAME agent in another channel notifies (a room the operator is not watching yet)", () => {
  const { mayNotifyDismissed } = load();
  const t0 = 5_000_000;
  assert.equal(mayNotifyDismissed(CH, A, t0), true);
  assert.equal(mayNotifyDismissed(OTHER_CH, A, t0 + 1), true);
  assert.equal(mayNotifyDismissed(OTHER_CH, A, t0 + 2), false);
});

test("an UNNAMED addressee still keys consistently, so its burst is bounded too", () => {
  // The id comes off `metadata.to_agent_id`, which can be missing on an odd post. That collapses
  // to one key per channel — which is the right answer for spam: unattributed dismissals are
  // exactly the flood the operator cannot act on individually.
  const { mayNotifyDismissed } = load();
  const t0 = 5_000_000;
  assert.equal(mayNotifyDismissed(CH, "", t0), true);
  assert.equal(mayNotifyDismissed(CH, undefined, t0 + 1), false, "same key, same burst");
  assert.equal(mayNotifyDismissed(CH, null, t0 + 2), false);
  assert.equal(mayNotifyDismissed(OTHER_CH, "", t0 + 3), true, "still per channel");
});

// ── bounds: it can never grow, and a bad clock cannot mute it forever ─────────

test("F-072: the memory is CAPPED, and the oldest pair is the one that is forgotten", () => {
  const { mayNotifyDismissed, SUPPRESS_CAP } = load();
  const t0 = 5_000_000;
  assert.equal(mayNotifyDismissed(CH, "agent-0", t0), true); // the oldest entry
  for (let i = 1; i <= SUPPRESS_CAP; i++) {
    assert.equal(mayNotifyDismissed(CH, `agent-${i}`, t0 + i), true, `agent-${i}`);
  }
  // The cap has pushed agent-0 out, so it notifies again — a bounded map trading a rare extra
  // banner for a guarantee that nothing here grows.
  assert.equal(mayNotifyDismissed(CH, "agent-0", t0 + SUPPRESS_CAP + 1), true, "evicted, so it is news again");
  assert.equal(mayNotifyDismissed(CH, `agent-${SUPPRESS_CAP}`, t0 + SUPPRESS_CAP + 2), false,
    "…while the most recent pair is still suppressed");
  assert.ok(SUPPRESS_CAP > 0 && SUPPRESS_CAP <= 200, "a small LRU, stated as a constant");
});

test("a clock that went BACKWARDS starts a new burst instead of muting forever", () => {
  const { mayNotifyDismissed } = load();
  const t0 = 5_000_000;
  assert.equal(mayNotifyDismissed(CH, A, t0), true);
  assert.equal(mayNotifyDismissed(CH, A, t0 - 60_000), true, "a system time change is not a suppression");
  assert.equal(mayNotifyDismissed(CH, A, t0 - 59_000), false, "and the new window is honoured from there");
});

// ── the wiring, pinned statically ─────────────────────────────────────────────

test("notifyAgentDismissed ASKS before it builds or shows anything", () => {
  const body = SRC.slice(SRC.indexOf("function notifyAgentDismissed("));
  const ask = body.indexOf("mayNotifyDismissed(");
  assert.ok(ask > 0, "the suppression is consulted");
  assert.ok(ask < body.indexOf("agentDismissedNotice("), "before the copy is built");
  assert.ok(ask < body.indexOf("new Notification("), "and before anything is shown");
  assert.match(body.slice(ask), /^[^]*?return;/, "a suppressed burst returns, it does not fall through");
  // The key is the ADDRESSED agent — the same field the caller resolved the handle from.
  assert.ok(body.includes("metaStr(m, 'to_agent_id')"), "keyed on the agent that was addressed");
});

test("the pinned DEPENDENCY SET did not grow to buy this", () => {
  const deps = [...SRC.matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]).sort();
  assert.deepEqual(deps, ["./diag", "./listener-io", "./targeting", "electron"],
    "the passive lane still cannot reach anything that spawns, gates or records a consent");
});
