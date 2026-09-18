// The telemetry quantizer and the cadence floor (main/session-telemetry.js) — the orchestrator
// wave, 2026-08-22.
//
// The four properties, each the difference between shipping the rich fields and turning the
// state-change writer into a heartbeat:
//   1. A BUCKET IS A BUCKET. Sub-bucket drift produces the SAME number, so the digest that gates
//      every write cannot move on it.
//   2. THE FLOOR IS A DELAY, NOT A GATE ON EVERYTHING. Churn waits; a STATE change never does.
//   3. NULL SURVIVES EVERY STEP. `Math.floor(null / 5000) * 5000` is 0, and an unmeasured metric
//      has to draw an absent meter rather than a confident 0%.
//   4. THE MODULE STAYS PURE. It is required ABOVE `session-state-push.js`'s sentinel and injected
//      into that suite's `new Function`; one require here and both slices stop being evaluable.
//
// Run: `node --test dopl-desktop-app/test/session-telemetry.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);

const SRC = readFileSync(join(MAIN, "session-telemetry.js"), "utf8");
const t = require_(join(MAIN, "session-telemetry.js"));

// ── 0. THE PURITY THE SPLIT DEPENDS ON ───────────────────────────────────────────────────
//
// `session-state-push.js` requires this module ABOVE its BEGIN sentinel and the push harness
// injects the REAL thing into the sliced block. A `require` inside the pure block would fail as a
// ReferenceError at module load in that `new Function`, taking BOTH push suites down.
test("PURE: the sentinel block reaches nothing — no require, no electron, no fs", () => {
  const from = SRC.indexOf("// ─── BEGIN SESSION-TELEMETRY");
  const to = SRC.indexOf("// ─── END SESSION-TELEMETRY");
  assert.notEqual(from, -1, "BEGIN SESSION-TELEMETRY sentinel missing");
  assert.ok(to > from, "END SESSION-TELEMETRY sentinel missing or misplaced");
  // The scan is over CODE, not prose: stripping line comments first bans what the ban is actually
  // about, instead of tripping over the word "electron" in a header.
  const block = SRC.slice(from, to).replace(/^\s*\/\/.*$/gm, "");
  for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
    assert.equal(block.includes(banned), false, `the pure block must not reference ${banned}`);
  }
  // …and it really does evaluate in a bare scope, which is the property the harness spends.
  const built = new Function(`${block}\n return { quantizeTokens, floorAllows, stateDigest };`)();
  assert.equal(typeof built.quantizeTokens, "function");
});

// ── 1. THE CONSTANTS, PINNED WITH THEIR DERIVATIONS ──────────────────────────────────────
//
// Pinned as VALUES because every derivation in the module's header is arithmetic ON these numbers.
// A silent edit to one of them makes the prose a lie without failing anything else.
test("CONSTANTS: the three buckets and the floor are what the derivations were written about", () => {
  assert.equal(t.CONTEXT_BUCKET_FRACTION, 0.05, "5% of the window — one visible notch on the meter");
  assert.equal(t.CONTEXT_BUCKET_FALLBACK_TOKENS, 5000, "an absolute count, for a model with no window");
  assert.equal(t.TOKENS_BUCKET, 10000, "roughly one substantial turn");
  assert.equal(t.TELEMETRY_MIN_INTERVAL_MS, 10000, "=> at most 6 writes/min/workspace, and 0 when idle");
  // The relation the fallback's derivation claims: an UNKNOWN model is never quantized more
  // COARSELY than a known one. Asserted rather than trusted — the smallest known window is a fact
  // of `session-model.js`, not of this file.
  assert.ok(t.CONTEXT_BUCKET_FALLBACK_TOKENS < t.contextBucket(200_000),
    "finer than the smallest known window's bucket");
  assert.ok(t.CONTEXT_BUCKET_FALLBACK_TOKENS < t.contextBucket(1_000_000));
});

// ── 2. BUCKET BOUNDARIES ─────────────────────────────────────────────────────────────────

test("BUCKET: the context bucket is 5% of the session's OWN window", () => {
  assert.equal(t.contextBucket(200_000), 10_000);
  assert.equal(t.contextBucket(1_000_000), 50_000);
});

// The unknown model is the COMMON case, not the edge: `contextWindowFor` answers null for every
// model this build has never heard of, and it must never guess a denominator.
test("BUCKET: no denominator falls back to the absolute bucket, never to a guessed window", () => {
  for (const noWindow of [null, undefined, 0, -1, NaN, "200000", {}]) {
    assert.equal(t.contextBucket(noWindow), t.CONTEXT_BUCKET_FALLBACK_TOKENS,
      `a window of ${String(noWindow)} is not a window`);
  }
});

// A divide-by-zero guard, not a style choice: a window under 20 rounds 5% to 0.
test("BUCKET: a bucket is never zero, however small the window", () => {
  assert.equal(t.contextBucket(1), 1);
  assert.equal(t.contextBucket(10), 1);
  assert.ok(t.contextBucket(19) >= 1);
});

test("BOUNDARY: quantization is FLOOR — a value never claims occupancy that has not happened", () => {
  // 200k window => 10k buckets.
  assert.equal(t.quantizeContext(0, 200_000), 0);
  assert.equal(t.quantizeContext(9_999, 200_000), 0);
  assert.equal(t.quantizeContext(10_000, 200_000), 10_000, "exactly on the boundary IS the bucket");
  assert.equal(t.quantizeContext(10_001, 200_000), 10_000);
  assert.equal(t.quantizeContext(19_999, 200_000), 10_000);
  assert.equal(t.quantizeContext(20_000, 200_000), 20_000);
  assert.equal(t.quantizeContext(199_999, 200_000), 190_000);
  assert.equal(t.quantizeContext(200_000, 200_000), 200_000, "a full window reports full");
});

test("BOUNDARY: spend buckets at 10k, and the same floor rule", () => {
  assert.equal(t.quantizeTokens(0), 0);
  assert.equal(t.quantizeTokens(9_999), 0);
  assert.equal(t.quantizeTokens(10_000), 10_000);
  assert.equal(t.quantizeTokens(10_001), 10_000);
  assert.equal(t.quantizeTokens(1_234_567), 1_230_000);
});

// `0` and `null` are different claims and the wire keeps them apart: `null` = nothing has measured
// this, `0` = measured, and under one bucket. Collapsing the second into the first would erase the
// difference between an agent that has spent nothing and one this build cannot measure.
test("NULL: a measured-but-small value is 0, and an UNMEASURED one stays null", () => {
  assert.equal(t.quantizeTokens(1), 0, "measured, under a bucket");
  assert.equal(t.quantizeTokens(null), null, "not measured at all");
  assert.notEqual(t.quantizeTokens(1), t.quantizeTokens(null));
});

// ── 3. NULL PRESERVATION, THE `metricOrNull` DISCIPLINE RESTATED ─────────────────────────
//
// The arithmetic itself is the hazard: `Math.floor(null / 10000) * 10000` is 0, and the
// `undefined` form is NaN. Both would reach the server as a number.
test("NULL: every absence survives quantization as null, never as 0 and never as NaN", () => {
  for (const absent of [null, undefined, "", "84000", NaN, Infinity, -1, {}, []]) {
    assert.equal(t.quantizeTokens(absent), null, `${String(absent)} is not a measurement`);
    assert.equal(t.quantizeContext(absent, 200_000), null, `${String(absent)} is not a measurement`);
  }
});

// The two copies of the rule are pinned against each other: this block may hold no require, so
// `metricOrNull` is RESTATED here as `numberOrNull` — exactly the shape that drifts. Driven, not
// grepped.
test("NULL: `numberOrNull` agrees with `session-metrics.js › metricOrNull` value for value", () => {
  const { metricOrNull } = require_(join(MAIN, "session-metrics.js"));
  for (const v of [0, 1, 84_000, -1, -0.5, null, undefined, "", "7", NaN, Infinity, {}, [], true]) {
    assert.equal(t.numberOrNull(v), metricOrNull(v), `disagreement on ${String(v)}`);
  }
});

// ── 4. THE ROW'S FIFTEEN FIELDS ──────────────────────────────────────────────────────────
//
// Eight until 2026-09-01. The HEALTH half joined in the agent-efficiency wave (T25 / T50 / T51 /
// T83), derived by `main/session-health.js` and quantized (or deliberately not) here.

test("FIELDS: the fifteen are read off the summary's OWN names, quantized where the rule says", () => {
  const row = t.telemetryFields({
    detail: "tool",
    toolLabel: "Bash",
    model: "claude-opus-5",
    contextUsed: 137_777,
    contextWindow: 1_000_000, // => 50k buckets
    tokensSpent: 1_234_567,
    startedAt: 1_700_000_000_000,
    lastActivityAt: 1_700_000_600_000,
    turns: 7,
    tokensDelta: 44_444,
    stale: true,
    deniedCalls: 3,
    lastDeniedTool: "WebFetch",
    lastWakeSeq: 861,
    lastWakeAt: 1_700_000_500_000,
  });
  assert.deepEqual(row, {
    detail: "tool",
    toolLabel: "Bash",
    model: "claude-opus-5",
    contextUsed: 100_000, // floor(137777 / 50000) * 50000
    contextWindow: 1_000_000, // NOT quantized: it is the DENOMINATOR
    tokensSpent: 1_230_000,
    // ISO-8601, not epoch ms — the columns are TIMESTAMPTZ. See §4b.
    startedAt: "2023-11-14T22:13:20.000Z",
    lastActivityAt: "2023-11-14T22:23:20.000Z",
    // Small integers that move rarely are not quantized, and `turns` is the clearest case: the
    // difference between 1 turn and 4 IS the signal, so a bucket of 10 would delete it.
    turns: 7,
    // …and the delta takes `tokensSpent`'s own bucket, so the two cannot move independently.
    tokensDelta: 40_000,
    stale: true,
    deniedCalls: 3,
    lastDeniedTool: "WebFetch",
    lastWakeSeq: 861,
    lastWakeAt: "2023-11-14T22:21:40.000Z",
  });
});

// `stale` is the one boolean on the row and it is always present: a DERIVATION, not a measurement,
// so it has no "unmeasured" state to be in. The honest answer with nothing to go on is `false`.
test("FIELDS: `stale` is a boolean, never a null, and only a literal `true` is true", () => {
  for (const v of [undefined, null, false, 0, "", "true", 1, {}]) {
    assert.equal(t.telemetryFields({ stale: v }).stale, false, String(v));
  }
  assert.equal(t.telemetryFields({ stale: true }).stale, true);
});

// ── 4b. THE UNITS DO NOT SURVIVE THE CROSSING ────────────────────────────────────────────
//
// Everything on this machine speaks EPOCH MS; the COLUMNS are `TIMESTAMPTZ` and the push schema
// validates `z.string().datetime({ offset: true })`. So a raw number here 400s the WHOLE report,
// `retryable(400)` is false, and `read_sessions` answers `[]` for the machine for the life of the
// run. Pinned against the server's own source rather than a fixture, like `SESSION_KEY_RE`.
test("UNITS: the two stamps cross as ISO-8601 with an offset — the schema's own rule", () => {
  const SCHEMA = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "schema-sessions.ts"), "utf8"
  );
  for (const field of ["startedAt", "lastActivityAt"]) {
    assert.match(SCHEMA, new RegExp(`${field}: z\\.string\\(\\)\\.datetime\\(\\{ offset: true \\}\\)`),
      `${field} is a datetime string on the server, not a number`);
  }
  const row = t.telemetryFields({ startedAt: 1_700_000_000_000, lastActivityAt: 1 });
  for (const v of [row.startedAt, row.lastActivityAt]) {
    assert.equal(typeof v, "string");
    // The shape zod's `.datetime({ offset: true })` accepts.
    assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  }
});

test("UNITS: an absent, zero or unrepresentable stamp is null — never a thrown push", () => {
  for (const bad of [null, undefined, 0, -1, NaN, "2023-01-01", 8.64e15 * 10, {}]) {
    assert.equal(t.isoOrNull(bad), null, String(bad));
  }
});

// The three counts are `.int()` on the server, so a fractional one is a 400 that names the field.
// `contextWindow` is the risk: it is the only count that does NOT go through a bucket.
test("UNITS: the three counts are integers, contextWindow included", () => {
  const row = t.telemetryFields({ contextUsed: 7.9, contextWindow: 200_000.5, tokensSpent: 3.2 });
  for (const v of [row.contextUsed, row.contextWindow, row.tokensSpent]) {
    assert.ok(Number.isInteger(v), `${v} must be an integer`);
  }
});

// The server validates these three with `safeLabel(subject, N)` and zod validates the ARRAY, so
// one bad character in one `toolLabel` 400s the whole push unretryably. A tool name can come from
// the operator's own MCP servers, so the charset is not ours to assume.
test("LABELS: the bounds are the server's, field for field", () => {
  const SCHEMA = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "schema-sessions.ts"), "utf8"
  );
  for (const [field, subject, max] of [
    ["detail", "Session detail", t.DETAIL_MAX],
    ["toolLabel", "Tool label", t.TOOL_LABEL_MAX],
    ["model", "Model", t.MODEL_MAX],
  ]) {
    assert.match(SCHEMA, new RegExp(`${field}: safeLabel\\("${subject}", ${max}\\)`),
      `${field} must be bounded at the server's own ${max}`);
    const row = t.telemetryFields({ [field]: "x".repeat(max + 50) });
    assert.equal(row[field].length, max);
  }
});

test("LABELS: structure-forging characters are STRIPPED here, where the server would reject", () => {
  // The classes `SAFE_LABEL_RE` refuses: control, zero-width/bidi, line/paragraph separators.
  const row = t.telemetryFields({ toolLabel: "Ba sh​ mcp" });
  assert.equal(row.toolLabel, "Ba sh mcp");
  const SAFE = readFileSync(join(HERE, "..", "..", "src", "shared", "lib", "safe-label.ts"), "utf8");
  const re = new RegExp(SAFE.match(/SAFE_LABEL_RE =\s*(\/\^\[\^[^\n]*\/u);/)[1].slice(1, -2), "u");
  assert.ok(re.test(row.toolLabel), "what we send passes the rule the server enforces");
});

test("FIELDS: a session that has measured nothing yet reports nulls, not zeroes", () => {
  const row = t.telemetryFields({ state: "idle" });
  // Every measured field is null — fourteen of the fifteen. `deniedCalls: 0` would say "nothing
  // was refused", which is a claim nobody made.
  const { stale, ...measured } = row;
  assert.deepEqual(Object.values(measured), new Array(14).fill(null));
  // …and the one derivation is `false`, not null. See the `stale` case above.
  assert.equal(stale, false);
});

// `toolLabel` is a tool name, and a tool name can come from the operator's own MCP servers —
// counterparty-influenceable text on its way to a column another member's renderer reads.
test("FIELDS: display strings are collapsed and bounded before they cross", () => {
  const row = t.telemetryFields({ toolLabel: "  Bash\n\tinjected   line  ", model: "  " });
  assert.equal(row.toolLabel, "Bash injected line");
  assert.equal(row.model, null, "whitespace-only is absence, not an empty string");
  const long = t.telemetryFields({ toolLabel: "x".repeat(500) });
  assert.equal(long.toolLabel.length, t.TOOL_LABEL_MAX, "bounded at the server's own limit");
});

// ── 5. THE STATE HALF, AND THE FLOOR ─────────────────────────────────────────────────────
//
// The list is the floor's whole definition of "a state change". A field defaulted into this half
// bypasses the floor forever; defaulted out of it, something a peer's card is about can be
// delayed. So the membership is pinned, not derived.
test("STATE: the state half is the seven pre-orchestrator fields, plus three IDENTITIES", () => {
  assert.deepEqual([...t.STATE_FIELDS].sort(), [
    // `templateName` (2026-08-22), `color` (2026-09-13) and `displayName` (2026-09-16, F-708) are
    // IDENTITIES, not churn, so they sit PAST the cadence floor: each moves at most once per
    // session, so it costs nothing to put there, and `color` has to be past it or the transcript
    // paints NEUTRAL for up to `TELEMETRY_MIN_INTERVAL_MS`. F-708 was a correction —
    // `displayName` was on `reportRow` since 2026-08-31 but unclassified, so a rename moved the
    // full-row digest, missed `stateDigest`, and waited on the floor for a projection move a quiet
    // machine never makes.
    "channelId", "channelName", "color", "displayName", "name", "sessionKey", "state",
    "templateName", "threadId", "threadTitle",
  ]);
  // Stated as the RULE rather than as a member of a sorted list: every operator-authored IDENTITY
  // on the row is state, because a name a peer cannot see is a rename that did not happen.
  for (const identity of ["displayName", "templateName", "color", "name"]) {
    assert.equal(t.STATE_FIELDS.includes(identity), true, `${identity} is identity, not churn`);
  }
  for (const churn of ["detail", "toolLabel", "model", "contextUsed", "contextWindow",
    "tokensSpent", "startedAt", "lastActivityAt"]) {
    assert.equal(t.STATE_FIELDS.includes(churn), false, `${churn} is churn, not state`);
  }
});

const ROW = {
  sessionKey: "k", channelId: "c", threadId: "t", name: "a1b2c3d4", state: "working",
  channelName: "General", threadTitle: "Ship it",
  detail: "thinking", toolLabel: null, model: "claude-opus-5",
  contextUsed: 10_000, contextWindow: 200_000, tokensSpent: 0,
  startedAt: 1, lastActivityAt: 2,
};

test("STATE: churn does not move the state digest — that is the whole mechanism", () => {
  const base = t.stateDigest([ROW]);
  for (const churn of [
    { detail: "tool" }, { toolLabel: "Bash" }, { model: "claude-sonnet-5" },
    { contextUsed: 190_000 }, { tokensSpent: 9_990_000 },
    { startedAt: 999 }, { lastActivityAt: 1_700_000_600_000 },
  ]) {
    assert.equal(t.stateDigest([{ ...ROW, ...churn }]), base,
      `${Object.keys(churn)[0]} must not read as a state change`);
  }
});

test("STATE: the pill moving DOES move it, and so does set membership", () => {
  const base = t.stateDigest([ROW]);
  assert.notEqual(t.stateDigest([{ ...ROW, state: "idle" }]), base, "the pill");
  assert.notEqual(t.stateDigest([{ ...ROW, threadTitle: "Renamed" }]), base, "the thread title");
  // Arrival and departure: the replace protocol deletes by OMISSION, so a session leaving is a
  // shorter array and must never be mistaken for churn.
  assert.notEqual(t.stateDigest([ROW, { ...ROW, sessionKey: "k2" }]), base, "an agent arriving");
  assert.notEqual(t.stateDigest([]), base, "…and the last one leaving");
});

test("FLOOR: never floors a workspace this process has not written yet", () => {
  // The first write for a workspace is the one carrying its whole set — including the EMPTY
  // set that clears a previous run's rows. Delaying that is delaying the delete.
  for (const never of [null, undefined, NaN, "0"]) {
    assert.equal(t.floorAllows(never, 1_000), true, `${String(never)} means "never written"`);
  }
});

test("FLOOR: the boundary is inclusive, and it is measured from the last STORE", () => {
  const at = 1_000_000;
  assert.equal(t.floorAllows(at, at), false, "same instant");
  assert.equal(t.floorAllows(at, at + 9_999), false, "just inside");
  assert.equal(t.floorAllows(at, at + 10_000), true, "exactly on it");
  assert.equal(t.floorAllows(at, at + 60_000), true, "long past it");
});

// The cost ceiling the derivation claims, stated as an assertion: if this fails, the module
// header's "6 writes per minute per workspace" is no longer true.
test("FLOOR: the ceiling really is six writes a minute per workspace", () => {
  let last = null;
  let writes = 0;
  for (let ms = 0; ms < 60_000; ms += 100) { // a churn move every 100ms for a minute
    if (t.floorAllows(last, ms)) { writes += 1; last = ms; }
  }
  assert.equal(writes, 6);
});
