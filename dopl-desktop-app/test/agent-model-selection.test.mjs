// AGENT MODEL SELECTION — the desktop half (2026-08-22, Samuel's ruling; the CHANNEL/PROFILE model
// setting DELETED 2026-09-23, Samuel: "We don't need a pin model in the settings").
//
// TWO VOCABULARIES: the ruling names FULL IDS and the SPA renders those, while everything below the
// launch boundary speaks version-stable ALIASES (an alias is what may become `--model` on a child
// process). Hence two frozen lists in `session-model.js` and one map between them.
// `test/session-model.test.mjs` owns the lists; THIS file owns the WIRING:
//
//   NO PIN   no launch record stores a model any more — not the channel's, not the profile
//            defaults'. A legacy one on disk is dropped on read and never written back.
//   LAUNCH   every lane resolves launcher pick > identity model > the RUNTIME's default
//            (`runtime/launch-default.js`, applied once in the funnel).
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
import { legacyPreset } from "./_channel-prefs-block.mjs";
import { between, codeOf, fnOf, orderOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");
const model = require(join(MAIN, "runtime", "claude", "model-table.js"));
// U10 (2026-09-21): `setModelByTask`'s new free vars. REAL, never stubbed — `main/runtime/index.js`
// is electron-free by contract, so the live-switch refusal is asked of the SHIPPED descriptors.
const RUNTIME_REGISTRY = require(join(MAIN, "runtime/index.js"));

const JUNK = ["", " ", null, undefined, 0, 1, true, {}, [], "opus", "claude-opus-4-5",
  "claude-opus-5 ", "--dangerously-skip-permissions", "claude-opus-5\n--model=x"];

/** Source with comments blanked, so a tombstone naming a deleted symbol does not count. */
const code = codeOf;

// ── 1. NO STORED MODEL (2026-09-23) ──────────────────────────────────────────────────────────

test("NO PIN: a legacy record on disk that still carries a model reads back as the pair alone", () => {
  assert.deepEqual(legacyPreset({ tools: "manual", messages: "ask", model: "claude-fable-5" }),
    { tools: "manual", messages: "ask" });
});

// ── THE WIRE CARRIES NO `model` KEY, AND ITS ABSENCE IS THE POINT ────────────────────────────
//
// The web's capability probe (`src/features/channels/lib/permission-modes.ts › hasModelKey`) is an
// OWN-KEY test: a missing `model` means "this desktop has no model setting" and the Settings tab
// draws NO model row. So an OLDER renderer meeting this build hides the row too.
test("WIRE: `getLaunchPosture` is that composition, not a second spelling of it", () => {
  // A REGEX BECAUSE THE REAL FUNCTION NEEDS electron-store. The reader is the VERSIONED,
  // RUNTIME-KEYED selection, rendered back into the legacy wire.
  const PREFS = read("channel-prefs.js");
  assert.match(fnOf(PREFS, "getLaunchPosture"), /toLegacyPosture\(ctx\(\), getLaunchSelection\(channelId\)\)/);
  assert.ok(!/model/.test(fnOf(code(read("launch-selection.js")), "toLegacyPosture")),
    "the legacy wire shape must not grow the key back");
});

test("PRELOAD: the posture and defaults writes forward NO model key", () => {
  const PRELOAD = code(readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8"));
  assert.ok(!/preset\.model/.test(PRELOAD), "setLaunchPosture no longer forwards `model`");
  assert.ok(!/defaults\.model/.test(PRELOAD), "setAgentDefaults no longer forwards `model`");
  assert.ok(!/record\.model/.test(PRELOAD), "the runtime-keyed records no longer carry one");
});

// ── 2. THE CHANNEL MODEL READERS ARE GONE ────────────────────────────────────────────────────

test("READERS: no channel-model reader survives, and no launch lane calls one", () => {
  const PREFS = code(read("channel-prefs.js"));
  assert.ok(!/function getLaunchModel/.test(PREFS), "getLaunchModel / getLaunchModelLink are deleted");
  for (const f of ["session-launch-op.js", "launch-directive-spawn.js", "trigger.js"]) {
    assert.ok(!/getLaunchModel/.test(code(read(f))), `${f} must not read a channel model`);
  }
  // …and the peer-triggered lane STILL does not inherit the operator's PERMISSION posture (H2).
  assert.ok(!/getLaunchPosture|launchStartModes/.test(code(read("trigger.js"))),
    "a peer-driven launch must still not inherit the operator's PERMISSION posture");
});

// ── 3. THE LAUNCH LANES ──────────────────────────────────────────────────────────────────────

test("LAUNCH: the spawn funnel FORWARDS the resolved model — launcher/identity pick or runtime default", () => {
  const LAUNCH = read("session-launch.js");
  assert.match(LAUNCH, /const model = await launchDefault\.withRuntimeDefault\(rt, a\.model\);/,
    "the runtime default is applied ONCE, in the funnel every lane shares");
  const spec = between(LAUNCH, "const s = await deps.startSession({", "}, rt);");
  assert.match(spec, /^\s*model,$/m, "forwarded, never invented by a lane");
  assert.ok(orderOf(LAUNCH, "await refuseUnknownModel(a.runtime, a.model)", "await launchDefault.withRuntimeDefault(rt, a.model)"),
  "an explicit unknown model is refused BEFORE a default could be substituted");
});

test("LAUNCH: every lane's chain is launcher pick > identity model, and nothing below it", () => {
  const OPS = read("session-launch-op.js");
  assert.match(OPS,
    /const model = overrides\.model\s*\|\| await launchDefault\.identityModelFor\(runtimeId, identity && identity\.model, identity && identity\.runtime\);/,
    "the operator's own Launch: the sheet, then the identity default ON THE LAUNCH RUNTIME — the funnel does the rest");
  const { pickOf } = require(join(MAIN, "runtime", "selection-vocabulary.js"));
  assert.equal(pickOf("claude-opus-6[1m]"), "claude-opus-6[1m]", "a model this build predates commits the chain");
  assert.equal(pickOf("default"), "");
  assert.equal(pickOf("  "), "");
  const DIRECTIVE = read("launch-directive-spawn.js");
  assert.match(DIRECTIVE,
    /return pickOf\(d\.model\)\s*\|\| require\('\.\/runtime\/launch-default'\)\.identityModelFor\(runtimeId, identity && identity\.model, identity && identity\.runtime\);/,
    "the directive lane, ONE path for every runtime: the directive's `model`, then the identity's on the launch runtime");
  // P3-09: no second model check on the directive lane — no roster spawn, no pre-resolved default.
  assert.doesNotMatch(DIRECTIVE, /\.models\(\)|withRuntimeDefault/,
    "the funnel owns the unknown-model refusal and the runtime default");
});

test("LAUNCH: an unknown stored model degrades to the PRODUCT FALLBACK, never to argv", () => {
  // Driven rather than asserted from source: the whole chain, id -> alias -> argv.
  const CLAUDE_MODELS = require(join(MAIN, "runtime", "claude", "models.js"));
  const fallback = model.aliasForModelId(model.LAUNCH_MODEL_FALLBACK);
  for (const junk of JUNK) {
    assert.equal(CLAUDE_MODELS.launchArg(model.aliasForModelId(junk)), fallback, JSON.stringify(junk));
  }
  for (const id of model.MODEL_IDS) {
    assert.match(CLAUDE_MODELS.launchArg(model.aliasForModelId(id)), /^[a-z]+$/, id);
  }
});

// ── 4. THE LIVE SWITCH ───────────────────────────────────────────────────────────────────────

/** `setModelByTask`, sliced from the shipped op and driven against a fake registry + query. */
function live({ query, settled = false, runtimeId = "claude" } = {}) {
  const src = read("session-reopen.js");
  // fnOf starts at `function`, so the `async` modifier is restored here.
  const body = fnOf(src, "resolveSession") + "\nasync " + fnOf(src, "setModelByTask");
  const s = { key: "c:t:a1b2c3d4", agentId: "a1b2c3d4", settled, model: "", query, runtimeId };
  const sessions = new Map([[s.key, s]]);
  // ⚠ `runtimeRegistry` / `runtimeCopy` JOINED THE INJECTED SET ON 2026-09-21 (U10) AND ARE REAL.
  // `setModelByTask` now asks the SESSION'S OWN descriptor whether a live model switch is a thing
  // this runtime does — `capability.js › canSwitchModelLive`'s first consumer in `main/` — so
  // driving it against a stub would pin nothing about the refusal that matters.
  const fn = new Function(
    "deps", "store", "sessionModel", "runtimeRegistry", "runtimeCopy",
    `${body}\n return setModelByTask;`
  )(
    { sessions },
    { slotKey: (x) => `${x.channelId || ""}:${x.taskId || ""}:${x.agentId || ""}`,
      threadKeyPrefix: (c, t) => `${c || ""}:${t || ""}:` },
    model,
    RUNTIME_REGISTRY, RUNTIME_REGISTRY.copy
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
  // ⚠ 2026-09-22: resolved on the SESSION'S OWN RUNTIME'S roster (`runtime.modelArg`). With nothing
  // read live here that is the adapter's fallback table, so the id reaches the SDK as that row's
  // launch value (`opus`) and the session records the row's id.
  return h.fn({ ...address, model: "claude-opus-5" }).then((res) => {
    assert.deepEqual(res, { ok: true, model: "claude-opus-5" });
    assert.deepEqual(seen, ["opus"], "the row's own launch value reaches the SDK");
    assert.equal(h.s.model, "claude-opus-5", "…and the pick is recorded on the session object");
  });
});

test("LIVE: an unknown value is REFUSED with a sentence — it used to RESET the session silently", () => {
  // ⚠ REVERSED 2026-09-22. This pinned "an unknown value is ACCEPTED and normalized, never
  // refused", which meant an operator who picked one model was moved onto another without being
  // told. The switch now refuses, names what this machine offers, and changes nothing.
  const seen = [];
  const h = live({ query: { setModel: async (m) => { seen.push(m); } } });
  return h.fn({ ...address, model: "claude-opus-4-5" }).then((res) => {
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no-model");
    assert.match(res.detail, /does not offer the model "claude-opus-4-5"/);
    assert.deepEqual(seen, [], "nothing reached the SDK");
    assert.equal(h.s.model, "", "and nothing was recorded");
  });
});

test("LIVE: a THROWING switch records NOTHING — a pick nothing applied is a lie", () => {
  const h = live({ query: { setModel: async () => { throw new Error("query is gone"); } } });
  return h.fn({ ...address, model: "claude-fable-5" }).then((res) => {
    assert.deepEqual(res, { ok: false, reason: "switch-failed" });
    assert.equal(h.s.model, "", "the previous pick survives an attempt that did not land");
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
    assert.deepEqual(res, { ok: true, model: "claude-sonnet-5" });
    assert.equal(h.s.model, "claude-sonnet-5");
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
  assert.match(read("runtime/claude/launch-spec.js"), /sdk\.query\(\{ prompt: watch\.stamp\(spec\.prompt\)/,
    "streaming input mode, which is the condition on the method");
  assert.match(read("session-query.js"), /s\.pushIterator = io\.makePushIterator\(\);/,
    "…and the prompt core puts on the spec is that iterator");
});

// ── 5. WHAT THE UI IS TOLD ───────────────────────────────────────────────────────────────────

test("REPORT: the summary reports the SDK's own model over the operator's pick", () => {
  const SUMMARY = read("session-summary.js");
  assert.match(SUMMARY, /model: \(s && s\.liveModel\) \|\| modelPick\(s\),/);
  const pick = fnOf(SUMMARY, "modelPick");
  assert.match(pick, /return pickOf\(s && s\.model\) \|\| null;/, "the ONE spelling of 'no pick' (RC-15)");
  const { pickOf } = require(join(MAIN, "runtime", "selection-vocabulary.js"));
  for (const none of ["default", " default ", "", "  ", null, undefined, 7]) {
    assert.equal(pickOf(none), "", `'default' names no model and must not be rendered as one (${String(none)})`);
  }
  assert.equal(pickOf(" gpt-6-sol "), "gpt-6-sol");
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
  assert.match(mirror, /interface DoplBridge extends SpaBridgeSurface/,
    "…which the SPA's bridge type extends rather than re-declares");
  const preload = readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8");
  // The durable posture has no model field: the preload forwards none.
  assert.doesNotMatch(codeOf(preload), /preset\.model/, "the durable posture forwards no model");
  assert.match(preload, /setModel: \(channelId, taskId, model, agentId\) =>/,
    "and the preload is the ground truth all three follow");
});

// ── 5. U10 (2026-09-21): A RECORDED PICK NOTHING APPLIED IS A LIE, ON EVERY RUNTIME ──────────
//
// ⚠ THE DEFECT THESE CLOSE. The `setModel` call is guarded by `typeof … === 'function'`, so on a
// runtime whose live handle has no model verb NOTHING was applied — and the write below it still
// recorded the alias and answered `{ ok: true }`. `buildLaunchSpec` reads that value on the NEXT
// assembly, so the session came back on a model the operator had been told it was already using.
// It also wrote CLAUDE's alias onto another runtime's session, which is the cross-vocabulary
// coercion the adapter seam exists to stop.

test("U10: a runtime whose live model switch is UNVERIFIED refuses, with a reason", async () => {
  const seen = [];
  const h = live({ runtimeId: "codex", query: { setModel: async (m) => { seen.push(m); } } });
  const res = await h.fn({ ...address, model: "claude-opus-5" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unsupported");
  assert.match(res.detail, /Codex/, res.detail);
  assert.match(res.detail, /has not been measured/, "unverified is worded apart from a measured no");
  assert.deepEqual(seen, [], "nothing was told");
  assert.equal(h.s.model, "", "and nothing was recorded — the whole point");
});

test("U10: a handle with no model verb refuses instead of recording a switch it did not make", async () => {
  // ⚠ THE DECLARATION AND THE HANDLE CAN DISAGREE, and the handle wins. Cursor DECLARES
  // `liveModelSwitch: true`; a query object with no `setModel` is the promise not being kept, and
  // recording over either one is the same lie.
  const h = live({ runtimeId: "cursor", query: { __noModelVerb: true } });
  const res = await h.fn({ ...address, model: "claude-opus-5" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unsupported");
  assert.match(res.detail, /Cursor/, res.detail);
  assert.equal(h.s.model, "");
});

test("U10: Claude is untouched — the refusal is per runtime, not a new blanket rule", async () => {
  const seen = [];
  const h = live({ runtimeId: "claude", query: { setModel: async (m) => { seen.push(m); } } });
  // 2026-09-22: the RECORD is the roster row's id; what the SDK is told is that row's launch value.
  assert.deepEqual(await h.fn({ ...address, model: "claude-opus-5" }), { ok: true, model: "claude-opus-5" });
  assert.deepEqual(seen, ["opus"]);
});
