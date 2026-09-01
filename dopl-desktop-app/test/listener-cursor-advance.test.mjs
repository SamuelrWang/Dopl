// C-3 — THE PERSISTED CURSOR MOVES ONLY PAST A MESSAGE WHOSE DISPATCH LANDED.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-3, "the single highest-leverage fix"):
// `channel-listener.js` wrote `io.setCursor` — an electron-store write, i.e. state that
// survives a restart — BEFORE calling `dispatchMessage`. Every downstream early return
// was therefore a permanent silent drop. The motivating incident: wifi drops for 15s
// during the consent POST, `consent.createConsentRequest` answers `null`, `handleTrigger`
// fails closed, and the cursor is already past the seq — so no consent row exists, nothing
// appears in Pending Requests, a restart re-awaits from the ADVANCED cursor, and the peer's
// agent long-polls forever with no record on either machine that anything was asked.
//
// WHAT THIS FILE PINS, in the three properties the fix has to have at once:
//   1. ADVANCE ON SUCCESS. A dispatched message moves the cursor; the one that did not
//      dispatch does not, and neither do the messages BEHIND it (order is the contract —
//      stepping over the head to deliver seq+1 would reorder the exchange).
//   2. THE RETRY IS BOUNDED. A message that can never dispatch would otherwise hold the
//      head of its channel's queue for the life of the process, which is a worse failure
//      than the one being fixed: every LATER message in that channel stalls behind it.
//   3. THE ESCAPE IS LOUD. When the ladder is exhausted the message IS dropped — and the
//      log says so in as many words, which is exactly what the old ordering never did.
//
// METHOD: the repo's source-extraction idiom. `drainPage` and the DISPATCH-DEFERRAL block
// are sliced out of `main/listener-messages.js` and evaluated verbatim with fakes for the
// cursor store, the clock-free sleep, the log, and `dispatchMessage` itself — so this
// drives the SHIPPED cursor logic with no electron, no store and no network.
//
// Run: `node --test dopl-desktop-app/test/listener-cursor-advance.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("listener-messages.js");
const LOOP = M("channel-listener.js");
const TRIGGER = M("trigger.js");

const { LISTENER } = require("../main/config.js");

const BEGIN = "// ─── BEGIN DISPATCH-DEFERRAL";
const END = "// ─── END DISPATCH-DEFERRAL";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN DISPATCH-DEFERRAL sentinel missing");
assert.ok(to > from, "DISPATCH-DEFERRAL sentinels out of order");
const POLICY = SRC.slice(from, to);

for (const banned of ["require(", "electron", "child_process", "@anthropic"]) {
  assert.ok(!POLICY.includes(banned), `the DISPATCH-DEFERRAL block must not reference ${banned}`);
}

function extractAsyncFn(src, name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.notEqual(at, -1, `async function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", at);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(at, i);
}

const CHAN = "dba90694-1111-4222-8333-444444444444";

/**
 * The REAL drainPage + the REAL deferral policy, over a fake cursor store.
 * `verdicts` maps seq -> what dispatchMessage answers for it (a string defers, a thrown
 * Error defers, anything falsy is handled).
 */
function harness(verdicts = {}) {
  const cursors = new Map();
  const logged = [];
  const dispatched = [];
  const io = {
    getCursor: (id) => cursors.get(id) || 0,
    setCursor: (id, seq) => cursors.set(id, seq),
    sleep: () => Promise.resolve(),
  };
  const dispatchMessage = async (entry, m) => {
    dispatched.push(m.seq);
    const v = verdicts[m.seq];
    if (v instanceof Error) throw v;
    return v;
  };
  const api = new Function(
    "io", "LISTENER", "diag", "dispatchMessage",
    `${POLICY}\n${extractAsyncFn(SRC, "drainPage")}\n` +
      `function deferBackoff(entry) { return io.sleep(deferralDelayMs(entry.deferral && entry.deferral.attempts)); }\n` +
      `return { drainPage, deferBackoff, deferralDelayMs, deferralExhausted, noteDeferral, clearDeferral };`
  )(io, LISTENER, (...a) => logged.push(a.join(" ")), dispatchMessage);
  return { ...api, cursors, logged, dispatched, cursor: () => cursors.get(CHAN) || 0 };
}

const entry = () => ({ channel: { id: CHAN, name: "Direct message" }, workspaceId: "ws" });
const page = (...seqs) => seqs.map((seq) => ({ seq, kind: "message", body: "x" }));

// ── 1. ADVANCE ON SUCCESS ────────────────────────────────────────────────────────────

test("a fully dispatched page advances the cursor to its last seq", async () => {
  const h = harness();
  assert.equal(await h.drainPage(entry(), page(7, 8, 9), null), false, "the page finished");
  assert.deepEqual(h.dispatched, [7, 8, 9]);
  assert.equal(h.cursor(), 9);
});

test("THE FIX: a message that does not dispatch does NOT move the cursor", async () => {
  // This is the whole audit finding, in one assertion. `no-consent-row` is what
  // `handleTrigger` answers when the consent POST could not be made.
  const h = harness({ 8: "no-consent-row" });
  assert.equal(await h.drainPage(entry(), page(7, 8, 9), null), true, "the page was left unfinished");
  assert.equal(h.cursor(), 7, "the cursor sits BEHIND the undelivered message, so the next await re-reads it");
});

test("…and neither do the messages BEHIND it — order is the contract", async () => {
  const h = harness({ 8: "no-agent-runtime" });
  await h.drainPage(entry(), page(7, 8, 9), null);
  assert.deepEqual(h.dispatched, [7, 8], "seq 9 is not delivered ahead of the seq 8 it follows");
});

test("the retry re-delivers the SAME seq, and a success then releases the whole page", async () => {
  const verdicts = { 8: "no-consent-row" };
  const h = harness(verdicts);
  const e = entry();
  await h.drainPage(e, page(7, 8, 9), null);
  assert.equal(h.cursor(), 7);
  delete verdicts[8]; // the network came back
  assert.equal(await h.drainPage(e, page(8, 9), null), false);
  assert.equal(h.cursor(), 9, "nothing was lost — the deferred request is answered late, not never");
});

test("a THROWING dispatch defers too, instead of escaping and killing the channel loop", async () => {
  // It used to reject out of channelLoop into the `.catch` in reconcile: the loop was
  // dropped for up to a 5-minute reconcile, with the cursor already past the message.
  const h = harness({ 8: new Error("boom") });
  assert.equal(await h.drainPage(entry(), page(7, 8), null), true);
  assert.equal(h.cursor(), 7);
  assert.ok(h.logged.some((l) => l.includes("error:boom")), "the throw is reported, not swallowed");
});

// ── 2. THE RETRY IS BOUNDED, AND 3. THE ESCAPE IS LOUD ───────────────────────────────

test("the ladder is bounded: after DISPATCH_MAX_ATTEMPTS the head is stepped over", async () => {
  const h = harness({ 8: "no-agent-runtime" });
  const e = entry();
  for (let i = 1; i < LISTENER.DISPATCH_MAX_ATTEMPTS; i += 1) {
    assert.equal(await h.drainPage(e, page(8, 9), null), true, `attempt ${i} still holds`);
    assert.equal(h.cursor(), 0);
  }
  assert.equal(await h.drainPage(e, page(8, 9), null), false, "the last attempt escapes");
  assert.equal(h.cursor(), 9, "and every LATER message in the channel is delivered again");
});

test("the escape SAYS the message was dropped — the property the old ordering lacked", async () => {
  const h = harness({ 8: "no-consent-row" });
  const e = entry();
  for (let i = 0; i < LISTENER.DISPATCH_MAX_ATTEMPTS; i += 1) await h.drainPage(e, page(8), null);
  const drop = h.logged.filter((l) => l.includes("dispatch DROPPED"));
  assert.equal(drop.length, 1, "exactly one escape, and it is on the record");
  assert.match(drop[0], /never be answered/);
  assert.equal(h.logged.filter((l) => l.includes("dispatch deferred")).length,
    LISTENER.DISPATCH_MAX_ATTEMPTS - 1, "every held attempt is logged too");
});

test("the counter is per-seq: a different message resets the ladder", async () => {
  const h = harness({ 8: "x", 9: "y" });
  const e = entry();
  await h.drainPage(e, page(8), null);
  assert.equal(e.deferral.attempts, 1);
  await h.drainPage(e, page(9), null);
  assert.deepEqual(e.deferral, { seq: 9, attempts: 1 }, "a new head starts its own ladder");
});

test("a success clears the ladder, so a later blip gets the full budget again", async () => {
  const verdicts = { 8: "x" };
  const h = harness(verdicts);
  const e = entry();
  await h.drainPage(e, page(8), null);
  delete verdicts[8];
  await h.drainPage(e, page(8), null);
  assert.equal(e.deferral, null);
});

// ── The backoff ladder itself ────────────────────────────────────────────────────────

test("the deferral wait is the reconnect ladder, capped — never a hot loop", () => {
  const h = harness();
  assert.equal(h.deferralDelayMs(1), LISTENER.BACKOFF_BASE_MS);
  assert.equal(h.deferralDelayMs(2), LISTENER.BACKOFF_BASE_MS * 2);
  assert.equal(h.deferralDelayMs(3), LISTENER.BACKOFF_BASE_MS * 4);
  assert.equal(h.deferralDelayMs(99), LISTENER.BACKOFF_MAX_MS, "capped");
  assert.equal(h.deferralDelayMs(0), LISTENER.BACKOFF_BASE_MS, "a missing count is still a real wait");
  // The whole hold, end to end, is minutes — long enough to outlast a network blip and
  // short enough that one poison message cannot stall a channel indefinitely.
  let total = 0;
  for (let i = 1; i <= LISTENER.DISPATCH_MAX_ATTEMPTS; i += 1) total += h.deferralDelayMs(i);
  assert.ok(total > 60_000 && total < 15 * 60_000, `the bounded hold is ${total}ms`);
});

test("deferBackoff waits the ladder value for the CURRENT head", async () => {
  const h = harness({ 8: "x" });
  const e = entry();
  await h.drainPage(e, page(8), null);
  await h.drainPage(e, page(8), null);
  assert.equal(h.deferralDelayMs(e.deferral.attempts), LISTENER.BACKOFF_BASE_MS * 2);
});

// ── STATIC PINS: the ordering itself, in the shipped source ──────────────────────────

test("the transport loop no longer writes the cursor at all — drainPage owns it", () => {
  assert.equal(/io\.setCursor\(entry\.channel\.id, m\.seq\)/.test(LOOP), false,
    "the per-message advance must not come back to channel-listener.js");
  // The seed drain keeps its own wholesale advance (backlog suppression, L1), and that is
  // the ONLY setCursor left in the loop.
  assert.equal((LOOP.match(/io\.setCursor\(/g) || []).length, 1, "exactly one, in the seed branch");
  assert.match(LOOP, /if \(maxSeq > since\) io\.setCursor\(entry\.channel\.id, maxSeq\);/);
});

test("drainPage dispatches BEFORE it advances, in that order, in the shipped source", () => {
  const body = SRC.slice(SRC.indexOf("async function drainPage("));
  const dispatch = body.indexOf("await dispatchMessage(entry, m, myUserId)");
  const advance = body.indexOf("io.setCursor(channelId, seq)");
  assert.ok(dispatch !== -1 && advance !== -1);
  assert.ok(dispatch < advance, "the cursor advance must stay downstream of the dispatch");
});

test("the fail-closed return in handleTrigger answers a REASON, not silence", () => {
  // ⚠ ONE DEFERRING RETURN, DOWN FROM TWO (2026-08-22, Samuel's INBOUND CONSENT RETIREMENT).
  // `return 'no-consent-row';` was the OTHER one — `consent.createConsentRequest` answers null on
  // ANY network error or non-2xx, and that null was the motivating incident at the head of this
  // file. There is no consent POST on this path any more: the ask is a native notification, so
  // the only thing that can stop it is having no runtime to launch. The C-3 CONTRACT is
  // unchanged and is what these cases pin — a reason string holds the cursor, silence advances
  // it — and `no-consent-row` still exercises it as a fixture above, because drainPage treats
  // every non-empty reason identically.
  assert.match(TRIGGER, /return 'no-agent-runtime';/);
  // It is the FIRST statement of the function, so a deferral can never leave a side effect
  // behind for the retry to duplicate. (It used to have to be stated as "upstream of
  // `watcher.register`"; there is no durable record to be half-written any more.)
  const body = TRIGGER.slice(TRIGGER.indexOf("async function handleTrigger("));
  assert.ok(body.indexOf("return 'no-agent-runtime';") < body.indexOf("notifyAsk({"),
    "the runtime probe must stay ahead of the notification it would otherwise raise");
  assert.equal(/return 'no-consent-row';/.test(TRIGGER), false,
    "the consent-row deferral is deleted with the row");
});
