// AGENT MODEL SELECTION — the desktop half (2026-08-22, Samuel's ruling).
//
// ── THE SHAPE, AND WHY IT IS TWO VOCABULARIES ────────────────────────────────────────────────
// The operator picks a MODEL for a channel; their agents run on it. The ruling names the values
// as FULL IDS and the SPA renders exactly those, while this tree's existing picker is a frozen
// list of ALIASES — deliberately, because an alias is version-stable and is what may become
// `--model` on a child process. Both are right about different things, so there are two frozen
// lists (`session-model.js › MODEL_IDS` / `MODEL_CHOICES`) and one map between them.
// `test/session-model.test.mjs` owns the lists; THIS file owns the WIRING:
//
//   DURABLE  the per-channel launch posture carries `model` beside the two axes — a third FIELD,
//            never a third AXIS. It validates SOFT (unknown = absent = the SDK default) where the
//            axes validate HARD (unknown = the whole write is refused).
//   LAUNCH   every lane that spawns hands it in. ⚠ INCLUDING the peer-triggered one, which may
//            NOT inherit the permission pair — hence two readers in `channel-prefs.js`.
//   LIVE     `Query.setModel` really switches a running session; main records the pick so a
//            park/resume keeps it.
//   REPORT   the summary carries the EFFECTIVE model, SDK-reported first.
//
// ⚠ THE SECURITY PROPERTY THIS FILE EXISTS FOR: the value ends up as `--model <argv>` on a
// `claude` child. Nothing anywhere may pass a string through — every layer coerces against a
// frozen list, and the LAST one is `buildSdkOptions`. These cases drive that from each entry.

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
  // ⚠ THE ASYMMETRY IS THE DESIGN. An unknown value on either AXIS rejects the whole write, so a
  // half-applied posture cannot exist. An unknown MODEL is simply not stored: absent means the SDK
  // default, which is what every channel that has never chosen one already does. Failing the write
  // would mean a desktop that has not heard of a newer model could not store a POSTURE at all.
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

// ── ⚠ STORAGE OMITS THE KEY; THE WIRE MUST NOT. THIS IS THE SEAM. ───────────────────────────
//
// The three cases above are about the STORED record, where an absent model is a MISSING KEY so
// that a pre-field record and a cleared one are the same record. The RENDERER is the opposite
// requirement, and reading `readPostureFrom` as if it were the wire is what broke it: the web's
// capability probe (`src/features/channels/lib/permission-modes.ts › hasModelKey`) is an OWN-KEY
// test — a missing `model` means "this desktop predates the field" and the Settings tab draws NO
// MODEL ROW at all. So a `getLaunchPosture` that answered the pair alone told every channel
// without a stored model that the feature did not exist, and the only way to store one is the row
// that was never drawn. A closed loop, green in every suite, with the feature unreachable.
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
  // ⚠ A REGEX BECAUSE THE REAL FUNCTION NEEDS electron-store. What it pins is the ONE property
  // source extraction cannot: that the store-backed reader routes through the same helper the
  // case above drives, rather than re-deriving the shape and drifting from it.
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

// ── 2. TWO READERS, AND WHY ──────────────────────────────────────────────────────────────────

test("READERS: the model has its OWN reader, so H2's posture census stays honest", () => {
  // ⚠ THE POINT OF THE SPLIT. `getLaunchPosture` has exactly ONE consumer and
  // `test/session-preset-start.test.mjs` pins the count, because a second reader of the stored
  // PERMISSION pair re-opens the failure H2 exists to prevent — a posture reaching a spawn nobody
  // is attending. A MODEL grants nothing and reaches no gate, so the PEER-TRIGGERED lane may
  // inherit it; keeping the two readers apart is what makes that distinction CHECKABLE rather
  // than a claim in a comment.
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
  // ⚠ THE BUG THIS CASE IS FOR. `session-launch.js › launch` built the `startSession` spec with no
  // `model` field at all, so `startSession`'s `normalizeModel(spec.model)` could only ever answer
  // 'default' for anything spawned through the funnel — which is every lane. The per-session
  // picker had one producer left (a resume's stored record) and no way in from a launch.
  const LAUNCH = read("session-launch.js");
  const spec = LAUNCH.slice(LAUNCH.indexOf("const s = await deps.startSession({"), LAUNCH.indexOf("}, sdk);"));
  assert.match(spec, /^\s*model: a\.model,$/m, "forwarded, never invented");
});

test("LAUNCH: both lanes convert the ID to the argv-safe ALIAS before it travels", () => {
  // Everything below the launch boundary speaks the alias vocabulary, and `buildSdkOptions`
  // re-coerces against it as the last gate. Converting at the boundary is what keeps a full id
  // from reaching a layer that would coerce it to 'default' and silently drop the pick.
  // ⚠ REPOINTED 2026-08-22: the launch body moved to `main/session-launch-op.js` (§1 split).
  // ⚠ AND THE CHAIN GREW A LINK IN FRONT OF IT. An AGENT TEMPLATE may carry a default model,
  // and it outranks the channel's durable pick — so the assertion is that the channel read is
  // still the FALLBACK of that expression, not that it is the whole of it. `templateModel`
  // answers '' (not 'default') when a template names no model or names one this build does
  // not know, which is what keeps an unknown template model falling THROUGH to this read
  // instead of ending the chain one link early.
  const OPS = read("session-launch-op.js");
  // ⚠ AND THE LAUNCH SHEET SITS IN FRONT OF BOTH SINCE PHASE 2: `overrides.model` is a
  // DELIBERATE PER-CALL CHOICE and the other two are DEFAULTS, which is the same ordering
  // argument the directive lane's explicit `model` param wins on.
  assert.match(OPS,
    /model: overrides\.model \|\| templateModel\(sessionModel, template\)\s*\|\| sessionModel\.aliasForModelId\(channelPrefs\.getLaunchModel\(p\.channelId\)\)/,
    "the operator's own Launch: the sheet, then the template default, then the channel's pick");
  // ⚠ THE RULE ITSELF MOVED TO `session-model.js › chainModel` ON 2026-08-23 (F-285) — the
  // DIRECTIVE lane needed the identical answer for its OWN link, and a rule written once per lane
  // is a rule that drifts in one of them. `templateModel` is now only "which field to read".
  assert.match(read("session-model.js"), /alias === 'default' \? '' : alias/,
    "an unrecognised model falls THROUGH to the next link, it does not end the chain");
  assert.match(OPS, /return sessionModel\.chainModel\(/,
    "the button lane must not restate the rule — it delegates");
  assert.match(read("launch-directives.js"), /model: sessionModel\.chainModel\(d\.model\)/,
    "…and so does the directive lane's own link, which used to be a ternary on aliasForModelId");
  assert.match(read("trigger.js"),
    /aliasForModelId\(channelPrefs\.getLaunchModel\(entry\.channel\.id\)\)/, "the peer-triggered lane");
});

test("LAUNCH: an unknown stored model degrades to the CLI's own pick, never to argv", () => {
  // Driven rather than asserted from source: the whole chain, id -> alias -> argv.
  for (const junk of JUNK) assert.equal(model.modelArg(model.aliasForModelId(junk)), null, JSON.stringify(junk));
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
  // Both halves matter. `s.model` is what `buildSdkOptions` reads on the NEXT assembly — a park,
  // a crash resume, the post-sign-in relaunch — so a switch that only called the SDK would revert
  // the operator's pick the first time the session was rebuilt.
  const seen = [];
  const h = live({ query: { setModel: async (m) => { seen.push(m); } } });
  return h.fn({ ...address, model: "claude-opus-5" }).then((res) => {
    assert.deepEqual(res, { ok: true, model: "opus" });
    assert.deepEqual(seen, ["opus"], "the ALIAS reaches the SDK, never the raw id");
    assert.equal(h.s.model, "opus", "…and it is recorded on the session object");
  });
});

test("LIVE: an unknown value CLEARS the override rather than being refused", () => {
  // "Let the CLI choose" is a legitimate thing to ask for, and is what an unset channel already
  // does. `setModel(undefined)` is the SDK's own way to spell it.
  const seen = [];
  const h = live({ query: { setModel: async (m) => { seen.push(m); } } });
  return h.fn({ ...address, model: "claude-opus-4-5" }).then((res) => {
    assert.deepEqual(res, { ok: true, model: "default" });
    assert.deepEqual(seen, [undefined], "no --model option at all");
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
  // ⚠ READ OFF THE BUNDLED SDK, NOT FROM MEMORY. `Query.setModel` is documented "Only available
  // in streaming input mode", and every session here runs in that mode by construction:
  // `sdk.query({ prompt: s.pushIterator })` takes an async iterable, never a string. If a future
  // SDK drops the method the shipped op degrades to record-only, which this file's "no query yet"
  // case already covers — but the claim in the docs would be wrong, so it is pinned.
  const sdk = readFileSync(
    join(HERE, "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"), "utf8");
  assert.match(sdk, /setModel\(model\?: string\): Promise<void>;/);
  // ⚠ 2026-08-31: the call moved to the runtime adapter (`runtime/claude/launch-spec.js › start`),
  // which takes the prompt off the OPAQUE spec core hands it. The condition is unchanged: the
  // prompt is the push iterator, never a string, so streaming input mode holds by construction.
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
  // ⚠ THREE PLACES MUST AGREE and a gap here does not fail, it deletes a feature silently: the
  // preload is ground truth, `src/shared/lib/spa-bridge.ts` is the shared declaration and
  // `apps/desktop-ui/src/lib/dopl-bridge.ts` is the mirror the SPA compiles against.
  const root = join(HERE, "..", "..");
  const shared = readFileSync(join(root, "src", "shared", "lib", "spa-bridge.ts"), "utf8");
  // ⚠ THE WIRE SHAPES MOVED TO `spa-bridge-shapes.ts` ON 2026-08-22 (the 500-line cap), and
  // `spa-bridge.ts` RE-EXPORTS them as the import path of record — so the FIELD is asserted where
  // it is declared and the RE-EXPORT is asserted separately. Reading only the ops file would go
  // green on a re-export that had quietly dropped a name.
  const shapes = readFileSync(join(root, "src", "shared", "lib", "spa-bridge-shapes.ts"), "utf8");
  const mirror = readFileSync(join(root, "apps", "desktop-ui", "src", "lib", "dopl-bridge.ts"), "utf8");
  assert.match(shapes, /model\?: string \| null;/, "DesktopSessionSummary carries it");
  assert.match(shared, /export type \{\s*DesktopSessionSummary,\s*DesktopNarrationEntry,\s*\} from "\.\/spa-bridge-shapes";/,
    "…and `spa-bridge` stays the import path of record for both shapes");
  assert.match(shared, /setModel\?\(/, "…and the shared declaration has the op");
  assert.match(mirror, /setModel\?\(/, "…and so does the mirror");
  assert.match(mirror, /preset: \{ tools: string; messages: string; model\?: string \}/,
    "the durable posture's third field is declared where the SPA writes it");
  assert.match(readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8"), /setModel: \(channelId, taskId, model, agentId\) =>/,
    "and the preload is the ground truth all three follow");
});
