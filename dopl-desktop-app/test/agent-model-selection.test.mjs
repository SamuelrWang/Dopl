// AGENT MODEL SELECTION — the desktop half (2026-08-22, Samuel's ruling).
//
// TWO VOCABULARIES: the ruling names FULL IDS and the SPA renders those, while everything below the
// launch boundary speaks version-stable ALIASES (an alias is what may become `--model` on a child
// process). Hence two frozen lists in `session-model.js` and one map between them.
// `test/session-model.test.mjs` owns the lists; THIS file owns the WIRING:
//
//   DURABLE  the per-channel launch posture carries `model` beside the two axes — a third FIELD,
//            never a third AXIS. It validates SOFT (unknown = absent = the SDK default) where the
//            axes validate HARD (unknown = the whole write is refused).
//   LAUNCH   every lane that spawns hands it in, INCLUDING the peer-triggered one, which may NOT
//            inherit the permission pair — hence two readers in `channel-prefs.js`.
//   LIVE     `Query.setModel` really switches a running session; main records the pick so a
//            park/resume keeps it.
//   REPORT   the summary carries the EFFECTIVE model, SDK-reported first.
//
// THE SECURITY PROPERTY THIS FILE EXISTS FOR: the value ends up as `--model <argv>` on a `claude`
// child, so every layer coerces against a frozen list and the LAST one is `buildSdkOptions`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prefs, CH_A, CH_B } from "./_channel-prefs-block.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");
const model = require(join(MAIN, "session-model.js"));

const JUNK = ["", " ", null, undefined, 0, 1, true, {}, [], "opus", "claude-opus-4-5",
  "claude-opus-5 ", "--dangerously-skip-permissions", "claude-opus-5\n--model=x"];

// ── 1. THE DURABLE POSTURE ───────────────────────────────────────────────────────────────────

test("DURABLE: a valid model rides the pair and round-trips unchanged", () => {
  const map = {};
  const res = prefs.postureInto(map, CH_A, { tools: "bypass", messages: "auto_both", model: "claude-opus-5" });
  assert.equal(res.ok, true);
  assert.deepEqual(map[CH_A], { tools: "bypass", messages: "auto_both", model: "claude-opus-5" });
  assert.deepEqual(prefs.readPostureFrom(map, CH_A),
    { tools: "bypass", messages: "auto_both", model: "claude-opus-5" });
});

test("DURABLE: an UNKNOWN model is ABSENT, and the pair is still written", () => {
  // THE ASYMMETRY IS THE DESIGN. An unknown value on either AXIS rejects the whole write, so a
  // half-applied posture cannot exist. An unknown MODEL is simply not stored: absent means the SDK
  // default. Failing the write would stop a desktop that has not heard of a newer model from
  // storing a POSTURE at all.
  for (const junk of JUNK) {
    const map = {};
    const res = prefs.postureInto(map, CH_A, { tools: "auto", messages: "ask", model: junk });
    assert.equal(res.ok, true, JSON.stringify(junk));
    assert.deepEqual(map[CH_A], { tools: "auto", messages: "ask" }, JSON.stringify(junk));
    assert.equal("model" in map[CH_A], false, "absent is a MISSING KEY, never '' or null");
  }
});

test("DURABLE: an unknown AXIS still refuses the whole write, model or no model", () => {
  const map = {};
  assert.deepEqual(prefs.postureInto(map, CH_A, { tools: "YOLO", messages: "ask", model: "claude-opus-5" }),
    { ok: false });
  assert.deepEqual(map, {}, "nothing is stored — not even the valid model");
});

test("DURABLE: a record written BEFORE this field reads back as the pair alone", () => {
  const map = { [CH_A]: { tools: "manual", messages: "ask" } };
  assert.deepEqual(prefs.readPostureFrom(map, CH_A), { tools: "manual", messages: "ask" });
});

// ── STORAGE OMITS THE KEY; THE WIRE MUST NOT. THIS IS THE SEAM. ─────────────────────────────
//
// The web's capability probe (`src/features/channels/lib/permission-modes.ts › hasModelKey`) is an
// OWN-KEY test: a missing `model` means "this desktop predates the field" and the Settings tab draws
// NO MODEL ROW at all. So a `getLaunchPosture` answering the pair alone told every channel without a
// stored model that the feature did not exist — and the only way to store one is the row that was
// never drawn. A closed loop, green in every suite, with the feature unreachable.
test("WIRE: the effective read ALWAYS carries `model`, so the capability probe can see it", () => {
  // A channel that has never chosen anything: the restrictive pair, and an EXPLICIT null.
  const fresh = prefs.effectivePosture({}, CH_A);
  assert.deepEqual(fresh, { tools: "manual", messages: "ask", model: null });
  assert.equal("model" in fresh, true, "an own-key probe must find the key on a fresh channel");

  // A record written before the field existed: same answer. Absent is KNOWN-ABSENT here.
  const legacy = prefs.effectivePosture({ [CH_A]: { tools: "auto", messages: "ask" } }, CH_A);
  assert.deepEqual(legacy, { tools: "auto", messages: "ask", model: null });

  // And "Default" — the web writes `''`, which stores no key and must still read as null
  // rather than as a desktop with no model concept.
  const cleared = {};
  prefs.postureInto(cleared, CH_A, { tools: "auto", messages: "ask", model: "" });
  assert.equal("model" in cleared[CH_A], false, "storage still omits it");
  assert.equal(prefs.effectivePosture(cleared, CH_A).model, null, "the wire still states it");

  // A real pick rides through unchanged.
  const picked = {};
  prefs.postureInto(picked, CH_A, { tools: "bypass", messages: "auto_both", model: "claude-opus-5" });
  assert.equal(prefs.effectivePosture(picked, CH_A).model, "claude-opus-5");
});

test("WIRE: `getLaunchPosture` is that composition, not a second spelling of it", () => {
  // A REGEX BECAUSE THE REAL FUNCTION NEEDS electron-store. It pins the one property source
  // extraction cannot: that the store-backed reader routes through the same helper the case above
  // drives, rather than re-deriving the shape and drifting from it.
  const PREFS = read("channel-prefs.js");
  const body = PREFS.slice(PREFS.indexOf("function getLaunchPosture("));
  assert.match(body.slice(0, body.indexOf("}")), /effectivePosture\(getAllPostures\(\), channelId\)/);
});

test("DURABLE: two channels hold independent models", () => {
  const map = {};
  prefs.postureInto(map, CH_A, { tools: "manual", messages: "ask", model: "claude-fable-5" });
  prefs.postureInto(map, CH_B, { tools: "manual", messages: "ask" });
  assert.equal(prefs.readPostureFrom(map, CH_A).model, "claude-fable-5");
  assert.equal("model" in prefs.readPostureFrom(map, CH_B), false);
});

test("DURABLE: extra properties are still dropped whole", () => {
  const map = {};
  prefs.postureInto(map, CH_A, { tools: "auto", messages: "ask", model: "claude-sonnet-5", at: 1, evil: "x" });
  assert.deepEqual(Object.keys(map[CH_A]).sort(), ["messages", "model", "tools"]);
});

// ── ABSENT IS UNCHANGED; SUPPLIED IS OBEYED. THE OTHER SEAM. ────────────────────────────────
//
// The durable record is rewritten WHOLE on every posture change, and the preload used to coerce
// `model` unconditionally — so a write from any surface that does not carry the field arrived as
// `model: ''`, stored no key, and silently dropped the operator's pick while the Settings row still
// read Opus. `{ model: undefined }` HAS the own key, so it is a caller SAYING "no model" and still
// clears; only a `raw` with no `model` key at all preserves (INVARIANTS §11).
test("SUPPLIED-ONLY: a write that never mentions the model leaves the stored pick alone", () => {
  const map = {};
  prefs.postureInto(map, CH_A, { tools: "bypass", messages: "auto_both", model: "claude-opus-5" });
  // The Permissions row moves; this payload carries no `model` key at all.
  const res = prefs.postureInto(map, CH_A, { tools: "manual", messages: "ask" });
  assert.equal(res.ok, true);
  assert.deepEqual(map[CH_A], { tools: "manual", messages: "ask", model: "claude-opus-5" },
    "the axes moved and the pick survived");
  assert.deepEqual(res.preset, map[CH_A], "…and the reply states what was STORED, not what was asked");
});

test("SUPPLIED-ONLY: an explicit '' still CLEARS it — the Default row is a real pick", () => {
  const map = {};
  prefs.postureInto(map, CH_A, { tools: "auto", messages: "ask", model: "claude-opus-5" });
  prefs.postureInto(map, CH_A, { tools: "auto", messages: "ask", model: "" });
  assert.equal("model" in map[CH_A], false, "supplied absence is absence, and storage omits the key");
  // …and an UNRECOGNISED id is a supplied value too: it validates SOFT to the same absence, which
  // is the 2026-08-22 rule and is deliberately not what a MISSING key does.
  prefs.postureInto(map, CH_A, { tools: "auto", messages: "ask", model: "claude-opus-5" });
  prefs.postureInto(map, CH_A, { tools: "auto", messages: "ask", model: "claude-opus-4-5" });
  assert.equal("model" in map[CH_A], false, "an unknown id clears; only a MISSING key preserves");
});

test("SUPPLIED-ONLY: the two ends agree — the preload spreads, the validator probes the key", () => {
  // SOURCE-ASSERTED BECAUSE THE HOLE IS AT AN END, NOT IN THE MIDDLE. Either half alone leaves the
  // rule broken at whichever end forgot, and neither end can drive the other in-process: the preload
  // needs `electron`, and the validator is sliced pure.
  const PRELOAD = readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8");
  assert.match(PRELOAD, /\.\.\.\(preset && preset\.model !== undefined \? \{ model: asMode\(preset\.model\) \} : \{\}\)/,
    "the preload forwards the key ONLY when the caller supplied one");
  assert.ok(!/model: asMode\(preset && preset\.model\)/.test(PRELOAD),
    "…and the unconditional coercion is gone, not merely shadowed by a second spelling");
  assert.match(read("channel-prefs.js"), /hasOwnProperty\.call\(raw, 'model'\)/,
    "…and main tells a missing key from a supplied one, which is the other half");
});

// ── 2. TWO READERS, AND WHY ──────────────────────────────────────────────────────────────────

test("READERS: the model has its OWN reader, so H2's posture census stays honest", () => {
  // THE POINT OF THE SPLIT. `getLaunchPosture` has exactly ONE consumer and
  // `test/session-preset-start.test.mjs` pins the count, because a second reader of the stored
  // PERMISSION pair re-opens the failure H2 exists to prevent. A MODEL grants nothing and reaches no
  // gate, so the PEER-TRIGGERED lane may inherit it; two readers make that distinction CHECKABLE.
  const PREFS = read("channel-prefs.js");
  assert.match(PREFS, /function getLaunchModel\(channelId\)/);
  const body = PREFS.slice(PREFS.indexOf("function getLaunchModel("), PREFS.indexOf("module.exports = {"));
  assert.ok(!/getLaunchPosture\(/.test(body),
    "the model reader must not go through the posture reader, or the census cannot tell them apart");
  // …and the peer-triggered lane reads the MODEL and nothing else from that record.
  const TRIGGER = read("trigger.js");
  assert.match(TRIGGER, /channelPrefs\.getLaunchModel\(entry\.channel\.id\)/);
  const code = TRIGGER.split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
    .join("\n");
  assert.ok(!/getLaunchPosture|launchStartModes/.test(code),
    "a peer-driven launch must still not inherit the operator's PERMISSION posture");
});

// ── 3. THE LAUNCH LANES ──────────────────────────────────────────────────────────────────────

test("LAUNCH: the spawn funnel FORWARDS a model — it used to drop one on every lane", () => {
  // THE BUG THIS CASE IS FOR: `session-launch.js › launch` built the `startSession` spec with no
  // `model` field at all, so `normalizeModel(spec.model)` could only answer 'default' for anything
  // spawned through the funnel — which is every lane.
  const LAUNCH = read("session-launch.js");
  const spec = LAUNCH.slice(LAUNCH.indexOf("const s = await deps.startSession({"), LAUNCH.indexOf("}, sdk);"));
  assert.match(spec, /^\s*model: a\.model,$/m, "forwarded, never invented");
});

test("LAUNCH: both lanes convert the ID to the argv-safe ALIAS before it travels", () => {
  // Everything below the launch boundary speaks the alias vocabulary, and `buildSdkOptions`
  // re-coerces against it as the last gate. An AGENT TEMPLATE may carry a default model and it
  // outranks the channel's durable pick, so the channel read is the FALLBACK of the expression, not
  // the whole of it; `templateModel` answers '' (not 'default') for an unknown template model, which
  // is what keeps it falling THROUGH instead of ending the chain one link early.
  const OPS = read("session-launch-op.js");
  // The launch sheet sits in front of both since Phase 2: `overrides.model` is a DELIBERATE PER-CALL
  // CHOICE and the other two are DEFAULTS.
  assert.match(OPS,
    /model: overrides\.model \|\| templateModel\(sessionModel, template\)\s*\|\| sessionModel\.aliasForModelId\(channelPrefs\.getLaunchModel\(p\.channelId\)\)/,
    "the operator's own Launch: the sheet, then the template default, then the channel's pick");
  // The rule itself moved to `session-model.js › chainModel` on 2026-08-23 (F-285): the DIRECTIVE
  // lane needed the identical answer, and a rule written once per lane drifts in one of them.
  assert.match(read("session-model.js"), /alias === 'default' \? '' : alias/,
    "an unrecognised model falls THROUGH to the next link, it does not end the chain");
  assert.match(OPS, /return sessionModel\.chainModel\(/,
    "the button lane must not restate the rule — it delegates");
  // The chain moved with `spawn` on 2026-09-01 (the §1 split); the precedence is unchanged.
  assert.match(read("launch-directive-spawn.js"), /model: sessionModel\.chainModel\(d\.model\)/,
    "…and so does the directive lane's own link, which used to be a ternary on aliasForModelId");
  assert.match(read("trigger.js"),
    /aliasForModelId\(channelPrefs\.getLaunchModel\(entry\.channel\.id\)\)/, "the peer-triggered lane");
});

test("LAUNCH: an unknown stored model degrades to the PRODUCT FALLBACK, never to argv", () => {
  // Driven rather than asserted from source: the whole chain, id -> alias -> argv.
  // The degradation target moved 2026-09-06 (back-fill ruling): an unpicked channel launches
  // `LAUNCH_MODEL_FALLBACK` rather than leaving `--model` off. What the case is about is unchanged:
  // the junk itself must never reach argv.
  const fallback = model.aliasForModelId(model.LAUNCH_MODEL_FALLBACK);
  for (const junk of JUNK) {
    assert.equal(model.modelArg(model.aliasForModelId(junk)), fallback, JSON.stringify(junk));
  }
  for (const id of model.MODEL_IDS) {
    const arg = model.modelArg(model.aliasForModelId(id));
    assert.match(arg, /^[a-z]+$/, id);
  }
});

// ── 4. THE LIVE SWITCH ───────────────────────────────────────────────────────────────────────

/** `setModelByTask`, sliced from the shipped op and driven against a fake registry + query. */
function live({ query, settled = false } = {}) {
  const src = read("session-reopen.js");
  const resolver = src.slice(src.indexOf("function resolveSession("), src.indexOf("// PURE READ —"));
  const body = resolver + src.slice(
    src.indexOf("async function setModelByTask("),
    src.indexOf("// ── THE DIRECT 1:1 LANE")
  );
  const s = { key: "c:t:a1b2c3d4", agentId: "a1b2c3d4", settled, model: "default", query };
  const sessions = new Map([[s.key, s]]);
  const fn = new Function(
    "deps", "store", "sessionModel",
    `${body}\n return setModelByTask;`
  )(
    { sessions },
    { slotKey: (x) => `${x.channelId || ""}:${x.taskId || ""}:${x.agentId || ""}`,
      threadKeyPrefix: (c, t) => `${c || ""}:${t || ""}:` },
    model
  );
  return { fn, s };
}

const address = { channelId: "c", taskId: "t", agentId: "a1b2c3d4" };

test("LIVE: the SDK is told, and the pick is RECORDED for the next assembly", () => {
  // Both halves matter. `s.model` is what `buildSdkOptions` reads on the NEXT assembly — a park, a
  // crash resume, the post-sign-in relaunch — so a switch that only called the SDK would revert the
  // operator's pick the first time the session was rebuilt.
  const seen = [];
  const h = live({ query: { setModel: async (m) => { seen.push(m); } } });
  return h.fn({ ...address, model: "claude-opus-5" }).then((res) => {
    assert.deepEqual(res, { ok: true, model: "opus" });
    assert.deepEqual(seen, ["opus"], "the ALIAS reaches the SDK, never the raw id");
    assert.equal(h.s.model, "opus", "…and it is recorded on the session object");
  });
});

test("LIVE: an unknown value RESETS to the product default rather than being refused", () => {
  // 2026-09-06: "Default" was removed as an option and an unpicked channel was ruled to run
  // `LAUNCH_MODEL_FALLBACK`, so there is nothing left to clear TO. The property the case exists for
  // is untouched — an unknown value is ACCEPTED and normalized, never refused — and `s.model` still
  // records `'default'`, which is "no explicit pick", not a model name.
  const seen = [];
  const h = live({ query: { setModel: async (m) => { seen.push(m); } } });
  return h.fn({ ...address, model: "claude-opus-4-5" }).then((res) => {
    assert.deepEqual(res, { ok: true, model: "default" });
    assert.deepEqual(seen, [model.aliasForModelId(model.LAUNCH_MODEL_FALLBACK)],
      "the product fallback, which is what an unpicked channel launches");
    assert.equal(h.s.model, "default");
  });
});

test("LIVE: a THROWING switch records NOTHING — a pick nothing applied is a lie", () => {
  const h = live({ query: { setModel: async () => { throw new Error("query is gone"); } } });
  return h.fn({ ...address, model: "claude-fable-5" }).then((res) => {
    assert.deepEqual(res, { ok: false, reason: "switch-failed" });
    assert.equal(h.s.model, "default", "the previous pick survives an attempt that did not land");
  });
});

test("LIVE: a settled or unknown session refuses, and never touches a query", () => {
  const settled = live({ query: { setModel: async () => {} }, settled: true });
  return settled.fn({ ...address, model: "claude-opus-5" }).then((res) => {
    assert.deepEqual(res, { ok: false, reason: "no-session" });
    const wrong = live({ query: { setModel: async () => {} } });
    return wrong.fn({ ...address, agentId: "z9y8x7w6", model: "claude-opus-5" }).then((r2) => {
      assert.deepEqual(r2, { ok: false, reason: "no-session" },
        "a wrong agent id resolves NOTHING — switching a different agent's model is worse than refusing");
    });
  });
});

test("LIVE: a session with no query yet is still recorded, so its first launch uses the pick", () => {
  // A SPAWN-IDLE agent has no `claude` child at all. There is nothing to tell, and the record is
  // the whole of the switch — `buildSdkOptions` reads it when the wake starts the query.
  const h = live({ query: null });
  return h.fn({ ...address, model: "claude-sonnet-5" }).then((res) => {
    assert.deepEqual(res, { ok: true, model: "sonnet" });
    assert.equal(h.s.model, "sonnet");
  });
});

test("LIVE: the SDK really supports this — it is a switch, not a deferral", () => {
  // READ OFF THE BUNDLED SDK, NOT FROM MEMORY. `Query.setModel` is documented "Only available in
  // streaming input mode", and every session here runs in that mode by construction:
  // `sdk.query({ prompt: s.pushIterator })` takes an async iterable, never a string.
  const sdk = readFileSync(
    join(HERE, "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"), "utf8");
  assert.match(sdk, /setModel\(model\?: string\): Promise<void>;/);
  // 2026-08-31: the call moved to the runtime adapter (`runtime/claude/launch-spec.js › start`).
  // The condition is unchanged: the prompt is the push iterator, never a string.
  assert.match(read("runtime/claude/launch-spec.js"), /sdk\.query\(\{ prompt: spec\.prompt/,
    "streaming input mode, which is the condition on the method");
  assert.match(read("session-query.js"), /s\.pushIterator = io\.makePushIterator\(\);/,
    "…and the prompt core puts on the spec is that iterator");
});

// ── 5. WHAT THE UI IS TOLD ───────────────────────────────────────────────────────────────────

test("REPORT: the summary reports the SDK's own model over the operator's pick", () => {
  const SUMMARY = read("session-summary.js");
  assert.match(SUMMARY, /model: \(s && s\.liveModel\) \|\| modelPick\(s\),/);
  const pick = SUMMARY.slice(SUMMARY.indexOf("function modelPick(s) {"), SUMMARY.indexOf("/** One LIVE session"));
  assert.match(pick, /pick !== 'default' \? pick : null/,
    "'default' names no model and must not be rendered as one");
});

test("REPORT: the bridge declares the field and the op, in BOTH trees", () => {
  // THREE PLACES MUST AGREE and a gap here does not fail, it deletes a feature silently: the preload
  // is ground truth, `src/shared/lib/spa-bridge.ts` is the shared declaration and
  // `apps/desktop-ui/src/lib/dopl-bridge.ts` is the mirror the SPA compiles against.
  const root = join(HERE, "..", "..");
  const shared = readFileSync(join(root, "src", "shared", "lib", "spa-bridge.ts"), "utf8");
  // The wire SHAPES moved to `spa-bridge-shapes.ts` on 2026-08-22 and `spa-bridge.ts` RE-EXPORTS
  // them as the import path of record — so the FIELD is asserted where it is declared and the
  // RE-EXPORT separately. Reading only one file goes green on a re-export that dropped a name.
  const shapes = readFileSync(join(root, "src", "shared", "lib", "spa-bridge-shapes.ts"), "utf8");
  const mirror = readFileSync(join(root, "apps", "desktop-ui", "src", "lib", "dopl-bridge.ts"), "utf8");
  // The OPS moved to `spa-bridge-sessions.ts` on 2026-09-17, at the same cap and on the same terms
  // as the shapes split above — hence the same two assertions.
  const sessionOps = readFileSync(join(root, "src", "shared", "lib", "spa-bridge-sessions.ts"), "utf8");
  assert.match(shapes, /model\?: string \| null;/, "DesktopSessionSummary carries it");
  assert.match(shared, /export type \{\s*DesktopSessionSummary,\s*DesktopNarrationEntry,\s*\} from "\.\/spa-bridge-shapes";/,
    "…and `spa-bridge` stays the import path of record for both shapes");
  assert.match(shared, /sessions\?: SpaBridgeSessions;/, "…and for the ops namespace");
  assert.match(shared, /export type \{ SpaBridgeSessions \} from "\.\/spa-bridge-sessions";/,
    "…which is re-exported from it, so one import path stays canonical");
  assert.match(sessionOps, /setModel\?\(/, "…and the shared declaration has the op");
  assert.match(mirror, /setModel\?\(/, "…and so does the mirror");
  assert.match(mirror, /preset: \{ tools: string; messages: string; model\?: string \}/,
    "the durable posture's third field is declared where the SPA writes it");
  assert.match(readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8"), /setModel: \(channelId, taskId, model, agentId\) =>/,
    "and the preload is the ground truth all three follow");
});
