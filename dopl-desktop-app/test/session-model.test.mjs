// THE PER-SESSION MODEL (2026-08-02), rewritten down on 2026-08-20 when the v1 session window
// went (F-228).
//
// It arrived as a third control in the status strip and the one with the sharpest edge in that
// window: its value becomes `--model <argv>` on a child process. THE PICKER IS GONE — the strip,
// its <select>, the preload that coerced the click and the IPC that applied it all lived in the
// deleted window. THE VALUE IS NOT. A session still carries a model, `buildSdkOptions` still
// spends it on every spawn shape, the durable record still round-trips it, and every one of
// those is still a boundary a hostile string must not cross.
//
// So the rule the file was built on is unchanged and is now the whole file: a FROZEN ENUM,
// coerced or rejected at every boundary, failing closed to 'default' (which sets no model option
// at all and leaves the CLI its own pick, i.e. exactly what every session did before this
// existed).
//
// WHAT THIS FILE PROVES, and it drives the shipped code for all of it:
//   0. the frozen tables evaluate standalone — no require, no electron, no process state
//   1. the enum and the argv it produces
//   3. buildSdkOptions carries the model on every spawn shape, from the one assembly point,
//      and re-coerces there too
//   4. the durable round trip preserves it, a hostile stored value lands on 'default', and the
//      one construction site coerces what a spec hands in
//
// ⚠ SECTIONS 2, 5 AND 6 END IN COMMENT BLOCKS. §2 pinned the FOUR copies of the enum against
// each other, two of which were renderer files; §5 drove `session:set-model` from three sender
// shapes; §6 pinned the diag line every axis change left behind. All three read surfaces that no
// longer exist — the argument is at each site.
//
// METHOD is the directory idiom: slice the REAL functions (helpers/source-probe fnOf/between)
// and drive them with fakes. No test here asserts on source text where it could assert on
// behavior; the one pin that remains is about what a CONSTRUCTION SITE passes, which is not
// observable any other way without booting electron.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const model = require("../main/session-model.js");
const SPEC = M("runtime/claude/launch-spec.js");
const IO = M("session-io.js");
const STORE = M("session-store.js");
const PARK = M("session-park.js");
const ENGINE = M("session-engine.js");

// ⚠ `"claude-opus-5"` LEFT THIS LIST ON 2026-08-22 (Samuel's model-selection ruling) AND IT IS
// NOT A WEAKENING. It was junk because the picker's only vocabulary was ALIASES; the ruling names
// the values an operator picks as FULL IDS, so the durable per-channel posture stores one and
// `normalizeModel` now accepts BOTH — answering, always, in the alias vocabulary that reaches
// argv. The four ids are a FROZEN list of their own (`MODEL_IDS`) and are coerced exactly as
// hard; `§1b` below drives them, and the shell-shaped strings that made this list matter are
// all still here.
const JUNK = ["", " ", null, undefined, 0, 1, true, {}, [], "Opus", "opus ", "sonnet;rm -rf /",
  "claude-opus-4-5", "--dangerously-skip-permissions", "opus --print", "haiku\n--model=x"];

// ── 0. the frozen tables stand alone ─────────────────────────────────────────
// The sentinel block evaluated in a plain Node context with NO require, NO electron and NO
// process state: the WATCHER-PURE idiom. It is what stops the two tables every other layer
// coerces against from quietly growing a dependency on app state.

test("the frozen tables evaluate standalone, with nothing in scope but themselves", () => {
  const SRC = M("session-model.js");
  const from = SRC.indexOf("// ─── BEGIN SESSION-MODEL");
  const to = SRC.indexOf("// ─── END SESSION-MODEL");
  assert.notEqual(from, -1, "BEGIN sentinel missing");
  assert.ok(to > from, "sentinels out of order");
  const block = SRC.slice(from, to);
  assert.ok(!/require\(|electron|process\.|require\b/.test(block), "the block reaches nothing");
  const pure = new Function(`${block}
    return { MODEL_CHOICES, normalizeModel, modelArg, contextWindowFor, promptTokens, contextEvent };`)();
  assert.deepEqual(pure.MODEL_CHOICES, model.MODEL_CHOICES);
  assert.equal(pure.modelArg("rm -rf /"), null);
  assert.equal(pure.contextWindowFor("claude-opus-5"), 1000000);
  assert.deepEqual(pure.contextEvent(0, "claude-opus-5"), null, "nothing measured, nothing said");
});

// ── 1. the enum, and the argv it produces ────────────────────────────────────

test("the enum offers exactly five choices, with the fail-closed one first", () => {
  assert.deepEqual(model.MODEL_CHOICES, ["default", "opus", "sonnet", "haiku", "fable"]);
  assert.equal(model.MODEL_CHOICES[0], "default",
    "[0] is the coercion target, the same convention 'manual' / 'ask' follow");
});

test("normalizeModel takes a member and refuses everything else", () => {
  for (const m of model.MODEL_CHOICES) assert.equal(model.normalizeModel(m), m);
  for (const junk of JUNK) assert.equal(model.normalizeModel(junk), "default", JSON.stringify(junk));
});

// ── 1b. THE SECOND VOCABULARY: FULL IDS (2026-08-22, Samuel's model-selection ruling) ────────
// The UI and the durable per-channel posture speak FULL IDS; argv speaks ALIASES. Two frozen
// lists and one map between them, because each is right about a different thing: an id is what
// an operator picked and must round-trip through the bridge unchanged, an alias is
// version-stable and is what may become `--model`.

test("the id list is frozen, and the four members are the ruling's four", () => {
  assert.deepEqual(model.MODEL_IDS,
    ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]);
});

test("normalizeModelId takes a member and answers '' — ABSENT — for everything else", () => {
  // ⚠ ABSENT, NOT A MEMBER. There is no 'default' id: an unchosen model is the SDK's own pick,
  // which is today's behaviour for every channel that has never touched this, and the durable
  // posture OMITS the key rather than storing a sentinel.
  for (const id of model.MODEL_IDS) assert.equal(model.normalizeModelId(id), id);
  for (const junk of JUNK.concat(["opus", "claude-opus-5 ", "CLAUDE-OPUS-5"])) {
    assert.equal(model.normalizeModelId(junk), "", JSON.stringify(junk));
  }
});

test("aliasForModelId is the seam, and it fails closed to 'default'", () => {
  assert.equal(model.aliasForModelId("claude-fable-5"), "fable");
  assert.equal(model.aliasForModelId("claude-opus-5"), "opus");
  assert.equal(model.aliasForModelId("claude-sonnet-5"), "sonnet");
  assert.equal(model.aliasForModelId("claude-haiku-4-5-20251001"), "haiku");
  for (const junk of JUNK) assert.equal(model.aliasForModelId(junk), "default", JSON.stringify(junk));
});

test("normalizeModel accepts BOTH vocabularies and answers in exactly one", () => {
  // A caller holding an id (the durable posture) and a caller holding an alias (the per-session
  // picker) must not have to know which one the layer below wants — that is how a value reaches
  // argv un-coerced. The ANSWER is always an alias, so `modelArg` below is unchanged.
  for (const m of model.MODEL_CHOICES) assert.equal(model.normalizeModel(m), m);
  for (const id of model.MODEL_IDS) {
    const out = model.normalizeModel(id);
    assert.notEqual(model.MODEL_CHOICES.indexOf(out), -1, id);
    assert.equal(out, model.aliasForModelId(id));
  }
  for (const junk of JUNK) assert.equal(model.normalizeModel(junk), "default", JSON.stringify(junk));
});

test("an ID still cannot reach argv as itself — the alias is what argv gets", () => {
  // The argv gate is unchanged and this is the case that says so: whatever vocabulary went in,
  // what comes out is one lowercase word from the frozen alias list, or nothing at all.
  for (const id of model.MODEL_IDS) {
    const arg = model.modelArg(id);
    assert.match(arg, /^[a-z]+$/, id);
    assert.notEqual(model.MODEL_CHOICES.indexOf(arg), -1, id);
  }
});

test("modelArg is the argv gate: null for 'default', the bare alias otherwise, junk NEVER", () => {
  assert.equal(model.modelArg("default"), null, "no model option at all — the CLI's own pick");
  assert.equal(model.modelArg("opus"), "opus");
  assert.equal(model.modelArg("fable"), "fable");
  for (const junk of JUNK) {
    assert.equal(model.modelArg(junk), null, JSON.stringify(junk));
  }
  // A shell-shaped string can never come back out, whatever went in.
  for (const m of model.MODEL_CHOICES) {
    const arg = model.modelArg(m);
    if (arg !== null) assert.match(arg, /^[a-z]+$/, "an alias is one lowercase word or it is nothing");
  }
});

// ── ⚠ 2. THE FOUR-COPY PIN ENDED HERE — 2026-08-20, F-228 ────────────────────
//
// One test, and it was the reason the enum could be duplicated at all. A sandboxed preload
// cannot require main, the reducer-block extraction cannot either, and the durable whitelist is
// evaluated standalone — so the list lived in FOUR places on purpose and this case drove all
// four against `main/session-model.js`: (a) the preload's `asModel` coercion, (b) the
// view-model's echo guard, (c) the durable whitelist, and (d) the picker's own
// `<option value="…">` set, in order, plus a guard that the picker was NOT markup-shaped like a
// third permission axis.
//
// ⚠ TWO OF THE FOUR COPIES ARE DELETED. `renderer/session/session-preload.js` and
// `session-viewmodel.js` went with the window, and `session.html` — which (d) read — went with
// them, so there is no markup offering model values anywhere. The list is no longer duplicated:
// `main/session-model.js` is the only copy, `main/session-store.js`'s whitelist reads it through
// §4 below, and §0 proves the table is standalone. A four-way agreement test over one surviving
// copy is not a weakened guard, it is a tautology.
//
// ⚠ THE RULE TO RE-APPLY IF A NEW SURFACE EVER OFFERS THIS ENUM: a surface may only offer values
// main will spend, and the agreement is asserted by DRIVING each copy's coercion, never by
// grepping for the words. `test/session-permission-axes.test.mjs` holds the same discipline for
// the two posture tables and is the pattern to copy.

// ── 3. buildSdkOptions: the ONE assembly point, on every spawn shape ─────────
// The real function, sliced and evaluated with fakes for every module it reaches. This is the
// same reason session-query exists: a fresh launch, a parked resume and the post-sign-in
// relaunch all come through here, so proving it once proves it for all of them.

// ⚠ 2026-08-31 (runtime-adapter port, steps 3–4): the option assembly is the RUNTIME ADAPTER's
// (`main/runtime/claude/launch-spec.js › buildOptions`) — it is written in one platform's option
// vocabulary, so it belongs to that platform. It is still the ONE assembly point for every spawn
// shape, which is the property this section is about, and the model coercion it performs is
// unchanged. The fakes moved with it: the platform-facing helpers now arrive as one `loader`
// object and the gate as `axisB`.
// ⚠ 2026-09-02 (A10/G19): `buildOptions` now reads ONE module-scope constant,
// `SESSION_MAX_TURNS`, and a sliced function cannot see its module. It is
// injected like every other module-scope reference here, and the VALUE is read
// out of the shipped SOURCE rather than restated — the discipline
// `sdk-mcp-token.test.mjs` follows for mcp-config's timeout, so this harness can
// never drift from the number that ships.
// ⚠ DERIVED SINCE 2026-09-05 (task 9a): the brake is `MAX_TURNS_FACTOR * OPERATOR_TURN_CAP`,
// not a literal, so a regex for a literal threw and took this whole file down with it. Both
// factors are read off the shipping source and multiplied here — same "read it, never restate
// it" rule, one level down, exactly as `launch-max-turns.test.mjs` already does.
const shippedNum = (src, name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(src);
  if (!m) throw new Error(`${name} is no longer a literal declaration in the shipped source`);
  return Number(m[1]);
};
const SHIPPED_MAX_TURNS =
  shippedNum(SPEC, "MAX_TURNS_FACTOR") * shippedNum(M("session-state.js"), "OPERATOR_TURN_CAP");

function assembled(s) {
  const src = `${fnOf(SPEC, "buildOptions")}\n return buildOptions;`;
  const fake = new Function(
    "tools", "channelDirs", "loader", "sessionAuth", "sessionOutbound", "axisB", "diag",
    "store", "sessionModel", "sessionCredential", "agentOps", "SESSION_MAX_TURNS", src
  )(
    { buildSessionToolConfig: () => ({ preApproved: [], disallowedTools: [], doplToolsPolicy: "full", builtinTools: [] }) },
    { sessionSpawnDir: () => "/tmp" },
    {
      buildSecretPathDenyRules: () => [],
      buildMcpServers: () => ({}),
      buildScrubbedEnv: () => ({}),
      withSessionStamp: () => {},
      // The per-run ROLE stamp (2026-09-02). Inert here like the session stamp beside it —
      // this file is about the MODEL — but the assembly calls it, and a fake missing a
      // function the one assembly point invokes fails every test in the file at once.
      withToolProfileStamp: () => {},
      resolveClaudeExecutable: () => null,
    },
    { withStoredCredential: (e) => e },
    { wrapGate: () => () => {} },
    // agent-self-ops (2026-08-31): no server in this harness — the real builder answers null
    // outside Electron too (its own test pins that), so options carry no dopl_agents entry.
    { makeCanUseTool: () => () => {}, makeAgentOpsServer: () => null },
    () => {},
    { slotKey: () => "c1:t1" },
    require("../main/session-model.js"),
    // 🔒 THE CONTAINER LOCK (plan §4.4 B1) — an UNLOCKED session, which is what every assertion
    // in this file is about. The assembly passes this bearer to `buildMcpServers` as a third
    // argument; '' means "use the device token", i.e. the pre-ceiling behaviour.
    { sessionBearer: () => "" },
    { AGENT_OPS_TOOL_NAMES: [], SERVER_KEY: "dopl_agents" },
    SHIPPED_MAX_TURNS
  );
  return fake(s);
}

const session = (over) => ({ profile: "full", channelId: "c1", workspaceId: "w1", taskId: "t1", ...over });

test("the launch spec carries the picked model on a FRESH launch", () => {
  assert.equal(assembled(session({ model: "opus" })).model, "opus");
  assert.equal(assembled(session({ model: "fable" })).model, "fable");
});

test("the launch spec carries it on a RESUME too — one assembly point, so park/resume is free", () => {
  const opts = assembled(session({ model: "sonnet", resumeSdkId: "sdk-1" }));
  assert.equal(opts.model, "sonnet");
  assert.equal(opts.resume, "sdk-1", "and the resume is still the only field that differs");
});

test("'default' sets NO model field at all, so the CLI keeps its own pick", () => {
  for (const s of [session({ model: "default" }), session({ model: null }), session({})]) {
    assert.ok(!("model" in s ? Object.prototype.hasOwnProperty.call(assembled(s), "model") : false),
      "an absent or default pick leaves the option unset");
    assert.equal(assembled(s).model, undefined);
  }
});

test("the launch spec re-coerces: a hostile s.model can never reach argv", () => {
  for (const junk of JUNK) {
    assert.equal(assembled(session({ model: junk })).model, undefined, JSON.stringify(junk));
  }
});

test("the model changed NOTHING else about the assembled options", () => {
  const opts = assembled(session({ model: "opus" }));
  assert.deepEqual(opts.settingSources, [], "the global allow-list still can never shadow a gate");
  assert.equal(opts.permissionMode, "default");
  assert.equal(opts.includePartialMessages, false);
});

// ── 4. the durable round trip ────────────────────────────────────────────────

const baseRecord = new Function(`${fnOf(IO, "baseRecord")}\n return baseRecord;`)();
const durable = new Function(`${fnOf(STORE, "durableName")}\n${fnOf(STORE, "durableSessionRecord")}
                              return durableSessionRecord;`)();
const live = (over = {}) => ({
  key: "c1:t1", sessionId: "s1", channelId: "c1", taskId: "t1", workspaceId: "w1",
  side: "responder", profile: "full", mode: "interactive", startedAt: 1,
  state: { phase: "running", turns: 0, costUsd: 0 }, context: {}, ...over,
});

test("the model survives the round trip a P2 recreate depends on", () => {
  for (const m of ["opus", "sonnet", "haiku", "fable"]) {
    assert.equal(durable(baseRecord(live({ model: m }))).model, m, m);
  }
  assert.equal(durable(baseRecord(live())).model, "default", "a session that never picked one");
});

test("a HOSTILE stored value coerces to 'default' on the way out of the projection", () => {
  // The store is a plain JSON file on disk. This is the whole reason the whitelist coerces.
  for (const junk of JUNK) {
    assert.equal(durable(baseRecord(live({ model: junk }))).model, "default", JSON.stringify(junk));
    assert.equal(durable({ model: junk }).model, "default", "and straight into the whitelist too");
  }
});

test("a record written BEFORE this field existed reopens on the CLI default, not on undefined", () => {
  const old = durable({ key: "c1:t1", channelId: "c1", phase: "parked" });
  assert.equal(old.model, "default");
  assert.equal(model.modelArg(old.model), null, "which assembles to no model option at all");
});

test("the record-driven resume hands the stored pick back to startSession", () => {
  // What a spawn shape PASSES is not observable from outside without booting electron, and it
  // is the whole point: a resume that dropped this would silently revert the operator's pick.
  // ⚠ THIS CASE USED TO DRIVE TWO SHAPES. `recreateParkedShell` — the shell-recreate lane — is
  // deleted with the window it opened (2026-08-20, F-228); `startResume`, the crash/interrupted
  // resume, is the only record-driven spawn left and carries the field unchanged.
  assert.match(fnOf(PARK, "startResume"), /model: rec\.model/, "startResume carries the record's model");
});

test("the ONE construction site coerces what a spec hands in", () => {
  // ⚠ REWRITTEN DOWN (2026-08-20, F-228). The original asserted a two-term precedence —
  // `sessionConsent.takeStartModel(spec.adoptsConsent === true ? spec.key : null) || spec.model`
  // — where the pre-consent card's entry-scoped, single-use pick beat the spec's stored value.
  // The card, its registry and the `adoptsConsent` gate are all deleted, so `spec.model` is the
  // only term left. The COERCION is the half that survives and it is asserted nowhere else:
  // buildSdkOptions (§3) re-coerces, and the store (§4) coerces, but each of those is a second
  // fence — this is the first, and a hand-edited durable record reaches it before either.
  const line = ENGINE.split("\n").find((l) => l.includes("model: sessionModel.normalizeModel("));
  assert.ok(line, "the model assignment moved — reslice it");
  assert.match(line, /model: sessionModel\.normalizeModel\(spec\.model\)/,
    "the spec's value is coerced against the frozen enum, never trusted");
  assert.ok(!/takeStartModel|adoptsConsent/.test(line), "no second term on this line");
  assert.ok(!/takeStartModel/.test(ENGINE), "and the consent module is unreachable from the engine");
  // ⚠ `adoptsConsent` is deliberately NOT asserted absent from the whole file: `launch()` still
  // passes `adoptsConsent: adoptable` on an identifier that no longer exists anywhere in it.
  // Nothing READS the field, so it cannot change this line's behaviour — it is a dangling
  // reference to file, not something a test in this suite should paper over.
});

// ── ⚠ 5. session:set-model ENDED HERE — 2026-08-20, F-228 ────────────────────
//
// Fourteen tests and two harnesses (`ipcHarness`, slicing the REAL `session:set-model`
// registration + `modelChange` out of main/session-ipc.js; `consentRegistry`, slicing the REAL
// `armModel`/`takeStartModel` out of main/session-consent.js). They drove the handler from all
// three sender shapes and pinned, among other things:
//
//   (a) a LIVE sender — the pick lands on `s.model` AND on the running query via
//       `Query.setModel`; 'default' hands the SDK `undefined`, its own "use the default"; junk
//       coerces fail-closed and the {ok} reports the COERCED value; a parked session with no
//       query still records it for its next assembly; a `setModel` that throws or REJECTS is
//       never fatal.
//   FIX L2 — a running child on an SDK build that cannot switch answers `{ok:true, deferred:true}`
//       and echoes `{choice, pending:true}`, because a bare {ok:true} was indistinguishable from
//       a real live switch; a query that CAN switch carries no `pending` and no `deferred` key
//       at all; and the view-model kept `modelChoice` (the operator's ask) apart from `liveModel`
//       (what really served a turn).
//   (b) a CONSENT-only sender, (c) an UNKNOWN sender, and the resolution order between them.
//
// ⚠ THERE IS NO LIVE MODEL SWITCH ANY MORE, AND THAT IS THE POINT: `main/session-ipc.js` and
// `main/session-consent.js` are deleted, and `grep -rn "setModel" main/` returns only the two
// COMMENTS in session-reducer.js and session-state.js that explain where a mid-session model
// change used to come from. A session's model is fixed at spawn from `spec.model` (§4's last
// case) and spent by `buildSdkOptions` (§3). Nothing renderer-reachable can move it.
//
// ⚠ FIX L2 IS THE ONE WORTH RE-READING BEFORE ANY NEW SURFACE OFFERS THIS CONTROL. Its rule is
// not about models: an answer must distinguish "applied now" from "recorded for later", or every
// caller downstream is free to invent which one happened. The same defect, in the other
// direction, is F1 in test/session-decision-truth.test.mjs.
//
// ⚠ AND THE STATE HALF STILL EXISTS, UNGUARDED BY THIS FILE: `session-reducer.js` still keeps
// `state.model` — the model that really SERVED a turn, read off `result.model` — apart from the
// session's `s.model` ask. Nothing here reaches it; test/session-context-meter.test.mjs is where
// that field's readers live.

// ── ⚠ 6. THE DIAG LINE ENDED HERE — 2026-08-20, F-228 ────────────────────────
//
// Three tests over the one line every axis change left behind:
// `session posture: model=opus session=abcdef01` — the axis, the COERCED value, and an 8-char
// session prefix, never the whole id and never any prompt text, drafted body or tool input.
// Logged for a REFUSED change too, because the silence was what it existed to remove; and the
// two POSTURE axes were pinned to the same shape, since `listener.log` is plaintext.
//
// ⚠ EVERY WRITER OF THAT LINE WAS IN main/session-ipc.js — `grep -rn "session posture" main/`
// is now empty. There is no axis change to log because there is no per-session axis IPC.
//
// ⚠ THE RULE OUTLIVES THE LINE and belongs to whatever logs the next one: a diag line carries a
// value and an id PREFIX and nothing else. `listener.log` is plaintext on the user's disk, so a
// body, a prompt or a whole session id in it is a disclosure, not a debugging aid.
