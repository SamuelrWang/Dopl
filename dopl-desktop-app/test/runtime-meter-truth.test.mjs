// THE METER DECLARATION, HELD EQUAL TO WHAT THE ADAPTER ACTUALLY MEASURES (2026-09-22).
//
// ⚠ WHY THIS FILE EXISTS, AND IT IS SAMUEL'S QUESTION VERBATIM: *"we track a lot of things, like
// how many context tokens are left … are those things wired into Codex properly and correctly? I
// want to make sure that those things are not hard-coded or hardwired to fit Claude code."*
// `descriptor.meter` is the answer's SHAPE — a runtime states what it reports and core derives the
// rest — but a declaration nothing drives is a comment with syntax. Two of Codex's four members
// were WRONG for most of a day (`windowSource: 'config'` after the server started reporting its
// own window; `fields: null`, which means UNMEASURED, after three live breakdowns named the four)
// and every suite in the tree passed throughout, because nothing anywhere read either one.
//
// ⚠ SO THIS SUITE'S ONE REASON TO CHANGE IS: **does each adapter's METER DECLARATION match what
// its own normalizer really emits.** Not "is the descriptor well-formed" (`runtime-contract`), not
// "do the fields differ across runtimes" (`adapter-parity`) — those both pass on a confidently
// wrong value. The method is to DRIVE each shipped normalizer with a payload in that platform's
// own spelling and compare the CoreEvents against what its descriptor promised.
//
// ⚠ AND THE THIRD SECTION IS THE ANTI-HARDWIRING PROOF: a SYNTHETIC FOURTH ADAPTER, the idiom
// `session-runtime-truth.test.mjs § CXP-4` established. A rule that core gets right for Codex by
// naming Codex is a rule the next adapter inherits nothing from. Every derivation asserted there
// is driven off a runtime id no registry has ever heard of.
//
// Run: `node --test dopl-desktop-app/test/runtime-meter-truth.test.mjs`

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

const registry = require_(join(MAIN, "runtime/index.js"));
const sessionModel = require_(join(MAIN, "session-model.js"));
const codexNormalize = require_(join(MAIN, "runtime/codex/normalize.js"));
const claudeNormalize = require_(join(MAIN, "runtime/claude/normalize.js"));
const events = require_(join(MAIN, "runtime/events.js"));

// The SHIPPED projection, sliced with its two free vars injected — `session-metrics.js`'s own
// PURE-block idiom, so what is under test is the code that runs and not a restatement of it.
const METRICS = readFileSync(join(MAIN, "session-metrics.js"), "utf8");
const metrics = new Function(
  "contextWindowFor", "sessionHealth",
  `${fnOf(METRICS, "metricOrNull")}\n${fnOf(METRICS, "reportedWindow")}\n${fnOf(METRICS, "metrics")}\n return metrics;`
)(sessionModel.contextWindowFor, { health: () => ({}) });

const CTX = { channelId: "chan-1", peerName: "Ada", peerId: "peer-1" };
const first = (list, type) => (list || []).find((e) => e && e.type === type) || null;

// ── 1. `meter.windowSource` — DOES THE RUNTIME REALLY REPORT ITS OWN DENOMINATOR? ────────────

/**
 * The one measured Codex breakdown this file drives everything from.
 *
 * 🔒 MEASURED 2026-09-22 against `codex-cli 0.155.1` and transcribed verbatim from
 * `runtime/codex/normalize.js › tokensFrom`'s header: `totalTokens === inputTokens + outputTokens`
 * EXACTLY, with `cachedInputTokens` a SUBSET of the input rather than a term beside it, and
 * `modelContextWindow` a SIBLING of `last`/`total` rather than a member of either.
 */
const LAST = { totalTokens: 18838, inputTokens: 18833, cachedInputTokens: 7040, outputTokens: 5 };
const WINDOW = 258400;

/** What `runtime/codex/launch-spec.js › onNotification` folds onto the `turn/completed` frame. */
const codexTurn = (over = {}) => ({
  method: "turn/completed",
  params: {
    usage: { totalTokens: 18838, inputTokens: 18833, outputTokens: 5 },
    promptUsage: LAST,
    contextWindow: WINDOW,
    model: "gpt-5-codex",
    ...over,
  },
});

test("`windowSource: 'reported'` is a CLAIM, and the normalizer has to honour it", () => {
  const d = registry.descriptorFor("codex");
  assert.equal(d.meter.windowSource, "reported",
    "it read 'config' until 2026-09-22 and that was stale the moment the fold landed");
  const ev = first(codexNormalize.normalize(codexTurn(), CTX), "context");
  assert.ok(ev, "a measured turn emits a context event");
  assert.equal(ev.window, WINDOW,
    "a runtime declaring 'reported' must put a real denominator on the wire, or the word is a lie");
});

test("the runtimes that report NOTHING say so, and get `null` — never a zero denominator", () => {
  // ⚠ THE OTHER HALF OF THE CLAIM. `'table'` and `null` both mean "this platform does not state
  // its own window", and the proof is that the adapter calls `events.context` with two arguments.
  for (const id of ["claude", "cursor"]) {
    assert.notEqual(registry.descriptorFor(id).meter.windowSource, "reported", id);
  }
  // Driven rather than grepped, on the one of the two whose normalizer takes a plain message.
  const ev = first(claudeNormalize.normalize({
    type: "assistant",
    message: { usage: { input_tokens: 1200, output_tokens: 7, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 }, model: "claude-sonnet-5" },
  }, CTX), "context");
  assert.ok(ev, "the Claude lane still meters per assistant message");
  assert.equal(ev.window, null, "UNKNOWN STAYS DISTINCT FROM EMPTY — null, never 0");
});

test("a spelling this build has not seen reads as ABSENT, so the table still answers", () => {
  // ⚠ THE DECLARATION IS WHAT THIS BUILD MEASURED, NOT A PROMISE ABOUT EVERY LATER CLI. A renamed
  // field must fall back to the table, never paint an empty gauge over a live session.
  const ev = first(codexNormalize.normalize(codexTurn({ contextWindow: undefined }), CTX), "context");
  assert.equal(ev.window, null);
  for (const junk of [0, -1, "258400", null, NaN, Infinity, {}]) {
    const e = first(codexNormalize.normalize(codexTurn({ contextWindow: junk }), CTX), "context");
    assert.equal(e.window, null, JSON.stringify(String(junk)));
  }
});

// ── 2. `meter.fields` — A LIST IS A CLAIM TO HAVE READ THE PAYLOAD ───────────────────────────

test("`fields: null` means UNMEASURED, and Codex's is no longer null", () => {
  const d = registry.descriptorFor("codex");
  assert.deepEqual(d.meter.fields,
    ["inputTokens", "cachedInputTokens", "outputTokens", "totalTokens"],
    "three live breakdowns named these four; `null` would still be claiming nobody looked");
  // ⚠ EVERY DECLARED NAME IS ONE THE NORMALIZER REALLY READS. A list that named a field the
  // parser ignores would be the same "declared but not applied" failure in the other direction.
  for (const f of d.meter.fields) assert.ok(LAST[f] !== undefined, f);
});

test("🔒 `cachedInputTokens` IS A SUBSET OF THE INPUT, and the occupancy proves it", () => {
  // ⚠ THE DEFECT FIXED 2026-09-22, PINNED SO IT CANNOT COME BACK: the cached figure was ADDED ON
  // TOP, reporting a prompt of 25,873 against a real 18,833 — a meter that overstates occupancy by
  // whatever fraction of the prompt was cached, approaching double on a long thread.
  assert.equal(LAST.totalTokens, LAST.inputTokens + LAST.outputTokens,
    "the platform's OWN total excludes the cached term; the fixture is the measurement");
  const t = codexNormalize.tokensFrom(LAST);
  assert.equal(t.prompt, LAST.inputTokens, "occupancy is the input, NOT input + cached");
  assert.notEqual(t.prompt, LAST.inputTokens + LAST.cachedInputTokens);
  const ev = first(codexNormalize.normalize(codexTurn(), CTX), "context");
  assert.equal(ev.tokens, LAST.inputTokens);
});

test("the OTHER runtime's cache convention is additive, and the two are never reconciled in core", () => {
  // ⚠ WHY THIS IS A DESCRIPTOR FIELD AND NOT A SHARED HELPER. `cache_read_input_tokens` IS a term
  // beside the input on Claude and `cachedInputTokens` is NOT on Codex; a single "read the cache
  // field" path would have to be wrong for one of them. Each normalizer owns its own arithmetic.
  assert.deepEqual(registry.descriptorFor("claude").meter.fields,
    ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]);
  assert.equal(sessionModel.promptTokens({
    input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 100,
  }), 1600, "Claude's occupancy SUMS the cache terms — the opposite convention, declared apart");
});

// ── 3. `meter.cost` — HIDDEN, NEVER ZEROED ───────────────────────────────────────────────────

test("a runtime that reports no cost emits `null`, and `0` would be a budget that never trips", () => {
  assert.equal(registry.descriptorFor("codex").meter.cost, null);
  assert.equal(registry.capability.showsCostCap(registry.descriptorFor("codex")), false);
  const res = first(codexNormalize.normalize(codexTurn(), CTX), "result");
  assert.ok(res);
  assert.strictEqual(res.costUsd, null, "⚠ NOT 0 — `session-state.js › costCapReached` reads one number");
  // …and the runtimes that DO report one declare a currency, so the control is real.
  for (const id of ["claude", "cursor"]) {
    assert.equal(registry.capability.showsCostCap(registry.descriptorFor(id)), true, id);
    assert.equal(registry.descriptorFor(id).meter.cost.currency, "usd", id);
  }
});

// ── 4. ⚠ THE SYNTHETIC FOURTH ADAPTER — NO DERIVATION MAY BE KEYED ON A RUNTIME ID ───────────

test("a FOURTH runtime gets a percentage by REPORTING a window, never by being named", () => {
  // ⚠ THE RULE THIS WAVE IS MOST LIKELY TO LOSE (`session-runtime-truth.test.mjs § CXP-4`'s
  // idiom). Nothing in `session-model.js › contextEvent` or `session-metrics.js › metrics` may
  // know the word `codex`: an adapter nobody has written yet must get its denominator purely by
  // putting one on the wire, and a model id from no vendor this build has heard of must still
  // meter. Driven off exactly those — a made-up id and a made-up window.
  const ev = sessionModel.contextEvent(4096, "borg-3-turbo", 32768);
  assert.deepEqual(ev, { type: "context", tokens: 4096, window: 32768, model: "borg-3-turbo" });

  const m = metrics({ promptTokens: 4096, promptWindow: 32768, liveModel: "borg-3-turbo", runtimeId: "borg" });
  assert.equal(m.contextUsed, 4096);
  assert.equal(m.contextWindow, 32768, "the reported window is the denominator, whoever reported it");
});

test("…and a FOURTH runtime that reports NO window gets `null`, not a made-up one and not 0", () => {
  // ⚠ INVARIANTS: UNKNOWN STAYS DISTINCT FROM EMPTY. `contextWindowFor` answers null for a model
  // off every table, and the renderer draws raw tokens with no percentage. A `0` here is the lie —
  // a full meter on an empty session, or "0 tokens available" on a live one.
  const ev = sessionModel.contextEvent(4096, "borg-3-turbo", undefined);
  assert.equal(ev.window, null);
  const m = metrics({ promptTokens: 4096, liveModel: "borg-3-turbo", runtimeId: "borg" });
  assert.equal(m.contextWindow, null, "⚠ null — a zero denominator is a division nobody may do");
  assert.equal(m.contextUsed, 4096, "the numerator is still honest: measured, just undividable");
  // A window of 0 or junk on the wire falls THROUGH to the table rather than being spent.
  for (const junk of [0, -1, NaN, null, undefined, {}, [], "wide"]) {
    assert.equal(sessionModel.contextEvent(4096, "borg-3-turbo", junk).window, null, String(junk));
  }
  // ⚠ A NUMERIC STRING IS STOPPED AT THE SEAM, NOT DOWNSTREAM, AND IT MATTERS WHICH LAYER DOES IT.
  // `contextEvent` and `session-metrics.js › reportedWindow` both take `Number(x)`, so `'32768'`
  // WOULD be spent by either — it never reaches them, because the adapter boundary is TYPED:
  // `runtime/events.js › context` demands `typeof window === 'number'`. A string denominator
  // reaching a percentage untouched by anything that checks its type is what that line prevents,
  // and `session-io.js › applyCoreEvents` re-coerces once more before remembering it.
  assert.equal(events.context(10, "borg-3-turbo", "32768").window, null);
});

test("REGRESSION: the reported window BEATS the table, and Claude's table lookup is untouched", () => {
  // ⚠ PRECEDENCE, DRIVEN: a runtime that states its own denominator wins over a frozen
  // transcription of one vendor's registry, because the table is current by MAINTENANCE and the
  // wire is current by CONSTRUCTION.
  assert.equal(sessionModel.contextEvent(10, "claude-sonnet-5", 12345).window, 12345);
  // …and with nothing reported, every Claude session reads exactly what it always did.
  assert.equal(sessionModel.contextEvent(10, "claude-sonnet-5").window, 1000000);
  assert.equal(metrics({ promptTokens: 10, liveModel: "claude-haiku-4-5" }).contextWindow, 200000);
  assert.equal(metrics({ promptTokens: 10, liveModel: "claude-sonnet-5" }).contextWindow, 1000000);
});

test("the Claude-shaped model rules are never applied to another runtime's id", () => {
  // ⚠ `[1m]` AND THE DATED-ID RULE ARE ONE VENDOR'S SPELLING. They may answer for that vendor's
  // ids and must answer `null` — never a guessed window — for anybody else's.
  assert.equal(sessionModel.contextWindowFor("claude-sonnet-4-6[1m]"), 1000000);
  for (const id of ["gpt-5-codex", "gpt-5", "o4-mini", "borg-3-turbo", "gpt-5-codex[1m]-x", ""]) {
    assert.equal(sessionModel.contextWindowFor(id), null, id);
  }
});
